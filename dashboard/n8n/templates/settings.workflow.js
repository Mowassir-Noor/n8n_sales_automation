import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const sheetsCredentials = { googleSheetsOAuth2Api: { id: 'sFrPcvpn5K1JgYYK', name: 'Google Sheets account' } };
const documentRef = { __rl: true, mode: 'id', value: expr("{{ $('Config').first().json.documentId }}") };
const readFormatting = { outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } } };
const respondCondition = { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'respond-now', leftValue: expr('{{ $json.respond }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' };

const webhookSettings = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Settings',
    parameters: { httpMethod: 'POST', path: 'dash/settings', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ headers: { 'x-go-live': '' }, body: { expect: { 'Nil Email': 'old@example.com' }, data: { 'Nil Email': 'new@example.com' }, requestId: 'req-00000001', actor: 'admin@example.com', actorRole: 'admin' }, webhookUrl: 'http://n8n:5678/webhook/dash/settings' }],
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
          { id: 'cfg-golive', name: 'goLiveHeader', value: expr('{{ String(($json.headers || {})["x-go-live"] || "") }}'), type: 'string' },
        ],
      },
      options: {},
    },
  },
  output: [{ documentId: '10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM', body: {}, goLiveHeader: '' }],
});

const validateRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Request',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(settings/validate)' },
  },
  output: [{ respond: false, status: 200, body: {}, req: { data: {}, expect: {}, requestId: 'req-00000001' } }],
});

const respondNow = ifElse({
  version: 2.2,
  config: { name: 'Respond Now?', parameters: { conditions: respondCondition, options: {} } },
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
  output: [{ row_number: 2, 'Sender Name': 'Example Sender', 'Nil Email': 'old@example.com' }],
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
  output: [{ row_number: 2, 'Lead ID': 'L001', Stage: 'Sent', 'Sent At': '2026-11-10T10:00:00.000+03:00' }],
});

const planSettings = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Settings',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(settings/plan)' },
  },
  output: [{ respond: false, write: true, status: 200, body: {}, requestId: 'req-00000001', update: { row_number: 2, 'Nil Email': 'new@example.com' }, settings: {}, log: { Timestamp: '', Workflow: 'Dashboard', 'Lead ID': '', Company: '', Step: 'settings_update', Input: '{}', Output: '{}', Reason: 'by admin@example.com' } }],
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

const settingsUpdateItem = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Settings Update Item',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(settings/update-item)' },
  },
  output: [{ valueInputOption: 'RAW', data: [{ range: 'Settings!G2', values: [['new@example.com']] }] }],
});

const updateSettingsRow = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Update Settings Row',
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('Config').first().json.documentId + '/values:batchUpdate' }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json) }}'),
      options: {},
    },
    credentials: sheetsCredentials,
  },
  output: [{ spreadsheetId: 'example', totalUpdatedCells: 1 }],
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
          Timestamp: expr("{{ $('Plan Settings').first().json.log.Timestamp }}"),
          Workflow: expr("{{ $('Plan Settings').first().json.log.Workflow }}"),
          'Lead ID': expr("{{ $('Plan Settings').first().json.log['Lead ID'] }}"),
          Company: expr("{{ $('Plan Settings').first().json.log.Company }}"),
          Step: expr("{{ $('Plan Settings').first().json.log.Step }}"),
          Input: expr("{{ $('Plan Settings').first().json.log.Input }}"),
          Output: expr("{{ $('Plan Settings').first().json.log.Output }}"),
          Reason: expr("{{ $('Plan Settings').first().json.log.Reason }}"),
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

const settingsResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Settings Result',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(settings/result)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true, settings: {} }, requestId: 'req-00000001', store: true }],
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
  '## DB - Settings\nPOST /webhook/dash/settings (Header Auth). Validate fields per role -> re-read Settings row 2 (and Leads for the go-live rule) -> 409 if any expect value differs -> update row 2 (RAW, matched on row_number) -> Log row -> respond with the new Settings. Source: dashboard/n8n in the repo.',
  [webhookSettings, config, validateRequest],
  { color: 4 },
);

export default workflow('db-settings', 'DB - Settings', { settings: { timezone: 'Europe/Istanbul', executionOrder: 'v1' } })
  .add(webhookSettings)
  .to(config)
  .to(validateRequest)
  .to(respondNow
    .onTrue(finish)
    .onFalse(readSettings.to(readLeads.to(planSettings.to(writeNeeded
      .onTrue(settingsUpdateItem.to(updateSettingsRow.to(appendLogRow.to(settingsResult.to(finish)))))
      .onFalse(finish))))))
  .add(finish)
  .to(respond)
  .add(validateRequest.onError(respondError))
  .add(readSettings.onError(respondError))
  .add(readLeads.onError(respondError))
  .add(planSettings.onError(respondError))
  .add(settingsUpdateItem.onError(respondError))
  .add(updateSettingsRow.onError(respondError))
  .add(settingsResult.onError(respondError))
  .add(finish.onError(respondError))
  .add(note);
