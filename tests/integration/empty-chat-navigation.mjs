/** #609: production personal host, assets and desktop shell; synthetic UI data, no inference. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { createDshSessionAdapter } from '../../src/runtime/dsh-adapter/sessions.mjs';

for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-empty-chat';
const browserOnly = process.argv.includes('--browser-only');
const visible = process.env.EMPTY_CHAT_VISIBLE === '1';
const output = process.env.WEFTMATE_EVIDENCE_DIR;
if (!output) throw Error('Set WEFTMATE_EVIDENCE_DIR outside the repository.');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'weftmate-empty-chat-'));
const report = { scenario: '#609 empty-history new chat', renderer: browserOnly ? 'Chromium' : 'production Electron desktop',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim(),
  passed: false, observations: [], errors: [], operations: [] };
const sessions = new Map();
const adapter = id => createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true,
  value: { items: [...sessions.keys()].map(sessionId => ({ sessionId, origin: 'user' })) } } }) }, events: {} },
  { readLog: async () => sessions.get(id)?.events ?? [] });
let app, browser, host, ownedLock, timer, page, failure, seedExisting = false;
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for (const slot of [1, 2, 3]) {
      const candidate = join(process.env.WEFTMATE_HEAVY_LOCK_DIR, `heavy-${slot}.lock`);
      try { const file = await open(candidate, 'wx'); await file.writeFile(`R1022-EMPTY-CHAT ${new Date().toISOString()} isolated UI`); await file.close(); ownedLock = candidate; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!ownedLock) throw Error('All heavy slots occupied; UI not started.');
  }
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', capabilities: { chat: { available: true, inferenceVerified: true } } }),
    listModels: async () => [{ id: 'synthetic', name: '合成模型', model: 'synthetic-no-inference', configured: true, sourceKind: 'local' }],
    preflight: async () => ({ ok: true }),
    createSession: async input => {
      const operation = { kind: 'create', sessionId: input.sessionId };
      if (seedExisting) (report.seedOperations ??= []).push(operation); else report.operations.push(operation);
      const at = Date.now(), message = randomUUID();
      const events = seedExisting ? [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { id: message, role: 'user', source: { kind: 'user', rpcId: randomUUID() }, content: [{ type: 'text', text: '合成历史来源' }] } },
        { type: 'step/start', data: { turn: 1, step: 1 } },
        { type: 'assistant/message', data: { turn: 1, step: 1, message: { id: randomUUID(), role: 'assistant',
          source: { kind: 'model', provider: 'synthetic', model: 'no-inference' }, content: [{ type: 'text', text: '合成历史保留' }] } } },
        { type: 'step/end', data: { turn: 1, step: 1 } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ].map((event, seq) => ({ ...event, seq, time: at + seq })) : [];
      sessions.set(input.sessionId, { title: '合成已有对话', events }); return { sessionId: input.sessionId };
    },
    sendMessage: async () => { throw Error('This navigation check must not submit inference.'); },
    cancelSession: async () => { throw Error('This navigation check must not stop a task.'); },
    describeSession: async id => sessions.has(id) ? { sessionId: id, running: false, agentPreset: 'personal-remote', modelProfileId: 'synthetic', title: sessions.get(id).title } : null,
    readEvents: async ({ sessionId, ...options }) => adapter(sessionId).historyPage(sessionId, options),
    readHistoryPage: async ({ sessionId, ...options }) => adapter(sessionId).historyPage(sessionId, options),
    listApprovals: async () => [], listUserQuestions: async () => ({ runtimeId: 'empty-chat-fixture', questions: [] }),
  };
  host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend, uiHandler: servePersonalAccessUi });
  const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'EmptyChatFixture', password: randomUUID(), deviceName: 'Synthetic navigation desktop' }) });
  assert.equal(setup.status, 201);
  const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0];
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(origin + '/personal/v1' + path, { method,
      headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify({ path, status: response.status, error: value.error })); return value;
  };
  await api('/settings/models', { defaultModelProfileId: 'synthetic' }, 'PATCH');
  await api('/onboarding', { step: 'first', completed: true }, 'PATCH');
  assert.equal((await api('/sessions')).sessions.length, 0, 'the initial environment truly has zero sessions');
  let theme = process.env.EMPTY_CHAT_THEME ?? 'dark';
  if (browserOnly) {
    browser = await chromium.launch({ headless: true,
      ...(process.env.WEFTMATE_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.WEFTMATE_CHROMIUM_EXECUTABLE_PATH } : {}) });
    page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: theme });
  } else {
    const env = { ...process.env, REVIEW_PROFILE: join(root, 'desktop-profile'), REVIEW_ORIGIN: origin,
      REVIEW_LIBRARY_TOKEN: host.libraryDesktopToken, REVIEW_HIDDEN: '1', REVIEW_THEME: theme };
    delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_API_KEY;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'),
      args: ['scripts/review-gallery/electron.mjs', `--user-data-dir=${join(root, 'desktop-profile')}`,
        '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 30000 });
    page = await app.firstWindow();
    report.window = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { exists: !!w, visible: w.isVisible() }; });
  }
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    let module;
    Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => module, set: value => {
      module = value; const create = value.create;
      value.create = (...args) => { globalThis.emptyChatCore = create(...args); return emptyChatCore; };
    } });
  });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().addCookies([{ name: 'wm_personal_session', value: cookie.slice(cookie.indexOf('=') + 1), url: origin }]);
  timer = setTimeout(() => { void app?.close(); void browser?.close(); void host?.close(); }, 120000);
  await page.goto(origin + '/personal/v1/ui/');
  await page.waitForFunction(() => globalThis.emptyChatCore?.state.models.length && emptyChatCore.state.personalCapabilities?.workAndChat === 1);
  if (app && visible) {
    report.window = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.showInactive();
      return { exists: true, visible: w.isVisible(), handleBytes: [...w.getNativeWindowHandle()] }; });
    assert.equal(report.window.visible, true);
  }
  // Select the real appearance control; requested OS theme alone does not
  // override an application's stored default appearance.
  const setTheme = async value => {
    theme = value;
    await page.getByRole('button', { name: '账户菜单' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    report.appearance = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(report.appearance, theme, 'the product appearance control applies the requested theme');
  };
  await setTheme(theme);
  const snapshot = async label => {
    const state = await page.evaluate(() => ({ title: document.getElementById('assistant-title').textContent,
      bodyClasses: document.body.className, selectedSessionId: emptyChatCore.state.selectedSessionId,
      newConversation: emptyChatCore.state.newConversation, sessions: emptyChatCore.state.sessions.length,
      draft: document.getElementById('message-text').value, theme: document.documentElement.dataset.theme,
      libraryHidden: document.querySelector('.library-surface')?.hidden,
      fixedPagesHidden: [...document.querySelectorAll('.library-surface,.health-surface,.goals-surface,.activity-surface')].every(panel => panel.hidden),
      conversationHidden: document.getElementById('conversation-pane').hidden }));
    report.observations.push({ label, ...state });
    const file = join(output, `${label}-${theme}.png`);
    if (app && visible) {
      const ownedWindow = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0];
        return { mainProcessId: process.pid, handleBytes: [...window.getNativeWindowHandle()], visible: window.isVisible() }; });
      assert.equal(ownedWindow.visible, true);
      const bytes = Buffer.from(ownedWindow.handleBytes);
      const handle = bytes.length === 8 ? bytes.readBigUInt64LE().toString() : String(bytes.readUInt32LE());
      const evidence = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File',
        'tests/helpers/empty-chat-window-capture.ps1', '-WindowHandle', handle,
        '-ExpectedProcessId', String(ownedWindow.mainProcessId), '-OutputPath', file],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      report.visibleCaptures ??= []; report.visibleCaptures.push({ label, ...JSON.parse(evidence) });
    } else if (app) {
      // Native capture supports hidden production windows without showing an
      // OS window or changing navigation/DOM state for the screenshot.
      const captured = await app.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true });
        if (image.isEmpty()) throw Error('Native window capture is empty');
        return image.toDataURL();
      });
      await writeFile(file, Buffer.from(captured.slice(captured.indexOf(',') + 1), 'base64'));
    } else await page.screenshot({ path: file });
    return state;
  };
  await snapshot('initial-empty-chat');
  await page.getByRole('button', { name: '成果库', exact: true }).click();
  await page.locator('.library-surface').waitFor({ state: 'visible' });
  await snapshot('library-before-new');
  await page.locator('[data-mode="chat"]').click();
  await page.locator('#new-session').click();
  const actual = await snapshot('new-chat-after-library');
  assert.equal(actual.title, '新对话', 'new chat must replace the fixed-page title');
  assert.equal(actual.libraryHidden, true, 'the library must close when explicitly starting a chat');
  assert.equal(actual.conversationHidden, false);
  await page.locator('#message-text').fill('合成草稿，仅检查导航，不发送');
  report.cases = [{ history: 'empty', page: 'library', theme, passed: true }];
  const themes = [theme, theme === 'light' ? 'dark' : 'light'];
  const fixedPages = [{ key: 'library', label: '成果库' }, { key: 'health', label: '健康' },
    { key: 'goals', label: '目标' }, { key: 'activity', label: /^动态/ }];
  const assertChat = async (value, draft) => {
    assert.equal(value.title, '新对话'); assert.equal(value.fixedPagesHidden, true);
    assert.equal(value.conversationHidden, false); assert.equal(value.draft, draft, 'navigation preserves the current draft');
    await page.locator('#message-text').fill(draft);
    assert.equal(await page.locator('#message-text').inputValue(), draft);
  };
  const matrix = async (history, skipPrimary = false) => {
    for (const value of themes) {
      if (theme !== value) await setTheme(value);
      for (const entry of fixedPages) {
        if (skipPrimary && value === themes[0] && entry.key === 'library') continue;
        const draft = `合成${history}-${value}-${entry.key}草稿，不发送`;
        await page.locator('#message-text').fill(draft);
        await page.getByRole('button', { name: entry.label, exact: typeof entry.label === 'string' }).click();
        await page.locator(`.${entry.key}-surface`).waitFor({ state: 'visible' });
        let libraryQuery;
        if (entry.key === 'library') {
          await page.locator('.library-surface').getByPlaceholder('搜索文件名').fill('合成筛选');
          libraryQuery = await page.locator('.library-surface').getByPlaceholder('搜索文件名').inputValue();
        }
        await page.locator('#new-session').click();
        const state = await snapshot(`${history}-${entry.key}-new-chat`);
        await assertChat(state, draft);
        if (entry.key === 'library') {
          await page.getByRole('button', { name: '成果库', exact: true }).click();
          await page.locator('.library-surface').waitFor({ state: 'visible' });
          assert.equal(await page.locator('.library-surface').getByPlaceholder('搜索文件名').inputValue(), libraryQuery,
            'returning to the library retains its filter instead of deleting page data');
          await page.locator('#new-session').click();
          const returned = await snapshot(`${history}-library-return-new-chat`);
          await assertChat(returned, draft);
        }
        report.cases.push({ history, page: entry.key, theme: value, passed: true });
      }
    }
  };
  await matrix('empty', true);
  seedExisting = true;
  const creation = (await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' })).command;
  let existing;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const command = (await api('/commands/' + creation.commandId)).command;
    if (command.state === 'accepted_by_dsh') { existing = command.sessionId; break; }
    await new Promise(done => setTimeout(done, 30));
  }
  seedExisting = false; assert.ok(existing, 'the separate existing-history fixture is admitted');
  const retainedEvents = JSON.stringify(sessions.get(existing).events);
  await page.reload();
  await page.waitForFunction(id => emptyChatCore.state.sessions.some(row => row.sessionId === id), existing);
  await page.locator(`#session-list .session-row[data-session-id="${existing}"] > button`).first().click();
  await page.getByText('合成历史保留', { exact: true }).waitFor();
  await page.getByRole('button', { name: '成果库', exact: true }).click();
  await page.locator(`#session-list .session-row[data-session-id="${existing}"] > button`).first().click();
  assert.equal(await page.locator('.library-surface').isVisible(), false, 'selecting an existing chat still closes the fixed page');
  await page.getByText('合成历史保留', { exact: true }).waitFor();
  await page.locator('#new-session').click();
  await matrix('existing');
  assert.equal(JSON.stringify(sessions.get(existing).events), retainedEvents, 'new chat and fixed-page navigation preserve existing history');
  assert.equal((await api('/sessions')).sessions.length, 1, 'new drafts create no extra server sessions');
  assert.equal(report.cases.length, 16);
  assert.equal(report.operations.length, 0, 'navigation needs no server session or model request');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log('EMPTY_CHAT_NAVIGATION_PASS');
} catch (error) {
  failure = error; process.exitCode = 1; report.failure = error.message;
  if (page && !page.isClosed()) report.failureState = await page.evaluate(() => ({ title: document.getElementById('assistant-title')?.textContent,
    currentView: globalThis.emptyChatCore?.state.currentView, modelProfileId: globalThis.emptyChatCore?.state.modelProfileId,
    chatCapability: globalThis.emptyChatCore?.state.capabilities?.chat, bodyClasses: document.body.className,
    fixedPages: [...document.querySelectorAll('.library-surface,.health-surface,.goals-surface,.activity-surface')].map(node => ({ className: node.className, hidden: node.hidden })),
    conversationHidden: document.getElementById('conversation-pane')?.hidden })).catch(() => null);
  console.error(error.message);
}
finally {
  clearTimeout(timer);
  await Promise.allSettled([app?.close(), browser?.close()]); await host?.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (ownedLock) await unlink(ownedLock);
  const child = relative(tmpdir(), root); assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
  await rm(root, { recursive: true, force: true });
}
