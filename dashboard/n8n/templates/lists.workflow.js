import { workflow, node, trigger, sticky, newCredential, ifElse, switchCase, expr } from '@n8n/workflow-sdk';

const sheetsCredentials = { googleSheetsOAuth2Api: { id: 'sFrPcvpn5K1JgYYK', name: 'Google Sheets account' } };
const documentRef = { __rl: true, mode: 'id', value: expr("{{ $('Config').first().json.documentId }}") };
const readFormatting = { outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } } };
const respondCondition = { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'respond-now', leftValue: expr('{{ $json.respond }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' };

const webhookSuppression = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Suppression',
    parameters: { httpMethod: 'POST', path: 'dash/suppression', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ body: { action: 'add', data: { Email: 'someone@example.org', Reason: 'Asked not to be contacted' }, requestId: 'req-00000001', actor: 'approver@example.com', actorRole: 'approver' }, webhookUrl: 'http://n8n:5678/webhook/dash/suppression' }],
});

const webhookSocial = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Social',
    parameters: { httpMethod: 'POST', path: 'dash/social', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Dashboard key') },
  },
  output: [{ body: { rowNumber: 2, expect: { Week: '2026-W46', Topic: 'Example', draftHash: '' }, data: { Approved: 'Yes' }, requestId: 'req-00000002', actor: 'approver@example.com', actorRole: 'approver' }, webhookUrl: 'http://n8n:5678/webhook/dash/social' }],
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
  output: [{ documentId: '10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM', route: 'suppression', body: {} }],
});

const validateRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Request',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lists/validate)' },
  },
  output: [{ respond: false, op: 'suppression', status: 200, body: {}, req: { action: 'add', requestId: 'req-00000001' } }],
});

const respondNow = ifElse({
  version: 2.2,
  config: { name: 'Respond Now?', parameters: { conditions: respondCondition, options: {} } },
});

const routeList = switchCase({
  version: 3.2,
  config: {
    name: 'Route List',
    parameters: {
      rules: {
        values: [
          { outputKey: 'suppression', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'op-suppression', leftValue: expr('{{ $json.op }}'), rightValue: 'suppression', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { outputKey: 'social', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'op-social', leftValue: expr('{{ $json.op }}'), rightValue: 'social', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown route' },
    },
  },
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

const planSuppression = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Suppression',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lists/plan-suppression)' },
  },
  output: [{ respond: false, next: 'append', status: 200, body: {}, requestId: 'req-00000001', rowNumber: 2, row: { Email: 'someone@example.org', Domain: '', Reason: 'Example', Date: '2026-11-14' }, log: { Timestamp: '', Workflow: 'Dashboard', 'Lead ID': '', Company: '', Step: 'suppression_add', Input: '{}', Output: '{}', Reason: 'by approver@example.com' } }],
});

const suppressionStep = switchCase({
  version: 3.2,
  config: {
    name: 'Suppression Step',
    parameters: {
      rules: {
        values: [
          { outputKey: 'respond', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'next-respond', leftValue: expr('{{ $json.next }}'), rightValue: 'respond', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { outputKey: 'append', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'next-append', leftValue: expr('{{ $json.next }}'), rightValue: 'append', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { outputKey: 'delete', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'next-delete', leftValue: expr('{{ $json.next }}'), rightValue: 'delete', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unexpected' },
    },
  },
});

const appendSuppressionRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Append Suppression Row',
    executeOnce: true,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'sheet',
      operation: 'append',
      documentId: documentRef,
      sheetName: { __rl: true, mode: 'name', value: 'Suppression' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          Email: expr("{{ $('Plan Suppression').first().json.row.Email }}"),
          Domain: expr("{{ $('Plan Suppression').first().json.row.Domain }}"),
          Reason: expr("{{ $('Plan Suppression').first().json.row.Reason }}"),
          Date: expr("{{ $('Plan Suppression').first().json.row.Date }}"),
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
  output: [{ Email: 'someone@example.org', Domain: '', Reason: 'Example', Date: '2026-11-14' }],
});

const deleteSuppressionRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Delete Suppression Row',
    executeOnce: true,
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'sheet',
      operation: 'delete',
      documentId: documentRef,
      sheetName: { __rl: true, mode: 'name', value: 'Suppression' },
      toDelete: 'rows',
      startIndex: expr("{{ $('Plan Suppression').first().json.rowNumber }}"),
      numberToDelete: 1,
    },
    credentials: sheetsCredentials,
  },
  output: [{ success: true }],
});

const logSuppressionChange = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Log Suppression Change',
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
          Timestamp: expr("{{ $('Plan Suppression').first().json.log.Timestamp }}"),
          Workflow: expr("{{ $('Plan Suppression').first().json.log.Workflow }}"),
          'Lead ID': expr("{{ $('Plan Suppression').first().json.log['Lead ID'] }}"),
          Company: expr("{{ $('Plan Suppression').first().json.log.Company }}"),
          Step: expr("{{ $('Plan Suppression').first().json.log.Step }}"),
          Input: expr("{{ $('Plan Suppression').first().json.log.Input }}"),
          Output: expr("{{ $('Plan Suppression').first().json.log.Output }}"),
          Reason: expr("{{ $('Plan Suppression').first().json.log.Reason }}"),
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

const rereadSuppression = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Re-read Suppression',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueErrorOutput',
    parameters: { resource: 'sheet', operation: 'read', documentId: documentRef, sheetName: { __rl: true, mode: 'name', value: 'Suppression' }, options: readFormatting },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, Email: 'someone@example.org', Domain: '', Reason: 'Example', Date: '2026-11-14' }],
});

const suppressionResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Suppression Result',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lists/suppression-result)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true, suppression: [] }, requestId: 'req-00000001', store: true }],
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
  output: [{ row_number: 2, Week: '2026-W46', Topic: 'Example', Draft: 'Example draft', Approved: 'Pending', 'Nil Notes': '', Posted: 'No' }],
});

const planSocial = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Social',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lists/plan-social)' },
  },
  output: [{ respond: false, write: true, status: 200, body: {}, requestId: 'req-00000002', update: { row_number: 2, Approved: 'Yes' }, row: {}, log: { Timestamp: '', Workflow: 'Dashboard', 'Lead ID': '', Company: '', Step: 'social_update', Input: '{}', Output: '{}', Reason: 'by approver@example.com' } }],
});

const socialWriteNeeded = ifElse({
  version: 2.2,
  config: {
    name: 'Social Write Needed?',
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'write-needed', leftValue: expr('{{ $json.write === true }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    },
  },
});

const socialUpdateItem = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Social Update Item',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lists/social-update-item)' },
  },
  output: [{ row_number: 2, Approved: 'Yes' }],
});

const updateSocialRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Update Social Row',
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'sheet',
      operation: 'update',
      documentId: documentRef,
      sheetName: { __rl: true, mode: 'name', value: 'Social' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: ['row_number'],
        schema: [{ id: 'row_number', displayName: 'row_number', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true, readOnly: true, removed: false }],
      },
      options: { cellFormat: 'RAW', handlingExtraData: 'error' },
    },
    credentials: sheetsCredentials,
  },
  output: [{ row_number: 2, Approved: 'Yes' }],
});

const logSocialChange = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Log Social Change',
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
          Timestamp: expr("{{ $('Plan Social').first().json.log.Timestamp }}"),
          Workflow: expr("{{ $('Plan Social').first().json.log.Workflow }}"),
          'Lead ID': expr("{{ $('Plan Social').first().json.log['Lead ID'] }}"),
          Company: expr("{{ $('Plan Social').first().json.log.Company }}"),
          Step: expr("{{ $('Plan Social').first().json.log.Step }}"),
          Input: expr("{{ $('Plan Social').first().json.log.Input }}"),
          Output: expr("{{ $('Plan Social').first().json.log.Output }}"),
          Reason: expr("{{ $('Plan Social').first().json.log.Reason }}"),
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

const socialResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Social Result',
    onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '__CODE__(lists/social-result)' },
  },
  output: [{ respond: true, status: 200, body: { ok: true, row: {} }, requestId: 'req-00000002', store: true }],
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
  '## DB - Lists\nPOST /webhook/dash/suppression (add; admin-only remove by row number with expect check, then re-read) and /webhook/dash/social (update Approved / Nil Notes / Posted by row number with expect check). All writes RAW plus one Log row. Source: dashboard/n8n in the repo.',
  [webhookSuppression, webhookSocial, config],
  { color: 4 },
);

export default workflow('db-lists', 'DB - Lists', { settings: { timezone: 'Europe/Istanbul', executionOrder: 'v1' } })
  .add(webhookSuppression)
  .to(config)
  .add(webhookSocial)
  .to(config)
  .add(config)
  .to(validateRequest)
  .to(respondNow
    .onTrue(finish)
    .onFalse(routeList
      .onCase(0, readSuppression.to(planSuppression.to(suppressionStep
        .onCase(0, finish)
        .onCase(1, appendSuppressionRow.to(logSuppressionChange.to(rereadSuppression.to(suppressionResult.to(finish)))))
        .onCase(2, deleteSuppressionRow.to(logSuppressionChange))
        .onCase(3, respondError))))
      .onCase(1, readSocial.to(planSocial.to(socialWriteNeeded
        .onTrue(socialUpdateItem.to(updateSocialRow.to(logSocialChange.to(socialResult.to(finish)))))
        .onFalse(finish))))
      .onCase(2, respondError)))
  .add(finish)
  .to(respond)
  .add(validateRequest.onError(respondError))
  .add(readSuppression.onError(respondError))
  .add(planSuppression.onError(respondError))
  .add(appendSuppressionRow.onError(respondError))
  .add(deleteSuppressionRow.onError(respondError))
  .add(rereadSuppression.onError(respondError))
  .add(suppressionResult.onError(respondError))
  .add(readSocial.onError(respondError))
  .add(planSocial.onError(respondError))
  .add(socialUpdateItem.onError(respondError))
  .add(updateSocialRow.onError(respondError))
  .add(socialResult.onError(respondError))
  .add(finish.onError(respondError))
  .add(note);
