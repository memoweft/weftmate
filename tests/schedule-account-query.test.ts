import assert from 'node:assert/strict';
import test from 'node:test';
import { createScheduleOperations } from '../src/personal-access/schedules.mjs';

test('model reminder query matches the goals list across conversations and isolates accounts', async () => {
  const device = { scopes: ['sessions:read'], authEpoch: 1 };
  const accounts: any = {
    a: { sessions: { fresh: { origin: 'personal-remote' }, old: { origin: 'personal-remote' }, temporary: { origin: 'personal-remote', temporary: true }, deleting: { origin: 'personal-remote', deleting: true } },
      commands: { ask: { sessionId: 'fresh', receiptId: 'receipt-a', state: 'accepted_by_dsh', sourceDeviceId: 'device', sourceAuthEpoch: 1 } }, devices: { device } },
    b: { sessions: { foreign: { origin: 'personal-remote' } }, commands: { ask: { sessionId: 'foreign', receiptId: 'receipt-b', state: 'accepted_by_dsh', sourceDeviceId: 'device', sourceAuthEpoch: 1 } }, devices: { device: structuredClone(device) } },
  };
  const calls: any[] = [];
  const context: any = {
    sessionOperations: { ownerForSession: (id: string) => Object.entries(accounts).map(([ownerId, a]: any) => a.sessions[id] && { ownerId }).find(Boolean) },
    hostOwner: () => true, accountState: (owner: string) => accounts[owner], timestamp: Date.now,
    authenticate: () => ({ deviceId: 'device' }), json: (_res: any, status: number, body: any) => { response = { status, body }; },
    backend: { schedules: async (input: any) => { calls.push(input); return { items: input.sessionId === 'fresh' ? [] : [{ id: 'schedule-1', text: input.sessionId + ' reminder', state: 'scheduled' }] }; } },
  };
  let response: any;
  const ops = createScheduleOperations(context);
  const queried = await ops.handleRuntime({ action: 'schedule_list', sessionId: 'fresh', sourceReceiptId: 'receipt-a' });
  await ops.handleHttp({ method: 'GET' }, {}, new URL('http://test/personal/v1/schedules'), 'a');
  assert.equal(queried.scope, 'account');
  assert.deepEqual(queried.items, response.body.items);
  assert.deepEqual(queried.items.map((row: any) => row.sessionId).sort(), ['old', 'temporary']);
  assert.ok(!JSON.stringify(queried).includes('temporary reminder'));
  assert.ok(calls.every(call => call.ownerId === 'a'));
  const foreign = await ops.handleRuntime({ action: 'schedule_list', sessionId: 'foreign', sourceReceiptId: 'receipt-b' });
  assert.deepEqual(foreign.items.map((row: any) => row.sessionId), ['foreign']);
  await assert.rejects(ops.handleRuntime({ action: 'schedule_list', sessionId: 'fresh', sourceReceiptId: 'receipt-b' }), { code: 'FORBIDDEN' });
  accounts.a.devices.device.revoked = true;
  await assert.rejects(ops.handleRuntime({ action: 'schedule_list', sessionId: 'fresh', sourceReceiptId: 'receipt-a' }), { code: 'FORBIDDEN' });
});
