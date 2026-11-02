// 保护：一条消息的发送路径。把发送放回全局独占队列、重新多调一次 resume、或把派发失败又统一成
// MODEL_UNAVAILABLE，本人就会看到别的对话被卡住、长对话发送变慢、失败原因写错。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteMutationQueue } from '../src/route-mutation-queue.ts';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';
import { createCommandOperations } from '../src/personal-access/commands.mjs';

test('a stuck send in one chat does not hold another chat, while model changes still wait for every send', async () => {
  const queue = createRouteMutationQueue(), events: string[] = [];
  let releaseA!: () => void;
  const a = queue.runSession('A', () => new Promise<void>(resolve => { releaseA = () => { events.push('A:end'); resolve(); }; }));
  const a2 = queue.runSession('A', () => { events.push('A2'); });
  await queue.runSession('B', () => { events.push('B'); });
  assert.deepEqual(events, ['B'], 'chat B is sent while chat A is still stuck; A keeps its own order');
  const model = queue.run(() => { events.push('model'); });
  const b2 = queue.runSession('B', () => { events.push('B2'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['B'], 'a model change waits for the stuck send, and later sends wait for the model change');
  releaseA();
  await Promise.all([a, a2, model, b2]);
  assert.deepEqual(events, ['B', 'A:end', 'A2', 'model', 'B2']);
  let releaseC!: () => void;
  const c = queue.runSession('C', () => new Promise<void>(resolve => { releaseC = resolve; }));
  const shutdown = queue.stopAcceptingAndDrain(() => { events.push('closed'); });
  await assert.rejects(queue.runSession('D', () => {}), /正在退出/);
  releaseC(); await c; await shutdown;
  assert.equal(events.at(-1), 'closed');
});

function sendBackend({ allowed = () => true, messages = async () => ({ accepted: true, rpcId: 'r' }) as any } = {}) {
  const calls: string[] = [];
  const profile = { id: 'model', model: 'synthetic' };
  const gateway = async (path: string, options?: any) => {
    calls.push(`${options?.method ?? 'GET'} ${path}`);
    if (path === '/models') return { groups: [{ id: 'fixture', models: [{ id: 'synthetic' }] }] };
    if (path === '/sessions/one') return { sessionId: 'one', agentPreset: 'personal-remote' };
    if (path === '/sessions/one/messages') return messages();
    return {};
  };
  const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://fixture', hostOwnerId: () => 'owner',
    profiles: () => [profile], hasCredential: () => true, routeForProfile: () => ({ provider: 'fixture' }),
    modelAllowed: () => allowed(), queue: (work: any) => work(), gateway,
    resolveSession: async () => ({ chosen: { profile, source: 'durable-binding' }, profile, route: { provider: 'fixture' } }),
    ensureKnownSession: async (sessionId: string, resolved: any) => {
      assert.equal(resolved?.profile?.id, 'model', 'the session resolved for the send is reused');
      await gateway(`/sessions/${sessionId}/resume`, { method: 'POST', body: '{}' });
    } } as any);
  return { backend, calls };
}

test('sending resumes the native session once and marks failures before the prompt as not sent', async () => {
  const sent = sendBackend();
  await sent.backend.sendMessage({ sessionId: 'one', ownerId: 'owner', text: 'hello' });
  assert.equal(sent.calls.filter(call => call === 'POST /sessions/one/resume').length, 1);
  assert.equal(sent.calls.filter(call => call === 'GET /sessions/one').length, 1);
  assert.equal(sent.calls.at(-1), 'POST /sessions/one/messages');

  const blocked = sendBackend({ allowed: () => false });
  await assert.rejects(blocked.backend.sendMessage({ sessionId: 'one', ownerId: 'owner', text: 'hello' }),
    (error: any) => error.code === 'MODEL_UNAVAILABLE' && error.beforeSend === true);
  assert.ok(!blocked.calls.includes('POST /sessions/one/messages'));

  const lost = sendBackend({ messages: async () => { throw Object.assign(new Error('socket'), { code: 'BACKEND_UNAVAILABLE' }); } });
  await assert.rejects(lost.backend.sendMessage({ sessionId: 'one', ownerId: 'owner', text: 'hello' }),
    (error: any) => error.code === 'BACKEND_UNAVAILABLE' && error.beforeSend !== true, 'a failed prompt may have reached the model');
});

function dispatchFixture(session: any, send: () => Promise<any> = async () => ({ accepted: true, receiptId: 'receipt-1' })) {
  const account: any = { ownerId: 'owner', hostId: 'host', sessions: { s: { ownerId: 'owner', origin: 'personal-remote', modelProfileId: 'model', ...session } },
    devices: { device: { authKind: 'desktop', authEpoch: 1, expiresAt: '2999-01-01T00:00:00.000Z' } },
    commands: { c: { commandId: 'c', ownerId: 'owner', requestId: 'req', kind: 'session.message', sessionId: 's', state: 'pending',
      sourceDeviceId: 'device', sourceAuthEpoch: 1, createdAt: '2026-11-01T00:00:00.000Z', payload: { sessionId: 's', text: 'hello', mode: 'queue' } } } };
  const context: any = { closing: false, storageFault: false, timestamp: () => Date.parse('2026-11-01T00:00:00.000Z'),
    accountState: () => account, serial: (work: any) => work(), mutate: async (_owner: string, change: any) => change(account),
    callBackend: (work: any) => work(), requireOpen: () => {}, messageModelUsable: (_owner: string, row: any) => row?.modelProfileId === 'model',
    scheduled: new Set(), active: new Set(), activeByCommand: new Map(),
    backend: { preflight: async () => ({ ok: true }), sendMessage: send } };
  return { account, context, operations: createCommandOperations(context) };
}

test('a queued message that can no longer be sent records the real reason', async () => {
  for (const [session, code] of [[{ archived: true }, 'SESSION_ARCHIVED'], [{ deleting: true }, 'SESSION_UNAVAILABLE'],
    [{ expiresAt: '2026-10-31T00:00:00.000Z' }, 'SESSION_UNAVAILABLE'], [{ modelProfileId: 'gone' }, 'MODEL_UNAVAILABLE']] as const) {
    const f = dispatchFixture(session);
    await f.operations.dispatch('owner', 'c');
    assert.deepEqual([f.account.commands.c.state, f.account.commands.c.errorCode], ['rejected', code], JSON.stringify(session));
  }
  const changed = dispatchFixture({});
  changed.context.serial = (work: any) => {
    changed.account.sessions.s = { ...changed.account.sessions.s, modelProfileId: 'model-next' };
    changed.context.messageModelUsable = () => true; return work();
  };
  await changed.operations.dispatch('owner', 'c');
  assert.equal(changed.account.commands.c.errorCode, 'SESSION_MODEL_CHANGED');

  const notSent = dispatchFixture({}, async () => { throw Object.assign(new Error('gone'), { code: 'SESSION_UNAVAILABLE', beforeSend: true }); });
  await notSent.operations.dispatch('owner', 'c');
  assert.deepEqual([notSent.account.commands.c.state, notSent.account.commands.c.errorCode], ['rejected', 'SESSION_UNAVAILABLE']);
  const unknown = dispatchFixture({}, async () => { throw Object.assign(new Error('socket'), { code: 'BACKEND_UNAVAILABLE' }); });
  await unknown.operations.dispatch('owner', 'c');
  assert.equal(unknown.account.commands.c.state, 'uncertain');
  const accepted = dispatchFixture({});
  await accepted.operations.dispatch('owner', 'c');
  assert.deepEqual([accepted.account.commands.c.state, accepted.account.commands.c.receiptId], ['accepted_by_dsh', 'receipt-1']);
});
