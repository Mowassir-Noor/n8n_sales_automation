// DB - Status: StatusResponse = { ok, executions (newest first, up to 20 per workflow), running: { wf3, wf5 } }.
// 'Get Executions' and 'Get Recent Errors' / 'Get Running Executions' use onError: continueRegularOutput,
// so a failed API call arrives as an item with `error`. All of 'Get Executions' failing => 500.

// <lib:common>
// </lib:common>
// <lib:executions>
// </lib:executions>

const now = nowInfo($now);
const execItems = $('Get Executions').all();
const failure = itemsFailed(execItems);
if (failure) return [{ json: reply(500, { error: 'Could not read executions from the n8n API: ' + failure }, '', false) }];

const errorById = {};
for (const e of executionRows($('Get Recent Errors').all())) {
  const msg = errorMessageOf(e);
  if (msg) errorById[String(e.id)] = msg;
}
const running = executionRows($('Get Running Executions').all());
const recent = executionRows(execItems);

const byId = {};
for (const e of recent.concat(running)) {
  if (WATCHED_WORKFLOWS.some(w => w.id === e.workflowId)) byId[String(e.id)] = e;
}
const executions = Object.keys(byId)
  .map(id => toExecutionInfo(byId[id], errorById))
  .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));

return [{
  json: reply(200, {
    ok: true,
    executions,
    running: {
      wf3: isWorkflowRunning(WF3_ID, recent, running, now),
      wf5: isWorkflowRunning(WF5_ID, recent, running, now),
    },
  }, '', false),
}];
