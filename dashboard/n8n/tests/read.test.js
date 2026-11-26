import { describe, it, expect } from 'vitest';
import { runNode } from './harness.js';
import { lead, settingsRow } from './fixtures.js';

describe('DB - Read / snapshot', () => {
  it('returns all tabs, tolerates a missing Hot Handled column and empty tabs', async () => {
    const [out] = await runNode('read/build-snapshot', {
      nodes: { 'Read Leads': [lead(), lead({ row_number: 6, 'Lead ID': '' })], 'Read Settings': [settingsRow()], 'Read Suppression': [{}], 'Read Social': [{}] },
    });
    expect(out.status).toBe(200);
    const s = out.body;
    expect(s).toMatchObject({ ok: true, fetchedAt: '2026-11-16T12:00:00.000+03:00', headersOk: true, headerProblems: [], suppression: [], social: [] });
    expect(s.leads).toHaveLength(1);
    expect(s.leads[0]['Hot Handled']).toBe('');
    expect(s.leads[0].row_number).toBe(5);
    expect(s.settings['Test Email']).toBe('test-inbox@example.com');
    expect(s.settings.row_number).toBeUndefined();
  });

  it('reports header problems', async () => {
    const row = lead();
    delete row.Confidence;
    const [out] = await runNode('read/build-snapshot', { nodes: { 'Read Leads': [row], 'Read Settings': [{}], 'Read Suppression': [{}], 'Read Social': [{}] } });
    expect(out.body.headersOk).toBe(false);
    expect(out.body.headerProblems[0]).toBe('Column AF: expected "Confidence", found "Follow-up Draft"');
  });

  const QUOTA = 'The service is receiving too many requests from you';

  it('answers 503 "Google Sheets is busy" when a read hit the per-minute quota, not an empty snapshot', async () => {
    const [out] = await runNode('read/build-snapshot', {
      nodes: { 'Read Leads': [{}], 'Read Settings': [{}], 'Read Suppression': [{}], 'Read Social': [{}] },
      nodeErrors: { 'Read Leads': QUOTA, 'Read Settings': QUOTA },
    });
    expect(out.status).toBe(503);
    expect(out.store).toBe(false);
    expect(out.body.sheetsBusy).toBe(true);
    expect(out.body.error).toMatch(/Google Sheets is busy/);
    expect(out.body.leads).toBeUndefined();
  });

  it('answers 503 for any other failed read, naming the tab', async () => {
    const [out] = await runNode('read/build-snapshot', {
      nodes: { 'Read Leads': [lead()], 'Read Settings': [settingsRow()], 'Read Suppression': [{}], 'Read Social': [{}] },
      nodeErrors: { 'Read Social': 'Sheet not found' },
    });
    expect(out.status).toBe(503);
    expect(out.body.sheetsBusy).toBe(false);
    expect(out.body.error).toContain('Read Social: Sheet not found');
  });

  it('treats Leads and Settings both empty as a failed read', async () => {
    const [out] = await runNode('read/build-snapshot', { nodes: { 'Read Leads': [{}], 'Read Settings': [{}], 'Read Suppression': [{}], 'Read Social': [{}] } });
    expect(out.status).toBe(503);
  });
});

describe('DB - Read / log', () => {
  const rows = [];
  for (let i = 0; i < 7; i++) {
    rows.push({ row_number: i + 2, Timestamp: `2026-11-1${i}T10:00:00.000+03:00`, Workflow: i % 2 ? 'Dashboard' : 'WF3 Send approved emails', 'Lead ID': i < 4 ? 'L1' : 'L2', Company: 'C', Step: 's' + i, Input: '', Output: '', Reason: '' });
  }
  const run = async (body) => (await runNode('read/filter-log', { nodes: { Config: [{ body }], 'Read Log': rows } }))[0];

  it('filters, sorts newest first and pages', async () => {
    const out = await run({ leadId: 'L1', page: 1, pageSize: 2 });
    expect(out.body).toMatchObject({ ok: true, total: 4, page: 1, pageSize: 2 });
    expect(out.body.rows.map(r => r.Step)).toEqual(['s3', 's2']);
    const wf = await run({ workflow: 'wf3', from: '2026-11-12', to: '2026-11-14' });
    expect(wf.body.rows.map(r => r.Step)).toEqual(['s4', 's2']);
  });

  it('rejects bad paging', async () => {
    expect((await run({ pageSize: 9999 })).status).toBe(422);
  });
});
