import { describe, it, expect } from 'vitest';
import { runNode } from './harness.js';
import { settingsRow, lead } from './fixtures.js';

const admin = { actor: 'admin@example.com', actorRole: 'admin' };
const approver = { actor: 'approver@example.com', actorRole: 'approver' };

async function validate(body, goLiveHeader = '') {
  const [out] = await runNode('settings/validate', { nodes: { Config: [{ body, goLiveHeader }] } });
  return out;
}

async function plan(body, { goLiveHeader = '', settings = settingsRow(), leads = [{}] } = {}) {
  const v = await validate(body, goLiveHeader);
  if (v.respond) return v;
  const [out] = await runNode('settings/plan', { nodes: { 'Validate Request': [v], 'Read Settings': [settings], 'Read Leads': leads } });
  return out;
}

const req = (data, expect, who = admin) => Object.assign({ data, expect, requestId: 'req-settings-1' }, who);

describe('DB - Settings', () => {
  it('lets an approver change the signature and plans an update of row 2', async () => {
    const out = await plan(req({ 'Sender Title': 'CEO' }, { 'Sender Title': 'Founder' }, approver));
    expect(out.update).toEqual({ row_number: 2, 'Sender Title': 'CEO' });
    expect(out.settings['Sender Title']).toBe('CEO');
    expect(out.log).toMatchObject({ Step: 'settings_update', Input: '{"Sender Title":"Founder"}', Output: '{"Sender Title":"CEO"}', Reason: 'by approver@example.com' });
  });

  it('keeps admin fields for admins (403) and never-writable fields closed (422)', async () => {
    const forbidden = await validate(req({ 'Seed Every': '10' }, { 'Seed Every': '12' }, approver));
    expect(forbidden).toMatchObject({ status: 403 });
    const never = await validate(req({ 'Mail Provider': 'Gmail' }, { 'Mail Provider': 'SMTP' }));
    expect(never.status).toBe(422);
    expect(never.body.errors[0]).toMatch(/cannot be changed/);
  });

  it('validates values', async () => {
    const out = await validate(req(
      { 'Nil Email': 'not-an-email', 'Nil Telegram Chat ID': '12ab', 'HubSpot Pause Percent': '150', 'Seed Email': '' },
      { 'Nil Email': 'manager@example.com', 'Nil Telegram Chat ID': '123456789', 'HubSpot Pause Percent': '80', 'Seed Email': '' },
    ));
    expect(out.status).toBe(422);
    expect(out.body.errors).toEqual([
      'Nil Email must be an email address',
      'Nil Telegram Chat ID must be a number (group chats start with -)',
      'HubSpot Pause Percent must be a whole number from 1 to 100, or empty',
    ]);
    const group = await validate(req({ 'Nil Telegram Chat ID': '-1001234567890' }, { 'Nil Telegram Chat ID': '123456789' }, approver));
    expect(group.respond).toBe(false);
  });

  it('needs the before value of every changed field', async () => {
    const out = await validate(req({ 'Sender Title': 'CEO' }, {}));
    expect(out.body.errors[0]).toMatch(/expect\["Sender Title"\]/);
  });

  it('returns 409 when a field changed in the sheet', async () => {
    const out = await plan(req({ 'Sender Title': 'CEO' }, { 'Sender Title': 'Owner' }));
    expect(out).toMatchObject({ status: 409, body: { conflict: true } });
    expect(out.body.row['Sender Title']).toBe('Founder');
    expect(out.body.row.row_number).toBeUndefined();
  });

  it('clears Test Email only through go-live, and only when no test-sent leads are left', async () => {
    const body = req({ 'Test Email': '' }, { 'Test Email': 'test-inbox@example.com' });
    expect((await validate(body)).status).toBe(422);
    expect((await validate(Object.assign({}, body, approver), 'confirm')).status).toBe(403);
    const blocked = await plan(body, { goLiveHeader: 'confirm', leads: [lead({ Stage: 'Sent', 'Sent At': '2026-11-10T10:00:00.000+03:00' })] });
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors[0]).toMatch(/L901/);
    const ok = await plan(Object.assign({ goLive: true }, body), { leads: [lead({ Stage: 'Closed - No reply', 'Sent At': 'x' })] });
    expect(ok.update).toEqual({ row_number: 2, 'Test Email': '' });
    expect(ok.log.Step).toBe('settings_go_live');
  });
});
