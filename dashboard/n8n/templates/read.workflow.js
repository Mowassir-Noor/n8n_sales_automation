import { workflow, node, trigger, sticky, newCredential, switchCase, expr } from '@n8n/workflow-sdk';

const sheetsCredentials = { googleSheetsOAuth2Api: { id: 'sFrPcvpn5K1JgYYK', name: 'Google Sheets account' } };
const documentRef = { __rl: true, mode: 'id', value: expr("{{ $('Config').first().json.documentId }}") };
const readFormatting = { outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } } };

const webhookSnapshot = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Snapshot',
    parameters: { httpMethod: 'POST', path: 'dash/snapshot', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ body: {}, webhookUrl: 'http://n8n:5678/webhook/dash/snapshot' }],
});

const webhookLog = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Log',
    parameters: { httpMethod: 'POST', path: 'dash/log', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ body: { leadId: 'L001', page: 1, pageSize: 50 }, webhookUrl: 'http://n8n:5678/webhook/dash/log' }],
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
          { id: 'cfg-route', name: 'route', value: expr('{{ String($json.webhookUrl || "").replace(/\\/+$/, "").split("/").pop() }}'), type: 'string' },
          { id: 'cfg-body', name: 'body', value: expr('{{ $json.body }}'), type: 'object' },
        ],
      },
      options: {},
    },
  },
  output: [{ documentId: '10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM', route: 'snapshot', body: {} }],
});

const route = switchCase({
  version: 3.2,
  config: {
    name: 'Route',
    parameters: {
      rules: {
        values: [
          { outputKey: 'snapshot', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'route-snapshot', leftValue: expr('{{ $json.route }}'), rightValue: 'snapshot', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { outputKey: 'log', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'route-log', leftValue: expr('{{ $json.route }}'), rightValue: 'log', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown route' },
    },
  },
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
  output: [{ row_number: 2, 'Lead ID': 'L001', Company: 'Example Tekstil', Stage: 'Drafted' }],
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
  output: [{ row_number: 2, 'Sender Name': 'Example Sender' }],
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

const readSocial = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Social',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueErrorOutput',
    parameters: { resource: 'sheet', operation: 'read', documentId: documentRef, sheetName: { __rl: true, mode: 'name', value: 'Social' }, options: readFormatting },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, Week: '2026-W46', Topic: 'Example topic', Draft: 'Example draft', Approved: 'Pending', 'Nil Notes': '', Posted: 'No' }],
});

const buildSnapshot = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Snapshot',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(read/build-snapshot)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true }, requestId: '', store: false }],
});

const readLog = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Log',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueErrorOutput',
    parameters: { resource: 'sheet', operation: 'read', documentId: documentRef, sheetName: { __rl: true, mode: 'name', value: 'Log' }, options: readFormatting },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, Timestamp: '2026-11-13T10:00:00.000+03:00', Workflow: 'Dashboard', 'Lead ID': 'L001', Company: 'Example Tekstil', Step: 'approve_first', Input: '{}', Output: '{}', Reason: 'by approver@example.com' }],
});

const filterLog = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Filter Log',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(read/filter-log)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true, rows: [], total: 0, page: 1, pageSize: 50 }, requestId: '', store: false }],
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
  '## DB - Read\nPOST /webhook/dash/snapshot and /webhook/dash/log (Header Auth). Snapshot reads the Leads, Settings, Suppression and Social tabs whole and shapes them in Build Snapshot (header check A..AG). Log filters and pages the Log tab. Read-only. Source: dashboard/n8n in the repo.',
  [webhookSnapshot, webhookLog, config],
  { color: 4 },
);

export default workflow('db-read', 'DB - Read', { settings: { timezone: 'Europe/Istanbul', executionOrder: 'v1' } })
  .add(webhookSnapshot)
  .to(config)
  .add(webhookLog)
  .to(config)
  .add(config)
  .to(route
    .onCase(0, readLeads.to(readSettings.to(readSuppression.to(readSocial.to(buildSnapshot.to(respond))))))
    .onCase(1, readLog.to(filterLog.to(respond)))
    .onCase(2, respondError))
  .add(readLeads.onError(respondError))
  .add(readSettings.onError(respondError))
  .add(readSuppression.onError(respondError))
  .add(readSocial.onError(respondError))
  .add(buildSnapshot.onError(respondError))
  .add(readLog.onError(respondError))
  .add(filterLog.onError(respondError))
  .add(note);
