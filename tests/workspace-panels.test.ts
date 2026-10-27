import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';

async function surface(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 680, height: 900 } });
    page.setDefaultTimeout(6000);
    await page.route('http://workspace.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="surface"></main>' }));
    await page.goto('http://workspace.test/');
    await page.evaluate(() => {
      const g: any = globalThis;
      g.definitions = new Map(); g.calls = [];
      g.WeftPanels = { register: (kind: string, value: any) => g.definitions.set(kind, value), services: {
        resources: async () => ({ outputs: [], sources: [] }), previewResource: async (item: any, content: HTMLElement) => { content.textContent = item.name; },
      } };
      g.ctx = { ownerId: 'synthetic-owner', identityGeneration: 1, conversationId: 'chat-one', sessionId: 'session-one', mode: 'work', computerId: 'host-one', projectId: 'project-one', workDir: null };
      g.mount = (kind: string) => { g.instance?.dispose(); g.instance = g.definitions.get(kind).create(g.ctx); document.querySelector('main')!.replaceChildren(g.instance.el); };
    });
    for (const name of ['format-vendor.js', '../ui-core/rendering.js', 'panels/workspace.js', 'panels/review.js', 'panels/files.js'])
      await page.addScriptTag({ path: fileURLToPath(new URL('../src/personal-access-ui/' + name, import.meta.url)) });
    for (const name of ['tokens.css', 'styles.css', 'rendering.css', 'panels/workspace.css'])
      await page.addStyleTag({ path: fileURLToPath(new URL('../src/personal-access-ui/' + name, import.meta.url)) });
    await run(page);
    await page.evaluate(() => (globalThis as any).instance?.dispose());
  } finally { await browser.close(); }
}

test('review discards slow A after B and late responses after conversation switch; empty/error/chat are actionable', async () => surface(async page => {
  await page.evaluate(() => {
    const g: any = globalThis;
    g.WeftPanels.services.workspaceRequest = async (ctx: any, action: string, body: any) => {
      g.calls.push({ ctx, action, body });
      if (action === 'review/status') {
        if (g.failure) throw { code: g.failure };
        return { files: g.empty ? [] : [{ path: 'A.txt', status: ' M', additions: 1, deletions: 1 }, { path: 'B.txt', status: '??', additions: 2, deletions: 0 }] };
      }
      if (body.path === 'A.txt') return new Promise(resolve => { g.resolveA = () => resolve({ lines: [{ type: 'add', newLine: 1, text: 'late A' }] }); });
      return { lines: [{ type: 'add', newLine: 1, text: 'current B' }, { type: 'del', oldLine: 1, text: 'old B' }] };
    }; g.mount('review');
  });
  await page.getByRole('button', { name: /B.txt/ }).click();
  await page.getByText('current B', { exact: true }).waitFor();
  await page.evaluate(() => (globalThis as any).resolveA());
  assert.equal(await page.getByText('late A', { exact: true }).count(), 0);
  assert.equal(await page.locator('.diff-add').getAttribute('aria-label'), '新增第 1 行：current B');
  await page.evaluate(() => { const g: any = globalThis; g.originalRow = document.querySelector('.review-file'); g.originalDiff = document.querySelector('.diff-lines'); });
  await page.getByRole('button', { name: '刷新变更', exact: true }).click();
  await page.waitForFunction(() => !(document.querySelector('.panel-review button') as HTMLButtonElement).disabled);
  assert.equal(await page.evaluate(() => { const g: any = globalThis; return g.originalRow === document.querySelector('.review-file') && g.originalDiff === document.querySelector('.diff-lines'); }), true, 'unchanged snapshots retain mounted rows and diff');
  await page.evaluate(() => { const g: any = globalThis; g.instance.update({ ...g.ctx, conversationId: 'chat-two', sessionId: 'session-two', mode: 'chat', projectId: null }); });
  await page.getByText('先在工作模式里选一个工作目录。', { exact: true }).waitFor();
  await page.evaluate(() => (globalThis as any).resolveA());
  assert.equal(await page.locator('.diff-line').count(), 0);
  await page.evaluate(() => { const g: any = globalThis; g.failure = 'WORKSPACE_NOT_GIT'; g.instance.update(g.ctx); });
  await page.getByText('这个工作目录不是 Git 仓库。', { exact: true }).waitFor();
  await page.evaluate(() => { const g: any = globalThis; g.failure = null; g.empty = true; });
  await page.getByRole('button', { name: '刷新变更', exact: true }).click();
  await page.getByText('工作目录没有变更。', { exact: true }).waitFor();
}));

test('files lazy navigation, real code preview, protected draft, conflict recovery, save results and resources', async () => surface(async page => {
  await page.evaluate(() => {
    const g: any = globalThis; g.disk = { text: 'const answer = 1;\n', version: 'version-one' };
    g.WeftPanels.services.resources = async () => ({ outputs: [{ name: '合成成果' }], sources: [{ name: '合成来源' }] });
    g.WeftPanels.services.workspaceRequest = async (ctx: any, action: string, body: any) => {
      g.calls.push({ ctx, action, body });
      if (action === 'files/list') return { entries: body.path ? [{ name: 'code.js', path: 'nested/code.js', type: 'file' }] : [{ name: 'nested', path: 'nested', type: 'directory' }, { name: 'other.txt', path: 'other.txt', type: 'file' }] };
      if (action === 'files/read') return { path: body.path, kind: 'text', text: g.disk.text, version: g.disk.version, writable: true };
      if (action === 'files/save') {
        if (g.failSave) throw { code: g.failSave };
        if (body.version !== g.disk.version) throw { code: 'WORKSPACE_FILE_CHANGED' };
        g.disk = { text: body.text, version: 'saved-version' }; return { saved: true, version: g.disk.version };
      }
      return { entries: [] };
    }; g.mount('files');
  });
  await page.getByText('nested', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (globalThis as any).calls.filter((call: any) => call.body?.path === 'nested').length), 0);
  await page.getByText('nested', { exact: true }).click(); await page.getByRole('button', { name: 'code.js', exact: true }).click();
  await page.locator('.files-preview .render-code').waitFor();
  assert.match(await page.locator('.files-current-preview').innerText(), /const answer = 1/);
  await page.evaluate(() => { const g: any = globalThis; g.originalTree = document.querySelector('.files-branch'); g.originalCode = document.querySelector('.files-current-preview .render-code'); });
  await page.getByRole('button', { name: '刷新文件', exact: true }).click();
  await page.waitForFunction(() => { const g: any = globalThis; return g.calls.filter((call: any) => call.action === 'files/read').length >= 2; });
  assert.equal(await page.evaluate(() => { const g: any = globalThis; return g.originalTree === document.querySelector('.files-branch') && g.originalCode === document.querySelector('.files-current-preview .render-code'); }), true, 'unchanged refresh preserves tree, preview and scroll ownership');
  await page.getByRole('button', { name: '编辑文本', exact: true }).click();
  await page.getByRole('textbox', { name: '文件文本', exact: true }).fill('const draft = 2;');
  await page.evaluate(() => { const g: any = globalThis; g.instance.hide(); g.instance.show(); });
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'const draft = 2;', 'hiding a panel retains its editor');
  await page.evaluate(() => { (globalThis as any).disk = { text: 'const external = 3;', version: 'version-two' }; });
  await page.getByRole('button', { name: '刷新文件', exact: true }).click();
  await page.getByRole('button', { name: '查看新版本', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'const draft = 2;');
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '查看新版本', exact: true }).click();
  assert.match(await page.locator('.files-disk-version').innerText(), /const external = 3/);
  const versionBox = await page.locator('.files-disk-version .render-code').boundingBox();
  assert.ok(versionBox && versionBox.y >= 0 && versionBox.y + versionBox.height <= 900, 'new version is inside the visible viewport after the click');
  await page.getByRole('button', { name: '保留草稿继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByText('已保存。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (globalThis as any).disk), { text: 'const draft = 2;', version: 'saved-version' });
  await page.getByRole('textbox', { name: '文件文本', exact: true }).fill('next draft');
  // An external change between the most recent read and save is a real conflict.
  await page.evaluate(() => { (globalThis as any).disk = { text: 'external after read', version: 'conflict-version' }; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '查看新版本', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'next draft');
  assert.equal(await page.evaluate(() => (globalThis as any).disk.text), 'external after read');
  await page.getByRole('button', { name: '采用新版本', exact: true }).click();
  await page.getByRole('button', { name: '编辑文本', exact: true }).click(); await page.getByRole('textbox', { name: '文件文本', exact: true }).fill('retained on failure');
  await page.evaluate(() => { (globalThis as any).failSave = 'WORKSPACE_READ_FAILED'; });
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByText('暂时无法读取或保存，请重试。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'retained on failure');
  await page.getByText('成果 · 1', { exact: true }).click(); await page.getByRole('button', { name: '合成成果', exact: true }).click();
  assert.equal(await page.locator('.files-resource-preview').innerText(), '合成成果');
  await page.getByRole('button', { name: 'code.js', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'retained on failure');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'code.js', exact: true }).click();
  await page.getByRole('button', { name: '展开导航', exact: true }).waitFor();
  const narrowEditor = await page.getByRole('textbox', { name: '文件文本', exact: true }).boundingBox();
  assert.ok(narrowEditor && narrowEditor.width > 250, 'narrow panels give the selected file the available width');
  await page.evaluate(() => { const g: any = globalThis; g.instance.update({ ...g.ctx, mode: 'chat', projectId: null }); });
  await page.getByText('先在工作模式里选一个工作目录。', { exact: true }).waitFor();
}));

test('files invalidates search at input time and reads at selection/context change', async () => surface(async page => {
  await page.evaluate(() => {
    const g: any = globalThis;
    g.WeftPanels.services.workspaceRequest = async (ctx: any, action: string, body: any) => {
      g.calls.push({ ctx, action, body });
      if (action === 'files/list') return { entries: ['A.txt', 'B.txt'].map(name => ({ name, path: name, type: 'file' })) };
      if (action === 'files/search') return new Promise(resolve => { (g.searches ||= {})[body.query] = () => resolve({ entries: [{ path: body.query + '.txt' }] }); });
      if (body.path === 'A.txt') return new Promise(resolve => { g.resolveA = () => resolve({ kind: 'text', text: 'late A', writable: true, version: 'a' }); });
      return { kind: 'text', text: 'current B', writable: true, version: 'b' };
    }; g.mount('files');
  });
  await page.getByRole('button', { name: 'A.txt', exact: true }).click(); await page.getByRole('button', { name: 'B.txt', exact: true }).click();
  await page.locator('.files-current-preview').getByText('current B', { exact: true }).waitFor();
  await page.evaluate(() => (globalThis as any).resolveA());
  assert.equal(await page.getByText('late A', { exact: true }).count(), 0);
  await page.getByRole('searchbox', { name: '按文件名搜索' }).fill('old'); await page.waitForFunction(() => (globalThis as any).searches?.old);
  await page.getByRole('searchbox', { name: '按文件名搜索' }).fill('new');
  await page.evaluate(() => (globalThis as any).searches.old());
  assert.equal(await page.getByRole('button', { name: 'old.txt', exact: true }).count(), 0);
  await page.waitForFunction(() => (globalThis as any).searches?.new); await page.evaluate(() => (globalThis as any).searches.new());
  await page.getByRole('button', { name: 'new.txt', exact: true }).waitFor();
  await page.getByRole('searchbox', { name: '按文件名搜索' }).fill('stale'); await page.waitForFunction(() => (globalThis as any).searches?.stale);
  await page.evaluate(() => { const g: any = globalThis; g.instance.update({ ...g.ctx, sessionId: 'session-two', mode: 'chat', projectId: null }); g.searches.stale(); });
  await page.getByText('先在工作模式里选一个工作目录。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'stale.txt', exact: true }).count(), 0);
}));

test('resource component shares its real preview and targets the explicit computer rather than the active host', async () => surface(async page => {
  await page.evaluate(() => { (globalThis as any).WeftUiComponents = { factories: {} }; });
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/personal-access-ui/components/resources.js', import.meta.url)) });
  await page.evaluate(() => {
    const g: any = globalThis;
    g.WeftDesktop = { openPreview() { throw Error('resource must remain in the files panel'); }, markdown: (text: string) => g.WeftContent.create(text), usageText: () => '合成来源' };
    g.core = { state: {}, canUseComputerChannel: () => true, conversationTaskContext: () => ({}), conversationTaskCurrent: () => true,
      computerApi: async (...args: any[]) => { g.transport = args; return { ok: true }; }, accessApi: () => { throw Error('wrong computer'); },
      loadConversationResources: async () => ({ outputs: [], sources: [] }), readResource: async () => ({ kind: 'text', text: 'actual shared preview' }), artifactPreviewPath: () => '/library/artifact-one/preview' };
    g.ui = { element: (tag: string, cls: string, text: string) => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; } };
    Object.assign(g.ui, g.WeftUiComponents.factories.resources(g.core, g.ui));
  });
  await page.evaluate(async () => {
    const g: any = globalThis;
    await g.WeftPanels.services.workspaceRequest(g.ctx, 'files/read', { path: 'nested/code.js' });
    const target = document.querySelector('main')!;
    await g.WeftPanels.services.previewResource({ name: 'report.txt', artifact: { artifactId: 'artifact-one' } }, target);
  });
  assert.match(await page.locator('main').innerText(), /actual shared preview/);
  assert.deepEqual(await page.evaluate(() => (globalThis as any).transport), ['host-one', '/workspaces/session-one/files/read', { method: 'POST', body: { path: 'nested/code.js' }, protectedWrite: true }]);
  const local = await page.evaluate(async () => {
    const g: any = globalThis; g.core.canUseComputerChannel = () => false; g.core.state.hostId = 'host-one';
    g.core.computerApi = () => { throw Error('unavailable computer channel'); }; g.core.accessApi = async () => ({ local: true });
    return g.WeftPanels.services.workspaceRequest(g.ctx, 'review/status');
  });
  assert.deepEqual(local, { local: true });
}));
