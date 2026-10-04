/** Opt-in fixed DSH capture/segment/save proof with one owned synthetic rendered page. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform !== 'win32' || process.env.WEFTMATE_SYNTHETIC_BROWSER_SEGMENT_E2E !== '1') {
  throw new Error('Set WEFTMATE_SYNTHETIC_BROWSER_SEGMENT_E2E=1 on Windows for this isolated fixture.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const phoneServe = false;
const mobileUiDir = process.env.WEFTMATE_STAGE11_MOBILE_UI_DIR;
const androidApk = process.env.WEFTMATE_STAGE11_ANDROID_APK;
const publicOrigin = process.env.WEFTMATE_STAGE11_PUBLIC_ORIGIN;
if (phoneServe && (!mobileUiDir || !androidApk || !isAbsolute(mobileUiDir) ||
    !isAbsolute(androidApk) || basename(androidApk).toLowerCase() !== 'android-candidate.apk')) {
  throw new Error('Phone serve needs absolute versioned mobile UI and android-candidate.apk paths.');
}
if (phoneServe) { realpathSync(mobileUiDir); realpathSync(androidApk); }
if (phoneServe && publicOrigin) {
  const url = new URL(publicOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || url.origin !== publicOrigin) throw new Error('Invalid phone public origin.');
}
const electron = createRequire(import.meta.url)('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage11-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }), { flag: 'wx', mode: 0o600 });
const login = { username: 'Stage14SyntheticOwner', password: `synthetic-${randomUUID()}-password` };
const loginFile = join(profile, 'stage14-login.json');
writeFileSync(loginFile, `${JSON.stringify(login)}\n`, { flag: 'wx', mode: 0o600 });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const stallFinal = process.env.WEFTMATE_SEGMENT_STALL_FINAL === '1';
const heldResponses = new Set();
let summaryCalls = 0, pageReads = 0;
const observedTools = [];
let pagePort = null;
const segmentFact = 'SEGMENT_TWO_FACT_7A14: the second section is actually read.';
const longText = `${'A'.repeat(9_500)} ${segmentFact} ${'B'.repeat(2_000)}`;
const pageServer = createServer((request, response) => {
  const head = '<!doctype html><meta charset="utf-8"><main><h1 id="content"></h1>';
  if (request.method === 'GET' && request.url === '/page-a') {
    pageReads++;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`${head}<a id="next" href="http://page-b.weftmate.invalid:${pagePort}/page-b">继续阅读第二页</a></main>
      <script>document.title='合成分段网页';document.querySelector('#content').textContent=${JSON.stringify(longText)};</script>`);
  } else if (request.method === 'GET' && request.url === '/page-b') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`${head}合成网页乙：第二项事实来自页内已观察链接。</main><title>合成网页乙</title>`);
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
pagePort = pageServer.address().port;
assert.ok(!new Set([18186, 18188, 443, 8443, 8080, 8081]).has(pagePort));
const pageA = `http://page-a.weftmate.invalid:${pagePort}/page-a`;
const pageB = `http://page-b.weftmate.invalid:${pagePort}/page-b`;
function sse(response, model, name, args) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const choice = name ? { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0,
    id: `call-${randomUUID()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    finish_reason: null } : { index: 0, delta: { role: 'assistant', content: '合成任务已处理。' }, finish_reason: null };
  const frame = (value) => response.write(`data: ${JSON.stringify({ id: 'synthetic-browser',
    object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [value] })}\n\n`);
  frame(choice);
  frame({ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' });
  response.end('data: [DONE]\n\n');
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
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 256 * 1024) { response.destroy(); return; }
  }
  const body = JSON.parse(raw);
  assert.equal(body.model, 'synthetic-stop-model');
  // DSH's title generation uses the same route, but has no browser tool roster.
  if (!JSON.stringify(body.tools ?? []).includes('personal_browser_open')) {
    sse(response, body.model, null);
    return;
  }
  summaryCalls++;
  if (summaryCalls === 1) {
    observedTools.push('personal_browser_open');
    sse(response, body.model, 'personal_browser_open', { url: pageA });
  } else if (summaryCalls === 2) {
    const messages = JSON.stringify(body.messages);
    const snapshotId = /source-[a-f0-9]{48}/.exec(messages)?.[0];
    if (!snapshotId) { response.writeHead(500); response.end(); return; }
    observedTools.push('personal_browser_read_segment');
    sse(response, body.model, 'personal_browser_read_segment', { snapshotId, segmentIndex: 1 });
  } else if (summaryCalls === 3) {
    const sourceIds = [...new Set([...JSON.stringify(body.messages).matchAll(/source-[a-f0-9]{48}/g)]
      .map((match) => match[0]))];
    if (sourceIds.length < 2) { response.writeHead(500); response.end(); return; }
    observedTools.push('personal_save_document');
    sse(response, body.model, 'personal_save_document', { fileName: '合成分段摘要.md',
      content: `# 已读第二段\n${segmentFact}\n`, sourceSnapshotIds: [sourceIds.at(-1)] });
  } else if (stallFinal) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(`data: ${JSON.stringify({ id: 'synthetic-stalled-final',
      object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '仅有尚未完成的流式片段' },
        finish_reason: null }] })}\n\n`);
    heldResponses.add(response);
    response.once('close', () => heldResponses.delete(response));
  } else sse(response, body.model, null);
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [];
function startHost() {
  const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host',
    `--access-port=${phoneServe ? '18188' : '0'}`,
    ...(phoneServe ? [`--mobile-ui-dir=${mobileUiDir}`, `--android-package-path=${androidApk}`] : []),
    ...(phoneServe && publicOrigin ? [`--public-origin=${publicOrigin}`, '--trust-loopback-proxy'] : [])], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
      WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', WEFTMATE_SYNTHETIC_BROWSER_PORT: String(pagePort) },
  });
  children.push(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-64 * 1024);
  });
  return { child, output: () => output };
}
async function until(host, check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await check();
    if (found) return found;
    if (host.child.exitCode !== null || host.child.signalCode !== null) throw new Error('isolated host exited');
    await pause(100);
  }
  throw new Error('isolated browser fixture timed out');
}
function manage(host, action, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { host.child.off('message', listener); reject(new Error('management timeout')); }, 45_000);
    const listener = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      host.child.off('message', listener); clearTimeout(timer);
      if (frame.ok === true) resolve(frame.result);
      else reject(new Error(`management ${action} failed: ${frame.code}`));
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function submit(host, origin, account, path, body) {
  const sent = await json(origin, account, 'POST', path, body);
  assert.equal(sent.status, 202, `submit failed: ${sent.body.error?.code ?? sent.status}`);
  const commandId = sent.body.command.commandId;
  return until(host, async () => {
    const read = await json(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(read.status, 200);
    if (['pending', 'dispatching'].includes(read.body.command.state)) return null;
    assert.equal(read.body.command.state, 'accepted_by_dsh');
    return read.body.command;
  }, 45_000);
}
async function history(origin, account, sessionId) {
  const events = [];
  let afterSeq = -1;
  for (let page = 0; page < 12; page++) {
    const read = await json(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(read.status, 200);
    events.push(...read.body.events);
    if (!read.body.hasMore) return events;
    assert.ok(read.body.nextSeq > afterSeq);
    afterSeq = read.body.nextSeq;
  }
  throw new Error('browser fixture history limit reached');
}
async function stopOwned(host) {
  const child = host.child;
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode === 0;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.send({ type: 'weftmate:quit' });
  const managed = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  return child.exitCode === 0;
}
let host = startHost();
let completed = false;
async function waitForPhoneStop() {
  const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  await new Promise((resolve) => {
    const done = () => { process.off('SIGINT', done); process.off('SIGTERM', done); input.close(); resolve(); };
    process.once('SIGINT', done); process.once('SIGTERM', done);
    input.on('line', (line) => { if (line.trim().toLowerCase() === 'q') done(); });
  });
}
try {
  let origin = await until(host, () => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(host.output())?.[1]);
  const configured = await manage(host, 'model.configure-synthetic-stop-fixture',
    { baseUrl: `http://127.0.0.1:${modelPort}/v1` });
  assert.equal(configured.id, 'synthetic-stop-fixture');
  const grant = await manage(host, 'account.setup');
  const created = await json(origin, null, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, ...login, deviceName: 'Stage 14 segment fixture' });
  assert.equal(created.status, 201);
  let account = { cookie: created.cookie, csrf: created.body.csrfToken };
  assert.ok(account.cookie && account.csrf);
  if (phoneServe) {
    const ready = await json(origin, account, 'GET', '/personal/v1/workspaces/browser');
    assert.equal(ready.status, 200);
    assert.equal(ready.body.available, true);
    console.log(`[stage11-phone-serve] backend=ready origin=${origin} profile=${profile} loginFile=${loginFile} pageA=${pageA}`);
    completed = true;
    await waitForPhoneStop();
  } else {
  const workspace = await json(origin, account, 'GET', '/personal/v1/workspaces/browser');
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.available, true);
  const browserSession = await submit(host, origin, account,
    '/personal/v1/workspaces/browser/sessions',
    { requestId: randomUUID(), modelProfileId: 'synthetic-stop-fixture' });
  assert.equal(browserSession.workspaceKind, 'browser');
  const task = await submit(host, origin, account, '/personal/v1/commands', {
    requestId: randomUUID(), kind: 'session.message', targetDeviceId: workspace.body.hostId,
    sessionId: browserSession.sessionId, mode: 'queue',
    text: `阅读网页已冻结捕获的第二段，仅引用你实际读取的第二段来源，保存事实摘要并简短确认。\n网页链接：\n${pageA}` });
  const detail = await until(host, async () => {
    const read = await json(origin, account, 'GET', `/personal/v1/tasks/${task.commandId}`);
    assert.equal(read.status, 200);
    return read.body.artifacts.some((item) => item.state === 'observed') &&
      read.body.sources.some((item) => item.kind === 'webpage' && item.cited &&
        item.segmentIndex === 1) ? read.body : null;
  }, 90_000);
  assert.deepEqual(observedTools.slice(0, 3), ['personal_browser_open',
    'personal_browser_read_segment', 'personal_save_document']);
  assert.equal(observedTools.some((item) => item.includes('personal_open_notepad')), false);
  const artifact = detail.artifacts.find((item) => item.state === 'observed');
  const sources = detail.sources.filter((item) => item.kind === 'webpage' && item.cited);
  assert.ok(artifact && sources.length === 1);
  assert.equal(sources[0].url, pageA);
  assert.equal(sources[0].segmentIndex, 1);
  assert.equal(pageReads, 1, 'later segment comes from frozen capture, not a second browser navigation');
  for (const source of sources) {
    const read = await json(origin, account, 'GET',
      `/personal/v1/tasks/${task.commandId}/sources/${source.snapshotId}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.source.kind, 'webpage');
    assert.equal(read.body.source.contentSha256, source.contentSha256);
    assert.equal(hash(read.body.source.text), source.contentSha256);
    assert.match(read.body.source.text, /SEGMENT_TWO_FACT_7A14/);
  }
  const preview = await json(origin, account, 'GET',
    `/personal/v1/artifacts/${artifact.artifactId}/preview`);
  assert.equal(preview.status, 200);
  assert.match(preview.body.text, /已读取网页来源/);
  assert.match(preview.body.text, /SEGMENT_TWO_FACT_7A14/);
  const downloaded = await fetch(`${origin}/personal/v1/artifacts/${artifact.artifactId}/download`,
    { headers: { cookie: account.cookie } });
  assert.equal(downloaded.status, 200);
  assert.equal(hash(Buffer.from(await downloaded.arrayBuffer())), artifact.sha256);
  const other = await json(origin, null, 'POST', '/personal/v1/auth/register',
    { username: 'Stage11Other', password: `synthetic-${randomUUID()}-password`, deviceName: 'Other fixture' });
  assert.equal(other.status, 201);
  const otherAccount = { cookie: other.cookie, csrf: other.body.csrfToken };
  const otherWorkspace = await json(origin, otherAccount, 'GET', '/personal/v1/workspaces/browser');
  assert.equal(otherWorkspace.status, 200);
  assert.equal(otherWorkspace.body.available, false);
  assert.equal((await json(origin, otherAccount, 'GET',
    `/personal/v1/tasks/${task.commandId}/sources/${sources[0].snapshotId}`)).status, 404);
  assert.equal((await json(origin, otherAccount, 'GET',
    `/personal/v1/artifacts/${artifact.artifactId}/preview`)).status, 404);
  const terminal = await until(host, async () => {
    const current = await json(origin, account, 'GET', `/personal/v1/tasks/${task.commandId}`);
    return current.body.replyEvidence?.status === (stallFinal ? 'streaming' : 'completed')
      ? current.body.replyEvidence : null;
  }, 60_000);
  assert.equal(terminal.status, stallFinal ? 'streaming' : 'completed');
  assert.equal(terminal.toolSaveObserved, true);
  assert.equal(await stopOwned(host), true);
  const sessionRoot = join(profile, 'dsh-home', 'sessions');
  const logs = readdirSync(sessionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sessionRoot, entry.name, browserSession.sessionId, 'session.jsonl.zstd'))
    .filter(existsSync);
  assert.equal(logs.length, 1);
  const { JsonlSessionPersistence } = await import(pathToFileURL(join(repository, 'vendor',
    'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')).href);
  const physical = await JsonlSessionPersistence.prototype.readRaw.call({
    compression: 'zstd', ensureRootEncoding: async () => {},
    findLog: async () => logs[0], readStableFile: async () => ({ buffer: readFileSync(logs[0]) }),
  }, browserSession.sessionId);
  const rows = physical.content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const fixedHints = rows.filter((row) => row.type === 'user/message' &&
    row.data?.source?.kind === 'plugin' &&
    row.data.source.plugin === 'weftmate-personal-reply-evidence');
  assert.equal(fixedHints.length, 1, 'the observed save adds one fixed plugin reminder, not a second user request');
  assert.equal(rows.filter((row) => row.type === 'user/message' &&
    row.data?.source?.kind === 'user').length, 1);
  const calls = rows.filter((row) => row.type === 'tool/call' &&
    ['personal_browser_open', 'personal_browser_read_segment', 'personal_save_document'].includes(row.data?.name));
  assert.deepEqual(calls.map((row) => row.data.name), observedTools.slice(0, 3));
  for (const call of calls) {
    const result = rows.find((row) => row.type === 'tool/result' &&
      row.data?.message?.source?.callId === call.data.callId);
    assert.ok(result && result.seq > call.seq, 'each exact native tool result is persisted after its call');
  }
  assert.ok(calls[0].seq < calls[1].seq && calls[1].seq < calls[2].seq);
  assert.equal(rows.some((row) => row.type === 'turn/end' &&
    row.data?.reason?.kind === 'completed'), !stallFinal);
  host = startHost();
  origin = await until(host, () => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(host.output())?.[1]);
  const signed = await json(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage 14 restart' });
  assert.equal(signed.status, 200);
  account = { cookie: signed.cookie, csrf: signed.body.csrfToken };
  const recovered = await json(origin, account, 'GET', `/personal/v1/tasks/${task.commandId}`);
  assert.equal(recovered.status, 200);
  assert.ok(sources.every((source) => recovered.body.sources.some((item) => item.snapshotId === source.snapshotId && item.cited)));
  assert.ok(recovered.body.artifacts.some((item) => item.artifactId === artifact.artifactId && item.state === 'observed'));
  if (stallFinal) assert.notEqual(recovered.body.replyEvidence?.status, 'completed');
  for (const source of sources) assert.equal((await json(origin, account, 'GET',
    `/personal/v1/tasks/${task.commandId}/sources/${source.snapshotId}`)).status, 200);
  assert.equal((await json(origin, account, 'GET',
    `/personal/v1/artifacts/${artifact.artifactId}/preview`)).status, 200);
  console.log(`[stage14-synthetic-segment] backend=passed mode=${stallFinal ? 'open-stream' : 'completed'} profile=${profile} loginFile=${loginFile} pageA=${pageA}`);
  completed = true;
  }
} finally {
  try { for (const owned of children) if (owned.exitCode === null && owned.signalCode === null) await stopOwned({ child: owned }); }
  finally {
    for (const response of heldResponses) response.destroy();
    await new Promise((resolve) => modelServer.close(resolve));
    await new Promise((resolve) => pageServer.close(resolve));
    if (completed && !phoneServe && process.env.WEFTMATE_STAGE11_RETAIN_FIXTURE !== '1' &&
        children.every((owned) => owned.exitCode !== null || owned.signalCode !== null) &&
        realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true });
  }
}
