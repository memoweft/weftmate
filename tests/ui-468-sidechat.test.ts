import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

test('D92 production message components remove anchored side chats and preserve ordinary regeneration', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) });
  try {
    for (const bundle of ['src/personal-access-ui', 'apps/mobile-ui/www']) {
      const page = await browser.newPage();
      await page.setContent('<main id="chat-content"><ol id="messages"></ol><textarea id="draft"></textarea></main>');
      await page.addScriptTag({ path: fileURLToPath(new URL(`../${bundle}/message-actions.js`, import.meta.url)) });
      const result = await page.evaluate(async () => {
        const scope = globalThis as any, menus: any[] = [], mutations: any[] = [];
        Object.defineProperty(scope.crypto, 'randomUUID', { value: () => 'synthetic-request' });
        scope.WeftUiCore = { messagePlainText: (value: string) => value };
        scope.WeftPopover = { openMenu: (_trigger: any, entries: any[]) => { menus.push(entries); return { menu: document.createElement('div'), close() {} }; } };
        const rows: any[] = [];
        for (const kind of ['main', 'side', 'phone']) {
          const row: any = document.createElement('li'); row.className = 'message assistant';
          row.weftOpenSideChat = () => mutations.push('cancelled-side-chat');
          document.getElementById('messages')!.append(row);
          const core = { state: { ownerId: 'synthetic', identityGeneration: 1, sessions: [] },
            inMainChat: () => kind === 'main', readMessageFeedback: () => [],
            messageSource: async () => ({ kind: 'side' }), messageBusy: () => false,
            accessApi: async () => ({ groups: [] }), hasPendingMessageBranch: () => false,
            branchMessage: async (...args: any[]) => mutations.push(args) };
          const actions = scope.WeftMessageActions.create({ core, draft: () => document.getElementById('draft'), sessionId: () => kind, notice() {} });
          actions.bind(row, { seq: 7, type: 'assistant.message', data: { text: '合成回复', ...(kind === 'phone' ? { phoneSource: true } : {}) } }, kind);
          const more = row.querySelector('[aria-label="更多回复操作"]');
          if (more) { more.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
          rows.push({ kind, more: !!more, actions: [...row.querySelectorAll('button')].map((button: any) => button.getAttribute('aria-label')), menu: more ? menus.at(-1).map((entry: any) => entry.name) : [] });
        }
        await menus[0][0].action();
        return { rows, mutations };
      });
      assert.deepEqual(result.rows[0].menu, []);
      assert.equal(result.rows[0].more, false);
      for (const row of result.rows) {
        assert.ok(row.actions.includes('复制回复'));
        assert.ok(row.actions.includes('分享 / 导出对话'));
        assert.ok(!row.menu.some((name: string) => /旁聊|从这里开对话/.test(name)));
      }
      assert.deepEqual(result.rows[1].menu, ['重新生成', '换模型重新生成']);
      assert.deepEqual(result.rows[2].menu, ['重新生成', '换模型重新生成']);
      assert.equal(result.mutations.length, 1);
      assert.equal(result.mutations[0][2], 'regenerate');
      await page.close();
    }
  } finally { await browser.close(); }
});
