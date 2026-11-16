// Shared port of the first-email checks, as pure functions (no n8n globals).
//
// Sources (pinned copies under ./upstream/, compared by `npm run test:drift`):
//   - WF2 'Compliance check'  -> complianceIssues(): the lead-level gate. Any reason => status 'Blocked'.
//   - WF2 'Check Draft'       -> the draft rules, sensitiveIssues() and fixAddressLineBreak(). Any reason => 'Needs fix'.
//   - Dashboard-only rule (approval plan, risk table): the body must still contain a line exactly equal to
//     Settings 'Sender Name', or buildHtml() loses the signature styling => note 'signature line not found'.
// Rule order and message texts are the same as in the nodes so the dashboard shows the same reasons.
// The n8n node writes the reasons joined with '; ' into 'Compliance Notes'; here they are returned as an array.
//
// Self-contained: no imports. Every helper lives in this file (complianceIssues, sensitiveIssues,
// fixAddressLineBreak); the suppression test inside complianceIssues is WF2's own copy of the rule, not
// recipient.js isSuppressed(), so this file can be pasted alone into an n8n Code node.

// Gmail turns "<street> Sk. No: 41" into a map link; a line break before "No:" stops it (WF2 'Check Draft').
function fixAddressLineBreak(body) {
  return String(body == null ? '' : body).replace(/(\b(?:Sk|Sok|Cad|Cd|Bulv)\.|\bSokak|\bSokağı|\bCaddesi|\bBulvarı)[ \t]+(No\s*[:.])/g, '$1\n$2');
}

// WF2 'Compliance check' for one lead row. `suppression` = rows of the Suppression tab ({ Email, Domain, ... }).
function complianceIssues(lead, suppression) {
  lead = lead || {};
  const freeDomains = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'yandex.com', 'icloud.com'];
  // Every country the admin can pick in Settings 'Target Countries' (WF0 only searches the picked ones).
  const allowedCountries = ['turkey', 'türkiye', 'turkiye', 'bangladesh', 'vietnam', 'viet nam', 'malaysia', 'brazil', 'brasil'];

  // Suppression tab: emails and domains that must never be contacted (İYS "ret" opt-outs, manual do-not-contact, bounces).
  const supp = (suppression || []).filter(r => r && (r.Email || r.Domain));
  const suppEmails = new Set(supp.map(r => String(r.Email || '').toLowerCase().trim()).filter(Boolean));
  const suppDomains = supp.map(r => String(r.Domain || '').toLowerCase().replace(/^@/, '').trim()).filter(Boolean);

  function domainOf(url) {
    return String(url || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
  }

  const reasons = [];
  const email = String(lead.Email || '').trim().toLowerCase();
  const emailDomain = email.includes('@') ? email.split('@')[1] : '';
  const siteDomain = domainOf(lead.Website);

  if (!email) reasons.push('Email is empty');
  if (emailDomain && freeDomains.includes(emailDomain)) reasons.push('Free or personal email domain');
  if (String(lead['Opt-out'] || '').trim().toLowerCase() === 'yes') reasons.push('Lead opted out');
  if (email && suppEmails.has(email)) reasons.push('On suppression list (İYS ret / do-not-contact)');
  else if (emailDomain && suppDomains.some(sd => emailDomain === sd || emailDomain.endsWith('.' + sd))) reasons.push('Email domain on suppression list');
  if (emailDomain && siteDomain && !freeDomains.includes(emailDomain)) {
    const matches = emailDomain === siteDomain || emailDomain.endsWith('.' + siteDomain) || siteDomain.endsWith('.' + emailDomain);
    if (!matches) reasons.push('Email domain does not match website domain');
  }
  if (!allowedCountries.includes(String(lead.Country || '').trim().toLowerCase())) reasons.push('Country not allowed');
  return reasons;
}

// WF2 'Check Draft' + WF2 'Compliance check' + the dashboard signature rule.
// Input:  { subject, body, lead: LeadRow, settings: Settings, suppression: SuppressionRow[] }
// Output: { status: 'OK' | 'Needs fix' | 'Blocked', notes: string[], body: string (after fixAddressLineBreak) }
function checkDraft(input) {
  const args = input || {};
  const subject = String(args.subject || '').trim();
  const body = String(args.body || '');
  const lower = body.toLowerCase();
  const settings = args.settings || {};
  const lead = args.lead || {};
  const isTr = String(lead.Language || '').trim().toLowerCase() === 'tr';

  const blocked = complianceIssues(lead, args.suppression);
  const reasons = [];

  const has = (s) => s && lower.includes(String(s).toLowerCase().trim());
  const start = (s, n) => String(s || '').trim().slice(0, n);
  const domainOf = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0].trim();

  if (!subject) reasons.push('Subject is empty');
  if (!body.trim()) reasons.push('Body is empty');
  if (!has(settings['Sender Name'])) reasons.push('Sender name missing');
  if (!has(settings['Company Legal Name'])) reasons.push('Company legal name missing');
  if (!has(start(settings['Company Address'], 12))) reasons.push('Company address missing');

  // Texprove's own website (Settings 'Company Website', default texprove.com) must be in the signature so prospects can check us out.
  const ownDomain = domainOf(settings['Company Website'] || 'texprove.com') || 'texprove.com';
  if (!lower.includes(ownDomain)) reasons.push('Texprove website missing from signature');

  const optOut = isTr ? settings['Opt-out TR'] : settings['Opt-out EN'];
  if (!has(start(optOut, 25))) reasons.push('Opt-out sentence missing (' + (isTr ? 'TR' : 'EN') + ')');

  const sourceOk = isTr ? has('web sitesinden aldık') : has('contact details on your company');
  if (!sourceOk) reasons.push('Data-source sentence missing');

  // Links: only the lead's own website and Texprove's website are allowed.
  const siteDomain = domainOf(lead.Website);
  const allowedDomains = [siteDomain, ownDomain].filter(Boolean);
  const links = body.match(/https?:\/\/[^\s)>\]]+/gi) || [];
  const foreign = links.filter(l => !allowedDomains.some(d => l.toLowerCase().includes(d)));
  if (foreign.length) reasons.push('Links to other sites: ' + foreign.join(', '));

  const words = body.trim().split(/\s+/).length;
  if (words > 190) reasons.push('Too long (' + words + ' words incl. signature)');

  const banned = ['garanti', 'guaranteed', '%100', '100%', 'ücretsiz', 'free trial', 'son şans', 'last chance'];
  const hits = banned.filter(b => lower.includes(b));
  if (hits.length) reasons.push('Hype wording: ' + hits.join(', '));

  // Trade-secret rule: check subject and body (the signature is from Settings and should never trip it).
  for (const r of sensitiveIssues(subject + '\n' + body)) reasons.push(r);

  const fixedBody = fixAddressLineBreak(body);

  // Dashboard-only rule: buildHtml() styles the signature from the line that equals Settings 'Sender Name'.
  // (An empty Sender Name is already reported as 'Sender name missing'.)
  const senderName = String(settings['Sender Name'] || '').trim();
  if (senderName && !fixedBody.replace(/\r/g, '').split('\n').some(l => l.trim() === senderName)) reasons.push('signature line not found');

  const notes = blocked.concat(reasons);
  return {
    status: blocked.length ? 'Blocked' : (reasons.length ? 'Needs fix' : 'OK'),
    notes,
    body: fixedBody,
  };
}

// Trade-secret rule (Nil's compliance plan): no buyer names, order volumes, prices, capacities or margins in outreach text.
// Verbatim from WF2 'Check Draft' (WF5 'Check Follow-up' has the same function; checkFollowup.js holds its own copy).
function sensitiveIssues(text) {
  const t = String(text || '');
  const low = t.toLowerCase();
  const issues = [];
  const buyers = ['zara', 'inditex', 'h&m', 'hennes', 'primark', 'c&a', 'mango', 'marks & spencer', 'm&s', 'tesco', 'lidl', 'aldi', 'decathlon', 'hugo boss', 'adidas', 'puma', 'nike', 'esprit', 's.oliver', 'tom tailor', 'bestseller', 'zalando', 'about you', 'otto', 'benetton', 'diesel', "levi's", 'levis', 'kiabi', 'celio', 'promod', 'etam', 'carrefour', 'auchan', 'tchibo', 'takko', 'ernsting', 'peek & cloppenburg', 'hunkemöller', 'we fashion', 'jack & jones', 'vero moda', 'pepe jeans', 'desigual', 'el corte ingl', 'cortefiel', 'mayoral', 'g-star', 'scotch & soda', 'zeeman', 'matalan', 'river island', 'new look', 'boohoo', 'asos', 'sinsay', 'cropp', 'mohito', 'pull&bear', 'pull & bear', 'bershka', 'stradivarius', 'massimo dutti', 'oysho', 'ikea', 'jysk', 'armani', 'gucci', 'prada', 'burberry', 'ralph lauren', 'tommy hilfiger', 'calvin klein', 'uniqlo', 'lacoste', 'superdry', 'jd sports', 'intersport', 'engelbert strauss', 'koton', 'defacto', 'lc waikiki'];
  // Whole-word match only: "zara" must not fire inside "yazarak", nor "otto" inside "cotton".
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordHit = (name) => new RegExp('(^|[^a-z0-9çğıöşüâîû])' + esc(name) + '(?=$|[^a-z0-9çğıöşüâîû])').test(low);
  const named = buyers.filter(wordHit);
  if (named.length) issues.push('Names a buyer or brand: ' + named.join(', '));
  if (/(€|£|₺|\$|\b(eur|usd|gbp|tl)\b)/i.test(t)) issues.push('Mentions money or prices');
  if (/\b\d[\d.,]*\s*(adet|parça|ton|tons|tonnes|kg|metre|meters|pcs|pieces|units|orders|order|sipariş)\b/i.test(t)) issues.push('Mentions order volumes or quantities');
  const words = ['sipariş hacmi', 'sipariş adedi', 'order volume', 'order quantity', 'minimum order', 'moq', 'fiyat', 'price', 'birim fiyat', 'tedarikçisi', 'supplier of', 'supplies to', 'supplier to', 'müşteriniz', 'your customer', 'your client', 'your buyer', 'alıcınız', 'customer list', 'müşteri listesi', 'kapasite', 'capacity', 'marj', 'margin', 'ciro', 'revenue', 'turnover'];
  const hits = words.filter(w => low.includes(w));
  if (hits.length) issues.push('Commercially sensitive wording: ' + hits.join(', '));
  return issues;
}

export { checkDraft, fixAddressLineBreak, complianceIssues, sensitiveIssues };
