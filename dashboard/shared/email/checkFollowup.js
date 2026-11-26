// Shared port of WF5 'Check Follow-up', as a pure function (no n8n globals).
// Pinned copy of the node code: ./upstream/WF5__Check-Follow-up.code.txt (`npm run test:drift` fails when the node changes).
//
// Node rules (same order and texts, Nil's decisions of 23 Nov 2026): empty body, more than 230 words, hype words,
// nilRuleIssues (30-minute demo, calendar link, allowed claims and dates, language by country), trade-secret rule.
// The node writes fu_check_status 'Blocked' | 'OK'; here ok = (no reasons).
// Added from WF5's 'Follow-up due?' filter (the gate before the node), because the dashboard approves outside that
// filter: 'Lead opted out' when Opt-out is 'Yes', and the suppression rule (texts taken from WF2 'Compliance check').
//
// Self-contained: no imports. followupNilRuleIssues() and followupSensitiveIssues() are this file's own copies of the
// node's nilRuleIssues() and sensitiveIssues() (renamed so they cannot clash with checkDraft.js when both are pasted
// into one Code node), and followupIsSuppressed() is a local copy of the WF3/WF5 suppression rule (same as
// recipient.js isSuppressed()).

// Input:  { body, lead?: LeadRow, settings?: Settings, suppression?: SuppressionRow[] }
// Output: { ok: boolean, notes: string[] }
function checkFollowup(input) {
  const args = input || {};
  const body = String(args.body || '');
  const lead = args.lead || {};
  const settings = args.settings || {};
  const lang = ['turkey', 'türkiye', 'turkiye'].includes(String(lead.Country || '').trim().toLowerCase()) ? 'tr' : 'en';
  const brand = /^(marka|brand)$/i.test(String(lead.Segment || '').trim());
  const domainOf = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0].trim();
  const reasons = [];

  if (String(lead['Opt-out'] || '') === 'Yes') reasons.push('Lead opted out');
  if (lead.Email && followupIsSuppressed(lead.Email, args.suppression)) reasons.push('On suppression list (İYS ret / do-not-contact)');

  if (!body.trim()) reasons.push('Body is empty');
  const words = body.trim().split(/\s+/).length;
  if (words > 230) reasons.push('Too long (' + words + ' words)');
  const banned = ['garanti', 'guaranteed', '%100', '100%', 'son şans', 'last chance'];
  const hits = banned.filter(b => body.toLowerCase().includes(b));
  if (hits.length) reasons.push('Hype wording: ' + hits.join(', '));
  for (const r of followupNilRuleIssues(body, { lang, calendarLink: settings['Calendar Link'], ownDomain: domainOf(settings['Company Website'] || 'texprove.com') || 'texprove.com', senderName: settings['Sender Name'] })) reasons.push(r);
  for (const r of followupSensitiveIssues(body, brand ? lead.Company : '')) reasons.push(r);

  return { ok: reasons.length === 0, notes: reasons };
}

// Same rule as WF5 'Follow-up due?' / WF3 'Safe to send?' (suppression condition).
function followupIsSuppressed(email, suppression) {
  const e = String(email || '').toLowerCase().trim();
  const d = e.includes('@') ? e.split('@')[1] : '';
  return (suppression || []).some(r => {
    const se = String((r && r.Email) || '').toLowerCase().trim();
    const sd = String((r && r.Domain) || '').toLowerCase().replace(/^@/, '').trim();
    return !!((se && se === e) || (sd && d && (d === sd || d.endsWith('.' + sd))));
  });
}

// Nil's email rules of 23 Nov 2026 (decision log sections 1, 3, 8, 9), as plain code.
// Verbatim body of nilRuleIssues() from WF5 'Check Follow-up', only renamed.
// o = { lang: 'tr' | 'en', calendarLink, ownDomain, senderName }. Returns a list of reasons (empty = passes).
function followupNilRuleIssues(text, o) {
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

// Trade-secret rule (Nil's compliance plan): no buyer names, order volumes, prices, capacities or margins in outreach text.
// Verbatim body of sensitiveIssues() from WF5 'Check Follow-up', only renamed.
// ownName: the recipient company's own name (a brand may be named in a mail to that brand).
function followupSensitiveIssues(text, ownName) {
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

export { checkFollowup, followupNilRuleIssues, followupSensitiveIssues };
