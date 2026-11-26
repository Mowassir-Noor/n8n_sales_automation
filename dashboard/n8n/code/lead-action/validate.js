// DB - Lead action: check the request shape and the role, and answer a repeated requestId from
// workflow static data. Output: a reply item ({ respond: true, status, body }) or
// { respond: false, req } with the cleaned request.

// <lib:common>
// </lib:common>

const ACTIONS = [
  'approve_first', 'reject_first', 'edit_first', 'unapprove_first',
  'approve_followup', 'edit_followup', 'rewrite_followup', 'decline_followup',
  'opt_out', 'set_reply_category', 'mark_hot_handled',
  'reset_test_sent', 'close_test_sent',
];
const ADMIN_ONLY = ['reset_test_sent', 'close_test_sent'];
const CATEGORIES = ['Hot', 'Warm', 'Cold', 'Not interested'];

const body = $('Config').first().json.body;
const now = nowInfo($now);
if (!isPlainObject(body)) return [{ json: reply(422, { errors: ['Request body must be a JSON object'] }, '', false) }];

const requestId = typeof body.requestId === 'string' ? body.requestId : '';
const seen = dedupeGet($getWorkflowStaticData('global'), requestId, now.ms);
if (seen) return [{ json: Object.assign(reply(seen.status, seen.body, requestId, false), { deduplicated: true }) }];

const errors = actorErrors(body);
const action = body.action;
if (ACTIONS.indexOf(action) === -1) errors.push('action must be one of: ' + ACTIONS.join(', '));
const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : '';
if (!leadId || leadId.length > 50) errors.push('leadId is required');

const expect = body.expect;
if (!isPlainObject(expect)) {
  errors.push('expect is required');
} else {
  for (const k of ['lastUpdated', 'stage', 'approved', 'draftHash']) {
    if (typeof expect[k] !== 'string') errors.push('expect.' + k + ' must be a string');
  }
}

const data = body.data == null ? {} : body.data;
if (!isPlainObject(data)) errors.push('data must be an object');
const text = (k, max) => {
  const v = data[k];
  if (v == null) return '';
  if (typeof v !== 'string') { errors.push('data.' + k + ' must be a string'); return ''; }
  if (v.length > max) errors.push('data.' + k + ' is longer than ' + max + ' characters');
  return v;
};
const subject = text('subject', 500);
const draftBody = text('body', 20000);
const note = text('note', 2000).trim();

if (action === 'edit_first') {
  if (typeof data.subject !== 'string') errors.push('data.subject is required');
  if (!draftBody.trim()) errors.push('data.body is required');
}
if (action === 'edit_followup' && !draftBody.trim()) errors.push('data.body is required');
if ((action === 'reject_first' || action === 'rewrite_followup') && !note) errors.push('data.note is required');
if (action === 'set_reply_category' && CATEGORIES.indexOf(data.category) === -1) errors.push('data.category must be one of: ' + CATEGORIES.join(', '));

if (errors.length) return [{ json: reply(422, { errors }, requestId) }];

if (ADMIN_ONLY.indexOf(action) !== -1 && body.actorRole !== 'admin') {
  return [{ json: reply(403, { error: action + ' is for admins only' }, requestId) }];
}

return [{
  json: {
    respond: false,
    req: {
      action,
      leadId,
      expect: { lastUpdated: expect.lastUpdated, stage: expect.stage, approved: expect.approved, draftHash: expect.draftHash },
      data: { subject, body: draftBody, note, category: data.category == null ? '' : String(data.category) },
      requestId,
      actor: str(body.actor).trim(),
      actorRole: body.actorRole,
    },
  },
}];
