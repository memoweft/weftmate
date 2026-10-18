import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { checkMainHistoryActions, checkTimelineSourceActions, checkPhoneHistoryActions, checkPhoneHistoryPresentation } from './helpers/history-message-scenarios.mjs';

test('D92 historical validation scenarios run against the production message components', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) });
  try {
    const cases = [
      ['ux-4-main-chat', 'assistant', true, checkMainHistoryActions],
      ['ia-3-main-chat', 'user', true, checkTimelineSourceActions],
      ['ia-4-main-chat', 'assistant', true, checkMainHistoryActions],
      ['ia-4-android', 'user', true, checkTimelineSourceActions],
      ['mem-7-phone-handover', 'assistant', false, checkPhoneHistoryActions],
      ['mem-7-final-ui', 'assistant', false, checkPhoneHistoryPresentation],
    ] as const;
    for (const [name, role, main, scenario] of cases) await t.test(name, async () => {
      const page = await browser.newPage(); page.setDefaultTimeout(1000);
      try {
        await page.setContent('<main id="chat-content"><ol id="messages"></ol><textarea id="draft"></textarea></main>');
        const bundle = name === 'ia-4-main-chat' || name === 'ia-4-android' ? 'apps/mobile-ui/www' : 'src/personal-access-ui';
        await page.addScriptTag({ path: fileURLToPath(new URL(`../${bundle}/message-actions.js`, import.meta.url)) });
        await page.evaluate(({ role, main }) => {
          const scope = globalThis as any;
          scope.WeftUiCore = { messagePlainText: (text: string) => text };
          scope.WeftPopover = { openMenu: (_trigger: any, entries: any[]) => {
            const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
            for (const entry of entries) { const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.textContent = entry.name; button.disabled = entry.disabled; menu.append(button); }
            document.body.append(menu); return { menu, close: () => menu.remove() };
          } };
          scope.WeftUiComponents = { factories: {} };
          const row = document.createElement('li'); row.className = `message ${role}`;
          row.setAttribute('aria-label', `${role === 'user' ? '我的消息' : '助手消息'}：合成历史`);
          const text=document.createElement('span');text.className='message-text';text.textContent='合成历史';
          row.append(text); document.getElementById('messages')!.append(row);
          const core = { state: { ownerId: 'synthetic', identityGeneration: 1, sessions: [] },
            inMainChat: () => main, readMessageFeedback: () => [], messageBusy: () => false,
            messageSource: async () => ({ kind: main ? 'main' : 'side' }), accessApi: async () => ({ groups: [], timeZone: 'UTC' }) };
          scope.WeftMessageActions.create({ core, draft: () => document.getElementById('draft'), sessionId: () => 'synthetic', notice() {} })
            .bind(row, { seq: 7, type: `${role}.message`, data: { text: '合成历史', ...(!main ? { phoneSource: true } : {}) } });
        }, { role, main });
        await page.addScriptTag({ path: fileURLToPath(new URL('../src/personal-access-ui/components/main-chat.js', import.meta.url)) });
        await page.evaluate(() => { const scope = globalThis as any; scope.visualMain = scope.WeftUiComponents.factories.mainChat({ state: {} }, {}); });
        await scenario(page, page.getByRole('group', { name: /消息：合成历史/ }));
        assert.equal(await page.getByText('合成历史', { exact: true }).count(), 1);
        assert.equal(await page.getByRole('dialog').count(), 0);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
