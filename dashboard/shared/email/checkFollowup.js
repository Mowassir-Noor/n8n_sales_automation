// Shared port of WF5 'Check Follow-up', as a pure function (no n8n globals).
// Pinned copy of the node code: ./upstream/WF5-Check-Follow-up.js (`npm run test:drift` fails when the node changes).
//
// Node rules (same order and texts): empty body, more than 160 words, hype words, trade-secret rule.
// The node writes fu_check_status 'Blocked' | 'OK'; here ok = (no reasons).
// Added from WF5's 'Follow-up due?' filter (the gate before the node), because the dashboard approves outside that
// filter: 'Lead opted out' when Opt-out is 'Yes', and the suppression rule (texts taken from WF2 'Compliance check').
//
// Self-contained: no imports. followupSensitiveIssues() is this file's own copy of the node's sensitiveIssues()
// (renamed so it cannot clash with checkDraft.js when both are pasted into one Code node), and
// followupIsSuppressed() is a local copy of the WF3/WF5 suppression rule (same as recipient.js isSuppressed()).

// Input:  { body, lead?: LeadRow, settings?: Settings, suppression?: SuppressionRow[] }
// Output: { ok: boolean, notes: string[] }
function checkFollowup(input) {
  const args = input || {};
  const body = String(args.body || '');
  const lead = args.lead || {};
  const reasons = [];

  if (String(lead['Opt-out'] || '') === 'Yes') reasons.push('Lead opted out');
  if (lead.Email && followupIsSuppressed(lead.Email, args.suppression)) reasons.push('On suppression list (İYS ret / do-not-contact)');

  if (!body.trim()) reasons.push('Body is empty');
  const words = body.trim().split(/\s+/).length;
  if (words > 160) reasons.push('Too long (' + words + ' words)');
  const banned = ['garanti', 'guaranteed', '%100', '100%', 'ücretsiz', 'free trial', 'son şans', 'last chance'];
  const hits = banned.filter(b => body.toLowerCase().includes(b));
  if (hits.length) reasons.push('Hype wording: ' + hits.join(', '));
  for (const r of followupSensitiveIssues(body)) reasons.push(r);

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

// Trade-secret rule (Nil's compliance plan): no buyer names, order volumes, prices, capacities or margins in outreach text.
// Verbatim body of sensitiveIssues() from WF5 'Check Follow-up', only renamed.
function followupSensitiveIssues(text) {
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

export { checkFollowup, followupSensitiveIssues };
