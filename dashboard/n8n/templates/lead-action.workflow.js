import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const sheetsCredentials = { googleSheetsOAuth2Api: { id: 'sFrPcvpn5K1JgYYK', name: 'Google Sheets account' } };
const documentRef = { __rl: true, mode: 'id', value: expr("{{ $('Config').first().json.documentId }}") };
const readFormatting = { outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } } };
const respondCondition = { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'respond-now', leftValue: expr('{{ $json.respond }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' };

const webhookLead = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Lead',
    parameters: { httpMethod: 'POST', path: 'dash/lead', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ body: { action: 'approve_first', leadId: 'L001', expect: { lastUpdated: '', stage: 'Drafted', approved: 'Pending', draftHash: '' }, data: {}, requestId: 'req-00000001', actor: 'approver@example.com', actorRole: 'approver' }, webhookUrl: 'http://n8n:5678/webhook/dash/lead' }],
});

const config = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'cfg-document', name: 'documentId', value: '10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM', type: 'string' },
          { id: 'cfg-body', name: 'body', value: expr('{{ $json.body }}'), type: 'object' },
        ],
      },
      options: {},
    },
  },
  output: [{ documentId: '10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM', body: { action: 'approve_first', leadId: 'L001' } }],
});

const validateRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Request',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lead-action/validate)' },
  },
  output: [{ respond: false, status: 200, body: {}, req: { action: 'approve_first', leadId: 'L001', requestId: 'req-00000001' } }],
});

const respondNow = ifElse({
  version: 2.2,
  config: { name: 'Respond Now?', parameters: { conditions: respondCondition, options: {} } },
});

const checkWf3Running = node({
  type: 'n8n-nodes-base.n8n',
  version: 1,
  config: {
    name: 'Check WF3 Running',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'execution',
      operation: 'getAll',
      returnAll: false,
      limit: 5,
      filters: { workflowId: { __rl: true, mode: 'id', value: 'SeSyIb5vHQxG1F59' }, status: expr('{{ "running" }}') },
      options: {},
    },
    credentials: { n8nApi: newCredential('n8n API') },
  },
  output: [{ id: '101', workflowId: 'SeSyIb5vHQxG1F59', status: 'running', startedAt: '2026-11-13T07:00:01.000Z', stoppedAt: null }],
});

const lastWf3Runs = node({
  type: 'n8n-nodes-base.n8n',
  version: 1,
  config: {
    name: 'Last WF3 Runs',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'execution',
      operation: 'getAll',
      returnAll: false,
      limit: 3,
      filters: { workflowId: { __rl: true, mode: 'id', value: 'SeSyIb5vHQxG1F59' } },
      options: {},
    },
    credentials: { n8nApi: newCredential('n8n API') },
  },
  output: [{ id: '100', workflowId: 'SeSyIb5vHQxG1F59', status: 'success', startedAt: '2026-11-13T07:00:01.000Z', stoppedAt: '2026-11-13T07:12:00.000Z' }],
});

const readLeads = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Leads',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueErrorOutput',
    parameters: { resource: 'sheet', operation: 'read', documentId: documentRef, sheetName: { __rl: true, mode: 'name', value: 'Leads' }, options: readFormatting },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, 'Lead ID': 'L001', Company: 'Example Tekstil', Stage: 'Drafted', Approved: 'Pending' }],
});

const readSettings = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Settings',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueErrorOutput',
    parameters: { resource: 'sheet', operation: 'read', documentId: documentRef, sheetName: { __rl: true, mode: 'name', value: 'Settings' }, options: readFormatting },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, 'Sender Name': 'Example Sender', 'Test Email': 'test@example.com' }],
});

const readSuppression = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Suppression',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueErrorOutput',
    parameters: { resource: 'sheet', operation: 'read', documentId: documentRef, sheetName: { __rl: true, mode: 'name', value: 'Suppression' }, options: readFormatting },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, Email: 'blocked@example.org', Domain: '', Reason: 'Example', Date: '2026-11-01' }],
});

const planWrite = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Write',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lead-action/plan)' },
  },
  output: [{ respond: false, write: true, status: 200, body: {}, requestId: 'req-00000001', update: { 'Lead ID': 'L001', Approved: 'Yes' }, row: {}, suppressionRow: null, log: { Timestamp: '', Workflow: 'Dashboard', 'Lead ID': 'L001', Company: '', Step: 'approve_first', Input: '{}', Output: '{}', Reason: 'by approver@example.com' } }],
});

const writeNeeded = ifElse({
  version: 2.2,
  config: {
    name: 'Write Needed?',
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'write-needed', leftValue: expr('{{ $json.write === true }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    },
  },
});

const leadUpdateItem = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Lead Update Item',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lead-action/update-item)' },
  },
  output: [{ 'Lead ID': 'L001', Approved: 'Yes', 'Last Updated': '2026-11-14T10:00:00.000+03:00' }],
});

const updateLeadRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Update Lead Row',
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'sheet',
      operation: 'update',
      documentId: documentRef,
      sheetName: { __rl: true, mode: 'name', value: 'Leads' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: ['Lead ID'],
        schema: [{ id: 'Lead ID', displayName: 'Lead ID', required: false, defaultMatch: true, display: true, type: 'string', canBeUsedToMatch: true }],
      },
      options: { cellFormat: 'RAW', handlingExtraData: 'error' },
    },
    credentials: sheetsCredentials,
  },
  output: [{ 'Lead ID': 'L001', Approved: 'Yes' }],
});

const appendLogRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Append Log Row',
    executeOnce: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'sheet',
      operation: 'append',
      documentId: documentRef,
      sheetName: { __rl: true, mode: 'name', value: 'Log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          Timestamp: expr("{{ $('Plan Write').first().json.log.Timestamp }}"),
          Workflow: expr("{{ $('Plan Write').first().json.log.Workflow }}"),
          'Lead ID': expr("{{ $('Plan Write').first().json.log['Lead ID'] }}"),
          Company: expr("{{ $('Plan Write').first().json.log.Company }}"),
          Step: expr("{{ $('Plan Write').first().json.log.Step }}"),
          Input: expr("{{ $('Plan Write').first().json.log.Input }}"),
          Output: expr("{{ $('Plan Write').first().json.log.Output }}"),
          Reason: expr("{{ $('Plan Write').first().json.log.Reason }}"),
        },
        schema: [
          { id: 'Timestamp', displayName: 'Timestamp', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Workflow', displayName: 'Workflow', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Lead ID', displayName: 'Lead ID', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Company', displayName: 'Company', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Step', displayName: 'Step', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Input', displayName: 'Input', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Output', displayName: 'Output', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Reason', displayName: 'Reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
        ],
      },
      options: { cellFormat: 'RAW' },
    },
    credentials: sheetsCredentials,
  },
  output: [{ Timestamp: '2026-11-14T10:00:00.000+03:00', Workflow: 'Dashboard' }],
});

const suppressionNeeded = ifElse({
  version: 2.2,
  config: {
    name: 'Suppression Row Needed?',
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'supp-needed', leftValue: expr("{{ !!$('Plan Write').first().json.suppressionRow }}"), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    },
  },
});

const appendSuppressionRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Append Suppression Row',
    executeOnce: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'sheet',
      operation: 'append',
      documentId: documentRef,
      sheetName: { __rl: true, mode: 'name', value: 'Suppression' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          Email: expr("{{ $('Plan Write').first().json.suppressionRow.Email }}"),
          Domain: expr("{{ $('Plan Write').first().json.suppressionRow.Domain }}"),
          Reason: expr("{{ $('Plan Write').first().json.suppressionRow.Reason }}"),
          Date: expr("{{ $('Plan Write').first().json.suppressionRow.Date }}"),
        },
        schema: [
          { id: 'Email', displayName: 'Email', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Domain', displayName: 'Domain', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Reason', displayName: 'Reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'Date', displayName: 'Date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
        ],
      },
      options: { cellFormat: 'RAW' },
    },
    credentials: sheetsCredentials,
  },
  output: [{ Email: 'lead@example.com', Domain: '', Reason: 'Opt-out via dashboard: example', Date: '2026-11-14' }],
});

const writeResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Write Result',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lead-action/write-result)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true, row: {} }, requestId: 'req-00000001', store: true }],
});

const finish = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Finish',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(common/finish)' },
  },
  output: [{ status: 200, body: { ok: true } }],
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
  '## DB - Lead action\nPOST /webhook/dash/lead (Header Auth). Validate -> re-read Leads/Settings/Suppression -> expect check + rules (shared email checks pasted by `npm run sync:n8n`) -> update the row by Lead ID (RAW) -> Log row -> Suppression row for opt_out -> respond. Every error output ends in Respond Error (500). Source: dashboard/n8n in the repo; do not edit Code nodes here.',
  [webhookLead, config, validateRequest],
  { color: 4 },
);

export default workflow('db-lead-action', 'DB - Lead action', { settings: { timezone: 'Europe/Istanbul', executionOrder: 'v1' } })
  .add(webhookLead)
  .to(config)
  .to(validateRequest)
  .to(respondNow
    .onTrue(finish)
    .onFalse(checkWf3Running.to(lastWf3Runs.to(readLeads.to(readSettings.to(readSuppression.to(planWrite.to(writeNeeded
      .onTrue(leadUpdateItem.to(updateLeadRow.to(appendLogRow.to(suppressionNeeded
        .onTrue(appendSuppressionRow.to(writeResult))
        .onFalse(writeResult)))))
      .onFalse(finish)))))))))
  .add(writeResult)
  .to(finish)
  .add(finish)
  .to(respond)
  .add(validateRequest.onError(respondError))
  .add(readLeads.onError(respondError))
  .add(readSettings.onError(respondError))
  .add(readSuppression.onError(respondError))
  .add(planWrite.onError(respondError))
  .add(leadUpdateItem.onError(respondError))
  .add(updateLeadRow.onError(respondError))
  .add(writeResult.onError(respondError))
  .add(finish.onError(respondError))
  .add(note);
