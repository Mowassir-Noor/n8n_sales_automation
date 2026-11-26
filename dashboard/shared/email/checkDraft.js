// Shared port of the first-email checks, as pure functions (no n8n globals).
//
// Sources (pinned copies under ./upstream/, compared by `npm run test:drift`):
//   - WF2 'Compliance check'  -> complianceIssues(): the lead-level gate. Any reason => status 'Blocked'.
//   - WF2 'Check Draft'       -> the draft rules (Nil's decisions of 23 Nov 2026), nilRuleIssues(), sensitiveIssues() and
//     fixAddressLineBreak(). Any reason => 'Needs fix'.
//   - Dashboard-only rule (approval plan, risk table): the body must still contain a line exactly equal to
//     Settings 'Sender Name', or buildHtml() loses the signature styling => note 'signature line not found'.
// Rule order and message texts are the same as in the nodes so the dashboard shows the same reasons.
// The n8n node writes the reasons joined with '; ' into 'Compliance Notes'; here they are returned as an array.
//
// Self-contained: no imports. Every helper lives in this file (complianceIssues, nilRuleIssues, sensitiveIssues,
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
  // Language follows the company's country, not its website: Turkey = Turkish, everywhere else English.
  const isTr = ['turkey', 'türkiye', 'turkiye'].includes(String(lead.Country || '').trim().toLowerCase());
  const brand = /^(marka|brand)$/i.test(String(lead.Segment || '').trim());

  const blocked = complianceIssues(lead, args.suppression);
  const reasons = [];

  const has = (s) => s && lower.includes(String(s).toLowerCase().trim());
  const start = (s, n) => String(s || '').trim().slice(0, n);
  const domainOf = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0].trim();
  const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

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

  // The value sentence for this audience and language must be in the mail (exporters: Settings 'Value Prop Exporter TR/EN';
  // brands: the sentence of Nil's brand template).
  const valueProp = brand ? (isTr ? 'tek platformdan talep edip doğrulama' : 'one platform to request and verify') : (isTr ? settings['Value Prop Exporter TR'] : settings['Value Prop Exporter EN']);
  if (!squash(valueProp) || !squash(body).includes(squash(valueProp))) reasons.push('Value proposition sentence missing (' + (brand ? 'brand' : 'exporter') + ', ' + (isTr ? 'TR' : 'EN') + ')');

  const words = body.trim().split(/\s+/).length;
  if (words > 330) reasons.push('Too long (' + words + ' words incl. signature)');

  const banned = ['garanti', 'guaranteed', '%100', '100%', 'son şans', 'last chance'];
  const hits = banned.filter(b => lower.includes(b));
  if (hits.length) reasons.push('Hype wording: ' + hits.join(', '));

  // Nil's rules: one offer (30-minute demo), one link (calendar), allowed dates and claims only, right language.
  for (const r of nilRuleIssues(subject + '\n' + body, { lang: isTr ? 'tr' : 'en', calendarLink: settings['Calendar Link'], ownDomain, senderName: settings['Sender Name'] })) reasons.push(r);

  // Trade-secret rule: check subject and body (the signature is from Settings and should never trip it).
  for (const r of sensitiveIssues(subject + '\n' + body, brand ? lead.Company : '')) reasons.push(r);

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

// Nil's email rules of 23 Nov 2026 (decision log sections 1, 3, 8, 9), as plain code.
// Verbatim from WF2 'Check Draft' (WF5 'Check Follow-up' has the same function; checkFollowup.js holds its own copy).
// o = { lang: 'tr' | 'en', calendarLink, ownDomain, senderName }. Returns a list of reasons (empty = passes).
function nilRuleIssues(text, o) {
  const t = String(text || '');
  const low = t.toLowerCase();
  const issues = [];
  const opt = o || {};
  const cal = String(opt.calendarLink || '').trim();
  const own = String(opt.ownDomain || 'texprove.com').toLowerCase();

  // Required: the 30-minute live demo and the calendar link (read from Settings 'Calendar Link').
  if (!/30[\s-]*(dakikalık|dakika|dk|minute|min)\b/i.test(t) || !/demo/i.test(t)) issues.push('30-minute demo offer missing');
  if (!cal) issues.push("Settings 'Calendar Link' is empty");
  else if (!t.includes(cal)) issues.push('Calendar link missing');

  // Links: only the calendar link and Texprove's own website.
  const links = t.match(/(https?:\/\/|www\.)[^\s)>\]]+/gi) || [];
  const foreign = links.filter(l => !(cal && l.startsWith(cal)) && !l.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(own));
  if (foreign.length) issues.push('Link other than the calendar link and ' + own + ': ' + foreign.join(', '));

  // One offer only: the demo.
  if (/\b15[\s-]*(dakika|dk|min|minute)/i.test(t)) issues.push('Mentions 15 minutes (the offer is a 30-minute demo)');
  const offers = ['görüşme', 'toplantı', 'webinar', 'video', 'deneme sürümü', 'ücretsiz deneme', 'free trial', 'pilot'].filter(w => low.includes(w));
  if (/\b(call|meeting)\b/i.test(t)) offers.push('call/meeting');
  if (offers.length) issues.push('Offer other than the demo: ' + offers.join(', '));
  const promo = ['katalog', 'catalog', 'broşür', 'brochure', 'numune', 'paket', 'package', 'pricing', 'abonelik', 'subscription', 'lisans ücreti'].filter(w => low.includes(w));
  if (/\bsamples?\b/i.test(t)) promo.push('sample');
  if (promo.length) issues.push('Price, package, catalog or sample wording: ' + promo.join(', '));

  // Claims that must not be made.
  if (/\btier\b|tier[\s-]*\d/i.test(t)) issues.push('Mentions Tier (Tier-4 / tier depth claims are not allowed)');
  if (/%\s*\d|\d\s*%|yüzde\s+\d|\bpercent\b|\bper cent\b/i.test(t)) issues.push('Contains a percentage (no savings rates: there is no measured data)');
  if (/fewer audits|less audits|reduc\w*\s+(the\s+)?(number of\s+)?audits|daha az denetim|denetim(ler)?(in)?\s*(sayısı)?\w*\s*(azal|düş)/i.test(t)) issues.push('Claims fewer audits');
  const figures = ['rakip', 'competitor', 'araştırmaya göre', 'araştırmalara göre', 'according to a study', 'studies show', 'gartner', 'mckinsey'].filter(w => low.includes(w));
  if (figures.length) issues.push('Competitor or vendor figures: ' + figures.join(', '));

  // Regulatory dates: only 14 December 2027, "2027" (textile DPP, expected) and April 2028 (EPR).
  const months = 'ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|january|february|march|april|may|june|july|august|september|october|november|december';
  const okDates = ['14 aralık 2027', '14 december 2027', 'nisan 2028', 'april 2028', '17 nisan 2028', '17 april 2028'];
  const badDates = [];
  for (const m of low.matchAll(new RegExp('(\\d{1,2}\\s+)?(' + months + ')\\s+(\\d{1,2},?\\s+)?(20\\d\\d)', 'g'))) {
    if (Number(m[4]) >= 2027 && !okDates.includes(m[0].replace(/\s+/g, ' ').trim())) badDates.push(m[0].trim());
  }
  for (const m of low.matchAll(/\b(20\d\d)\b/g)) {
    const y = Number(m[1]);
    if (y > 2028) badDates.push(m[1]);
    if (y === 2028 && !/(nisan|april)\s+$/.test(low.slice(Math.max(0, m.index - 8), m.index))) badDates.push('2028 without April');
  }
  if (badDates.length) issues.push('Date other than 14 December 2027, 2027 (expected) and April 2028: ' + [...new Set(badDates)].join(', '));

  // Language rule: Turkish for firms in Turkey, English abroad. Judged on the text above the signature.
  const lines = t.replace(/\r/g, '').split('\n');
  const iSig = opt.senderName ? lines.findIndex(l => l.trim() === String(opt.senderName).trim()) : -1;
  const main = ' ' + (iSig > 0 ? lines.slice(0, iSig) : lines).join(' ').toLowerCase().replace(/[.,;:!?()"']/g, ' ') + ' ';
  const count = (ws) => ws.reduce((n, w) => n + main.split(' ' + w + ' ').length - 1, 0);
  const tr = count(['ve', 'bir', 'için', 'ile', 'bu', 'sayın', 'size', 'sizin']);
  const en = count(['the', 'and', 'for', 'your', 'you', 'with', 'dear', 'is']);
  if (opt.lang === 'tr' && tr <= en) issues.push('Wrong language: firms in Turkey get Turkish');
  if (opt.lang === 'en' && en <= tr) issues.push('Wrong language: firms outside Turkey get English');
  return issues;
}

// Verbatim from WF2 'Check Draft' (WF5 'Check Follow-up' has the same function; checkFollowup.js holds its own copy).
// Trade-secret rule (Nil's compliance plan): no buyer names, order volumes, prices, capacities or margins in outreach text.
// ownName: the recipient company's own name (a brand may be named in a mail to that brand).
function sensitiveIssues(text, ownName) {
  const t = String(text || '');
  const low = t.toLowerCase();
  const own = String(ownName || '').toLowerCase();
  const issues = [];
  const buyers = ['zara', 'inditex', 'h&m', 'hennes', 'primark', 'c&a', 'mango', 'marks & spencer', 'm&s', 'tesco', 'lidl', 'aldi', 'decathlon', 'hugo boss', 'adidas', 'puma', 'nike', 'esprit', 's.oliver', 'tom tailor', 'bestseller', 'zalando', 'about you', 'otto', 'benetton', 'diesel', "levi's", 'levis', 'kiabi', 'celio', 'promod', 'etam', 'carrefour', 'auchan', 'tchibo', 'takko', 'ernsting', 'peek & cloppenburg', 'hunkemöller', 'we fashion', 'jack & jones', 'vero moda', 'pepe jeans', 'desigual', 'el corte ingl', 'cortefiel', 'mayoral', 'g-star', 'scotch & soda', 'zeeman', 'matalan', 'river island', 'new look', 'boohoo', 'asos', 'sinsay', 'cropp', 'mohito', 'pull&bear', 'pull & bear', 'bershka', 'stradivarius', 'massimo dutti', 'oysho', 'ikea', 'jysk', 'armani', 'gucci', 'prada', 'burberry', 'ralph lauren', 'tommy hilfiger', 'calvin klein', 'uniqlo', 'lacoste', 'superdry', 'jd sports', 'intersport', 'engelbert strauss', 'koton', 'defacto', 'lc waikiki'];
  // Whole-word match only: "zara" must not fire inside "yazarak", nor "otto" inside "cotton".
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordHit = (name) => new RegExp('(^|[^a-z0-9çğıöşüâîû])' + esc(name) + '(?=$|[^a-z0-9çğıöşüâîû])').test(low);
  const named = buyers.filter(b => wordHit(b) && !(own && own.includes(b)));
  if (named.length) issues.push('Names a buyer or brand: ' + named.join(', '));
  if (/(€|£|₺|\$|\b(eur|usd|gbp|tl)\b)/i.test(t)) issues.push('Mentions money or prices');
  if (/\b\d[\d.,]*\s*(adet|parça|ton|tons|tonnes|kg|metre|meters|pcs|pieces|units|orders|order|sipariş)\b/i.test(t)) issues.push('Mentions order volumes or quantities');
  const words = ['sipariş hacmi', 'sipariş adedi', 'order volume', 'order quantity', 'minimum order', 'moq', 'fiyat', 'price', 'birim fiyat', 'tedarikçisi olduğunuz', 'supplier of', 'supplies to', 'supplier to', 'customer list', 'müşteri listesi', 'kapasite', 'capacity', 'marj', 'margin', 'ciro', 'revenue', 'turnover'];
  const hits = words.filter(w => low.includes(w));
  if (hits.length) issues.push('Commercially sensitive wording: ' + hits.join(', '));
  return issues;
}

export { checkDraft, fixAddressLineBreak, complianceIssues, nilRuleIssues, sensitiveIssues };
