/** Opt-in Stage 11 acceptance against the already-loaded local model and public Electron docs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUserModelSwitcherKey } from '../../src/local-model-config.mjs';
import { ensurePrivateFile } from '../../src/private-host-storage.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_BROWSER_SUMMARY_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_BROWSER_SUMMARY_E2E=1 on Windows for one isolated public-docs goal.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const acceptanceRoot = join(repository, '..', 'Runtime', 'UnifiedAssistant', 'Stage11Acceptance-20261003');
const expectedModel = 'qwen3.8-27b';
const modelProfileId = `personal-local-${expectedModel}`;
const caseId = process.env.WEFTMATE_REAL_BROWSER_CASE ?? 'electron-api';
if (!['electron-api', 'iana-short'].includes(caseId)) throw new Error('Unknown bounded browser acceptance case.');
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
const runRoot = join(acceptanceRoot, `local-browser-${caseId}-${Date.now()}-${randomUUID()}`);
mkdirSync(runRoot);
assert.ok(realpathSync(runRoot).startsWith(realpathSync(acceptanceRoot) + sep));
const profile = join(runRoot, 'profile');
const loginFile = join(runRoot, 'stage11-local-login.json');
const login = { username: 'Stage11LocalOwner', password: randomBytes(24).toString('base64url') };
writeFileSync(loginFile, `${JSON.stringify(login)}\n`, { flag: 'wx', mode: 0o600 });
await ensurePrivateFile(loginFile);
const launcher = join(repository, 'scripts', 'run-personal-host.mjs');
const child = spawn(process.execPath, [launcher, '--user-data-dir', profile, '--access-port', '0'], {
  cwd: repository, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
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
async function management(command, pattern, cap = 45_000) {
  const start = output.length;
  child.stdin.write(`${JSON.stringify(command)}\n`);
  return until(() => pattern.exec(output.slice(start)), cap);
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
  try { child.stdin.write('q\n'); child.stdin.end(); } catch { /* bounded fallback below */ }
  const managed = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  return child.exitCode === 0;
}
let account, origin, sessionId, taskId, receiptId;
let result = 'failed', failure = null;
try {
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1], 90_000);
  await management({ action: 'model.configure-local', modelId: expectedModel },
    /modelId=qwen3\.8-27b profileId=personal-local-qwen3\.8-27b verification=catalog_only inferenceVerified=false/);
  const setup = await management({ action: 'account.setup' }, /setupLinkFile=([^\s]+) expiresAt=/);
  const setupUrl = new URL(JSON.parse(readFileSync(setup[1], 'utf8')).url);
  const created = await json(origin, null, 'POST', '/personal/v1/auth/setup', {
    grant: decodeURIComponent(setupUrl.hash.slice('#setup='.length)), ...login,
    deviceName: 'Stage 11 isolated PC',
  });
  assert.equal(created.status, 201, `account setup failed: ${created.body.error?.code ?? created.status}`);
  const signed = await json(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage 11 acceptance' });
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
    : `请用电脑实际阅读这两份公开的 Electron 官方文档：${documentation[0]} 和 ${documentation[1]}。分别确认 BrowserWindow 如何创建窗口并加载网页，以及 session 如何管理临时/持久会话与代理设置。只根据实际读取的页面保存一份简短 Markdown 摘要，引用两份页面来源。遇到登录、网络或阅读失败就如实报告，不要编造、不要打开记事本。`;
  const sent = await json(origin, account, 'POST', '/personal/v1/commands', {
    requestId: randomUUID(), kind: 'session.message', targetDeviceId: workspace.body.hostId,
    sessionId, mode: 'queue', text: goal,
  });
  assert.equal(sent.status, 202, `browser goal failed: ${sent.body.error?.code ?? sent.status}`);
  const task = await settle(origin, account, sent.body.command.commandId);
  taskId = task.commandId; receiptId = task.receiptId;
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
    return response.body.artifacts.some((item) => item.state === 'observed') ? response.body : null;
  }, 30_000);
  assert.equal(detail.workspace.kind, 'browser');
  const cited = detail.sources.filter((source) => source.cited && source.kind === 'webpage');
  assert.ok(cited.length >= 2, 'both official pages must be cited from real browser snapshots');
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
    sourceTextByPath.set(new URL(source.url).pathname, opened.body.source.text);
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
  console.log(`[stage11-local-browser] ${caseId} completed with two public cited pages; evidence=${runRoot}`);
} catch (error) {
  failure = { code: typeof error?.code === 'string' ? error.code : 'ACCEPTANCE_FAILED',
    message: String(error?.message ?? 'failed').slice(0, 200) };
  throw error;
} finally {
  let eventSummary = null, taskSummary = null;
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
        taskSummary = { artifactStates: (task.artifacts ?? []).map((item) => item.state),
          sources: (task.sources ?? []).map((item) => ({ kind: item.kind, url: item.url,
            cited: item.cited === true, contentSha256: item.contentSha256, truncated: item.truncated })) };
      }
    } catch { taskSummary = { available: false }; }
  }
  const clean = await stopOwned();
  writeFileSync(join(runRoot, 'sanitized-evidence.json'), `${JSON.stringify({
    result, caseId, at: new Date().toISOString(), runRoot, profile, sessionId: sessionId ?? null,
    taskId: taskId ?? null, receiptPresent: Boolean(receiptId), expectedModel,
    hostCleanExit: clean, eventSummary, taskSummary, failure,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (!clean) throw new Error('isolated host did not finish managed shutdown; profile retained');
}
