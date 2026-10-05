/**
 * Explicit, isolated Stage 15 account-model acceptance against the real MiMo API.
 * It never touches the daily host, a normal account, or a fixed DSH profile.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { decryptStage12Dpapi } from './stage12-dpapi-loader.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_REAL_ACCOUNT_MODEL_E2E !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_REAL_ACCOUNT_MODEL_E2E=1 on Windows for this isolated real acceptance.');
}

const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const privateRoot = realpathSync(join(repository, '..', 'Runtime', 'UnifiedAssistant', 'private-model-tests'));
const designatedEvidenceDir = join(repository, '..', 'Runtime', 'UnifiedAssistant',
  'Stage15-WindowsAndroid-20261005', 'Cloud');
mkdirSync(designatedEvidenceDir, { recursive: true });
const evidenceRoot = realpathSync(designatedEvidenceDir);
const keyPath = process.env.WEFTMATE_STAGE15_MIMO_DPAPI_PATH;
const requestedEvidenceDir = process.env.WEFTMATE_STAGE15_EVIDENCE_DIR;
if (!keyPath || !isAbsolute(keyPath) || basename(keyPath) !== 'mimo-v2.6-flash.dpapi' ||
    !realpathSync(keyPath).startsWith(privateRoot + sep)) {
  throw new Error('Stage 15 requires the authorized DPAPI MiMo fixture beneath private-model-tests.');
}
if (!requestedEvidenceDir || !isAbsolute(requestedEvidenceDir) ||
    realpathSync(requestedEvidenceDir) !== evidenceRoot) {
  throw new Error('Stage 15 evidence must use the designated Cloud evidence directory.');
}

const root = mkdtempSync(join(tmpdir(), 'weftmate-stage15-real-account-model-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
const marker = join(profile, '.weftmate-personal-host-profile.json');
mkdirSync(profile);
writeFileSync(marker, `${JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' })}\n`,
  { flag: 'wx', mode: 0o600 });

const runId = randomUUID();
const login = { username: `Stage15${runId.replaceAll('-', '').slice(0, 16)}`,
  password: `stage15-${randomUUID()}-pass` };
const startedAt = new Date().toISOString();
const budgetEndsAt = Date.now() + 12 * 60_000;
const evidence = {
  schemaVersion: 1,
  classification: 'real',
  runId,
  startedAt,
  provider: { endpoint: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' },
  limits: { individualRequestMs: 240_000, runMs: 12 * 60_000, inferenceTurnsMaximum: 3 },
  registration: { submitted: false, settled: false, configured: false, verify: null },
  normalConversation: { accepted: false, terminal: null, replyEvidence: null },
  toolGoal: { accepted: false, terminal: null, replyEvidence: null, observedArtifact: false },
  stop: { accepted: false, terminal: null, control: null },
  restart: { cleanShutdown: false, modelRestored: false, stoppedTaskRestored: false },
  result: 'failed',
  failure: null,
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const remaining = (cap) => Math.max(1, Math.min(cap, budgetEndsAt - Date.now()));
let child = null;
let output = '';
let cleanShutdown = false;
function startHost() {
  const running = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
    '--user-data-dir', profile, '--access-port', '0'], {
    cwd: repository, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (part) => {
    // Host output can contain request text. Retain only a bounded in-memory tail and never persist it.
    output = (output + String(part)).slice(-16 * 1024);
  });
  return running;
}
async function until(check, cap = 90_000) {
  const end = Date.now() + remaining(cap);
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    if (!child || child.exitCode !== null || child.signalCode !== null) throw new Error('isolated host exited');
    await pause(150);
  }
  throw new Error('bounded acceptance step timed out');
}
async function management(command, pattern, cap = 45_000) {
  const start = output.length;
  child.stdin.write(`${JSON.stringify(command)}\n`);
  return until(() => pattern.exec(output.slice(start)), cap);
}
async function shutdown() {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    cleanShutdown = child?.exitCode === 0;
    return cleanShutdown;
  }
  const closed = new Promise((resolve) => child.once('close', resolve));
  try { child.stdin.write('q\n'); child.stdin.end(); } catch { /* bounded fallback follows */ }
  const graceful = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!graceful && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  cleanShutdown = child.exitCode === 0;
  return cleanShutdown;
}
async function api(origin, account, method, route, body) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(remaining(20_000)),
  });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function settledModel(origin, account, requestId) {
  return until(async () => {
    const current = await api(origin, account, 'GET', `/personal/v1/account/models/by-request/${requestId}`);
    assert.equal(current.status, 200);
    return ['pending', 'applying'].includes(current.body.operation?.status) ? null : current.body;
  }, 120_000);
}
async function settledCommand(origin, account, commandId) {
  return until(async () => {
    const current = await api(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(current.status, 200);
    return ['pending', 'dispatching'].includes(current.body.command?.state) ? null : current.body.command;
  }, 60_000);
}
async function history(origin, account, sessionId) {
  const events = [];
  let afterSeq = -1;
  for (let page = 0; page < 16; page++) {
    const current = await api(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(current.status, 200);
    events.push(...current.body.events);
    if (!current.body.hasMore) return events;
    assert.ok(current.body.nextSeq > afterSeq);
    afterSeq = current.body.nextSeq;
  }
  throw new Error('bounded event history exceeded');
}
async function terminalFor(origin, account, sessionId, receiptId, expected = null) {
  return until(async () => {
    const events = await history(origin, account, sessionId);
    const user = events.find((event) => event.type === 'user.message' && event.data?.receiptId === receiptId);
    const start = events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
    const end = events.find((event) => event.type === 'turn.ended' && event.data?.turn === start?.data?.turn);
    if (!end || (expected && end.data?.reason !== expected)) return null;
    return end;
  }, 240_000);
}
function safeReplyEvidence(task) {
  const reply = task?.replyEvidence;
  return reply && typeof reply === 'object' ? {
    status: reply.status ?? null, turn: Number.isSafeInteger(reply.turn) ? reply.turn : null,
    assistantChunks: Number.isSafeInteger(reply.assistantChunks) ? reply.assistantChunks : null,
    textChunks: Number.isSafeInteger(reply.textChunks) ? reply.textChunks : null,
    toolSaveObserved: reply.toolSaveObserved === true,
  } : null;
}
function safeFailure(error) {
  return { code: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'ACCEPTANCE_FAILED',
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error' };
}

let origin = null;
let account = null;
let model = null;
let sessionId = null;
let stoppedTaskId = null;
let secret = null;
try {
  child = startHost();
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const setup = await management({ action: 'account.setup' }, /setupLinkFile=([^\s]+) expiresAt=/);
  const setupUrl = new URL(JSON.parse(readFileSync(setup[1], 'utf8')).url);
  const registered = await api(origin, null, 'POST', '/personal/v1/auth/setup', {
    grant: decodeURIComponent(setupUrl.hash.slice('#setup='.length)), ...login,
    deviceName: 'Stage 15 isolated account-model fixture',
  });
  assert.equal(registered.status, 201);
  account = { cookie: registered.cookie, csrf: registered.body.csrfToken };
  assert.ok(account.cookie && account.csrf);

  secret = await decryptStage12Dpapi(realpathSync(keyPath));
  const registerRequestId = `stage15-create-${runId}`;
  evidence.registration.submitted = true;
  const created = await api(origin, account, 'POST', '/personal/v1/account/models', {
    requestId: registerRequestId, name: 'Stage 15 MiMo Fixture',
    baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: secret,
  });
  // Do not retain a second application reference once the request body was submitted.
  secret = null;
  assert.equal(created.status, 202);
  const installed = await settledModel(origin, account, registerRequestId);
  assert.equal(installed.operation.status, 'succeeded');
  assert.equal(installed.model.configured, true);
  model = installed.model;
  evidence.registration.settled = true;
  evidence.registration.configured = true;
  const verified = await api(origin, account, 'POST', `/personal/v1/models/${model.profileId}/verify`, {});
  assert.equal(verified.status, 200);
  evidence.registration.verify = { configured: verified.body.configured === true,
    reachable: verified.body.reachable === true, modelListed: verified.body.modelListed === true,
    inferenceVerified: verified.body.inferenceVerified === true };
  assert.equal(verified.body.configured, true);
  assert.equal(verified.body.reachable, true);
  assert.equal(verified.body.modelListed, true);

  const status = await api(origin, account, 'GET', '/personal/v1/status');
  assert.equal(status.status, 200);
  const opened = await api(origin, account, 'POST', '/personal/v1/commands', {
    requestId: `stage15-session-${runId}`, kind: 'session.create', targetDeviceId: status.body.hostId,
    modelProfileId: model.profileId,
  });
  assert.equal(opened.status, 202);
  const session = await settledCommand(origin, account, opened.body.command.commandId);
  assert.equal(session.state, 'accepted_by_dsh');
  sessionId = session.sessionId;

  const normal = await api(origin, account, 'POST', '/personal/v1/commands', {
    requestId: `stage15-normal-${runId}`, kind: 'session.message', targetDeviceId: status.body.hostId,
    sessionId, mode: 'queue', text: '这是阶段15的受控连通性检查。请只用一句简短中文确认你已收到。',
  });
  assert.equal(normal.status, 202);
  const normalCommand = await settledCommand(origin, account, normal.body.command.commandId);
  assert.equal(normalCommand.state, 'accepted_by_dsh');
  evidence.normalConversation.accepted = true;
  const normalEnd = await terminalFor(origin, account, sessionId, normalCommand.receiptId, 'completed');
  evidence.normalConversation.terminal = normalEnd.data?.reason ?? null;
  const normalTask = await api(origin, account, 'GET', `/personal/v1/tasks/${normalCommand.commandId}`);
  assert.equal(normalTask.status, 200);
  evidence.normalConversation.replyEvidence = safeReplyEvidence(normalTask.body);
  assert.equal(normalTask.body.replyEvidence?.status, 'completed');
  assert.ok(normalTask.body.replyEvidence?.assistantChunks > 0);

  const tool = await api(origin, account, 'POST', '/personal/v1/commands', {
    requestId: `stage15-tool-${runId}`, kind: 'session.message', targetDeviceId: status.body.hostId,
    sessionId, mode: 'queue', text: '请使用 personal_save_document 保存一个名为 stage15-cloud-probe.md 的 Markdown 文件，内容只写“stage15 cloud tool verified”。完成后用一句中文确认。',
  });
  assert.equal(tool.status, 202);
  const toolCommand = await settledCommand(origin, account, tool.body.command.commandId);
  assert.equal(toolCommand.state, 'accepted_by_dsh');
  evidence.toolGoal.accepted = true;
  const toolEnd = await terminalFor(origin, account, sessionId, toolCommand.receiptId, 'completed');
  evidence.toolGoal.terminal = toolEnd.data?.reason ?? null;
  const toolTask = await until(async () => {
    const task = await api(origin, account, 'GET', `/personal/v1/tasks/${toolCommand.commandId}`);
    assert.equal(task.status, 200);
    return task.body.replyEvidence?.status === 'completed' ? task.body : null;
  }, 30_000);
  evidence.toolGoal.replyEvidence = safeReplyEvidence(toolTask);
  evidence.toolGoal.observedArtifact = toolTask.artifacts?.some((item) => item.state === 'observed') === true;
  assert.equal(toolTask.replyEvidence?.toolSaveObserved, true);
  assert.equal(evidence.toolGoal.observedArtifact, true);

  const cancellable = await api(origin, account, 'POST', '/personal/v1/commands', {
    requestId: `stage15-stop-${runId}`, kind: 'session.message', targetDeviceId: status.body.hostId,
    sessionId, mode: 'queue', text: '请从 1 开始逐行输出自然数，直到 100000；在收到停止前不要总结。',
  });
  assert.equal(cancellable.status, 202);
  const stopCommand = await settledCommand(origin, account, cancellable.body.command.commandId);
  assert.equal(stopCommand.state, 'accepted_by_dsh');
  evidence.stop.accepted = true;
  await until(async () => {
    const events = await history(origin, account, sessionId);
    const user = events.find((event) => event.type === 'user.message' && event.data?.receiptId === stopCommand.receiptId);
    return events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq) ?? null;
  }, 60_000);
  const requestedStop = await api(origin, account, 'POST', `/personal/v1/tasks/${stopCommand.commandId}/stop`,
    { requestId: `stage15-stop-request-${runId}` });
  assert.equal(requestedStop.status, 202);
  const stopEnd = await terminalFor(origin, account, sessionId, stopCommand.receiptId, 'aborted');
  evidence.stop.terminal = stopEnd.data?.reason ?? null;
  stoppedTaskId = stopCommand.commandId;
  const stoppedTask = await until(async () => {
    const task = await api(origin, account, 'GET', `/personal/v1/tasks/${stoppedTaskId}`);
    assert.equal(task.status, 200);
    return task.body.control?.stopStatus === 'stopped' ? task.body : null;
  }, 30_000);
  evidence.stop.control = { state: stoppedTask.control?.state ?? null,
    stopStatus: stoppedTask.control?.stopStatus ?? null, reasonCode: stoppedTask.control?.reasonCode ?? null,
    canResume: stoppedTask.control?.canResume === true };
  assert.equal(stoppedTask.control.reasonCode, 'STOP_OBSERVED');

  assert.equal(await shutdown(), true);
  evidence.restart.cleanShutdown = cleanShutdown;
  output = '';
  child = startHost();
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const relogin = await api(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage 15 recovery fixture' });
  assert.equal(relogin.status, 200);
  account = { cookie: relogin.cookie, csrf: relogin.body.csrfToken };
  const restored = await api(origin, account, 'GET', '/personal/v1/account/models');
  assert.equal(restored.status, 200);
  const restoredModel = restored.body.models.find((item) => item.accountModelId === model.accountModelId);
  evidence.restart.modelRestored = restoredModel?.configured === true && restoredModel?.status === 'active' &&
    restoredModel?.profileId === model.profileId;
  assert.equal(evidence.restart.modelRestored, true);
  const restoredTask = await api(origin, account, 'GET', `/personal/v1/tasks/${stoppedTaskId}`);
  assert.equal(restoredTask.status, 200);
  evidence.restart.stoppedTaskRestored = restoredTask.body.control?.stopStatus === 'stopped' &&
    restoredTask.body.control?.reasonCode === 'STOP_OBSERVED';
  assert.equal(evidence.restart.stoppedTaskRestored, true);
  evidence.result = 'passed';
  console.log('[stage15-account-model-real] real registration, normal reply, tool artifact, stop, and restart recovery passed');
} catch (error) {
  evidence.failure = safeFailure(error);
  throw error;
} finally {
  secret = null;
  evidence.finishedAt = new Date().toISOString();
  evidence.restart.cleanShutdown = cleanShutdown;
  const outputPath = join(evidenceRoot, `real-account-model-${runId}.json`);
  try {
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (writeError) {
    if (!evidence.failure) evidence.failure = safeFailure(writeError);
    throw writeError;
  } finally {
    await shutdown().catch(() => {});
    if (cleanShutdown && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}
