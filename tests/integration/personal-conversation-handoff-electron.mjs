/** Explicit opt-in, owned Electron/DSH conversation handoff fixture. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptStage12Dpapi } from './stage12-dpapi-loader.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE12_HANDOFF_E2E !== '1')
  throw new Error('Stage12 handoff fixture requires explicit Windows opt-in.');
const realRelay = process.env.WEFTMATE_STAGE12_MIMO_RELAY === '1';
if (realRelay && process.env.WEFTMATE_STAGE12_MIMO_ACCEPT !== '1')
  throw new Error('Real MiMo relay requires its separate opt-in.');
const phoneServe = process.env.WEFTMATE_STAGE12_PHONE_SERVE === '1';
const mobileUiDir = process.env.WEFTMATE_STAGE12_MOBILE_UI_DIR;
const androidApk = process.env.WEFTMATE_STAGE12_ANDROID_APK;
if (phoneServe && (!mobileUiDir || !androidApk || !isAbsolute(mobileUiDir) ||
    !isAbsolute(androidApk) || basename(androidApk).toLowerCase() !== 'android-candidate.apk'))
  throw new Error('Phone serve needs absolute versioned UI and candidate APK paths.');
if (phoneServe) { realpathSync(mobileUiDir); realpathSync(androidApk); }
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const electron = createRequire(import.meta.url)('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage12-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }), { flag: 'wx', mode: 0o600 });
const login = { username: 'Stage12SyntheticOwner', password: `synthetic-${randomUUID()}-password` };
const loginFile = join(profile, 'stage12-login.json');
writeFileSync(loginFile, `${JSON.stringify(login)}\n`, { flag: 'wx', mode: 0o600 });
const uniqueFact = `the violet lantern is numbered ${randomUUID().slice(0, 8)}`;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + 360_000;
let relayKey = null;

async function privateMiMoKey() {
  const path = process.env.WEFTMATE_STAGE12_MIMO_DPAPI_PATH;
  const expectedRoot = realpathSync(join(repository, '..', 'Runtime', 'UnifiedAssistant', 'private-model-tests'));
  if (!path || !isAbsolute(path) || !realpathSync(path).startsWith(expectedRoot + sep) ||
      basename(path) !== 'mimo-v2.6-flash.dpapi') throw new Error('Missing private MiMo fixture key path.');
  return decryptStage12Dpapi(path);
}

function sse(response, model, tool = null) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const frame = (choice) => response.write(`data: ${JSON.stringify({ id: 'stage12-synthetic',
    object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [choice] })}\n\n`);
  frame(tool ? { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0,
    id: `call-${randomUUID()}`, type: 'function', function: { name: 'personal_save_document',
      arguments: JSON.stringify({ fileName: '接续摘要.md', content: `# 接续摘要\n${uniqueFact}\n` }) } }] },
    finish_reason: null } : { index: 0, delta: { role: 'assistant', content:
      `电脑已接上手机记录：${uniqueFact}` }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' });
  response.end('data: [DONE]\n\n');
}
let modelCalls = 0, contextSeen = false, upstreamAborts = 0, fatalRelayError = null;
if (realRelay) try { relayKey = await privateMiMoKey(); }
catch (error) {
  if (realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true });
  throw error;
}
const modelServer = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404); response.end(); return;
  }
  let raw = '';
  for await (const part of request) {
    raw += part;
    if (raw.length > 256 * 1024) { response.destroy(); return; }
  }
  let body;
  try { body = JSON.parse(raw); } catch { response.writeHead(400); response.end(); return; }
  if (body.model !== 'synthetic-stop-model') { response.writeHead(400); response.end(); return; }
  const hasDocumentTool = JSON.stringify(body.tools ?? []).includes('personal_save_document');
  if (hasDocumentTool) {
    modelCalls++;
    contextSeen ||= JSON.stringify(body.messages).includes(uniqueFact);
    if (!contextSeen) { response.writeHead(409); response.end(); return; }
    if (raw.includes('请用先前手机对话中的特别事实') && raw.includes(uniqueFact)) {
      // The only occurrence of the fact must be the injected context, not the new goal.
      const userGoal = body.messages?.findLast?.((message) => message.role === 'user' &&
        JSON.stringify(message.content).includes('请用先前手机对话中的特别事实'));
      if (JSON.stringify(userGoal?.content).includes(uniqueFact)) { response.writeHead(409); response.end(); return; }
    }
  }
  if (!realRelay) { sse(response, body.model, hasDocumentTool && modelCalls === 1); return; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  response.once('close', () => { if (!response.writableEnded) { upstreamAborts++; controller.abort(); } });
  try {
    const upstream = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${relayKey}`, 'content-type': 'application/json',
        accept: 'text/event-stream' },
      body: JSON.stringify({ ...body, model: 'mimo-v2.6-flash' }),
    });
    if (!upstream.ok || !upstream.body || !/^text\/event-stream/i.test(upstream.headers.get('content-type') ?? '')) {
      let providerCode = 'UNKNOWN';
      if (!upstream.ok && upstream.body) {
        let rawError = '', bytes = 0;
        for await (const part of upstream.body) {
          bytes += part.byteLength;
          if (bytes > 4096) break;
          rawError += Buffer.from(part).toString('utf8');
        }
        try {
          const candidate = JSON.parse(rawError)?.error?.code;
          if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(candidate))
            providerCode = candidate.toUpperCase();
        } catch { /* Only bounded, safe metadata is reported. */ }
      }
      const status = upstream.ok ? 502 : upstream.status;
      fatalRelayError = `upstreamStatus=${status} providerCode=${providerCode}`;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'REAL_PROVIDER_UNAVAILABLE',
        message: 'The real provider rejected the bounded request.', status, providerCode } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    let bytes = 0;
    for await (const part of upstream.body) {
      bytes += part.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('relay response too large');
      response.write(part);
    }
    response.end();
  } catch {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  } finally { clearTimeout(timer); controller.abort(); }
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;

const children = [];
function startHost() {
  const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host',
    `--access-port=${phoneServe ? '18188' : '0'}`,
    ...(phoneServe ? [`--mobile-ui-dir=${mobileUiDir}`, `--android-package-path=${androidApk}`] : [])], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
      WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1' },
  });
  children.push(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-64 * 1024);
  });
  return { child, output: () => output };
}
async function until(host, check, timeout = realRelay ? 240_000 : 90_000) {
  const phaseDeadline = Math.min(deadline, Date.now() + timeout);
  while (Date.now() < phaseDeadline) {
    if (fatalRelayError) throw new Error(`Stage12 real relay failed: ${fatalRelayError}`);
    const result = await check();
    if (result) return result;
    if (host.child.exitCode !== null || host.child.signalCode !== null) throw new Error('isolated host exited');
    await pause(100);
  }
  throw new Error('Stage12 fixture timed out');
}
function manage(host, action, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { host.child.off('message', listener); reject(new Error('management timeout')); },
      Math.min(45_000, Math.max(1, deadline - Date.now())));
    const listener = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      host.child.off('message', listener); clearTimeout(timer);
      frame.ok === true ? resolve(frame.result) : reject(new Error(`management failed: ${frame.code}`));
    };
    host.child.on('message', listener);
    host.child.send({ type: 'weftmate:manage', requestId, action, ...fields }, (error) => {
      if (error) { host.child.off('message', listener); clearTimeout(timer); reject(error); }
    });
  });
}
async function json(origin, account, method, path, body) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.min(20_000, Math.max(1, deadline - Date.now()))) });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function command(host, origin, account, commandId) {
  return until(host, async () => {
    const read = await json(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(read.status, 200);
    return ['pending', 'dispatching'].includes(read.body.command.state) ? null : read.body.command;
  }, 45_000);
}
async function history(origin, account, sessionId) {
  const events = []; let after = -1;
  for (let page = 0; page < 20; page++) {
    const read = await json(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${after}&limit=100`);
    assert.equal(read.status, 200);
    events.push(...read.body.events);
    if (!read.body.hasMore) return events;
    assert.ok(read.body.nextSeq > after); after = read.body.nextSeq;
  }
  throw new Error('History page bound exceeded');
}
async function stopOwned(host) {
  if (host.child.exitCode !== null || host.child.signalCode !== null) return host.child.exitCode === 0;
  const closed = new Promise((resolve) => host.child.once('close', resolve));
  host.child.send({ type: 'weftmate:quit' });
  const graceful = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!graceful && host.child.pid) {
    const killer = spawn('taskkill', ['/PID', String(host.child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  return host.child.exitCode === 0;
}
async function holdForPhone() {
  const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  await new Promise((resolve) => {
    const done = () => { process.off('SIGINT', done); process.off('SIGTERM', done); input.close(); resolve(); };
    process.once('SIGINT', done); process.once('SIGTERM', done);
    input.on('line', (line) => { if (line.trim().toLowerCase() === 'q') done(); });
  });
}
let host = startHost();
let completed = false;
try {
  let origin = await until(host, () => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(host.output())?.[1]);
  const configured = await manage(host, 'model.configure-synthetic-stop-fixture',
    { baseUrl: `http://127.0.0.1:${modelPort}/v1` });
  assert.equal(configured.id, 'synthetic-stop-fixture');
  const grant = await manage(host, 'account.setup');
  const setup = await json(origin, null, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, ...login, deviceName: 'Stage12 desktop fixture' });
  assert.equal(setup.status, 201);
  let desktop = { cookie: setup.cookie, csrf: setup.body.csrfToken };
  const mobileLogin = await json(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage12 phone fixture' });
  assert.equal(mobileLogin.status, 200);
  const phone = { cookie: mobileLogin.cookie, csrf: mobileLogin.body.csrfToken };
  assert.ok(desktop.cookie && desktop.csrf && phone.cookie && phone.csrf);
  if (phoneServe) {
    console.log(`[stage12-phone-serve] backend=ready origin=${origin} modelOrigin=http://127.0.0.1:${modelPort}/v1 syntheticFact=${uniqueFact} profile=${profile} loginFile=${loginFile}`);
    completed = true;
    await holdForPhone();
  } else {
    const conversationId = `conversation-${randomUUID()}`;
    const turnId = `turn-${randomUUID()}`;
    const declared = await json(origin, phone, 'POST', '/personal/v1/sync/capabilities',
      { sharedConversations: 1, nativeVersionCode: 11 });
    assert.equal(declared.status, 200);
    assert.equal(declared.body.nativeVersionCode, 11);
    const now = new Date().toISOString();
    const rows = [
      { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 1,
        kind: 'conversation.created', occurredAt: now, payload: { title: '手机起步的合成对话' } },
      { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 2,
        kind: 'message.created', occurredAt: now, payload: { messageId: `message-${randomUUID()}`,
          role: 'user', text: `请记住这个仅用于测试的事实：${uniqueFact}` } },
      { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 3,
        kind: 'message.created', occurredAt: now, payload: { messageId: `message-${randomUUID()}`,
          role: 'assistant', text: '手机端已记下这个事实。' } },
      { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 4,
        kind: 'turn.finished', occurredAt: now, payload: { turnId, status: 'completed' } },
    ];
    const synced = await json(origin, phone, 'POST', '/personal/v1/sync/events', { events: rows });
    assert.equal(synced.status, 200, `phone sync: ${synced.body.error?.code ?? synced.status}`);
    assert.equal(synced.body.accepted.length, 4);
    const before = await json(origin, desktop, 'GET',
      `/personal/v1/sync/conversations/${conversationId}/shared`);
    assert.equal(before.status, 200); assert.equal(before.body.canAdopt, true);
    const adoption = { requestId: randomUUID(), modelProfileId: 'synthetic-stop-fixture',
      expectedSyncSeq: before.body.syncThroughSeq };
    const started = await json(origin, desktop, 'POST',
      `/personal/v1/sync/conversations/${conversationId}/shared`, adoption);
    assert.equal(started.status, 202, `adoption: ${started.body.error?.code ?? started.status}`);
    const adopted = await command(host, origin, desktop, started.body.command.commandId);
    assert.equal(adopted.state, 'accepted_by_dsh');
    const binding = await until(host, async () => {
      const read = await json(origin, desktop, 'GET',
        `/personal/v1/sync/conversations/${conversationId}/shared`);
      return read.body.status === 'active' ? read.body.binding : null;
    }, 45_000);
    assert.equal(binding.sessionId, adopted.sessionId);
    assert.equal(binding.conversationId, conversationId);
    const target = await json(origin, desktop, 'POST', '/personal/v1/commands', {
      requestId: randomUUID(), kind: 'session.message', targetDeviceId: before.body.hostId,
      sessionId: binding.sessionId, mode: 'queue',
      text: '请用先前手机对话中的特别事实回答，并保存一份简短 Markdown 摘要。' });
    assert.equal(target.status, 202);
    const targetCommand = await command(host, origin, desktop, target.body.command.commandId);
    assert.equal(targetCommand.state, 'accepted_by_dsh');
    const finished = await until(host, async () => {
      const events = await history(origin, desktop, binding.sessionId);
      const user = events.find((event) => event.type === 'user.message' &&
        event.data?.receiptId === targetCommand.receiptId);
      const start = events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
      const end = events.find((event) => event.type === 'turn.ended' && event.data?.turn === start?.data?.turn);
      if (end?.data?.reason === 'error') throw new Error(`Host turn ended with error; ${fatalRelayError ?? 'upstreamStatus=unknown'}`);
      const assistant = events.find((event) => event.type === 'assistant.message' &&
        event.seq > user?.seq && event.seq < end?.seq);
      if (end?.data?.reason !== 'completed' || !assistant?.data?.text?.includes(uniqueFact)) return null;
      const detail = await json(origin, desktop, 'GET', `/personal/v1/tasks/${targetCommand.commandId}`);
      if (!detail.body.artifacts?.some((item) => item.state === 'observed')) return null;
      return { events, detail: detail.body };
    });
    assert.equal(contextSeen, true, 'model saw the phone fact only through owner-bound context');
    assert.equal(finished.events.filter((event) => event.type === 'user.message' &&
      event.data?.receiptId === targetCommand.receiptId).length, 1);
    const artifact = finished.detail.artifacts.find((item) => item.state === 'observed');
    assert.ok(artifact && finished.detail.conversationId === conversationId);
    const preview = await json(origin, phone, 'GET',
      `/personal/v1/artifacts/${artifact.artifactId}/preview`);
    assert.equal(preview.status, 200); assert.ok(preview.body.text.includes(uniqueFact));
    const download = await fetch(`${origin}/personal/v1/artifacts/${artifact.artifactId}/download`,
      { headers: { cookie: phone.cookie } });
    assert.equal(download.status, 200);
    assert.equal(digest(Buffer.from(await download.arrayBuffer())), artifact.sha256);
    const firstSessionCount = (await json(origin, desktop, 'GET', '/personal/v1/sessions')).body.sessions
      .filter((item) => item.conversationId === conversationId).length;
    assert.equal(firstSessionCount, 1);
    const other = await json(origin, null, 'POST', '/personal/v1/auth/register', {
      username: 'Stage12Other', password: `synthetic-${randomUUID()}-password`, deviceName: 'Other fixture',
    });
    assert.equal(other.status, 201);
    const otherAccount = { cookie: other.cookie, csrf: other.body.csrfToken };
    assert.equal((await json(origin, otherAccount, 'GET',
      `/personal/v1/sync/conversations/${conversationId}/shared`)).status, 404);
    assert.equal((await json(origin, otherAccount, 'GET',
      `/personal/v1/tasks/${targetCommand.commandId}`)).status, 404);
    assert.equal(await stopOwned(host), true);
    host = startHost();
    origin = await until(host, () => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(host.output())?.[1]);
    const relogin = await json(origin, null, 'POST', '/personal/v1/auth/login',
      { ...login, deviceName: 'Stage12 restart fixture' });
    assert.equal(relogin.status, 200);
    desktop = { cookie: relogin.cookie, csrf: relogin.body.csrfToken };
    const repeated = await json(origin, desktop, 'POST',
      `/personal/v1/sync/conversations/${conversationId}/shared`, adoption);
    assert.equal(repeated.status, 202);
    assert.equal(repeated.body.command.commandId, started.body.command.commandId);
    const after = await json(origin, desktop, 'GET',
      `/personal/v1/sync/conversations/${conversationId}/shared`);
    assert.equal(after.body.binding.sessionId, binding.sessionId);
    assert.equal((await json(origin, desktop, 'GET', '/personal/v1/sessions')).body.sessions
      .filter((item) => item.conversationId === conversationId).length, 1);
    assert.equal((await json(origin, desktop, 'GET',
      `/personal/v1/tasks/${targetCommand.commandId}`)).body.conversationId, conversationId);
    console.log(`[stage12-handoff] backend=passed model=${realRelay ? 'MiMo-V2.6-Flash relay' : 'synthetic-stop-model'} profile=${profile} loginFile=${loginFile} nativeTurn=completed artifactSha256=${artifact.sha256} upstreamAbortCount=${upstreamAborts}`);
    completed = true;
  }
} finally {
  relayKey = null;
  try { for (const child of children) if (child.exitCode === null && child.signalCode === null)
    await stopOwned({ child }); }
  finally {
    await new Promise((resolve) => modelServer.close(resolve));
    if (completed && !phoneServe && process.env.WEFTMATE_STAGE12_RETAIN_FIXTURE !== '1' &&
        children.every((child) => child.exitCode !== null || child.signalCode !== null) &&
        realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true });
  }
}
