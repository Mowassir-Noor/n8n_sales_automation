// Last node before 'Respond' in the write workflows: remembers the response for the request's
// requestId (10 minutes, workflow static data) so a repeated request gets the same answer, then
// passes { status, body } on. 5xx answers are not remembered, so a retry runs again.

// <lib:common>
// </lib:common>

const item = $input.first().json;
const status = Number(item.status) || 500;
const body = item.body || { error: 'Empty response' };
if (item.store && item.requestId && status < 500) {
  dedupeSet($getWorkflowStaticData('global'), item.requestId, status, body, nowInfo($now).ms);
}
return [{ json: { status, body } }];
