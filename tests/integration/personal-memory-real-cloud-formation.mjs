/** Isolated real MiMo chat -> real Core formation -> new cloud turn recall. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptStage12Dpapi } from './stage12-dpapi-loader.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_REAL_CLOUD_MEMORY_E2E !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_REAL_CLOUD_MEMORY_E2E=1 for this bounded real MiMo acceptance.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
const privateRoot = realpathSync(join(repository, '..', 'Runtime', 'UnifiedAssistant', 'private-model-tests'));
const keyPath = process.env.WEFTMATE_STAGE15_MIMO_DPAPI_PATH;
if (!keyPath || !isAbsolute(keyPath) || basename(keyPath) !== 'mimo-v2.6-flash.dpapi' ||
    !realpathSync(keyPath).startsWith(privateRoot + sep)) {
  throw new Error('Stage 15 requires the authorized DPAPI MiMo fixture beneath private-model-tests.');
}
const evidenceRoot = join(repository, '..', 'Runtime', 'UnifiedAssistant',
  'Stage15-WindowsAndroid-20261005', 'Memory');
mkdirSync(evidenceRoot, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'weftmate-real-cloud-memory-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  `${JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' })}\n`,
  { flag: 'wx', mode: 0o600 });
const config = join(root, 'memory-config.json');
writeFileSync(config, JSON.stringify({ python, pythonPath, baseUrl: 'http://127.0.0.1:8081/v1',
  model: '@current', authRef: 'personal-local-occamy-miniplus-v21' }), { flag: 'wx', mode: 0o600 });

const runId = randomUUID();
const budgetEndsAt = Date.now() + 12 * 60_000;
const login = { username: `Memory${runId.replaceAll('-', '').slice(0, 16)}`,
  password: `memory-${randomUUID()}-password` };
const preference = '我喝咖啡时偏好加一小撮肉桂粉';
const evidence = { schemaVersion: 1, classification: 'real', runId,
  startedAt: new Date().toISOString(), provider: {
    endpoint: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' },
  limits: { runMs: 12 * 60_000, providerCompletionMaximum: 3,
    batchesMaximum: 1, preferenceTurns: 1, recallTurns: 1 },
  providerCompletions: { conversationPreference: 0, coreFormation: 0, conversationRecall: 0, total: 0 },
  checks: {}, result: 'failed', failure: null };
let child = null, output = '', secret = null, cleanShutdown = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const remaining = (cap) => Math.max(1, Math.min(cap, budgetEndsAt - Date.now()));
function startHost() {
  const running = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
    '--user-data-dir', profile, '--access-port', '0', '--personal-memory-config', config], {
    cwd: repository, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (part) => {
    output = (output + String(part)).slice(-32 * 1024);
  });
  return running;
}
async function until(check, cap = 90_000) {
  const end = Date.now() + remaining(cap);
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    if (!child || child.exitCode !== null || child.signalCode !== null) throw new Error('isolated host exited');
    await pause(200);
  }
  throw new Error('bounded cloud-memory acceptance step timed out');
}
async function management(command, pattern, cap = 45_000) {
  const start = output.length;
  child.stdin.write(`${JSON.stringify(command)}\n`);
  return until(() => pattern.exec(output.slice(start)), cap);
}
async function shutdown() {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    cleanShutdown = child?.exitCode === 0; return cleanShutdown;
  }
  const closed = new Promise((resolve) => child.once('close', resolve));
  try { child.stdin.write('q\n'); child.stdin.end(); } catch {}
  const graceful = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!graceful && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve)); await closed;
  }
  cleanShutdown = child.exitCode === 0; return cleanShutdown;
}
async function api(origin, account, method, route, body) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(remaining(30_000)) });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function settledModel(origin, account, requestId) {
  return until(async () => {
    const value = await api(origin, account, 'GET', `/personal/v1/account/models/by-request/${requestId}`);
    assert.equal(value.status, 200);
    return ['pending', 'applying'].includes(value.body.operation.status) ? null : value.body;
  }, 120_000);
}
async function settledCommand(origin, account, commandId) {
  return until(async () => {
    const value = await api(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(value.status, 200);
    return ['pending', 'dispatching'].includes(value.body.command.state) ? null : value.body.command;
  }, 60_000);
}
async function history(origin, account, sessionId) {
  const events = []; let afterSeq = -1;
  for (let page = 0; page < 16; page++) {
    const value = await api(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(value.status, 200); events.push(...value.body.events);
    if (!value.body.hasMore) return events;
    assert.ok(value.body.nextSeq > afterSeq); afterSeq = value.body.nextSeq;
  }
  throw new Error('bounded history exceeded');
}
async function createSession(origin, account, hostId, profileId) {
  const opened = await api(origin, account, 'POST', '/personal/v1/commands', {
    requestId: `session-${randomUUID()}`, kind: 'session.create', targetDeviceId: hostId,
    modelProfileId: profileId });
  assert.equal(opened.status, 202, JSON.stringify(opened.body));
  const command = await settledCommand(origin, account, opened.body.command.commandId);
  assert.equal(command.state, 'accepted_by_dsh'); return command.sessionId;
}
async function turn(origin, account, hostId, sessionId, text) {
  const sent = await api(origin, account, 'POST', '/personal/v1/commands', {
    requestId: `turn-${randomUUID()}`, kind: 'session.message', targetDeviceId: hostId,
    sessionId, mode: 'queue', text });
  assert.equal(sent.status, 202, JSON.stringify(sent.body));
  const command = await settledCommand(origin, account, sent.body.command.commandId);
  assert.equal(command.state, 'accepted_by_dsh');
  return until(async () => {
    const events = await history(origin, account, sessionId);
    const user = events.find((event) => event.type === 'user.message' &&
      event.data?.receiptId === command.receiptId);
    const started = events.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
    const ended = events.find((event) => event.type === 'turn.ended' &&
      event.data?.turn === started?.data?.turn);
    if (!ended) return null;
    assert.equal(ended.data.reason, 'completed', JSON.stringify(ended.data));
    const answer = events.filter((event) => event.type === 'assistant.message' &&
      event.seq > started.seq && event.seq < ended.seq).map((event) => event.data.text ?? '').join(' ');
    assert.ok(answer.trim()); return answer;
  }, 240_000);
}
const hostState = () => JSON.parse(readFileSync(join(profile, 'dsh-home', 'weftmate-host-state.json'), 'utf8'))
  .accountMemoryIpc;

try {
  child = startHost();
  const origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/
    .exec(output)?.[1]);
  const setup = await management({ action: 'account.setup' }, /setupLinkFile=([^\s]+) expiresAt=/);
  const setupUrl = new URL(JSON.parse(readFileSync(setup[1], 'utf8')).url);
  const registered = await api(origin, null, 'POST', '/personal/v1/auth/setup', {
    grant: decodeURIComponent(setupUrl.hash.slice('#setup='.length)), ...login,
    deviceName: 'Stage 15 real cloud memory fixture' });
  assert.equal(registered.status, 201);
  const account = { cookie: registered.cookie, csrf: registered.body.csrfToken,
    ownerId: registered.body.account.ownerId };

  secret = await decryptStage12Dpapi(realpathSync(keyPath));
  const registerRequestId = `memory-model-${runId}`;
  const created = await api(origin, account, 'POST', '/personal/v1/account/models', {
    requestId: registerRequestId, name: 'Stage 15 memory MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: secret });
  secret = null;
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const installed = await settledModel(origin, account, registerRequestId);
  assert.equal(installed.operation.status, 'succeeded');
  assert.equal(installed.model.configured, true);
  const status = await api(origin, account, 'GET', '/personal/v1/status');
  assert.equal(status.status, 200);

  const firstSession = await createSession(origin, account, status.body.hostId, installed.model.profileId);
  const before = hostState();
  const firstAnswer = await turn(origin, account, status.body.hostId, firstSession,
    `请记住这个新偏好：${preference}。只需用一句短中文确认，不调用工具。`);
  evidence.providerCompletions.conversationPreference = 1;
  await until(() => hostState().ingestRequests > before.ingestRequests, 30_000);
  const formed = await until(async () => {
    const result = await api(origin, account, 'GET',
      `/personal/v1/memory/items?kind=cognition&query=${encodeURIComponent('肉桂粉')}`);
    assert.equal(result.status, 200);
    return result.body.items.find((item) => item.currentState === 'current' &&
      /肉桂/.test(item.text)) ?? null;
  }, 300_000);
  evidence.providerCompletions.coreFormation = 1;

  const secondSession = await createSession(origin, account, status.body.hostId, installed.model.profileId);
  const beforeRecall = hostState();
  const recalledAnswer = await turn(origin, account, status.body.hostId, secondSession,
    '根据本账户记忆，我喝咖啡时偏好加什么？只回答偏好内容，不调用工具。');
  evidence.providerCompletions.conversationRecall = 1;
  evidence.providerCompletions.total = 3;
  const afterRecall = hostState();
  assert.ok(afterRecall.recallWithContext > beforeRecall.recallWithContext,
    'new cloud turn must receive nonempty account memory context');
  assert.match(recalledAnswer, /肉桂/);
  evidence.checks = { accountModelConfigured: true, firstTurnCompleted: firstAnswer.trim().length > 0,
    coreFormedWithoutSqlSeed: true, formedItemIdHash: createHash('sha256').update(formed.id).digest('hex'),
    newSessionReceivedMemoryContext: true, recalledAnswerContainsPreference: true,
    ownerIdHash: createHash('sha256').update(account.ownerId).digest('hex'),
    productionTestingMode: false, cleanShutdown: false };
  evidence.result = 'passed';
  console.log('[personal-memory-real-cloud-formation] private MiMo turn formed real Core memory; new cloud session recalled it');
} catch (error) {
  evidence.failure = { code: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'ACCEPTANCE_FAILED',
    name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 300) };
  throw error;
} finally {
  secret = null;
  cleanShutdown = await shutdown().catch(() => false);
  evidence.finishedAt = new Date().toISOString();
  evidence.checks.cleanShutdown = cleanShutdown;
  const outputPath = join(evidenceRoot, `real-cloud-memory-${runId}.json`);
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (cleanShutdown && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
    rmSync(root, { recursive: true, force: true });
  }
}
