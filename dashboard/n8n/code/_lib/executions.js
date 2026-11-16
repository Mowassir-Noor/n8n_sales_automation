// Execution helpers for DB - Status and the WF3 check in DB - Lead action.
// Pure functions, no n8n globals: pasted between `// <lib:executions>` markers by sync-n8n.mjs.

const WATCHED_WORKFLOWS = [
  { id: '4sjSYRcQvBBXEe6a', key: 'wf0', name: 'WF0 - Company discovery' },
  { id: 'lVqeh6vUqxRPN6gS', key: 'wf1', name: 'WF1 - Lead research' },
  { id: 'm1uUhMTcZHRXVIeV', key: 'wf2', name: 'WF2 - Compliance check and draft' },
  { id: 'SeSyIb5vHQxG1F59', key: 'wf3', name: 'WF3 - Send approved emails' },
  { id: 'bN2OX0nXYAOHqHfY', key: 'wf4', name: 'WF4 - Reply triage' },
  { id: '6Im09dml8yELL7Fc', key: 'wf5', name: 'WF5 - Follow-ups' },
  { id: '0rOv5SKwQS5Pd3l5', key: 'wf6', name: 'WF6 - Weekly report and LinkedIn drafts' },
];
const WF3_ID = 'SeSyIb5vHQxG1F59';
const WF5_ID = '6Im09dml8yELL7Fc';

// Weekday schedule slots (minutes after midnight, Istanbul) from the WF3/WF5 cron triggers:
// WF3 "0 10,14 * * 1-5", WF5 "0 11 * * 1-5".
const SCHEDULE_SLOTS = { [WF3_ID]: [600, 840], [WF5_ID]: [660] };
// A WF3 batch of 15 drafts takes about 22 minutes (90 s apart).
const RUN_WINDOW_MIN = 40;

function execStatus(e) {
  if (!e) return '';
  if (e.status) return String(e.status);
  if (e.finished) return 'success';
  if (e.stoppedAt) return 'error';
  return 'running';
}

function isRunningExecution(e) {
  const s = execStatus(e);
  return s === 'running' || s === 'new';
}

// Real execution objects from n8n node items (drops the alwaysOutputData `{}` item and error items).
function executionRows(items) {
  return (items || []).map(i => (i && i.json) || {}).filter(j => j.id != null && j.workflowId);
}

function itemsFailed(items) {
  const list = (items || []).map(i => (i && i.json) || {});
  const errs = list.filter(j => j.error);
  return list.length > 0 && errs.length === list.length ? String(errs[0].error && errs[0].error.message || errs[0].error) : '';
}

function errorMessageOf(e) {
  const err = e && e.data && e.data.resultData && e.data.resultData.error;
  if (!err) return null;
  const node = e.data.resultData.lastNodeExecuted;
  const msg = String(err.message || err.description || 'Error');
  return node ? node + ': ' + msg : msg;
}

function toExecutionInfo(e, errorById) {
  const wf = WATCHED_WORKFLOWS.find(w => w.id === e.workflowId);
  const status = execStatus(e);
  const id = String(e.id);
  return {
    workflowId: String(e.workflowId),
    workflowName: wf ? wf.name : String(e.workflowId),
    status,
    startedAt: e.startedAt ? String(e.startedAt) : '',
    stoppedAt: e.stoppedAt ? String(e.stoppedAt) : null,
    error: status === 'error' ? ((errorById && errorById[id]) || errorMessageOf(e) || null) : null,
  };
}

// Whether a workflow is running now.
// 1) any execution the API reports as running; 2) fallback for APIs that hide running executions:
// inside a schedule window (slot … slot + RUN_WINDOW_MIN on a weekday) with no finished execution
// started at or after the slot.
function isWorkflowRunning(workflowId, recent, running, now) {
  if ((running || []).some(e => e.workflowId === workflowId && isRunningExecution(e))) return true;
  if ((recent || []).some(e => e.workflowId === workflowId && isRunningExecution(e))) return true;
  const slots = SCHEDULE_SLOTS[workflowId] || [];
  if (!now || now.weekday > 5) return false;
  for (const slot of slots) {
    if (now.minuteOfDay >= slot && now.minuteOfDay < slot + RUN_WINDOW_MIN) {
      const slotMs = now.ms - (now.minuteOfDay - slot) * 60000;
      const finishedSince = (recent || []).some(e =>
        e.workflowId === workflowId && e.stoppedAt && !isRunningExecution(e) && Date.parse(e.startedAt) >= slotMs - 60000);
      if (!finishedSince) return true;
    }
  }
  return false;
}

export {
  WATCHED_WORKFLOWS, WF3_ID, WF5_ID, SCHEDULE_SLOTS, RUN_WINDOW_MIN,
  execStatus, isRunningExecution, executionRows, itemsFailed, errorMessageOf, toExecutionInfo, isWorkflowRunning,
};
