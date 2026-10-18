// Isolated production desktop + native DSH + MiMo. No daily profile or OS UI.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, unlink, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { phoneRuntime } from '../../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { cleanupOwnedProcesses, redactEvidenceText } from '../helpers/process-evidence.mjs';
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });

const repository = resolve(import.meta.dirname, '../..');
const out = process.env.WEFTMATE_EVIDENCE_DIR;
if (!out || !process.env.MIMO_API_KEY) throw Error('Set WEFTMATE_EVIDENCE_DIR and MIMO_API_KEY in this process.');
const root = await mkdtemp(join(tmpdir(), 'weftmate-r-w4-')), startedAt = Date.now();
await mkdir(out, { recursive: true });
const report = { realElectron: true, realDsh: true, realModel: 'mimo-v2.6-flash', hidden: true,
  systemBarsVerified: false, scenarios: [], screenshots: [], requests: [] };
const textOf = m => typeof m.content === 'string' ? m.content : (m.content ?? []).map(p => p.text ?? '').join('');
let host, runtime, app, proxy, lock, lease, page, api, stage = 'setup', forceRelay = false;
const logs = [];
const abort = new AbortController();
const deadline = setTimeout(() => abort.abort(Error('W4 overall timeout')), 8 * 60 * 1000);
const until = async (read, label, timeout = 90000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { abort.signal.throwIfAborted(); const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Timed out: ' + label);
};
const hash = value => createHash('sha256').update(value).digest('hex');
async function capture(name) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const file = `${name}-${theme}.png`;
    await page.screenshot({ path: join(out, file) }); report.screenshots.push(file);
  }
}
async function removeLinks(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if ((await lstat(file)).isSymbolicLink()) await unlink(file);
    else if (item.isDirectory()) await removeLinks(file);
  }
}
async function snapshot(directory) {
  const files = {};
  async function visit(dir) { for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) await visit(file); else files[relative(directory, file).replaceAll('\\', '/')] = hash(await readFile(file));
  } }
  await visit(directory); return files;
}
try {
  for (const n of [1, 2, 3]) {
    const candidate = resolve(out, '../../../locks', `heavy-${n}.lock`);
    try { const handle = await open(candidate, 'wx'); lease = `R-W4 ${new Date().toISOString()} Electron/MiMo`; await handle.writeFile(lease); await handle.close(); lock = candidate; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!lock) throw Error('All heavy slots occupied');
  // Record the actual provider request, never credentials. The transport alone
  // is proxied; native tools, queue, compaction, prompts and approvals are real.
  proxy = createServer(async (req, res) => {
    res.on('error', () => {});
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const record = { stage, messages: body.messages.map(m => ({ role: m.role, text: textOf(m),
        ...(m.tool_calls ? { toolCalls: m.tool_calls.map(c => c.function.name) } : {}) })), tools: body.tools?.map(t => t.function.name) };
      report.requests.push(record);
      const controller = new AbortController(); res.on('close', () => controller.abort());
      const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MIMO_API_KEY}` },
        body: raw, signal: AbortSignal.any([abort.signal, controller.signal, AbortSignal.timeout(90000)]),
      });
      record.status = response.status;
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json' });
      for await (const chunk of response.body) if (!res.destroyed) res.write(chunk);
      res.end();
    } catch (error) {
      if (!res.destroyed && !res.headersSent) res.writeHead(502).end(JSON.stringify({ error: { message: 'Synthetic test transport ended' } }));
      else res.destroy();
    }
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  runtime = await phoneRuntime(root, logs, { baseUrl: `http://127.0.0.1:${proxy.address().port}/v1`, modelId: 'mimo-v2.6-flash', apiKey: 'proxy-only', nativeTaskStop: true });
  const relayState = runtime.backend.chatRelayState;
  runtime.backend.chatRelayState = async input => { const state = await relayState(input); return forceRelay ? { ...state, pending: true } : state; };
  const install = runtime.backend.installChatHandoff;
  runtime.backend.installChatHandoff = async input => { const result = await install(input); forceRelay = false; return result; };
  host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend, uiHandler: servePersonalAccessUi });
  runtime.setHost(host); await runtime.start();
  // A small retained tail makes real native compaction testable without filling
  // the model context. Only this generated fixture configuration is changed.
  const presetPath = join(root, 'dsh-home', '.agent-presets', 'personal-remote', 'agent.cordis.yml');
  const preset = await readFile(presetPath, 'utf8');
  assert.ok(preset.includes('retainRatio: 0.16'));
  // Preserve native !!js conditions and every other generated byte.
  await writeFile(presetPath, preset.replace('retainRatio: 0.16', 'retainTokens: 20'));
  report.compactionFixture = 'native compactNow; retainTokens=20; pending flag forced once after queue completed';
  const started = await host.start(), grant = await host.issueSetupGrant();
  const setup = await fetch(started.origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'SyntheticW4', password: 'Synthetic W4 password', deviceName: 'synthetic-desktop' }) });
  assert.equal(setup.status, 201); const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0];
  api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(started.origin + '/personal/v1' + path, { method, headers: { origin: started.origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
    const value = await res.json(); assert.ok(res.ok, JSON.stringify({ path, status: res.status, error: value.error })); return value;
  };
  await api('/settings/models', { defaultModelProfileId: 'synthetic' }, 'PATCH');
  await api('/onboarding', { step: 'first', completed: true }, 'PATCH');
  const env = { ...process.env, REVIEW_PROFILE: join(root, 'desktop-profile'), REVIEW_ORIGIN: started.origin,
    REVIEW_LIBRARY_TOKEN: host.libraryDesktopToken, REVIEW_THEME: 'light', REVIEW_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_API_KEY;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository, timeout: 30000,
    args: ['scripts/review-gallery/electron.mjs', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(90000);
  await page.addInitScript(() => { let module; Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => module, set: value => {
    module = value; const create = value.create; value.create = (...args) => { globalThis.w4Core = create(...args); return globalThis.w4Core; }; } }); });
  await page.context().addCookies([{ name: 'wm_personal_session', value: cookie.slice(cookie.indexOf('=') + 1), url: started.origin }]);
  await page.goto(started.origin + '/personal/v1/ui/'); await page.waitForFunction(() => globalThis.w4Core?.state.personalCapabilities?.workAndChat === 1);
  const events = async id => { const page = await api(`/sessions/${id}/events?limit=200`); return [...page.events, ...(page.liveEvents ?? [])]; };
  const command = async body => {
    const submitted = (await api('/commands', { requestId: randomUUID(), targetDeviceId: started.hostId, ...body })).command;
    return until(async () => { const c = (await api('/commands/' + submitted.commandId)).command;
      if (c.state === 'rejected') throw Error(c.errorCode); if (c.state === 'accepted_by_dsh') report.lastSessionId = c.sessionId;
      return c.state === 'accepted_by_dsh' && c; }, 'command accepted');
  };
  for (const scenario of (process.env.WEFTMATE_W4_SCENARIOS || '431,363').split(',')) {
    stage = scenario;
    console.log(`W4 ${scenario}: starting`);
    const folder = join(root, 'Synthetic' + scenario); await mkdir(folder);
    const originals = { 'note.txt': 'W4 synthetic text\n', 'data.csv': 'name,value\na,1\n', 'readme.md': '# Synthetic W4\n' };
    for (const [name, body] of Object.entries(originals)) await writeFile(join(folder, name), body);
    const project = (await api('/projects', { requestId: randomUUID(), name: '合成文件夹' + scenario, rootPath: folder, permission: 'write' })).project;
    let before;
    if (scenario === '431') {
      await page.evaluate(async () => { await w4Core.refreshLogicalSessions(); await w4Core.selectMainChat(); });
      const chatId = (await api('/chats/main')).chat.chatId;
      const long = await command({ kind: 'chat.message', chatId, modelProfileId: 'synthetic', text: '只用纯文字回答，不用工具，不要列任务计划：请写一篇6000字的合成科普文章，主题是光合作用。直接开始正文。\n合成背景材料：\n' + '合成记录：植物在光照下利用水和二氧化碳形成有机物。\n'.repeat(60) });
      await page.evaluate(async () => { await w4Core.refreshLogicalSessions(); await w4Core.selectMainChat(); });
      await until(async () => (await events(long.sessionId)).some(e => e.type === 'assistant.delta' && e.data.streaming === true && e.data.text.length > 200), 'long reply streaming');
      console.log('W4 431: live long reply observed');
      const queued = await command({ kind: 'chat.message', chatId, text: 'G7-C3-QUEUE：排队后只回复“排队保留”。', intent: 'queue' });
      console.log('W4 431: queued request accepted');
      await api(`/tasks/${long.commandId}/stop`, { requestId: randomUUID() });
      await until(async () => (await events(long.sessionId)).some(e => e.type === 'turn.ended' && e.data.reason === 'aborted'), 'long reply aborted');
      console.log('W4 431: native aborted observed');
      await until(async () => (await events(queued.sessionId)).some(e => e.type === 'assistant.message' && e.data.text.trim() === '排队保留'), 'queued reply');
      console.log('W4 431: queued reply completed');
      await until(async () => (await relayState({ sessionId: long.sessionId, ownerId: auth.account.ownerId })).safe, 'idle queue drained');
      before = { chatId, sessionId: long.sessionId }; forceRelay = true;
    } else { await page.evaluate(() => w4Core.startNewConversation()); }
    const request = scenario === '431'
      ? 'G7-W3：请帮我把一个合成文件夹里的文件按扩展名分别放入子文件夹。需要先切换到工作并由我选择文件夹，只动选定的合成目录，不处理其他位置。'
      : '请把我接下来选择的合成文件夹中的文件，按扩展名分别放入同名子文件夹，保留文件名和内容，只动选定的目录。';
    await page.locator('#message-text').fill(request); await page.locator('#send-message').click();
    console.log(`W4 ${scenario}: file request sent`);
    const region = page.getByRole('region', { name: '切换到工作', exact: true }); await region.waitFor();
    const identity = await page.evaluate(() => ({ sessionId: w4Core.state.selectedSessionId, chatId: w4Core.state.selectedChatId }));
    report.lastSessionId = identity.sessionId;
    if (before) { assert.equal(identity.chatId, before.chatId); assert.notEqual(identity.sessionId, before.sessionId); }
    assert.deepEqual(await snapshot(folder), Object.fromEntries(Object.entries(originals).map(([name, body]) => [name, hash(body)])));
    await capture(scenario + '-switch-card');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await region.getByRole('button', { name: '选择文件夹…', exact: true }).click();
    await until(() => page.evaluate(() => !w4Core.state.workProjectSelecting), 'folder chosen');
    await region.getByRole('button', { name: '切换到工作', exact: true }).click();
    await until(() => page.evaluate(() => w4Core.currentConversationMode() === 'work'), 'work mode');
    await until(async () => {
      const approvals = (await api(`/sessions/${identity.sessionId}/approvals`)).approvals;
      for (const card of approvals.filter(a => a.status === 'pending')) {
        assert.notEqual(card.intent, 'work-switch');
        await api(`/sessions/${identity.sessionId}/approvals/${card.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once' });
      }
      const files = await snapshot(folder);
      return Object.entries(originals).every(([name, body]) => files[`${name.split('.').at(-1)}/${name}`] === hash(body));
    }, 'three files sorted', 150000);
    const finalFiles = await snapshot(folder);
    assert.deepEqual(Object.keys(finalFiles).sort(), ['csv/data.csv', 'md/readme.md', 'txt/note.txt']);
    assert.equal(await page.evaluate(() => w4Core.state.selectedSessionId), identity.sessionId);
    await until(async () => (await events(identity.sessionId)).some(e => e.type === 'turn.ended'), 'task completed');
    const history = await events(identity.sessionId);
    assert.equal(history.filter(e => e.type === 'user.message' && e.data.text === request).length, 1);
    await capture(scenario + '-completed');
    report.scenarios.push({ issue: scenario, passed: true, sameChat: true, sessionChanged: !!before, files: finalFiles, projectId: project.projectId,
      toolCalls: history.filter(e => e.type === 'step.started').map(e => e.data.toolName), turns: history.filter(e => e.type === 'turn.ended').map(e => e.data.reason) });
    console.log(`W4 ${scenario}: card, folder choice, same conversation, 3/3 files sorted`);
  }
} catch (error) {
  report.failure = { stage, message: redactEvidenceText(error.message, [root]) };
  if (api && report.lastSessionId) report.failure.events = await api(`/sessions/${report.lastSessionId}/events?limit=200`).catch(() => null);
  if (page) { await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    report.failure.state = await page.evaluate(() => ({ text: document.getElementById('transcript')?.innerText,
      session: globalThis.w4Core?.state.selectedSessionId, operation: document.getElementById('operation-status')?.innerText })).catch(() => null); }
  process.exitCode = 1; console.error(`W4 failed at ${stage}: ${error.message}`);
} finally {
  clearTimeout(deadline); abort.abort();
  await Promise.allSettled([app?.close(), runtime?.close()]); await host?.close();
  if (proxy) await new Promise(r => { proxy.close(r); proxy.closeAllConnections(); });
  report.cleanup = cleanupOwnedProcesses({ startedAt, executables: [process.execPath, createRequire(import.meta.url)('electron')], commandRoots: [root] });
  report.logs = logs.filter(line => /error|fail/i.test(line)).slice(-8).map(line => redactEvidenceText(line, [root]));
  await writeFile(join(out, 'real-electron-report.json'), JSON.stringify(report, (_key, value) => typeof value === 'string' ? value.replaceAll(root, '%FIXTURE%') : value, 2));
  if (lock && await readFile(lock, 'utf8').catch(() => null) === lease) await unlink(lock);
  const rel = relative(tmpdir(), root); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
  await removeLinks(root); await rm(root, { recursive: true, force: true });
}
