// DB - Lists: check the request for either webhook ('suppression' or 'social').
// Output: a reply item, or { respond: false, op: 'suppression' | 'social', req }.

// <lib:common>
// </lib:common>

const cfg = $('Config').first().json;
const route = cfg.route;
const body = cfg.body;
const now = nowInfo($now);
if (!isPlainObject(body)) return [{ json: reply(422, { errors: ['Request body must be a JSON object'] }, '', false) }];

const requestId = typeof body.requestId === 'string' ? body.requestId : '';
const seen = dedupeGet($getWorkflowStaticData('global'), requestId, now.ms);
if (seen) return [{ json: Object.assign(reply(seen.status, seen.body, requestId, false), { deduplicated: true }) }];

const errors = actorErrors(body);
const isAdmin = body.actorRole === 'admin';
const base = { requestId, actor: str(body.actor).trim(), actorRole: body.actorRole };
const rowNumberOk = (n) => Number.isInteger(n) && n >= 2 && n <= 1000000;

if (route === 'suppression') {
  if (body.action === 'add') {
    const d = isPlainObject(body.data) ? body.data : {};
    if (!isPlainObject(body.data)) errors.push('data is required');
    const email = str(d.Email).trim().toLowerCase();
    const domain = str(d.Domain).trim().toLowerCase().replace(/^@/, '');
    const reason = str(d.Reason).trim();
    if (!email && !domain) errors.push('Give an Email or a Domain');
    if (email && !isEmail(email)) errors.push('Email is not a valid email address');
    if (domain && !isDomain(domain)) errors.push('Domain must look like example.com (no https://, no path)');
    if (!reason) errors.push('Reason is required');
    if (reason.length > 500) errors.push('Reason is longer than 500 characters');
    if (errors.length) return [{ json: reply(422, { errors }, requestId) }];
    return [{ json: { respond: false, op: 'suppression', req: Object.assign({ action: 'add', email, domain, reason }, base) } }];
  }
  if (body.action === 'remove') {
    const ex = body.expect;
    if (!rowNumberOk(body.rowNumber)) errors.push('rowNumber must be a sheet row number from 2');
    if (!isPlainObject(ex) || typeof ex.Email !== 'string' || typeof ex.Domain !== 'string') errors.push('expect.Email and expect.Domain are required');
    const reason = str(body.reason).trim();
    if (!reason) errors.push('reason is required');
    if (errors.length) return [{ json: reply(422, { errors }, requestId) }];
    if (!isAdmin) return [{ json: reply(403, { error: 'Only an admin can remove Suppression rows' }, requestId) }];
    return [{ json: { respond: false, op: 'suppression', req: Object.assign({ action: 'remove', rowNumber: body.rowNumber, expect: { Email: ex.Email, Domain: ex.Domain }, reason }, base) } }];
  }
  errors.push('action must be "add" or "remove"');
  return [{ json: reply(422, { errors }, requestId) }];
}

if (route === 'social') {
  const ex = body.expect;
  const d = body.data;
  if (!rowNumberOk(body.rowNumber)) errors.push('rowNumber must be a sheet row number from 2');
  if (!isPlainObject(ex) || typeof ex.Week !== 'string' || typeof ex.Topic !== 'string' || typeof ex.draftHash !== 'string') {
    errors.push('expect.Week, expect.Topic and expect.draftHash are required');
  }
  const data = {};
  if (!isPlainObject(d)) {
    errors.push('data is required');
  } else {
    for (const k of Object.keys(d)) {
      if (k === 'Approved') {
        if (['Pending', 'Yes', 'No', 'Edit'].indexOf(d[k]) === -1) errors.push('Approved must be Pending, Yes, No or Edit');
        else data.Approved = d[k];
      } else if (k === 'Posted') {
        if (['Yes', 'No'].indexOf(d[k]) === -1) errors.push('Posted must be Yes or No');
        else data.Posted = d[k];
      } else if (k === 'Nil Notes') {
        if (typeof d[k] !== 'string' || d[k].length > 2000) errors.push('Nil Notes must be text up to 2000 characters');
        else data['Nil Notes'] = d[k];
      } else {
        errors.push('Field "' + k + '" cannot be changed');
      }
    }
    if (!Object.keys(data).length && !errors.length) errors.push('data must name at least one of Approved, Nil Notes, Posted');
  }
  if (errors.length) return [{ json: reply(422, { errors }, requestId) }];
  return [{ json: { respond: false, op: 'social', req: Object.assign({ rowNumber: body.rowNumber, expect: { Week: ex.Week, Topic: ex.Topic, draftHash: ex.draftHash }, data }, base) } }];
}

return [{ json: reply(500, { error: 'Unknown route ' + route }, requestId, false) }];
