/** Opt-in Stage 14 R2 baseline with opaque model-wire and semantic timestamps. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readUserModelSwitcherKey } from '../../src/local-model-config.mjs';
import { ensurePrivateFile } from '../../src/private-host-storage.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE14_R2_REAL_E2E !== '1') {
  throw new Error('Set WEFTMATE_STAGE14_R2_REAL_E2E=1 on Windows for one isolated Stage 14 R2 goal.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const acceptanceRoot = join(repository, '..', 'Runtime', 'UnifiedAssistant', 'Stage14R2Acceptance-20261004');
const expectedModel = 'qwen3.8-27b';
const caseId = process.env.WEFTMATE_STAGE14_R2_CASE ?? 'iana-short';
if (!['electron-api', 'iana-short'].includes(caseId)) throw new Error('Unknown bounded browser acceptance case.');
const mode = process.env.WEFTMATE_STAGE14_R2_MODE ?? 'baseline';
if (!['baseline', 'candidate-low'].includes(mode) || mode === 'candidate-low' && caseId !== 'iana-short') {
  throw new Error('Unknown Stage14R2 case or candidate mode.');
}
const modelProfileId = mode === 'candidate-low'
  ? `personal-local-${expectedModel}-stage14r2-low` : `personal-local-${expectedModel}`;
const observationRunId = randomUUID();
const documentation = caseId === 'iana-short' ? [
  'https://www.iana.org/help/example-domains',
  'https://www.iana.org/about',
] : [
  'https://www.electronjs.org/docs/latest/api/browser-window',
  'https://www.electronjs.org/docs/latest/api/session',
];
const deadline = Date.now() + 300_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value) => createHash('sha256').update(value).digest('hex');
function remaining(cap) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('acceptance wall-time limit reached');
  return Math.min(cap, left);
}
const switcherKey = await readUserModelSwitcherKey();
async function modelState(waitForIdle = false) {
  const until = Date.now() + remaining(waitForIdle ? 25_000 : 1);
  do {
    const response = await fetch('http://127.0.0.1:8081/switch/status', {
      headers: { authorization: `Bearer ${switcherKey}` },
      signal: AbortSignal.timeout(remaining(5_000)),
    });
    if (response.status !== 200) throw new Error('unmet precondition: ModelSwitcher status unavailable');
    const state = await response.json();
    if (state.currentModelId !== expectedModel || state.switching === true || state.probe?.health !== true) {
      throw new Error('unmet precondition: qwen3.8-27b must remain loaded and healthy');
    }
    if (state.activeLeases === 0 && state.queuedLeases === 0 && state.maintenanceQueued === 0) return state;
    if (!waitForIdle) throw new Error('unmet precondition: ModelSwitcher must be idle');
    await pause(500);
  } while (Date.now() < until);
  throw new Error('ModelSwitcher remained busy after the isolated goal');
}
const before = await modelState();
const priorSwitch = JSON.stringify(before.lastSwitch ?? null);
mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = join(acceptanceRoot, `local-browser-stage14r2-${mode}-${caseId}-${Date.now()}-${observationRunId}`);
mkdirSync(runRoot);
assert.ok(realpathSync(runRoot).startsWith(realpathSync(acceptanceRoot) + sep));
const profile = join(runRoot, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  `${JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' })}\n`,
  { flag: 'wx', mode: 0o600 });
const loginFile = join(runRoot, 'stage14r2-local-login.json');
const login = { username: 'Stage14LocalOwner', password: randomBytes(24).toString('base64url') };
writeFileSync(loginFile, `${JSON.stringify(login)}\n`, { flag: 'wx', mode: 0o600 });
await ensurePrivateFile(loginFile);
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
  cwd: repository, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
    WEFTMATE_STAGE14_R2_OBSERVE: '1', WEFTMATE_STAGE14_R2_RUN_ID: observationRunId },
});
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  output = (output + String(chunk)).slice(-64 * 1024);
});
async function until(check, cap = 45_000) {
  const end = Date.now() + remaining(cap);
  while (Date.now() < end) {
    const found = await check();
    if (found) return found;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('isolated host exited');
    await pause(250);
  }
  throw new Error('acceptance step timed out');
}
async function management(action, cap = 45_000) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error('management timed out')); },
      remaining(cap));
    const receive = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', receive); clearTimeout(timer);
      if (frame.ok === true) resolve(frame.result);
      else reject(new Error(`management failed: ${frame.code ?? 'UNKNOWN'}`));
    };
    child.on('message', receive);
    child.send({ type: 'weftmate:manage', requestId, action }, (error) => {
      if (error) { child.off('message', receive); clearTimeout(timer); reject(error); }
    });
  });
}
async function json(origin, account, method, route, body) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(remaining(15_000)),
  });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function settle(origin, account, commandId) {
  return until(async () => {
    const response = await json(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(response.status, 200);
    const command = response.body.command;
    if (['pending', 'dispatching'].includes(command.state)) return null;
    assert.equal(command.state, 'accepted_by_dsh', `command failed: ${command.errorCode ?? command.state}`);
    return command;
  }, 45_000);
}
async function history(origin, account, sessionId) {
  const events = [];
  let afterSeq = -1;
  for (let page = 0; page < 20; page++) {
    const response = await json(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(response.status, 200);
    events.push(...response.body.events);
    if (!response.body.hasMore) return events;
    assert.ok(response.body.nextSeq > afterSeq);
    afterSeq = response.body.nextSeq;
  }
  throw new Error('bounded history window exceeded');
}
async function stopOwned() {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode === 0;
  const closed = new Promise((resolve) => child.once('close', resolve));
  try { child.send({ type: 'weftmate:quit' }); } catch { /* bounded fallback below */ }
  const managed = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  return child.exitCode === 0;
}
async function nativeTimeline() {
  if (!sessionId || !existsSync(join(profile, 'dsh-home', 'sessions'))) return { available: false };
  try {
    const sessionRoot = join(profile, 'dsh-home', 'sessions');
    const logs = readdirSync(sessionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(sessionRoot, entry.name, sessionId, 'session.jsonl.zstd'))
      .filter(existsSync);
    if (logs.length !== 1) return { available: false, logCount: logs.length };
    const { JsonlSessionPersistence } = await import(pathToFileURL(join(repository, 'vendor',
      'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')).href);
    const raw = await JsonlSessionPersistence.prototype.readRaw.call({
      compression: 'zstd', ensureRootEncoding: async () => {},
      findLog: async () => logs[0], readStableFile: async () => ({ buffer: readFileSync(logs[0]) }),
    }, sessionId);
    const rows = raw.content.split('\n').filter(Boolean).slice(0, 12_000).map((line) => JSON.parse(line));
    const target = rows.filter((row) => row.type === 'user/message' &&
      row.data?.source?.kind === 'user' && row.data.source.rpcId === receiptId);
    if (target.length !== 1) return { available: true, exactReceiptCount: target.length };
    const start = rows.findLast((row) => row.type === 'turn/start' && row.seq < target[0].seq);
    if (!start || !Number.isSafeInteger(start.data?.turn)) return { available: true,
      exactReceiptCount: 1, turnStartPresent: false };
    const turn = start?.data?.turn;
    const nextStart = rows.find((row) => row.type === 'turn/start' && row.seq > target[0].seq);
    const scoped = rows.filter((row) => row.seq >= start.seq &&
      (!nextStart || row.seq < nextStart.seq));
    const numericUsage = (usage) => Object.fromEntries(Object.entries(usage ?? {})
      .filter(([key, value]) => /^(inputTokens|outputTokens|totalTokens|cachedInputTokens|promptTokens|completionTokens)$/i.test(key) &&
        Number.isSafeInteger(value) && value >= 0));
    const steps = scoped.filter((row) => row.type === 'step/start' || row.type === 'step/end')
      .map((row) => ({ type: row.type, step: row.data?.step ?? null,
        at: Number.isFinite(row.time) ? new Date(row.time).toISOString() : null,
        ...(row.type === 'step/end' ? { usage: numericUsage(row.data?.usage) } : {}) }));
    const chunks = scoped.filter((row) => row.type === 'assistant/chunk' && row.data?.turn === turn);
    const end = scoped.find((row) => row.type === 'turn/end' && row.data?.turn === turn);
    const requestHeaderEfforts = scoped.filter((row) => row.type === 'request/header')
      .map((row) => row.data?.header?.config?.reasoningEffort ?? 'off');
    const tools = scoped.filter((row) => row.type === 'tool/call' &&
      /^personal_browser_(open|follow|read_segment)$|^personal_save_document$/.test(row.data?.name ?? ''))
      .map((row) => ({ name: row.data.name, step: row.data.step ?? null,
        at: Number.isFinite(row.time) ? new Date(row.time).toISOString() : null,
        hasResult: scoped.some((item) => item.type === 'tool/result' &&
          item.data?.message?.source?.callId === row.data.callId) }));
    const stepStarts = scoped.filter((row) => row.type === 'step/start');
    const firstChunk = chunks[0];
    const precedingStep = firstChunk ? stepStarts.findLast((row) => row.seq < firstChunk.seq) : null;
    return { available: true, exactReceiptCount: 1, turn, turnStartedAt: Number.isFinite(start.time)
      ? new Date(start.time).toISOString() : null, steps, tools,
    firstChunkAt: Number.isFinite(firstChunk?.time) ? new Date(firstChunk.time).toISOString() : null,
    lastChunkAt: Number.isFinite(chunks.at(-1)?.time) ? new Date(chunks.at(-1).time).toISOString() : null,
    firstChunkDelayFromStepMs: precedingStep && firstChunk ? Math.max(0, firstChunk.time - precedingStep.time) : null,
    assistantChunks: chunks.length, requestHeaderEfforts,
    textChunks: chunks.filter((row) => row.data?.chunk?.type === 'text-delta').length,
    reasoningChunks: chunks.filter((row) => row.data?.chunk?.type === 'reasoning-delta').length,
    nativeTurnEnd: end ? { reason: end.data?.reason?.kind ?? 'unknown',
      at: Number.isFinite(end.time) ? new Date(end.time).toISOString() : null } : null };
  } catch { return { available: false, readFailed: true }; }
}
function observationTimeline() {
  const directory = join(profile, 'stage14-r2-observation');
  try {
    const parse = (name) => {
      const raw = readFileSync(join(directory, name), 'utf8');
      if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('observation log exceeded bound');
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    };
    const semantic = parse('semantic.jsonl').filter((row) => row.sessionId === sessionId);
    const network = parse('network.jsonl');
    const wireRequests = network.filter((row) => row.event === 'wire-arrival' && row.kind === 'chat')
      .map((start) => ({ requestId: start.requestId, at: start.at,
        headers: network.find((row) => row.requestId === start.requestId && row.event === 'wire-headers'),
        firstByte: network.find((row) => row.requestId === start.requestId && row.event === 'wire-first-byte'),
        end: network.find((row) => row.requestId === start.requestId &&
          ['wire-end', 'wire-cancel', 'wire-error'].includes(row.event)),
        ambiguous: network.some((row) => row.requestId === start.requestId &&
          row.event === 'wire-ambiguous') }));
    const semanticAttempts = semantic.filter((row) => row.event === 'semantic-start')
      .map((start) => {
        const own = semantic.filter((row) => row.turn === start.turn && row.step === start.step &&
          row.attempt === start.attempt && row.at >= start.at);
        const terminal = own.find((row) => ['semantic-finish', 'semantic-cancel',
          'semantic-error', 'semantic-incomplete'].includes(row.event));
        return { turn: start.turn, step: start.step, attempt: start.attempt, at: start.at,
          firstChunkAt: own.find((row) => row.event === 'semantic-first-chunk')?.at ?? null,
          firstReasoningAt: own.find((row) => row.event === 'semantic-first-reasoning')?.at ?? null,
          firstTextAt: own.find((row) => row.event === 'semantic-first-text')?.at ?? null,
          firstToolAt: own.find((row) => row.event === 'semantic-first-tool')?.at ?? null,
          usage: own.filter((row) => row.event === 'semantic-usage').map((row) => ({
            inputTokens: row.inputTokens ?? null, outputTokens: row.outputTokens ?? null,
            reasoningTokens: row.reasoningTokens ?? null, cacheReadTokens: row.cacheReadTokens ?? null,
            cacheWriteTokens: row.cacheWriteTokens ?? null })),
          terminal: terminal ? { event: terminal.event, at: terminal.at,
            kind: terminal.kind ?? null } : null,
          networkCorrelation: 'unproven' };
      });
    return { available: true, semanticEventCount: semantic.length,
      networkRequestCount: wireRequests.length,
      ambiguousWireRequests: wireRequests.filter((row) => row.ambiguous).length,
      wireRequests: wireRequests.map((wire) => ({ kind: 'chat', arrivalAt: wire.at,
        headersAt: wire.headers?.at ?? null, httpStatus: wire.headers?.status ?? null,
        firstByteAt: wire.firstByte?.at ?? null, endAt: wire.end?.at ?? null,
        endKind: wire.end?.event ?? null, bytes: wire.end?.bytes ?? null,
        overlappedAnotherWireRequest: wire.ambiguous })),
      semanticAttempts };
  } catch { return { available: false }; }
}
let account, origin, sessionId, taskId, receiptId, goalAcceptedAt = null;
let result = 'failed', failure = null;
try {
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1], 90_000);
  const configured = await management(mode === 'candidate-low'
    ? 'model.configure-observed-low' : 'model.configure-observed-local');
  assert.equal(configured?.profileId, modelProfileId);
  assert.equal(configured?.observation, 'isolated');
  if (mode === 'candidate-low') assert.equal(configured?.reasoningEffort, 'low');
  await until(() => {
    const file = join(profile, 'stage14-r2-observation', 'semantic.jsonl');
    return existsSync(file) && readFileSync(file, 'utf8').includes('"observer-ready"');
  }, 15_000);
  const setup = await management('account.setup');
  assert.ok(typeof setup?.grant === 'string');
  const created = await json(origin, null, 'POST', '/personal/v1/auth/setup', {
    grant: setup.grant, ...login,
    deviceName: 'Stage 14 isolated PC',
  });
  assert.equal(created.status, 201, `account setup failed: ${created.body.error?.code ?? created.status}`);
  const signed = await json(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage 14 acceptance' });
  assert.equal(signed.status, 200, `login failed: ${signed.body.error?.code ?? signed.status}`);
  account = { cookie: signed.cookie, csrf: signed.body.csrfToken };
  assert.ok(account.cookie && account.csrf);
  const workspace = await json(origin, account, 'GET', '/personal/v1/workspaces/browser');
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.available, true, 'default public browser reader must be available');
  const createdSession = await json(origin, account, 'POST', '/personal/v1/workspaces/browser/sessions',
    { requestId: randomUUID(), modelProfileId });
  assert.equal(createdSession.status, 202, `browser session failed: ${createdSession.body.error?.code ?? createdSession.status}`);
  sessionId = (await settle(origin, account, createdSession.body.command.commandId)).sessionId;
  const goal = caseId === 'iana-short'
    ? `请用电脑实际阅读以下两份公开 IANA 官方短页：\n${documentation[0]}\n${documentation[1]}\n第一份核对example.com等示例域名为什么用于文档、能否注册或转让；第二份核对IANA对DNS、IP地址及协议标识的协调职责。只根据两份实际读取正文保存一份简短Markdown摘要，引用两个来源。若页面失败请如实报告，不要编造或打开记事本。`
    : `请用电脑实际阅读以下两份公开 Electron 官方文档：\n${documentation[0]}\n${documentation[1]}\n只核对 BrowserWindow 创建窗口并用 loadURL 加载网页、session 管理会话和代理设置这些重点。网页可能分段：打开后请实际调用 personal_browser_read_segment 读取至少一段非首段，再用实际读到的两页来源保存一份简短 Markdown 摘要。请在摘要中注明已读片段范围及未覆盖的部分，不声称读完全文。遇到登录、网络或阅读失败就如实报告，不要编造或打开记事本。`;
  const sent = await json(origin, account, 'POST', '/personal/v1/commands', {
    requestId: randomUUID(), kind: 'session.message', targetDeviceId: workspace.body.hostId,
    sessionId, mode: 'queue', text: goal,
  });
  assert.equal(sent.status, 202, `browser goal failed: ${sent.body.error?.code ?? sent.status}`);
  const task = await settle(origin, account, sent.body.command.commandId);
  taskId = task.commandId; receiptId = task.receiptId;
  goalAcceptedAt = new Date().toISOString();
  assert.ok(receiptId && task.workspaceKind === 'browser');
  const terminal = await until(async () => {
    const events = await history(origin, account, sessionId);
    const user = events.find((item) => item.type === 'user.message' && item.data?.receiptId === receiptId);
    if (!user) return null;
    const start = events.findLast((item) => item.type === 'turn.started' && item.seq < user.seq);
    return events.find((item) => item.type === 'turn.ended' && item.data?.turn === start?.data?.turn) ?? null;
  }, 240_000);
  assert.equal(terminal.data.reason, 'completed', `browser turn ended: ${terminal.data.reason}`);
  const detail = await until(async () => {
    const response = await json(origin, account, 'GET', `/personal/v1/tasks/${taskId}`);
    assert.equal(response.status, 200);
    return response.body.artifacts.some((item) => item.state === 'observed') &&
      response.body.replyEvidence?.status === 'completed' ? response.body : null;
  }, 30_000);
  assert.equal(detail.replyEvidence?.status, 'completed', 'the exact native reply must finish');
  assert.equal(detail.replyEvidence?.toolSaveObserved, true);
  assert.equal(detail.workspace.kind, 'browser');
  const cited = detail.sources.filter((source) => source.cited && source.kind === 'webpage');
  assert.ok(cited.length >= 2, 'both official pages must be cited from real browser snapshots');
  if (caseId === 'electron-api') {
    assert.ok(cited.some((source) => Number.isSafeInteger(source.segmentIndex) &&
      source.segmentIndex >= 1 && typeof source.parentSnapshotId === 'string'),
    'large-document summary must cite a later segment that was actually read');
  }
  const citedPaths = new Set(cited.map((source) => new URL(source.url).pathname));
  const expectedPaths = documentation.map((url) => new URL(url).pathname);
  for (const expectedPath of expectedPaths) assert.ok(citedPaths.has(expectedPath));
  const sourceTextByPath = new Map();
  for (const source of cited) {
    assert.equal(new URL(source.url).hostname, caseId === 'iana-short' ? 'www.iana.org' : 'www.electronjs.org');
    assert.ok(source.title && source.url && Date.parse(source.readAt) > 0);
    assert.match(source.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof source.truncated, 'boolean');
    const opened = await json(origin, account, 'GET', `/personal/v1/tasks/${taskId}/sources/${source.snapshotId}`);
    assert.equal(opened.status, 200);
    assert.equal(sha(Buffer.from(opened.body.source.text, 'utf8')), source.contentSha256);
    assert.ok(opened.body.source.text.length > 0);
    const sourcePath = new URL(source.url).pathname;
    sourceTextByPath.set(sourcePath, `${sourceTextByPath.get(sourcePath) ?? ''}\n${opened.body.source.text}`);
  }
  if (caseId === 'iana-short') {
    const examples = sourceTextByPath.get('/help/example-domains') ?? '';
    const about = sourceTextByPath.get('/about') ?? '';
    assert.match(examples, /example\.com|example\.org/i);
    assert.match(examples, /not available for registration or transfer/i);
    assert.match(about, /domain names.*IP addresses|IP addresses.*domain names/is);
    assert.match(about, /protocols/i);
  }
  assert.equal(detail.steps.length, 0, 'public docs must not trigger Notepad');
  const artifact = detail.artifacts.find((item) => item.state === 'observed');
  assert.equal(artifact.taskId, taskId);
  assert.ok(artifact.sourceSnapshotIds.length >= 2);
  for (const source of cited) assert.ok(artifact.sourceSnapshotIds.includes(source.snapshotId));
  const preview = await json(origin, account, 'GET', `/personal/v1/artifacts/${artifact.artifactId}/preview`);
  assert.equal(preview.status, 200);
  if (caseId === 'iana-short') {
    assert.match(preview.body.text, /example\.com|example\.org/i);
    assert.match(preview.body.text, /文档|示例|documentation/i);
    assert.match(preview.body.text, /不可注册|不能注册|无法注册|不供注册|not available for registration/i);
    assert.match(preview.body.text, /DNS|域名/i);
    assert.match(preview.body.text, /IP|地址/i);
    assert.match(preview.body.text, /协议|protocol/i);
  } else {
    assert.match(preview.body.text, /BrowserWindow|浏览器窗口/);
    assert.match(preview.body.text, /loadURL|加载网页|加载网址/);
    assert.match(preview.body.text, /session|会话/i);
    assert.match(preview.body.text, /proxy|代理/i);
    assert.match(preview.body.text, /片段|段落|部分|范围|segment|coverage/i,
      'large-document summary must state its source coverage');
  }
  assert.match(preview.body.text, /已读取网页来源/);
  for (const source of cited) {
    assert.ok(preview.body.text.includes(source.url));
    assert.ok(preview.body.text.includes(source.contentSha256));
  }
  assert.equal(sha(Buffer.from(preview.body.text, 'utf8')), artifact.sha256);
  const commands = await json(origin, account, 'GET', '/personal/v1/commands?limit=100');
  assert.equal(commands.status, 200);
  assert.equal(commands.body.commands.some((item) => item.kind === 'desktop.open_app'), false);
  const after = await modelState(true);
  assert.equal(JSON.stringify(after.lastSwitch ?? null), priorSwitch, 'acceptance must not switch models');
  result = 'passed';
  console.log(`[stage14-local-browser] ${caseId} completed with exact native turn and two cited pages; evidence=${runRoot}`);
} catch (error) {
  failure = { code: typeof error?.code === 'string' ? error.code : 'ACCEPTANCE_FAILED',
    name: typeof error?.name === 'string' ? error.name.slice(0, 60) : 'Error' };
  throw error;
} finally {
  let eventSummary = null, taskSummary = null, afterModel = null;
  if (origin && account && sessionId) {
    try {
      const response = await fetch(`${origin}/personal/v1/sessions/${sessionId}/events?afterSeq=-1&limit=200`,
        { headers: { cookie: account.cookie }, signal: AbortSignal.timeout(5_000) });
      if (response.status === 200) {
        const body = await response.json();
        eventSummary = { counts: Object.fromEntries([...new Set(body.events.map((item) => item.type))]
          .map((type) => [type, body.events.filter((item) => item.type === type).length])),
          turnEnds: body.events.filter((item) => item.type === 'turn.ended')
            .map((item) => ({ turn: item.data?.turn ?? null, reason: item.data?.reason ?? 'unknown' })).slice(-4),
          hasMore: body.hasMore === true };
      }
    } catch { eventSummary = { available: false }; }
  }
  if (origin && account && taskId) {
    try {
      const response = await fetch(`${origin}/personal/v1/tasks/${taskId}`,
        { headers: { cookie: account.cookie }, signal: AbortSignal.timeout(5_000) });
      if (response.status === 200) {
        const task = await response.json();
        taskSummary = { replyEvidence: task.replyEvidence ?? null,
          artifacts: (task.artifacts ?? []).map((item) => ({ state: item.state,
            artifactId: item.artifactId, sha256: item.sha256, size: item.size,
            citedSourceCount: item.sourceSnapshotIds?.length ?? 0 })),
          sources: (task.sources ?? []).map((item) => ({ kind: item.kind, url: item.url,
            cited: item.cited === true, contentSha256: item.contentSha256, truncated: item.truncated,
            segmentIndex: item.segmentIndex ?? null, segmentCount: item.segmentCount ?? null,
            byteStart: item.byteStart ?? null, byteEnd: item.byteEnd ?? null })) };
      }
    } catch { taskSummary = { available: false }; }
  }
  const clean = await stopOwned();
  const physical = await nativeTimeline();
  const modelObservation = observationTimeline();
  if (mode === 'candidate-low' && physical.available &&
      physical.exactReceiptCount === 1 && !physical.requestHeaderEfforts?.includes('low')) {
    result = 'failed'; failure = { code: 'LOW_HEADER_UNCONFIRMED', name: 'Error' };
  }
  if (result === 'passed' && (!modelObservation.available ||
      modelObservation.semanticAttempts.length < 1 || modelObservation.networkRequestCount < 1)) {
    result = 'failed'; failure = { code: 'OBSERVATION_UNAVAILABLE', name: 'Error' };
  }
  try {
    const response = await fetch('http://127.0.0.1:8081/switch/status', {
      headers: { authorization: `Bearer ${switcherKey}` }, signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 200) {
      const state = await response.json();
      afterModel = { currentModelId: state.currentModelId, switching: state.switching,
        healthy: state.probe?.health, activeLeases: state.activeLeases,
        queuedLeases: state.queuedLeases,
        sameLastSwitch: JSON.stringify(state.lastSwitch ?? null) === priorSwitch };
    }
  } catch { afterModel = { available: false }; }
  writeFileSync(join(runRoot, 'sanitized-evidence.json'), `${JSON.stringify({
    result, mode, caseId, at: new Date().toISOString(), runRoot, profile,
    documentation, goalAcceptedAt, wallTimeBudgetMs: 300_000, turnBudgetMs: 240_000,
    sessionId: sessionId ?? null,
    taskId: taskId ?? null, receiptPresent: Boolean(receiptId), expectedModel,
    hostCleanExit: clean, eventSummary, taskSummary, physical, modelObservation, afterModel, failure,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (!clean) throw new Error('isolated host did not finish managed shutdown; profile retained');
  if (failure?.code === 'OBSERVATION_UNAVAILABLE') throw new Error('isolated observation was unavailable');
  if (failure?.code === 'LOW_HEADER_UNCONFIRMED') throw new Error('native low request header was not observed');
}
