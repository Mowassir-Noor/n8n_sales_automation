import { describe, it, expect } from 'vitest';
import {
  LEAD_HEADERS, checkLeadHeaders, colLetter, normalizeRow, sheetRows, detectHeaders, logRow,
  dedupeGet, dedupeSet, isEmail, isDomain, actorErrors,
} from '../code/_lib/common.js';
import { isWorkflowRunning, toExecutionInfo, WF3_ID, WF5_ID, itemsFailed } from '../code/_lib/executions.js';

describe('common', () => {
  it('names columns like the sheet', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(32)).toBe('AG');
    expect(colLetter(33)).toBe('AH');
  });

  it('accepts the 33 Leads headers with or without AH', () => {
    expect(checkLeadHeaders(LEAD_HEADERS)).toEqual({ ok: true, problems: [], hasHotHandled: false });
    expect(checkLeadHeaders(LEAD_HEADERS.concat(['Hot Handled'])).hasHotHandled).toBe(true);
  });

  it('reports moved and missing headers', () => {
    const moved = LEAD_HEADERS.slice();
    moved[1] = 'Website';
    moved[2] = 'Company';
    const r = checkLeadHeaders(moved.slice(0, 32));
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('Column B: expected "Company", found "Website"');
    expect(r.problems).toContain('Column AG: expected "Follow-up Draft", found nothing');
    expect(checkLeadHeaders([]).ok).toBe(false);
  });

  it('drops the empty-tab item and normalizes values to strings', () => {
    expect(sheetRows([{ json: {} }])).toEqual([]);
    const rows = sheetRows([{ json: { row_number: 2, Email: 'a@example.com', Domain: '', Count: 3 } }]);
    expect(normalizeRow(rows[0], ['Email', 'Count', 'Missing'])).toEqual({ Email: 'a@example.com', Count: '3', Missing: '', row_number: 2 });
    expect(detectHeaders([{ row_number: 2, A: 1 }, { row_number: 3, A: 1, B: 2 }])).toEqual(['A', 'B']);
  });

  it('builds Log rows as the contract says', () => {
    const long = 'x'.repeat(5000);
    const row = logRow({ nowIso: 'T', leadId: 'L1', company: 'C', step: 'approve_first', before: { a: long }, after: { a: 'Yes' }, actor: 'admin@example.com', adminApproval: true });
    expect(row.Workflow).toBe('Dashboard');
    expect(row.Input.length).toBe(3000);
    expect(row.Output).toBe('{"a":"Yes"}');
    expect(row.Reason).toBe('by admin@example.com (admin)');
    expect(logRow({ actor: 'a@example.com' }).Reason).toBe('by a@example.com');
  });

  it('remembers request ids for 10 minutes', () => {
    const sd = {};
    dedupeSet(sd, 'req-1', 200, { ok: true }, 1000);
    expect(dedupeGet(sd, 'req-1', 1000 + 9 * 60000)).toEqual({ status: 200, body: { ok: true } });
    expect(dedupeGet(sd, 'req-1', 1000 + 11 * 60000)).toBeNull();
    expect(sd.dashRequests).toEqual({});
  });

  it('validates emails, domains and actors', () => {
    expect(isEmail('someone@example.com')).toBe(true);
    expect(isEmail('someone@example')).toBe(false);
    expect(isEmail('a b@example.com')).toBe(false);
    expect(isDomain('example.com.tr')).toBe(true);
    expect(isDomain('https://example.com')).toBe(false);
    expect(actorErrors({ actor: 'a@example.com', actorRole: 'admin', requestId: '12345678' })).toEqual([]);
    expect(actorErrors({ actor: 'x', actorRole: 'boss', requestId: 'x' })).toHaveLength(3);
  });
});

describe('executions', () => {
  // Monday 16 Nov 2026; 10:00 Istanbul = 07:00Z
  const at = (hh, mm) => ({ ms: Date.parse(`2026-11-16T${hh}:${mm}:00+03:00`), weekday: 1, minuteOfDay: Number(hh) * 60 + Number(mm) });

  it('trusts the API when it reports a running execution', () => {
    expect(isWorkflowRunning(WF3_ID, [], [{ id: 1, workflowId: WF3_ID, status: 'running' }], at('16', '00'))).toBe(true);
    expect(isWorkflowRunning(WF5_ID, [], [{ id: 1, workflowId: WF3_ID, status: 'running' }], at('16', '00'))).toBe(false);
  });

  it('assumes WF3 runs inside its window until a run started after the slot has finished', () => {
    expect(isWorkflowRunning(WF3_ID, [], [], at('10', '05'))).toBe(true);
    const done = [{ id: 2, workflowId: WF3_ID, status: 'success', startedAt: '2026-11-16T07:00:01.000Z', stoppedAt: '2026-11-16T07:10:00.000Z' }];
    expect(isWorkflowRunning(WF3_ID, done, [], at('10', '15'))).toBe(false);
    const yesterday = [{ id: 1, workflowId: WF3_ID, status: 'success', startedAt: '2026-11-13T11:00:01.000Z', stoppedAt: '2026-11-13T11:10:00.000Z' }];
    expect(isWorkflowRunning(WF3_ID, yesterday, [], at('14', '10'))).toBe(true);
    expect(isWorkflowRunning(WF3_ID, [], [], at('10', '45'))).toBe(false);
    expect(isWorkflowRunning(WF3_ID, [], [], { ...at('10', '05'), weekday: 6 })).toBe(false);
  });

  it('shapes execution info with the error message', () => {
    const info = toExecutionInfo({ id: 9, workflowId: WF3_ID, status: 'error', startedAt: 'a', stoppedAt: 'b', data: { resultData: { lastNodeExecuted: 'Send Email', error: { message: 'boom' } } } });
    expect(info).toEqual({ workflowId: WF3_ID, workflowName: 'WF3 - Send approved emails', status: 'error', startedAt: 'a', stoppedAt: 'b', error: 'Send Email: boom' });
    expect(itemsFailed([{ json: { error: { message: 'no key' } } }])).toBe('no key');
    expect(itemsFailed([{ json: { id: 1 } }, { json: { error: 'x' } }])).toBe('');
  });
});
