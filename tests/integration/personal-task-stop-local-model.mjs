/** Opt-in Stage 09 acceptance against the already-loaded local model. Never switches models. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readUserModelSwitcherKey } from '../../src/local-model-config.mjs';
import { ensurePrivateFile } from '../../src/private-host-storage.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_STOP_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_STOP_E2E=1 on Windows for the bounded local-model acceptance.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const fixtureRoot = join(repository, '..', 'Runtime', 'UnifiedAssistant', 'Stage09Acceptance-20261003');
const profile = join(fixtureRoot, 'personal-fixture');
const loginFile = join(profile, 'stage09-login.json');
const expectedModel = 'qwen3.8-27b';
const profileId = `personal-local-${expectedModel}`;
const deadline = Date.now() + 240_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function remaining(cap) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('acceptance wall-time limit reached');
  return Math.min(cap, left);
}
const switcherKey = await readUserModelSwitcherKey();
async function modelState() {
  const response = await fetch('http://127.0.0.1:8081/switch/status', {
    headers: { authorization: `Bearer ${switcherKey}` }, signal: AbortSignal.timeout(remaining(5_000)),
  });
  if (response.status !== 200) throw new Error('unmet precondition: ModelSwitcher status unavailable');
  return response.json();
}
const before = await modelState();
if (before.currentModelId !== expectedModel || before.switching === true ||
    before.activeLeases !== 0 || before.queuedLeases !== 0 || before.maintenanceQueued !== 0 ||
    before.probe?.health !== true) {
  throw new Error('unmet precondition: qwen3.8-27b must already be healthy, loaded and idle');
}
if (existsSync(profile) && !existsSync(loginFile)) {
  throw new Error('existing Stage 09 profile has no private login record; refusing to alter it');
}
mkdirSync(fixtureRoot, { recursive: true });
const launcher = join(repository, 'scripts', 'run-personal-host.mjs');
const child = spawn(process.execPath, [launcher, '--user-data-dir', profile, '--access-port', '0'], {
  cwd: repository, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  output = (output + String(chunk)).slice(-96 * 1024);
});
async function until(check, cap = 45_000) {
  const end = Date.now() + remaining(cap);
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`isolated host exited: code=${child.exitCode ?? 'signal'}`);
    }
    await pause(150);
  }
  throw new Error('acceptance step timed out');
}
async function command(value, pattern, cap = 45_000) {
  const start = output.length;
  child.stdin.write(`${JSON.stringify(value)}\n`);
  return until(() => pattern.exec(output.slice(start)), cap);
}
async function json(origin, account, method, path, body) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(remaining(10_000)),
  });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function submit(origin, account, payload) {
  const sent = await json(origin, account, 'POST', '/personal/v1/commands', payload);
  assert.equal(sent.status, 202, `command submit failed: ${sent.body.error?.code ?? sent.status}`);
  const commandId = sent.body.command.commandId;
  return until(async () => {
    const current = await json(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(current.status, 200);
    const command = current.body.command;
    if (['pending', 'dispatching'].includes(command.state)) return null;
    assert.equal(command.state, 'accepted_by_dsh', `command failed: ${command.errorCode ?? command.state}`);
    return command;
  }, 45_000);
}
async function history(origin, account, sessionId) {
  let afterSeq = -1;
  const events = [];
  for (let page = 0; page < 20; page++) {
    const current = await json(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(current.status, 200);
    events.push(...current.body.events);
    if (!current.body.hasMore) return events;
    assert.ok(current.body.nextSeq > afterSeq);
    afterSeq = current.body.nextSeq;
  }
  throw new Error('history exceeded bounded acceptance scan');
}
async function turnFor(origin, account, sessionId, receiptId, reason, cap = 90_000) {
  return until(async () => {
    const events = await history(origin, account, sessionId);
    const user = events.find((item) => item.type === 'user.message' && item.data?.receiptId === receiptId);
    if (!user) return null;
    const start = events.findLast((item) => item.type === 'turn.started' && item.seq < user.seq);
    const end = events.find((item) => item.type === 'turn.ended' && item.data?.turn === start?.data?.turn);
    return end?.data?.reason === reason ? end : null;
  }, cap);
}
async function stopOwned() {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode === 0;
  const closed = new Promise((resolve) => child.once('close', resolve));
  try { child.stdin.write('q\n'); child.stdin.end(); } catch { /* force cleanup below */ }
  const managed = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  return child.exitCode === 0;
}
async function nativeDiagnostic(sessionId) {
  if (typeof sessionId !== 'string') return { available: false };
  const root = join(profile, 'dsh-home', 'sessions');
  let file = null;
  try {
    for (const project of readdirSync(root, { withFileTypes: true }).slice(0, 32)) {
      if (!project.isDirectory()) continue;
      const candidate = join(root, project.name, sessionId, 'session.jsonl.zstd');
      if (existsSync(candidate)) { file = candidate; break; }
    }
    if (!file || statSync(file).size > 5_000_000) return { available: false };
    // The pinned persistence reader decodes every complete concatenated Zstd
    // frame. Node's one-shot zstdDecompressSync only returns the header frame.
    const { JsonlSessionPersistence } = await import(pathToFileURL(join(repository, 'vendor',
      'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')).href);
    const reader = { compression: 'zstd', ensureRootEncoding: async () => {},
      findLog: async () => file, readStableFile: async () => ({ buffer: readFileSync(file) }) };
    const artifact = await JsonlSessionPersistence.prototype.readRaw.call(reader, sessionId);
    const turns = new Map();
    let rows = 0;
    for (const line of artifact.content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (++rows > 5_000) return { available: false, reason: 'scan_limit' };
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const turn = event.data?.turn;
      if (!Number.isSafeInteger(turn) || turn < 1) continue;
      if (!turns.has(turn)) turns.set(turn, { turn, started: false, terminalReason: null,
        terminalErrorCode: null, assistantChunks: 0 });
      const item = turns.get(turn);
      if (event.type === 'turn/start') item.started = true;
      else if (event.type === 'turn/end') {
        item.terminalReason = typeof event.data?.reason?.kind === 'string' &&
          /^[a-z-]{1,32}$/.test(event.data.reason.kind) ? event.data.reason.kind : 'unknown';
        item.terminalErrorCode = typeof event.data?.reason?.error?.code === 'string' &&
          /^[A-Z_]{2,48}$/.test(event.data.reason.error.code) ? event.data.reason.error.code : null;
      } else if (event.type === 'assistant/chunk') item.assistantChunks++;
    }
    return { available: true, turns: [...turns.values()].slice(-4) };
  } catch { return { available: false }; }
}
let observedSessionId = null;
let observedTargetTurn = null;
let targetControlStopped = false;
let nextAccepted = false;
let failureState = null;
let failed = false;
try {
  const origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1], 90_000);
  await command({ action: 'model.configure-local', modelId: expectedModel },
    /modelId=qwen3\.8-27b profileId=personal-local-qwen3\.8-27b verification=catalog_only inferenceVerified=false/, 45_000);
  let login;
  if (existsSync(loginFile)) {
    assert.ok(realpathSync(loginFile).startsWith(realpathSync(profile) + sep));
    login = JSON.parse(readFileSync(loginFile, 'utf8'));
  } else {
    const setup = await command({ action: 'account.setup' }, /setupLinkFile=([^\s]+) expiresAt=/);
    const url = new URL(JSON.parse(readFileSync(setup[1], 'utf8')).url);
    login = { username: 'Stage09Owner', password: randomBytes(24).toString('base64url') };
    writeFileSync(loginFile, `${JSON.stringify(login)}\n`, { flag: 'wx', mode: 0o600 });
    await ensurePrivateFile(loginFile);
    const created = await json(origin, null, 'POST', '/personal/v1/auth/setup', {
      grant: decodeURIComponent(url.hash.slice('#setup='.length)), ...login, deviceName: 'Stage 09 PC',
    });
    assert.equal(created.status, 201, `account setup failed: ${created.body.error?.code ?? created.status}`);
  }
  const signed = await json(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage 09 acceptance' });
  assert.equal(signed.status, 200, `login failed: ${signed.body.error?.code ?? signed.status}`);
  const account = { cookie: signed.cookie, csrf: signed.body.csrfToken };
  assert.ok(account.cookie && account.csrf);
  const status = await json(origin, account, 'GET', '/personal/v1/status');
  assert.equal(status.status, 200);
  const session = await submit(origin, account, { requestId: randomUUID(), kind: 'session.create',
    targetDeviceId: status.body.hostId, modelProfileId: profileId });
  observedSessionId = session.sessionId;
  const target = await submit(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: status.body.hostId, sessionId: session.sessionId, mode: 'queue',
    text: '请按以下三步给出具体检查项：\n1. 为本地项目写摘要。\n2. 逐项核对来源。\n3. 整理验收记录。' });
  assert.ok(target.receiptId);
  await until(async () => {
    const state = await modelState();
    const events = await history(origin, account, session.sessionId);
    return state.currentModelId === expectedModel && state.activeLeases > 0 &&
      events.some((event) => event.type === 'user.message' && event.data?.receiptId === target.receiptId);
  }, 60_000);
  const stopped = await json(origin, account, 'POST', `/personal/v1/tasks/${target.commandId}/stop`,
    { requestId: randomUUID() });
  assert.equal(stopped.status, 202, `stop refused: ${stopped.body.error?.code ?? stopped.status}`);
  const aborted = await turnFor(origin, account, session.sessionId, target.receiptId, 'aborted');
  observedTargetTurn = aborted.data.turn;
  const task = await until(async () => {
    const read = await json(origin, account, 'GET', `/personal/v1/tasks/${target.commandId}`);
    assert.equal(read.status, 200);
    return read.body.control.stopStatus === 'stopped' ? read.body : null;
  }, 45_000);
  assert.equal(task.control.reasonCode, 'STOP_OBSERVED');
  assert.equal(task.control.canResume, true);
  targetControlStopped = true;
  const next = await submit(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: status.body.hostId, sessionId: session.sessionId, mode: 'queue',
    text: '这是另一条独立消息。请只回复：已继续。' });
  nextAccepted = true;
  const completed = await turnFor(origin, account, session.sessionId, next.receiptId, 'completed', 180_000);
  assert.ok(completed.data.turn > aborted.data.turn);
  console.log(`[stage09-real-stop] target=aborted control=stopped next=completed profile=${profile} loginFile=${loginFile}`);
} catch (error) {
  failed = true;
  try {
    const state = await modelState();
    failureState = { currentModelId: state.currentModelId,
      activeLeases: state.activeLeases, queuedLeases: state.queuedLeases,
      maintenanceQueued: state.maintenanceQueued, switching: state.switching === true };
  } catch { failureState = { available: false }; }
  throw error;
} finally {
  const clean = await stopOwned();
  if (failed) {
    const native = await nativeDiagnostic(observedSessionId);
    console.error('[stage09-real-stop] diagnostic ' + JSON.stringify({
      configuredUpstreamPath: '/v1/chat/completions',
      targetNativeAborted: native.turns?.some((turn) => turn.turn === observedTargetTurn &&
        turn.terminalReason === 'aborted') === true,
      targetControlStopped, nextAccepted,
      nextStreamingThenInterruptedByShutdown: native.turns?.some((turn) =>
        turn.turn > observedTargetTurn && turn.assistantChunks > 0 &&
        turn.terminalReason === 'interrupted') === true,
      native, modelStateBeforeShutdown: failureState,
    }));
  }
  if (!clean) throw new Error('isolated host did not finish managed shutdown; profile preserved for inspection');
}
