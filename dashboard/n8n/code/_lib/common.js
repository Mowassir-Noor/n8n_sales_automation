// Helpers shared by the Code nodes of the five `DB - …` workflows.
// Pure functions, no n8n globals: sync-n8n.mjs pastes this file (minus the export line) between
// `// <lib:common>` and `// </lib:common>` markers. Tests import it directly.

const LEAD_HEADERS = [
  'Lead ID', 'Company', 'Website', 'Country', 'Segment',
  'Contact Name', 'Contact Title', 'Email', 'LinkedIn',
  'Research Notes', 'Personalisation Hook', 'Language',
  'Compliance Status', 'Compliance Notes',
  'Subject', 'Draft Body', 'Draft Body EN',
  'Approved', 'Nil Notes', 'Stage',
  'Sent At', 'Gmail Thread ID', 'Follow-up Count', 'Next Follow-up Date',
  'Reply Category', 'Reply Summary', 'HubSpot Contact ID', 'Opt-out',
  'Last Updated', 'Source URL', 'Source Date', 'Confidence', 'Follow-up Draft',
];
const HOT_HANDLED = 'Hot Handled';
const SETTINGS_HEADERS = [
  'Sender Name', 'Sender Title', 'Company Legal Name', 'Company Address',
  'Opt-out TR', 'Opt-out EN', 'Nil Email', 'Sheet URL',
  'HubSpot Monthly Limit', 'HubSpot Pause Percent', 'Test Email',
  'Nil WhatsApp', 'WhatsApp Phone Number ID', 'Nil Telegram Chat ID',
  'Company Website', 'HubSpot Owner ID', 'Mail Provider', 'SMTP From',
  'Seed Email', 'Seed Every', 'Target Countries',
];
// Countries the admin can pick in Settings 'Target Countries' (col U). WF0 searches only the picked
// ones (empty = Turkey); WF2 accepts leads from any of them. Keep in step with WF0, WF2 and src/lib/types.ts.
const TARGET_COUNTRIES = ['Turkey', 'Bangladesh', 'Vietnam', 'Malaysia', 'Brazil'];

// 'Turkey, Brazil' -> { list: ['Turkey', 'Brazil'], unknown: [] } (case-insensitive, Türkiye = Turkey).
function parseCountries(raw) {
  const list = [];
  const unknown = [];
  for (const part of str(raw).split(/[,;\n]/)) {
    const p = part.trim();
    if (!p) continue;
    const key = p.toLowerCase().replace('türkiye', 'turkey').replace('turkiye', 'turkey');
    const hit = TARGET_COUNTRIES.find(c => c.toLowerCase() === key);
    if (!hit) unknown.push(p);
    else if (list.indexOf(hit) === -1) list.push(hit);
  }
  return { list, unknown };
}
const SUPPRESSION_HEADERS = ['Email', 'Domain', 'Reason', 'Date'];
const SOCIAL_HEADERS = ['Week', 'Topic', 'Draft', 'Approved', 'Nil Notes', 'Posted'];
const LOG_HEADERS = ['Timestamp', 'Workflow', 'Lead ID', 'Company', 'Step', 'Input', 'Output', 'Reason'];

const DEDUPE_MS = 10 * 60 * 1000;
const DEDUPE_MAX = 300;

function str(v) {
  return v == null ? '' : String(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Items of a Sheets read -> plain row objects. Drops the synthetic `{}` item that alwaysOutputData
// adds for an empty tab, and error items from onError: continueRegularOutput.
function sheetRows(items) {
  return (items || [])
    .map(i => (i && i.json) || {})
    .filter(j => !('error' in j) && Object.keys(j).some(k => k !== 'row_number'));
}

// One row with exactly `headers` as keys (string values, "" when absent) plus row_number.
function normalizeRow(raw, headers) {
  const out = {};
  for (const h of headers) out[h] = str(raw && raw[h]);
  const rn = Number(raw && raw.row_number);
  if (Number.isFinite(rn) && rn > 0) out.row_number = rn;
  return out;
}

// Header row as n8n saw it: the keys of the row object with the most keys (n8n may leave out
// trailing empty cells on some rows), in sheet order, without row_number.
function detectHeaders(rows) {
  let best = [];
  for (const r of rows || []) {
    const keys = Object.keys(r || {}).filter(k => k !== 'row_number');
    if (keys.length > best.length) best = keys;
  }
  return best;
}

function colLetter(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Leads headers A..AG must equal LEAD_HEADERS in order. AH 'Hot Handled' is optional.
function checkLeadHeaders(headers) {
  const problems = [];
  const hs = headers || [];
  if (!hs.length) {
    problems.push('Leads tab has no data rows, so its headers could not be checked');
  } else {
    for (let i = 0; i < LEAD_HEADERS.length; i++) {
      const found = hs[i];
      if (found !== LEAD_HEADERS[i]) {
        problems.push('Column ' + colLetter(i) + ': expected "' + LEAD_HEADERS[i] + '", found ' + (found == null ? 'nothing' : '"' + found + '"'));
      }
    }
  }
  return { ok: problems.length === 0, problems, hasHotHandled: hs.indexOf(HOT_HANDLED) !== -1 };
}

function cut(s, n) {
  const t = str(s);
  const max = n || 3000;
  return t.length > max ? t.slice(0, max) : t;
}

// Log tab row, as CONTRACT.md fixes it.
function logRow(args) {
  return {
    Timestamp: str(args.nowIso),
    Workflow: 'Dashboard',
    'Lead ID': str(args.leadId),
    Company: str(args.company),
    Step: str(args.step),
    Input: cut(JSON.stringify(args.before || {}), 3000),
    Output: cut(JSON.stringify(args.after || {}), 3000),
    Reason: 'by ' + str(args.actor) + (args.adminApproval ? ' (admin)' : ''),
  };
}

// The time in Istanbul as plain values, from n8n's Luxon `$now`.
function nowInfo(now) {
  const t = now.setZone('Europe/Istanbul');
  return {
    iso: t.toISO(),
    date: t.toFormat('yyyy-MM-dd'),
    ms: t.toMillis(),
    weekday: t.weekday, // 1 = Monday … 7 = Sunday
    minuteOfDay: t.hour * 60 + t.minute + t.second / 60,
  };
}

// requestId dedupe in workflow static data (survives between production executions).
function dedupeStore(staticData) {
  if (!isPlainObject(staticData.dashRequests)) staticData.dashRequests = {};
  return staticData.dashRequests;
}

function dedupePrune(staticData, nowMs) {
  const store = dedupeStore(staticData);
  for (const id of Object.keys(store)) {
    if (!store[id] || nowMs - Number(store[id].at) > DEDUPE_MS) delete store[id];
  }
  const ids = Object.keys(store);
  if (ids.length > DEDUPE_MAX) {
    ids.sort((a, b) => store[a].at - store[b].at);
    for (const id of ids.slice(0, ids.length - DEDUPE_MAX)) delete store[id];
  }
  return store;
}

function dedupeGet(staticData, requestId, nowMs) {
  if (!requestId) return null;
  const store = dedupePrune(staticData, nowMs);
  const hit = store[requestId];
  return hit ? { status: hit.status, body: hit.body } : null;
}

function dedupeSet(staticData, requestId, status, body, nowMs) {
  if (!requestId) return;
  const store = dedupePrune(staticData, nowMs);
  store[requestId] = { at: nowMs, status, body };
}

// Item that ends a path: the Finish node stores it for dedupe and Respond sends it.
function reply(status, body, requestId, store) {
  return { respond: true, status, body, requestId: str(requestId), store: store !== false };
}

const EMAIL_RE = /^[^\s@"'<>(),;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function isEmail(s) {
  const t = str(s).trim();
  return t.length <= 254 && EMAIL_RE.test(t);
}

function isDomain(s) {
  const t = str(s).trim();
  return t.length <= 253 && DOMAIN_RE.test(t);
}

// Common checks on the actor fields the app adds to every write.
function actorErrors(body) {
  const errors = [];
  if (!isEmail(body.actor)) errors.push('actor must be the signed-in user\'s email');
  if (body.actorRole !== 'approver' && body.actorRole !== 'admin') errors.push('actorRole must be "approver" or "admin"');
  if (typeof body.requestId !== 'string' || body.requestId.length < 8 || body.requestId.length > 100) errors.push('requestId must be a string of 8 to 100 characters');
  return errors;
}

export {
  LEAD_HEADERS, HOT_HANDLED, SETTINGS_HEADERS, TARGET_COUNTRIES, parseCountries, SUPPRESSION_HEADERS, SOCIAL_HEADERS, LOG_HEADERS, DEDUPE_MS,
  str, isPlainObject, sheetRows, normalizeRow, detectHeaders, colLetter, checkLeadHeaders, cut, logRow, nowInfo,
  dedupeGet, dedupeSet, dedupePrune, reply, isEmail, isDomain, actorErrors,
};
