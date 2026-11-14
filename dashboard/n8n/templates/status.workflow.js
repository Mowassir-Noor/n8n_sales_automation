import { workflow, node, trigger, sticky, newCredential, expr } from '@n8n/workflow-sdk';

const webhookStatus = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Status',
    parameters: { httpMethod: 'POST', path: 'dash/status', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ body: {}, webhookUrl: 'http://n8n:5678/webhook/dash/status' }],
});

const workflowList = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Workflow List',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(status/workflow-list)' },
  },
  output: [{ workflowId: 'SeSyIb5vHQxG1F59', workflowName: 'WF3 - Send approved emails' }],
});

const getExecutions = node({
  type: 'n8n-nodes-base.n8n',
  version: 1,
  config: {
    name: 'Get Executions',
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'execution',
      operation: 'getAll',
      returnAll: false,
      limit: 20,
      filters: { workflowId: { __rl: true, mode: 'id', value: expr('{{ $json.workflowId }}') } },
      options: {},
    },
    credentials: { n8nApi: newCredential('n8n API') },
  },
  output: [{ id: '100', workflowId: 'SeSyIb5vHQxG1F59', status: 'success', finished: true, startedAt: '2026-11-13T07:00:01.000Z', stoppedAt: '2026-11-13T07:12:00.000Z' }],
});

const workflowListAgain = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Workflow List Again',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(status/workflow-list-again)' },
  },
  output: [{ workflowId: 'SeSyIb5vHQxG1F59', workflowName: 'WF3 - Send approved emails' }],
});

const getRecentErrors = node({
  type: 'n8n-nodes-base.n8n',
  version: 1,
  config: {
    name: 'Get Recent Errors',
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'execution',
      operation: 'getAll',
      returnAll: false,
      limit: 3,
      filters: { workflowId: { __rl: true, mode: 'id', value: expr('{{ $json.workflowId }}') }, status: 'error' },
      options: { activeWorkflows: true },
    },
    credentials: { n8nApi: newCredential('n8n API') },
  },
  output: [{ id: '99', workflowId: 'SeSyIb5vHQxG1F59', status: 'error', startedAt: '2026-11-12T11:00:01.000Z', stoppedAt: '2026-11-12T11:00:09.000Z', data: { resultData: { lastNodeExecuted: 'Send Email (SMTP)', error: { message: 'Example error' } } } }],
});

const getRunningExecutions = node({
  type: 'n8n-nodes-base.n8n',
  version: 1,
  config: {
    name: 'Get Running Executions',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'execution',
      operation: 'getAll',
      returnAll: false,
      limit: 50,
      filters: { status: expr('{{ "running" }}') },
      options: {},
    },
    credentials: { n8nApi: newCredential('n8n API') },
  },
  output: [{ id: '101', workflowId: '6Im09dml8yELL7Fc', status: 'running', startedAt: '2026-11-13T08:00:01.000Z', stoppedAt: null }],
});

const shapeStatus = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Shape Status',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(status/shape-status)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true, executions: [], running: { wf3: false, wf5: false } }, requestId: '', store: false }],
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond',
    parameters: { respondWith: 'json', responseBody: expr('{{ JSON.stringify($json.body) }}'), options: { responseCode: expr('{{ $json.status }}') } },
  },
});

const respondError = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Error',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ error: "n8n: " + String($json.error?.message ?? $json.error ?? $json.message ?? "unexpected error") }) }}'),
      options: { responseCode: 500 },
    },
  },
});

const note = sticky(
  '## DB - Status\nPOST /webhook/dash/status (Header Auth). Last 20 executions of each of WF0..WF6 via the n8n API (credential stays in n8n), error messages of the latest failed runs, and whether WF3 / WF5 are running now. Source: dashboard/n8n in the repo.',
  [webhookStatus, workflowList],
  { color: 4 },
);

export default workflow('db-status', 'DB - Status', { settings: { timezone: 'Europe/Istanbul', executionOrder: 'v1' } })
  .add(webhookStatus)
  .to(workflowList.to(getExecutions.to(workflowListAgain.to(getRecentErrors.to(getRunningExecutions.to(shapeStatus.to(respond)))))))
  .add(workflowList.onError(respondError))
  .add(workflowListAgain.onError(respondError))
  .add(shapeStatus.onError(respondError))
  .add(note);
