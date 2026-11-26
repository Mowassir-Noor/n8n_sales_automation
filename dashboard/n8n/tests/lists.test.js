import { describe, it, expect } from 'vitest';
import { runNode, fakeNow } from './harness.js';
import { hashText } from '../../shared/email/hash.js';

const approver = { actor: 'approver@example.com', actorRole: 'approver', requestId: 'req-lists-0001' };
const admin = { actor: 'admin@example.com', actorRole: 'admin', requestId: 'req-lists-0002' };
const suppressionTab = [
  { row_number: 2, Email: 'blocked@example.org', Domain: '', Reason: 'İYS ret', Date: '2026-10-01' },
  { row_number: 3, Email: '', Domain: 'example.net', Reason: 'bounce', Date: '2026-10-02' },
];

async function validate(route, body) {
  const [out] = await runNode('lists/validate', { nodes: { Config: [{ route, body }] } });
  return out;
}

async function planSuppression(body, tab = suppressionTab) {
  const v = await validate('suppression', body);
  if (v.respond) return v;
  const [out] = await runNode('lists/plan-suppression', { nodes: { 'Validate Request': [v], 'Read Suppression': tab.length ? tab : [{}] }, now: fakeNow('2026-11-16T23:30:00') });
  return out;
}

describe('DB - Lists / suppression', () => {
  it('adds an email with today\'s Istanbul date', async () => {
    const out = await planSuppression(Object.assign({ action: 'add', data: { Email: ' New@Example.org ', Reason: 'Asked by phone' } }, approver));
    expect(out.next).toBe('append');
    expect(out.row).toEqual({ Email: 'new@example.org', Domain: '', Reason: 'Asked by phone', Date: '2026-11-16' });
    expect(out.log.Step).toBe('suppression_add');
  });

  it('validates formats and refuses duplicates', async () => {
    const bad = await planSuppression(Object.assign({ action: 'add', data: { Email: 'nope', Domain: 'https://x.com/', Reason: '' } }, approver));
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toHaveLength(3);
    const dupe = await planSuppression(Object.assign({ action: 'add', data: { Domain: '@Example.net', Reason: 'again' } }, approver));
    expect(dupe).toMatchObject({ status: 422, next: 'respond' });
  });

  it('removes only for admins and only the row the user saw', async () => {
    const body = { action: 'remove', rowNumber: 3, expect: { Email: '', Domain: 'example.net' }, reason: 'added by mistake' };
    expect((await planSuppression(Object.assign({}, body, approver))).status).toBe(403);
    const ok = await planSuppression(Object.assign({}, body, admin));
    expect(ok).toMatchObject({ next: 'delete', rowNumber: 3 });
    expect(JSON.parse(ok.log.Output)).toEqual({ removed: true, reason: 'added by mistake' });
    const moved = await planSuppression(Object.assign({}, body, admin, { rowNumber: 2 }));
    expect(moved).toMatchObject({ status: 409, next: 'respond', body: { conflict: true } });
    const gone = await planSuppression(Object.assign({}, body, admin, { rowNumber: 9 }));
    expect(gone.body.row).toBeNull();
  });

  it('answers with the re-read list', async () => {
    const [out] = await runNode('lists/suppression-result', { nodes: { 'Plan Suppression': [{ requestId: 'r-1' }], 'Re-read Suppression': [{}], 'Log Suppression Change': [{}] } });
    expect(out).toMatchObject({ status: 200, body: { ok: true, suppression: [] }, store: true });
  });
});

describe('DB - Lists / social', () => {
  const tab = [{ row_number: 4, Week: '2026-W46', Topic: 'Example topic', Draft: 'Example draft text', Approved: 'Pending', 'Nil Notes': '', Posted: 'No' }];
  const body = (over = {}) => Object.assign({ rowNumber: 4, expect: { Week: '2026-W46', Topic: 'Example topic', draftHash: hashText('Example draft text') }, data: { Approved: 'Yes', Posted: 'Yes' } }, approver, over);

  async function plan(b) {
    const v = await validate('social', b);
    if (v.respond) return v;
    const [out] = await runNode('lists/plan-social', { nodes: { 'Validate Request': [v], 'Read Social': tab } });
    return out;
  }

  it('updates Approved and Posted by row number', async () => {
    const out = await plan(body());
    expect(out.update).toEqual({ row_number: 4, Approved: 'Yes', Posted: 'Yes' });
    expect(out.row).toMatchObject({ Approved: 'Yes', Posted: 'Yes', Draft: 'Example draft text' });
  });

  it('returns 409 when the draft changed and 422 for bad values', async () => {
    const changed = await plan(body({ expect: { Week: '2026-W46', Topic: 'Example topic', draftHash: hashText('older text') } }));
    expect(changed).toMatchObject({ status: 409, body: { conflict: true } });
    const bad = await plan(body({ data: { Approved: 'yes', Draft: 'x' } }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toHaveLength(2);
  });
});
