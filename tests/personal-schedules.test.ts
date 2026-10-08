import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// CI deliberately lacks the external prebuilt vendor. Pure/HTTP tests remain
// mandatory; native fixture tests run when the pinned artifact is installed.
const native = await import(new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-schedule/lib/index.js', import.meta.url).href)
  .catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return null; throw error; });
const createUserMessage = native ? (await import(new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-llm/lib/index.js', import.meta.url).href)).createUserMessage : undefined;
const nativeFixture = { skip: native ? false : 'prebuilt DSH vendor fixture unavailable' };
import { createNativeScheduleManager, scheduleSourceReceipt } from '../src/personal-access/schedules-native.mjs';
import { nextCalendarInput, scheduleContent } from '../src/personal-access/schedules-calendar.mjs';
import { createScheduleOperations } from '../src/personal-access/schedules.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

test('schedule creation binds the latest claimed steer without changing file-tool authorization', () => {
  const exec = { callId: 'schedule-call', agent: { session: { events: [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user', rpcId: 'original-task' } } },
    { type: 'user/message', data: { source: { kind: 'user', rpcId: 'reminder-steer' } } },
    { type: 'tool/call', data: { turn: 1, callId: 'schedule-call', name: 'schedule_create' } },
  ] } } };
  assert.equal(scheduleSourceReceipt(exec), 'reminder-steer');
  assert.throws(() => scheduleSourceReceipt({ ...exec, callId: 'missing' }), /TOOL_SOURCE_UNAVAILABLE/);
});

test('native local at handles zones, DST overlap/gap and weekly calendar keeps local hour', nativeFixture, () => {
  const at = native.createAtScheduleRecord('schedule-1', 'report', { date: '2026-10-09', time: '09:00:00', time_zone: 'Asia/Shanghai' }, Date.parse('2026-10-08T00:00:00Z'));
  assert.equal(at.scheduledAt, '2026-10-09T01:00:00.000Z');
  assert.throws(() => native.createAtScheduleRecord('gap', 'x', { date: '2027-03-14', time: '02:30:00', time_zone: 'America/New_York' }, Date.parse('2027-03-01')), { code: 'invalid_rule' });
  const overlap = native.createAtScheduleRecord('overlap', 'x', { date: '2026-11-01', time: '01:30:00', time_zone: 'America/New_York' }, Date.parse('2026-10-01'));
  assert.equal(overlap.scheduledAt, '2026-11-01T05:30:00.000Z');
  const repeat = { kind: 'weekly', weekday: 1, time: '08:00:00' };
  assert.deepEqual(nextCalendarInput(repeat, 'Asia/Shanghai', Date.parse('2026-10-12T00:00:01Z')), { date: '2026-10-19', time: '08:00:00', time_zone: 'Asia/Shanghai' });
  const next = nextCalendarInput(repeat, 'America/New_York', Date.parse('2026-10-26T12:00:01Z'));
  assert.equal(native.createAtScheduleRecord('next', 'x', next, Date.parse('2026-10-26T12:00:01Z')).scheduledAt, '2026-11-02T13:00:00.000Z');
  assert.throws(() => scheduleContent(JSON.stringify({ weftmate: 1, kind: 'task', text: 'x', repeat: { kind: 'weekly', weekday: 9, time: '08:00:00' } })), { code: 'INVALID_REQUEST' });
});

async function fixture(t: any, timeZone = 'Asia/Shanghai') {
  const root = await mkdtemp(join(tmpdir(), 'weft-schedule-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = Date.now();
  const events: any[] = [], definitions = new Map(), calls: any[] = [];
  const agent: any = { id: 'session-a', session: { header: { seedLength: 0 }, events,
    append(type: string, data: unknown) { const event = { type, data, seq: events.length, timestamp: new Date(now).toISOString() }; events.push(event); return event; } } };
  const ctx: any = { sessions: { flush: async () => true }, tools: { get: (name: string) => definitions.get(name),
    register: (definition: any) => { definitions.set(definition.name, definition); return () => {}; } }, logger: { warn() {} } };
  native.registerScheduleTools(ctx, ctx, agent, () => {});
  const file = join(root, 'schedules.json');
  const request = async (input: any) => { calls.push(input); return input.action === 'context' ? { timeZone, approvalMode: 'ask' } : { accepted: true }; };
  const make = () => createNativeScheduleManager({ ctx, native: { ...native, createUserMessage }, file, request, clock: () => now });
  let manager = await make();
  const create = async (input: any) => {
    const record = await definitions.get('schedule_create').execute(input, { agent, signal: new AbortController().signal });
    assert.ok(record.id, JSON.stringify(record)); await manager.register(agent, record); return record;
  };
  return { agent, events, calls, create, get manager() { return manager; },
    advance(ms: number) { now += ms; }, async restart() { await manager.close(); manager = await make(); }, now: () => now };
}

test('one-shot dispatch survives restart and only delivers once with missed time', nativeFixture, async t => {
  const f = await fixture(t);
  const row = await f.create({ prompt: '交报告', after_seconds: 1 });
  f.advance(120000);
  f.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: row.id });
  await f.restart(); await f.manager.due(f.agent); await f.manager.due(f.agent); await f.restart(); await f.manager.due(f.agent);
  const notices = await f.manager.manage(f.agent, 'notifications');
  assert.equal(notices.items.length, 1); assert.equal(notices.items[0].missed, true);
  assert.match(notices.items[0].text, /错过了.*交报告/);
  assert.equal(f.events.filter(e => e.type === 'user/message').length, 1);
  assert.equal((await f.manager.manage(f.agent, 'list')).items[0].state, 'completed');
});

test('native periodic dispatch skips missed backlog; pause/resume/delete and run now', nativeFixture, async t => {
  const f = await fixture(t);
  const row = await f.create({ prompt: '喝水', every_seconds: 300 });
  f.advance(20 * 60000);
  const decision = native.resolveEveryOccurrence(row, f.now());
  f.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: row.id, acceptedAt: new Date(f.now()).toISOString() });
  await f.manager.due(f.agent); await f.manager.due(f.agent);
  assert.equal((await f.manager.manage(f.agent, 'notifications')).items.length, 1);
  assert.equal((await f.manager.manage(f.agent, 'list')).items[0].nextRunAt, decision.nextScheduledAt);
  await f.manager.manage(f.agent, 'pause', row.id); await f.restart();
  assert.equal(native.foldScheduleEvents(f.events).active.length, 0);
  assert.equal((await f.manager.manage(f.agent, 'list')).items[0].state, 'paused');
  await f.manager.manage(f.agent, 'resume', row.id);
  assert.equal(native.foldScheduleEvents(f.events).active.length, 1);
  await f.manager.manage(f.agent, 'run', row.id);
  assert.equal((await f.manager.manage(f.agent, 'notifications')).items.length, 2);
  await f.manager.manage(f.agent, 'delete', row.id);
  assert.equal((await f.manager.manage(f.agent, 'list')).items.length, 0);
  assert.equal(native.foldScheduleEvents(f.events).active.length, 0);
});

test('calendar task renews via native at and dispatches owner command once', nativeFixture, async t => {
  const f = await fixture(t);
  const row = await f.create({ prompt: JSON.stringify({ weftmate: 1, kind: 'task', text: '生成周报', repeat: { kind: 'weekly', weekday: 1, time: '08:00:00' } }), after_seconds: 1 });
  f.advance(60000); f.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: row.id });
  await f.manager.due(f.agent); await f.manager.due(f.agent);
  assert.equal(f.calls.filter(c => c.action === 'execute').length, 1);
  assert.equal(native.foldScheduleEvents(f.events).active.length, 1);
  const item = (await f.manager.manage(f.agent, 'list')).items[0];
  assert.equal(item.id, row.id); assert.notEqual(item.nativeId, row.id); assert.equal(item.approvalMode, 'ask');
});

test('daily calendar continuation skips the nonexistent spring DST occurrence', nativeFixture, async t => {
  const f = await fixture(t, 'America/New_York');
  const row = await f.create({ prompt: JSON.stringify({ weftmate: 1, kind: 'reminder', text: '起床', repeat: { kind: 'daily', time: '02:30:00' } }), after_seconds: 1 });
  f.advance(Date.parse('2027-03-14T05:00:00Z') - f.now());
  f.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: row.id });
  await f.manager.due(f.agent);
  assert.equal((await f.manager.manage(f.agent, 'list')).items[0].nextRunAt, '2027-03-15T06:30:00.000Z');
});

test('calendar catch-up during a DST overlap skips the already-past earlier instant', nativeFixture, async t => {
  const f = await fixture(t, 'America/New_York');
  const row = await f.create({ prompt: JSON.stringify({ weftmate: 1, kind: 'reminder', text: '起床', repeat: { kind: 'weekly', weekday: 0, time: '01:30:00' } }), after_seconds: 1 });
  f.advance(Date.parse('2026-11-01T06:20:00Z') - f.now());
  f.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: row.id });
  await f.manager.due(f.agent);
  assert.equal((await f.manager.manage(f.agent, 'list')).items[0].nextRunAt, '2026-11-08T06:30:00.000Z');
});

test('scheduled command inherits conversation owner, source authorization and current approval mode', async () => {
  const account: any = { ownerId: 'owner', hostId: 'host-a', sessions: { 'session-a': { origin: 'personal-remote', approvalMode: 'ask' } },
    commands: { original: { commandId: 'original', requestId: 'user-a', receiptId: 'receipt-a', kind: 'session.message', sessionId: 'session-a', state: 'accepted_by_dsh',
      createdAt: '2026-10-08T00:00:00Z', sourceDeviceId: 'device-a', sourceAuthEpoch: 7 } } };
  const scheduled: any[] = [];
  const ctx: any = { sessionOperations: { ownerForSession: () => ({ ownerId: 'owner' }) }, hostOwner: () => true, accountState: () => account,
    usage: { settings: () => ({ timeZone: 'Asia/Shanghai' }) }, serial: (fn: any) => fn(), mutate: (_owner: any, fn: any) => fn(account),
    schedule: (...args: any[]) => scheduled.push(args), timestamp: Date.now };
  const ops = createScheduleOperations(ctx);
  assert.deepEqual(await ops.handleRuntime({ sessionId: 'session-a', action: 'context' }), { timeZone: 'Asia/Shanghai', approvalMode: 'ask' });
  const input = { action: 'execute', sessionId: 'session-a', text: '生成周报', deliveryId: 'schedule-1-7', sourceReceiptId: 'receipt-a' };
  const one = await ops.handleRuntime(input), two = await ops.handleRuntime(input);
  assert.equal(one.commandId, two.commandId);
  assert.equal(account.commands[one.commandId].sourceDeviceId, 'device-a');
  assert.equal(account.commands[one.commandId].sourceAuthEpoch, 7);
  assert.equal(account.commands[one.commandId].payload.mode, 'queue');
  await assert.rejects(ops.handleRuntime({ ...input, sessionId: 'other' }), { code: 'SESSION_UNAVAILABLE' });
});

test('authenticated schedule/notification contract enforces ownership, CSRF and exact actions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'weft-schedule-http-'));
  const calls: any[] = [], known = new Set();
  let now = Date.now(), sends = 0;
  const backend: any = {
    getStatus: async () => ({ runtime: 'ready', capabilities: { chat: { available: true } } }),
    listModels: async () => [{ id: 'local', name: 'Fixture', model: 'fixture', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: any) => { known.add(sessionId); return { sessionId }; },
    sendMessage: async () => ({ accepted: true, receiptId: `receipt-fixture-${++sends}` }), cancelSession: async () => ({ accepted: true }),
    readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }),
    describeSession: async (sessionId: string) => known.has(sessionId) ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'local' } : null,
    schedules: async (input: any) => { calls.push(input); return ['list', 'notifications'].includes(input.action) ? { items: [{ id: 'schedule-1', text: 'fixture' }] } : { ok: true }; },
  };
  const service = await createPersonalAccessService({ root, port: 0, backend, clock: () => now });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const { origin, hostId } = await service.start(), grant = await service.issueSetupGrant();
  const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'ScheduleOwner', password: 'synthetic schedule owner password', deviceName: 'Fixture' }) });
  assert.equal(setup.status, 201);
  const auth = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0];
  const request = async (pathname: string, method = 'GET', body?: any, csrf = true) => {
    const response = await fetch(`${origin}/personal/v1${pathname}`, { method, headers: { origin, cookie, 'content-type': 'application/json',
      ...(csrf ? { 'x-weftmate-csrf': auth.csrfToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await fetch(`${origin}/personal/v1/schedules`)).status, 401);
  const creation = await request('/commands', 'POST', { requestId: 'schedule-create-session', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' });
  assert.equal(creation.status, 202);
  let command: any;
  for (let n = 0; n < 100; n++) {
    command = (await request(`/commands/${creation.body.command.commandId}`)).body.command;
    if (command.state === 'accepted_by_dsh') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(command.state, 'accepted_by_dsh');
  assert.equal((await request('/schedules')).body.items[0].sessionId, command.sessionId);
  assert.equal((await request('/notifications')).body.items[0].sessionId, command.sessionId);
  assert.ok(calls.every(call => call.ownerId === auth.account.ownerId));
  const base = `/schedules/${command.sessionId}/schedule-1`;
  assert.equal((await request(`${base}/pause`, 'POST', {}, false)).status, 403);
  for (const action of ['pause', 'resume', 'run']) assert.equal((await request(`${base}/${action}`, 'POST', {})).status, 200);
  assert.equal((await request(base, 'DELETE')).status, 200);
  assert.equal((await request('/schedules/other/schedule-1/run', 'POST', {})).status, 404);
  assert.equal((await request(`${base}/run`, 'POST', { unknown: true })).status, 400);
  assert.equal((await request('/schedules?ownerId=other')).status, 400);
  await request(`/sessions/${command.sessionId}/approval-mode`, 'PATCH', { mode: 'ask' });
  const source = await request('/commands', 'POST', { requestId: 'schedule-source', kind: 'session.message', targetDeviceId: hostId,
    sessionId: command.sessionId, text: '明天生成周报' });
  let original;
  for (let n = 0; n < 100; n++) {
    original = (await request(`/commands/${source.body.command.commandId}`)).body.command;
    if (original.state === 'accepted_by_dsh') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(original.state, 'accepted_by_dsh');
  now += 40 * 86400000;
  await service.handleScheduleRuntime({ action: 'execute', sessionId: command.sessionId, text: '生成周报', deliveryId: 'after-login-expiry', sourceReceiptId: original.receiptId });
  for (let n = 0; n < 100 && sends < 2; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sends, 2, 'saved account intent survives creating login expiry');
  assert.equal(service.getApprovalPolicy({ sessionId: command.sessionId }).mode, 'ask');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const execution = await service.trackToolExecution({ action: 'authorize_execution', sessionId: command.sessionId, turn: 1,
    callId: 'expired-login-write', rootCallId: 'expired-login-write', receiptId: 'receipt-fixture-2',
    messageHash: hash('生成周报'), toolName: 'write', argumentsHash: hash('{}') });
  assert.equal(execution.state, 'running', 'native tools can still bind the exact scheduled command after login expiry');

  await service.revokeDevice(auth.device.id);
  await service.handleScheduleRuntime({ action: 'execute', sessionId: command.sessionId, text: '生成周报', deliveryId: 'after-device-revoked', sourceReceiptId: original.receiptId });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(sends, 2, 'device revocation still rejects scheduled work');

});
