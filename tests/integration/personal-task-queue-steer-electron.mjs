/** Isolated real host + pinned DSH queue, steer, cancel and stop acceptance. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

if (process.platform !== 'win32' || process.env.WEFTMATE_SYNTHETIC_STOP_E2E !== '1') {
  throw new Error('Set WEFTMATE_SYNTHETIC_STOP_E2E=1 on Windows for this isolated fixture.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const require = createRequire(import.meta.url);
const electron = require('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-queue-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }), { flag: 'wx', mode: 0o600 });
const requests = [];
const paths = [];
let completeFollowingRequests = false;
const modelServer = createServer(async (request, response) => {
  const pathRecord = { path: `${request.method} ${request.url}`, ended: false, closed: false, bytes: 0 };
  paths.push(pathRecord);
  request.on('end', () => { pathRecord.ended = true; });
  request.on('close', () => { pathRecord.closed = true; });
  if (request.method === 'GET' && request.url === '/props') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ n_ctx: 65536, total_slots: 1 }));
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404); response.end(); return;
  }
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    pathRecord.bytes += chunk.length;
    if (raw.length > 256 * 1024) { response.destroy(); return; }
  }
  const body = JSON.parse(raw);
  assert.equal(body.model, 'synthetic-stop-model');
  const record = { closed: false, startedAt: Date.now(), text: JSON.stringify(body.messages), kind: /Generate the session title|compaction engine/.test(raw) ? 'background' : raw.includes('synthetic unrelated next task') ? 'unrelated' : 'target' };
  requests.push(record);
  response.on('close', () => { record.closed = true; });
  const write = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id: 'synthetic',
    object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, delta: { role: 'assistant', content: delta }, finish_reason: finish }] })}\n\n`);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  write('working');
  record.complete = () => {
    if (record.closed) return;
    write('next task completed'); write('', 'stop'); response.end('data: [DONE]\n\n');
  };
  if (completeFollowingRequests || record.kind === 'background') record.complete();
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
  cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
    WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1' },
});
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  output = (output + String(chunk)).slice(-128 * 1024);
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Electron exited: ${output.slice(-1200)}`);
    await pause(100);
  }
  throw new Error(`synthetic stop fixture timed out: ${output.slice(-1200)}`);
}
function manage(action, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { child.off('message', listener); reject(new Error('management timeout')); }, 45_000);
    const listener = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', listener); clearTimeout(timer);
      if (frame.ok === true) resolve(frame.result);
      else reject(new Error(`management ${action} failed: ${frame.code}`));
    };
    child.on('message', listener);
    child.send({ type: 'weftmate:manage', requestId, action, ...fields }, (error) => {
      if (error) { child.off('message', listener); clearTimeout(timer); reject(error); }
    });
  });
}
async function requestJson(origin, account, method, path, body) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function postCommand(origin, account, payload) {
  const submitted = await requestJson(origin, account, 'POST', '/personal/v1/commands', payload);
  assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
  const commandId = submitted.body.command.commandId;
  return until(async () => {
    const read = await requestJson(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(read.status, 200);
    const state = read.body.command.state;
    if (state === 'pending' || state === 'dispatching') return null;
    assert.equal(state, 'accepted_by_dsh', JSON.stringify(read.body));
    return read.body.command;
  }, 45_000);
}
async function history(origin, account, sessionId) {
  const events = [];
  let afterSeq = -1;
  for (let page = 0; page < 12; page++) {
    const read = await requestJson(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    events.push(...read.body.events);
    if (!read.body.hasMore) return events;
    assert.ok(read.body.nextSeq > afterSeq);
    afterSeq = read.body.nextSeq;
  }
  throw new Error('history exceeded bounded fixture scan');
}
let cleanExit = false;
async function stopOwned() {
  if (child.exitCode !== null || child.signalCode !== null) { cleanExit = child.exitCode === 0; return; }
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.send({ type: 'weftmate:quit' });
  const managed = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  cleanExit = child.exitCode === 0;
}
try {
  const origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const configured = await manage('model.configure-synthetic-stop-fixture',
    { baseUrl: `http://127.0.0.1:${modelPort}/v1` });
  assert.equal(configured.id, 'synthetic-stop-fixture');
  const grant = await manage('account.setup');
  const registered = await requestJson(origin, null, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, username: 'SyntheticStopOwner',
      password: 'synthetic stop password 123', deviceName: 'Fixture' });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const account = { cookie: registered.cookie, csrf: registered.body.csrfToken };
  assert.ok(account.cookie && account.csrf);
  const status = await requestJson(origin, account, 'GET', '/personal/v1/status');
  assert.equal(status.status, 200);
  const hostId = status.body.hostId;
  const session = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.create',
    targetDeviceId: hostId, modelProfileId: 'synthetic-stop-fixture' });
  const target = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic blocking task' });
  assert.match(target.receiptId, /^[A-Za-z0-9._:-]+$/);
  try { await until(() => requests.some((item) => item.kind === 'target'), 15_000); }
  catch (error) {
    const events = await history(origin, account, session.sessionId);
    throw new Error(`synthetic upstream was not reached; paths=${JSON.stringify(paths)}; events=${JSON.stringify(events.map((event) =>
      ({ type: event.type, data: event.type === 'turn.ended' ? event.data : undefined })))}; cause=${error.message}`);
  }
  const steer = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic adjust current task' });
  assert.equal(steer.intent, 'steer'); assert.equal(steer.rootTaskId, target.commandId);
  const canceled = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic canceled task', intent: 'queue' });
  const later = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic unrelated next task ONE', intent: 'queue' });
  const last = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic unrelated next task TWO', intent: 'queue' });
  let timeline = await history(origin, account, session.sessionId);
  assert.ok(timeline.some(event => event.type === 'task.queued' && event.data.taskId === later.commandId));
  const cancelId = randomUUID();
  const cancel = await requestJson(origin, account, 'POST', `/personal/v1/tasks/${canceled.commandId}/cancel`, { requestId: cancelId });
  assert.equal(cancel.status, 202, JSON.stringify(cancel.body));
  assert.equal(cancel.body.task.control.stopStatus, 'stopped');
  assert.equal((await requestJson(origin, account, 'POST', `/personal/v1/tasks/${target.commandId}/cancel`, { requestId: randomUUID() })).status, 409);
  // Finish only the first step. Native steer is consumed at the next boundary in this same turn.
  requests.find(record => record.kind === 'target').complete();
  await until(() => requests.some(record => record.kind !== 'background' && record.text.includes('synthetic adjust current task')), 30000);
  const stopRequestId = randomUUID();
  const stopped = await requestJson(origin, account, 'POST', `/personal/v1/tasks/${target.commandId}/stop`, { requestId: stopRequestId });
  assert.equal(stopped.status, 202, JSON.stringify(stopped.body));
  const targetTurn = await until(async () => {
    const events = await history(origin, account, session.sessionId);
    return events.find(event => event.type === 'task.ended' && event.data.taskId === target.commandId && event.data.reason === 'aborted');
  }, 30000);
  assert.equal((await requestJson(origin, account, 'POST', `/personal/v1/tasks/${target.commandId}/stop`, { requestId: stopRequestId })).status, 202);
  completeFollowingRequests = true; for (const record of requests) record.complete?.();
  try {
    await until(async () => {
      timeline = await history(origin, account, session.sessionId);
      return timeline.some(event => event.type === 'task.ended' && event.data.taskId === last.commandId && event.data.reason === 'completed');
    }, 45000);
  } catch (error) { throw new Error(`${error.message}; requests=${JSON.stringify(requests)}; timeline=${JSON.stringify(timeline)}`); }
  assert.equal(timeline.filter(event => event.type === 'task.ended' && event.data.taskId === canceled.commandId)[0].data.reason, 'canceled');
  assert.ok(!timeline.some(event => event.type === 'user.message' && event.data.receiptId === canceled.receiptId));
  const starts = timeline.filter(event => event.type === 'task.started').map(event => event.data.taskId);
  assert.deepEqual(starts, [target.commandId, later.commandId, last.commandId]);
  const users = timeline.filter(event => event.type === 'user.message');
  assert.deepEqual(users.map(event => event.data.receiptId), [target.receiptId, steer.receiptId, later.receiptId, last.receiptId]);
  assert.ok(requests.some(record => record.kind !== 'background' && record.text.includes('synthetic adjust current task')));
  assert.equal((await requestJson(origin, account, 'POST', `/personal/v1/tasks/${canceled.commandId}/cancel`, { requestId: cancelId })).status, 202);
  console.log('[queue-steer] native steer consumed in active turn; queue cancellation; stop then FIFO ONE/TWO completed; timeline bindings verified');
} finally {
  try { await stopOwned(); }
  finally {
    await new Promise((resolve) => modelServer.close(resolve));
    console.log(`Isolated evidence: ${root}`);
    writeFileSync(join(root, 'summary.json'), JSON.stringify({ requests, output }, null, 2));
    if (process.env.WEFTMATE_KEEP_QUEUE_EVIDENCE !== '1' && cleanExit && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

