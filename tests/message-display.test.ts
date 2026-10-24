import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

test('reply controls and account-local time appear on hover, focus or tap, with complete turn duration', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) });
  try {
    for (const touch of [false, true]) {
      const page = await browser.newPage({ hasTouch: touch, isMobile: touch, viewport: { width: touch ? 390 : 1200, height: 800 } });
      page.setDefaultTimeout(3000);
      try {
        await page.setContent('<main id="chat-content"><article class="message assistant"><p class="message-text">合成回复</p></article><textarea id="draft"></textarea></main>');
        for (const name of ['tokens.css', 'message-actions.css']) await page.addStyleTag({ path: fileURLToPath(new URL(`../src/personal-access-ui/${name}`, import.meta.url)) });
        await page.addScriptTag({ path: fileURLToPath(new URL('../src/personal-access-ui/message-actions.js', import.meta.url)) });
        await page.evaluate(() => {
          const scope = globalThis as any;
          const accountDay = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
          const at = new Date(accountDay + 'T06:32:00Z');
          scope.displayEvents = [
            { seq: 0, type: 'turn.started', at: new Date(+at - 100000).toISOString(), data: { turn: 1 } },
            { seq: 1, type: 'user.message', at: new Date(+at - 96000).toISOString(), data: { text: '合成提问' } },
            { seq: 2, type: 'assistant.message', at: at.toISOString(), data: { text: '合成回复' } },
          ];
          const core = { state: { ownerId: 'synthetic', identityGeneration: 1, sessions: [] },
            readMessageFeedback: () => [], messageBusy: () => false, accessApi: async () => ({ groups: [], timeZone: 'Asia/Shanghai' }) };
          scope.actions = scope.WeftMessageActions.create({ core, draft: () => document.querySelector('textarea'), sessionId: () => 'synthetic', events: () => scope.displayEvents });
          scope.actions.bind(document.querySelector('article'), scope.displayEvents[2]);
        });
        const row = page.locator('article'), bar = row.getByRole('group', { name: '回复操作', includeHidden: true });
        await page.mouse.move(0, 0);
        assert.equal(await bar.isVisible(), false, 'including the last assistant reply');
        if (touch) await page.evaluate(() => {
          const scope = globalThis as any, row = document.querySelector('article');
          row.querySelector('.message-actions').remove();
          scope.actions.bind(row, scope.displayEvents[2]);
        });
        if (touch) await row.locator('.message-text').tap(); else await row.hover();
        await bar.waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('.message-time')?.textContent === '14:32');
        assert.doesNotMatch(await bar.innerText(), /用时/);
        await page.evaluate(() => { const scope = globalThis as any; scope.displayEvents.push({ seq: 3, type: 'turn.ended', at: scope.displayEvents[2].at, data: { turn: 1 } }); scope.actions.refresh(); });
        assert.match(await bar.innerText(), /14:32 · 用时 1 分 36 秒/);
        if (touch) { await row.locator('.message-text').tap(); await page.locator('#draft').focus(); }
        else { await page.mouse.move(0, 0); await page.locator('#draft').focus(); }
        assert.equal(await bar.isVisible(), false, `hidden after leaving (touch=${touch})`);
        await page.keyboard.press('Tab'); await row.focus(); assert.equal(await bar.isVisible(), true);
        await page.evaluate(() => { const scope = globalThis as any; scope.displayEvents[2].at = '2020-01-02T06:32:00Z'; scope.actions.refresh(); });
        assert.match(await bar.innerText(), /2020.*1.*2.*14:32/);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
