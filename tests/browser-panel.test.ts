import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

test('browser panel keeps its instance across context enrichment and rejects obsolete command results', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.setContent('<main style="height:600px"></main>');
    await page.evaluate(() => {
      const g = globalThis as any;
      g.created = 0; g.browserClosedTabs = [];
      g.initialState = { tabId: 'owned-tab', registered: true, url: 'https://example.org/first', title: '第一个网页' };
      g.weftmateDesktop = {
        browser: async (action: string, input: any) => {
          if (action === 'create') { g.created++; return g.initialState; }
          if (action === 'navigate') return new Promise(resolve => { g.finishOldCommand = resolve; });
          if (action === 'close') g.browserClosedTabs.push(input.tabId);
          return {};
        },
        onBrowserState: (callback: any) => { g.publishState = callback; return () => {}; },
      };
      g.WeftPanels = { register: (_kind: string, definition: any) => { g.browserDefinition = definition; } };
    });
    for (const path of ['icons.js', 'panels/browser.js'])
      await page.addScriptTag({ path: fileURLToPath(new URL('../src/personal-access-ui/' + path, import.meta.url)) });
    await page.evaluate(() => {
      const g = globalThis as any;
      g.context = { conversationId: 'chat-a', sessionId: 'session-a', ownerId: 'synthetic-owner', identityGeneration: 1,
        tabId: 'browser', mode: 'work', computerId: 'synthetic-host', projectId: 'project-a', workDir: null };
      g.panel = g.browserDefinition.create(g.context);
      document.querySelector('main')!.append(g.panel.el); g.panel.show();
    });
    await page.getByText('第一个网页', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '网址' }).fill('https://example.org/next');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => !!(globalThis as any).finishOldCommand);
    await page.evaluate(() => {
      const g = globalThis as any;
      g.panel.update({ ...g.context, workDir: 'synthetic-workspace' });
      g.publishState({ ...g.initialState, url: 'https://example.org/current', title: '当前网页' });
      g.finishOldCommand({ ...g.initialState, title: '迟到的旧命令结果' });
    });
    await page.waitForFunction(() => !(globalThis as any).panel.el.querySelector('.browser-page-title').textContent.includes('第一个'));
    assert.equal(await page.locator('.browser-page-title').textContent(), '当前网页');
    assert.equal(await page.evaluate(() => (globalThis as any).created), 1, 'late workDir uses the existing conversation tab');
    await page.evaluate(() => (globalThis as any).panel.dispose());
    assert.deepEqual(await page.evaluate(() => (globalThis as any).browserClosedTabs), ['owned-tab']);
  } finally { await browser.close(); }
});
