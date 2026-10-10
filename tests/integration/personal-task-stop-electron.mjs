// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Opt-in isolated Electron + pinned DSH exact-stop acceptance with a synthetic model. */
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
const earlyStop = process.argv.includes('--early-stop');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-'));
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
  const record = { closed: false, startedAt: Date.now(),
    compaction: raw.includes('compaction engine'),
    originalGoal: raw.includes('synthetic blocking task'), resume: raw.includes('synthetic resume explicit next step'),
    kind: /Generate the session title|compaction engine/.test(raw) ? 'background'
      : raw.includes('synthetic unrelated next task') ? 'unrelated' : 'target' };
  requests.push(record);
  response.on('close', () => { record.closed = true; });
  const write = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id: 'synthetic',
    object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, delta: { role: 'assistant', content: delta }, finish_reason: finish }] })}\n\n`);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  write('working');
  record.complete = () => {
    if (record.closed || !completeFollowingRequests && record.kind === 'target') return;
    write(record.compaction && record.originalGoal ? 'checkpoint: synthetic blocking task; next task completed'
      : 'next task completed'); write('', 'stop'); response.end('data: [DONE]\n\n');
  };
  if (completeFollowingRequests || record.kind === 'background') record.complete();
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
const childEnv = { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
  WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1' };
for (const key of Object.keys(childEnv)) if (key === 'MIMO_API_KEY' || key === 'MODEL_SWITCH_UNIFIED_KEY' ||
    key.startsWith('WEFTMATE_LAN_') || key === 'ELECTRON_RUN_AS_NODE') delete childEnv[key];
const child = spawn(electron, [earlyStop ? join(repository, 'tests/integration/personal-early-stop-bootstrap.mjs') : '.',
  `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
  cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: childEnv,
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
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic blocking task', mode: 'queue' });
  assert.match(target.receiptId, /^[A-Za-z0-9._:-]+$/);
  try { await until(() => earlyStop ? output.includes('[early-stop] claimed before persistence')
    : requests.some((item) => item.kind === 'target'), 15_000); }
  catch (error) {
    const events = await history(origin, account, session.sessionId);
    throw new Error(`synthetic upstream was not reached; paths=${JSON.stringify(paths)}; events=${JSON.stringify(events.map((event) =>
      ({ type: event.type, data: event.type === 'turn.ended' ? event.data : undefined })))}; cause=${error.message}`);
  }
  const later = await postCommand(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId: session.sessionId, text: 'synthetic unrelated next task', mode: 'queue' });
  const stopRequestId = randomUUID();
  if (earlyStop) assert.ok(!(await history(origin, account, session.sessionId)).some(event =>
    event.type === 'user.message' && event.data.receiptId === target.receiptId));
  const stopped = await requestJson(origin, account, 'POST',
    `/personal/v1/tasks/${target.commandId}/stop`, { requestId: stopRequestId });
  assert.equal(stopped.status, 202, JSON.stringify(stopped.body));
  const targetTurn = await until(async () => {
    const events = await history(origin, account, session.sessionId);
    const user = events.find((event) => event.type === 'user.message' && event.data?.receiptId === target.receiptId);
    const start = earlyStop ? events.find(event => event.type === 'turn.started')
      : events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
    const end = events.find((event) => event.type === 'turn.ended' && event.data?.turn === start?.data?.turn);
    return end?.data?.reason === 'aborted' ? end : null;
  }, 30_000);
  if (earlyStop) {
    assert.equal((await history(origin, account, session.sessionId)).filter(event =>
      event.type === 'user.message' && event.data.receiptId === target.receiptId).length, 1,
    'native cancellation preserves the original claimed goal exactly once');
    assert.ok(!requests.some(item => item.kind === 'target'));
  } else await until(() => requests.some((item) => item.kind === 'target' && item.closed === true), 10_000);
  assert.equal(targetTurn.data.reason, 'aborted');
  const task = await until(async () => {
    const read = await requestJson(origin, account, 'GET', `/personal/v1/tasks/${target.commandId}`);
    assert.equal(read.status, 200);
    return read.body.control.stopStatus === 'stopped' ? read.body : null;
  }, 20_000);
  assert.equal(task.control.reasonCode, 'STOP_OBSERVED');
  assert.equal(task.control.canResume, true);
  assert.equal(task.control.pendingReceipts, 0);
  await until(() => requests.some((item) => item.kind === 'unrelated'), 15_000);
  const repeated = await requestJson(origin, account, 'POST',
    `/personal/v1/tasks/${target.commandId}/stop`, { requestId: stopRequestId });
  assert.equal(repeated.status, 202);
  completeFollowingRequests = true;
  for (const item of requests) item.complete?.();
  const laterTurn = await until(async () => {
    const events = await history(origin, account, session.sessionId);
    const user = events.find((event) => event.type === 'user.message' && event.data?.receiptId === later.receiptId);
    const start = events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
    return events.find((event) => event.type === 'turn.ended' && event.data?.turn === start?.data?.turn &&
      event.data?.reason === 'completed') ?? null;
  }, 30_000);
  assert.ok(laterTurn.data.turn > targetTurn.data.turn);
  const resume = await requestJson(origin, account, 'POST',
    `/personal/v1/tasks/${target.commandId}/resume`,
    { requestId: randomUUID(), text: 'synthetic resume explicit next step' });
  assert.equal(resume.status, 202, JSON.stringify(resume.body));
  assert.equal(resume.body.command.rootTaskId, target.commandId);
  assert.equal(resume.body.task.control.state, 'active');
  const resumed = await until(async () => {
    const read = await requestJson(origin, account, 'GET',
      `/personal/v1/commands/${resume.body.command.commandId}`);
    assert.equal(read.status, 200);
    if (['pending', 'dispatching'].includes(read.body.command.state)) return null;
    assert.equal(read.body.command.state, 'accepted_by_dsh');
    return read.body.command;
  }, 30_000);
  assert.equal(resumed.rootTaskId, target.commandId);
  assert.match(resumed.receiptId, /^[A-Za-z0-9._:-]+$/);
  const resumedTurn = await until(async () => {
    const events = await history(origin, account, session.sessionId);
    const user = events.find((event) => event.type === 'user.message' &&
      event.data?.receiptId === resumed.receiptId);
    const start = events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
    return events.find((event) => event.type === 'turn.ended' &&
      event.data?.turn === start?.data?.turn && event.data?.reason === 'completed') ?? null;
  }, 30_000);
  assert.ok(resumedTurn.data.turn > laterTurn.data.turn);
  if (earlyStop) assert.ok(requests.some(item => item.resume && item.originalGoal),
    'the resumed model request includes the original interrupted goal');
  const finalTask = await requestJson(origin, account, 'GET', `/personal/v1/tasks/${target.commandId}`);
  assert.equal(finalTask.status, 200);
  assert.equal(finalTask.body.control.state, 'active');
  assert.equal(finalTask.body.resumes.filter((item) => item.commandId === resumed.commandId).length, 1);
  const commands = await requestJson(origin, account, 'GET', '/personal/v1/commands?limit=100');
  assert.equal(commands.status, 200);
  assert.equal(commands.body.commands.filter((item) => item.commandId === target.commandId).length, 1);
  assert.equal(commands.body.commands.some((item) => item.kind === 'session.cancel'), false);
  const original = commands.body.commands.find((item) => item.commandId === target.commandId);
  assert.equal(original.receiptId, target.receiptId);
  console.log(`[synthetic-stop] ${earlyStop ? 'claimed input stopped before normal persistence; native goal preserved once' : 'target aborted; upstream closed'}; unrelated turn completed; explicit resume completed`);
} finally {
  try { await stopOwned(); }
  finally {
    await new Promise((resolve) => modelServer.close(resolve));
    if (cleanExit && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}
