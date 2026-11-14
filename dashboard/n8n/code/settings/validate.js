// DB - Settings: check the request shape, which fields this role may change, and the values.
// Request: { expect: Partial<Settings>, data: Partial<Settings>, requestId, actor, actorRole, goLive? }
// Clearing 'Test Email' (go-live) needs actorRole admin plus the go-live confirmation: header
// `X-Go-Live: confirm` on the n8n call, or `goLive: true` in the body. The go-live list itself is
// checked against the sheet in 'Plan Settings'.

// <lib:common>
// </lib:common>

const NEVER = ['Mail Provider', 'SMTP From', 'Sheet URL', 'Nil WhatsApp', 'WhatsApp Phone Number ID', 'HubSpot Owner ID'];
const ADMIN_ONLY = ['Test Email', 'HubSpot Monthly Limit', 'HubSpot Pause Percent', 'Seed Email', 'Seed Every'];

const cfg = $('Config').first().json;
const body = cfg.body;
const now = nowInfo($now);
if (!isPlainObject(body)) return [{ json: reply(422, { errors: ['Request body must be a JSON object'] }, '', false) }];

const requestId = typeof body.requestId === 'string' ? body.requestId : '';
const seen = dedupeGet($getWorkflowStaticData('global'), requestId, now.ms);
if (seen) return [{ json: Object.assign(reply(seen.status, seen.body, requestId, false), { deduplicated: true }) }];

const errors = actorErrors(body);
const data = body.data;
const expect = body.expect;
if (!isPlainObject(data) || Object.keys(data).length === 0) errors.push('data must name at least one field');
if (!isPlainObject(expect)) errors.push('expect is required');
if (errors.length) return [{ json: reply(422, { errors }, requestId) }];

const isAdmin = body.actorRole === 'admin';
const goLive = str(cfg.goLiveHeader).trim().toLowerCase() === 'confirm' || body.goLive === true;
const clean = {};
const forbidden = [];

for (const field of Object.keys(data)) {
  const raw = data[field];
  if (SETTINGS_HEADERS.indexOf(field) === -1) { errors.push('Unknown Settings field "' + field + '"'); continue; }
  if (NEVER.indexOf(field) !== -1) { errors.push('"' + field + '" cannot be changed from the dashboard'); continue; }
  if (ADMIN_ONLY.indexOf(field) !== -1 && !isAdmin) { forbidden.push(field); continue; }
  if (typeof raw !== 'string') { errors.push('"' + field + '" must be a string'); continue; }
  if (typeof expect[field] !== 'string') { errors.push('expect["' + field + '"] (the value you saw) is required'); continue; }
  const v = raw.trim();
  if (v.length > 2000) { errors.push('"' + field + '" is longer than 2000 characters'); continue; }

  switch (field) {
    case 'Nil Email':
      if (!isEmail(v)) errors.push('Nil Email must be an email address');
      break;
    case 'Test Email':
      if (v === '') {
        if (!isAdmin || !goLive) errors.push('Test Email can only be cleared through Go live');
      } else if (!isEmail(v)) errors.push('Test Email must be an email address');
      break;
    case 'Seed Email':
      if (v !== '' && !isEmail(v)) errors.push('Seed Email must be an email address or empty');
      break;
    case 'HubSpot Monthly Limit':
    case 'Seed Every':
      if (v !== '' && !/^[1-9]\d{0,6}$/.test(v)) errors.push(field + ' must be a whole number from 1, or empty');
      break;
    case 'HubSpot Pause Percent':
      if (v !== '' && !(/^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100)) errors.push('HubSpot Pause Percent must be a whole number from 1 to 100, or empty');
      break;
    case 'Nil Telegram Chat ID':
      if (v !== '' && !/^-?\d{1,20}$/.test(v)) errors.push('Nil Telegram Chat ID must be a number (group chats start with -)');
      break;
    case 'Company Website':
      if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v)) errors.push('Company Website must be a full address starting with https://');
      break;
    case 'Sender Name':
    case 'Company Legal Name':
    case 'Company Address':
    case 'Opt-out TR':
    case 'Opt-out EN':
      if (v === '') errors.push(field + ' cannot be empty');
      break;
    default:
      break;
  }
  clean[field] = field === 'Company Address' || field === 'Opt-out TR' || field === 'Opt-out EN' ? raw.replace(/\s+$/, '') : v;
}

if (forbidden.length) return [{ json: reply(403, { error: 'Only an admin can change: ' + forbidden.join(', ') }, requestId) }];
if (errors.length) return [{ json: reply(422, { errors }, requestId) }];

const expectClean = {};
for (const f of Object.keys(clean)) expectClean[f] = expect[f];

return [{
  json: {
    respond: false,
    req: { data: clean, expect: expectClean, requestId, actor: str(body.actor).trim(), actorRole: body.actorRole, goLive },
  },
}];
