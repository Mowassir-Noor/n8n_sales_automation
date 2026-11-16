import { describe, it, expect } from 'vitest';
import { runNode, fakeNow } from './harness.js';

const WF3 = 'SeSyIb5vHQxG1F59';
const WF0 = '4sjSYRcQvBBXEe6a';

describe('DB - Status', () => {
  it('lists the seven watched workflows', async () => {
    const out = await runNode('status/workflow-list');
    expect(out).toHaveLength(7);
    expect(out[3]).toEqual({ workflowId: WF3, workflowName: 'WF3 - Send approved emails' });
  });

  it('merges executions, attaches error messages and reports running flags', async () => {
    const [out] = await runNode('status/shape-status', {
      nodes: {
        'Get Executions': [
          { id: '10', workflowId: WF0, status: 'success', startedAt: '2026-11-16T06:00:00.000Z', stoppedAt: '2026-11-16T06:05:00.000Z' },
          { id: '11', workflowId: WF3, status: 'error', startedAt: '2026-11-16T07:00:00.000Z', stoppedAt: '2026-11-16T07:00:05.000Z' },
          { id: '12', workflowId: 'someOtherWorkflow', status: 'success', startedAt: '2026-11-16T07:30:00.000Z', stoppedAt: '2026-11-16T07:31:00.000Z' },
        ],
        'Get Recent Errors': [{ id: '11', workflowId: WF3, status: 'error', data: { resultData: { lastNodeExecuted: 'Send Email (SMTP)', error: { message: 'Connection refused' } } } }],
        'Get Running Executions': [{ error: { message: 'status running not supported' } }],
      },
      now: fakeNow('2026-11-16T12:00:00'),
    });
    expect(out.status).toBe(200);
    expect(out.body.executions.map(e => e.workflowId)).toEqual([WF3, WF0]);
    expect(out.body.executions[0].error).toBe('Send Email (SMTP): Connection refused');
    expect(out.body.executions[1].error).toBeNull();
    expect(out.body.running).toEqual({ wf3: false, wf5: false });
  });

  it('returns 500 when the n8n API cannot be read', async () => {
    const [out] = await runNode('status/shape-status', {
      nodes: { 'Get Executions': [{ error: { message: 'Unauthorized' } }], 'Get Recent Errors': [{}], 'Get Running Executions': [{}] },
    });
    expect(out).toMatchObject({ status: 500, body: { error: 'Could not read executions from the n8n API: Unauthorized' } });
  });
});
