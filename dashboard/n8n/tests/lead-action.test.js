import { describe, it, expect } from 'vitest';
import { runNode, fakeNow } from './harness.js';
import { lead, settingsRow, expectFor, goodBody } from './fixtures.js';
import { LEAD_HEADERS } from '../code/_lib/common.js';

const ACTOR = 'approver@example.com';

function request(over = {}) {
  return Object.assign({ action: 'approve_first', leadId: 'L901', expect: expectFor(lead()), data: {}, requestId: 'req-0000-0001', actor: ACTOR, actorRole: 'approver' }, over);
}

async function validate(body, staticData = {}) {
  const [out] = await runNode('lead-action/validate', { nodes: { Config: [{ body }] }, staticData });
  return out;
}

async function plan(body, { rows = [lead()], settings = settingsRow(), suppression = [{}], wf3Running = [{}], wf3Recent = [{}], now } = {}) {
  const v = await validate(body);
  expect(v.respond).toBe(false);
  const [out] = await runNode('lead-action/plan', {
    nodes: {
      'Validate Request': [v],
      'Read Leads': rows.length ? rows : [{}],
      'Read Settings': [settings],
      'Read Suppression': suppression,
      'Check WF3 Running': wf3Running,
      'Last WF3 Runs': wf3Recent,
    },
    now,
  });
  return out;
}

describe('DB - Lead action / Validate Request', () => {
  it('rejects a malformed request with 422', async () => {
    const out = await validate({ action: 'fly', leadId: '', actor: 'nobody', actorRole: 'x', requestId: '1' });
    expect(out.status).toBe(422);
    expect(out.body.errors.length).toBeGreaterThan(3);
  });

  it('needs a note to reject', async () => {
    const out = await validate(request({ action: 'reject_first', data: {} }));
    expect(out.body.errors).toContain('data.note is required');
  });

  it('keeps go-live cleanup for admins', async () => {
    const out = await validate(request({ action: 'reset_test_sent' }));
    expect(out).toMatchObject({ respond: true, status: 403 });
  });

  it('answers a repeated requestId from static data without running again', async () => {
    const staticData = {};
    const [fin] = await runNode('common/finish', { input: [{ respond: true, status: 200, body: { ok: true, row: { 'Lead ID': 'L901' } }, requestId: 'req-0000-0001', store: true }], staticData });
    expect(fin).toEqual({ status: 200, body: { ok: true, row: { 'Lead ID': 'L901' } } });
    const again = await validate(request(), staticData);
    expect(again).toMatchObject({ respond: true, status: 200, store: false, deduplicated: true, body: { ok: true } });
  });

  it('does not remember 5xx answers', async () => {
    const staticData = {};
    await runNode('common/finish', { input: [{ status: 500, body: { error: 'x' }, requestId: 'req-0000-0001', store: true }], staticData });
    expect((await validate(request(), staticData)).respond).toBe(false);
  });
});

describe('DB - Lead action / Plan Write', () => {
  it('approves a clean first email and plans one update and one Log row', async () => {
    const out = await plan(request());
    expect(out.write).toBe(true);
    expect(out.update).toEqual({ 'Lead ID': 'L901', Approved: 'Yes', 'Last Updated': '2026-11-16T12:00:00.000+03:00' });
    expect(out.row.Approved).toBe('Yes');
    expect(out.row['Hot Handled']).toBe('');
    expect(out.log).toEqual({
      Timestamp: '2026-11-16T12:00:00.000+03:00',
      Workflow: 'Dashboard',
      'Lead ID': 'L901',
      Company: 'Example Tekstil A.Ş.',
      Step: 'approve_first',
      Input: JSON.stringify({ Approved: 'Pending', 'Last Updated': '2026-11-13T23:41:07.112+03:00' }),
      Output: JSON.stringify({ Approved: 'Yes', 'Last Updated': '2026-11-16T12:00:00.000+03:00' }),
      Reason: 'by approver@example.com',
    });
  });

  it('marks admin approvals in the Log reason', async () => {
    const out = await plan(request({ actor: 'admin@example.com', actorRole: 'admin' }));
    expect(out.log.Reason).toBe('by admin@example.com (admin)');
  });

  it('returns 409 with the current row when the row changed', async () => {
    const changed = lead({ 'Last Updated': '2026-11-14T08:00:00.000+03:00' });
    const out = await plan(request(), { rows: [changed] });
    expect(out.status).toBe(409);
    expect(out.body.conflict).toBe(true);
    expect(out.body.row['Last Updated']).toBe('2026-11-14T08:00:00.000+03:00');
    expect(out.write).toBeUndefined();
  });

  it('catches a hand edit of the draft through the hash', async () => {
    const out = await plan(request(), { rows: [lead({ 'Draft Body': goodBody + '\nP.S.' })] });
    expect(out.status).toBe(409);
    expect(out.body.message).toContain('Subject or Draft Body');
  });

  it('re-runs checkDraft and refuses a draft that needs fixing', async () => {
    const bad = lead({ 'Draft Body': 'Hello, 100% guaranteed results.' });
    const out = await plan(request({ expect: expectFor(bad) }), { rows: [bad] });
    expect(out.status).toBe(422);
    expect(out.body.errors).toContain('Data-source sentence missing');
  });

  it('refuses approval for a suppressed address', async () => {
    const out = await plan(request(), { suppression: [{ row_number: 2, Email: '', Domain: 'example-tekstil.com.tr', Reason: 'x', Date: '' }] });
    expect(out.status).toBe(422);
    expect(out.body.errors.join(' ')).toMatch(/suppression/i);
  });

  it('refuses writes when the Leads headers are wrong', async () => {
    const row = lead();
    const moved = {};
    for (const h of LEAD_HEADERS.slice().reverse()) moved[h] = row[h];
    const out = await plan(request(), { rows: [moved] });
    expect(out.status).toBe(422);
    expect(out.body.errors[0]).toMatch(/headers do not match/);
  });

  it('edit_first saves the fixed body and the check result, clears the translation', async () => {
    const row = lead({ 'Draft Body EN': 'old translation' });
    const body = goodBody.replace('Örnek Mahallesi 1. Sokak\nNo: 1', 'Örnek Mahallesi 1. Sokak No: 1') + '\nprice list attached';
    const out = await plan(request({ action: 'edit_first', expect: expectFor(row), data: { subject: 'New subject', body } }), { rows: [row] });
    expect(out.update['Draft Body']).toContain('Sokak\nNo: 1');
    expect(out.update['Compliance Status']).toBe('Needs fix');
    expect(out.update['Compliance Notes']).toContain('Commercially sensitive wording: price');
    expect(out.update['Draft Body EN']).toBe('');
    expect(out.update.Approved).toBe('Pending');
    expect(out.update.Subject).toBe('New subject');
  });

  it('unapprove_first is refused while WF3 runs and fails clearly when the API is down', async () => {
    const row = lead({ Approved: 'Yes' });
    const req = request({ action: 'unapprove_first', expect: expectFor(row) });
    const running = [{ id: '7', workflowId: 'SeSyIb5vHQxG1F59', status: 'running', startedAt: '2026-11-16T09:00:00.000Z' }];
    const busy = await plan(req, { rows: [row], wf3Running: running, wf3Recent: running });
    expect(busy.status).toBe(422);
    expect(busy.body.errors[0]).toMatch(/WF3 is sending/);
    const down = await plan(req, { rows: [row], wf3Running: [{ error: { message: 'Unauthorized' } }], wf3Recent: [{ error: { message: 'Unauthorized' } }] });
    expect(down.status).toBe(500);
    const idle = await plan(req, { rows: [row] });
    expect(idle.update.Approved).toBe('Pending');
  });

  it('opt_out adds a Suppression row dated today in Istanbul', async () => {
    const row = lead({ Stage: 'Sent', 'Next Follow-up Date': '2026-11-20' });
    const out = await plan(request({ action: 'opt_out', expect: expectFor(row, 'none'), data: { note: 'asked by phone' } }), { rows: [row], now: fakeNow('2026-11-17T01:30:00') });
    expect(out.update).toMatchObject({ 'Opt-out': 'Yes', Stage: 'Opted out', 'Next Follow-up Date': '' });
    expect(out.suppressionRow).toEqual({ Email: 'ayse@example-tekstil.com.tr', Domain: '', Reason: 'Opt-out via dashboard: asked by phone', Date: '2026-11-17' });
  });

  it('mark_hot_handled needs column AH', async () => {
    const row = lead({ Stage: 'Replied - Hot', 'Reply Category': 'Hot' });
    const req = request({ action: 'mark_hot_handled', expect: expectFor(row, 'none') });
    const missing = await plan(req, { rows: [row] });
    expect(missing).toMatchObject({ status: 422, body: { errors: ["Add column AH 'Hot Handled' to the Leads tab first"] } });
    const ok = await plan(req, { rows: [Object.assign({}, row, { 'Hot Handled': '' })] });
    expect(ok.update['Hot Handled']).toBe('2026-11-16T12:00:00.000+03:00 by approver@example.com');
  });

  it('follow-up actions use the follow-up hash and stages', async () => {
    const row = lead({ Stage: 'Sent', Approved: 'Yes', 'Follow-up Draft': 'Just following up on my note last week.' });
    const req = request({ action: 'rewrite_followup', expect: expectFor(row, 'followup'), data: { note: 'shorter please' } });
    const out = await plan(req, { rows: [row] });
    expect(out.update).toMatchObject({ Approved: 'Edit', 'Nil Notes': 'shorter please' });
    const wrongStage = lead({ Stage: 'Drafted', 'Follow-up Draft': 'x' });
    const bad = await plan(request({ action: 'decline_followup', expect: expectFor(wrongStage, 'followup') }), { rows: [wrongStage] });
    expect(bad.status).toBe(422);
  });

  it('set_reply_category maps Not interested to Opted out', async () => {
    const row = lead({ Stage: 'Replied - Warm', 'Reply Category': 'Warm' });
    const out = await plan(request({ action: 'set_reply_category', expect: expectFor(row, 'none'), data: { category: 'Not interested' } }), { rows: [row] });
    expect(out.update).toMatchObject({ 'Reply Category': 'Not interested', Stage: 'Opted out' });
  });

  it('reset_test_sent clears the send fields (admin, test mode)', async () => {
    const row = lead({ Stage: 'Follow-up 1', Approved: 'Yes', 'Sent At': '2026-11-10T10:00:00.000+03:00', 'Gmail Thread ID': 'smtp:x', 'Follow-up Count': '1', 'Next Follow-up Date': '2026-11-20', 'Follow-up Draft': 'x' });
    const req = request({ action: 'reset_test_sent', expect: expectFor(row, 'none'), actor: 'admin@example.com', actorRole: 'admin' });
    const out = await plan(req, { rows: [row] });
    expect(out.update).toMatchObject({ Stage: 'Drafted', 'Sent At': '', 'Gmail Thread ID': '', 'Follow-up Count': '', 'Next Follow-up Date': '', 'Follow-up Draft': '', Approved: 'Pending' });
    const live = await plan(req, { rows: [row], settings: settingsRow({ 'Test Email': '' }) });
    expect(live.status).toBe(422);
  });

  it('reports a missing or duplicated lead', async () => {
    expect((await plan(request({ leadId: 'L404' }))).status).toBe(422);
    expect((await plan(request(), { rows: [lead(), lead({ row_number: 6 })] })).body.errors[0]).toMatch(/appears 2 times/);
  });

  it('write-result returns the row and warns about a failed Log append', async () => {
    const planned = await plan(request());
    const [out] = await runNode('lead-action/write-result', { nodes: { 'Plan Write': [planned], 'Append Log Row': [{ error: { message: 'quota' } }] } });
    expect(out).toMatchObject({ status: 200, store: true, requestId: 'req-0000-0001', body: { ok: true, warnings: ['The Log row could not be written: quota'] } });
    expect(out.body.row.Approved).toBe('Yes');
  });
});
