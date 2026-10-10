/** UX-P1b: all/type/all filters through the shipped mobile browser UI. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';

const out = resolve(import.meta.dirname, '../evidence/ux-p1b');
await mkdir(out, { recursive: true });
let fixture, browser;
const checks = [], errors = [];
try {
  fixture = await startTimelineCandidate({ historyCount: 0, logicalMobile: true });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/bridge.js', route => route.fulfill({ contentType: 'text/javascript', body: '// browser transport' }));
    const login = await page.request.post(fixture.origin + '/personal/v1/auth/login', {
      data: fixture.credentials, headers: { origin: fixture.origin },
    });
    assert.equal(login.status(), 200);
    const identity = await login.json(), ownerId = identity.account.ownerId;
    await page.route('**/personal/v1/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/memory/')) {
        let data = {};
        if (url.pathname.endsWith('/status')) data = { ownerId, state: 'ready', worldRevision: 7,
          capabilities: { list: true, source: true }, pendingBoundaryCount: 0 };
        if (url.pathname.endsWith('/items')) {
          const kind = url.searchParams.get('kind');
          data = { ownerId, worldRevision: 7, searchScope: 'account_snapshot', hasMore: false, nextCursor: null,
            items: [{ id: 'cognition-1', kind: 'cognition', text: '合成理解：喜欢简洁', lifecycle: {}, currentState: 'current', sourceCount: 0 },
              { id: 'entity-1', kind: 'entity', text: '合成人物：小明', lifecycle: {}, currentState: 'current', sourceCount: 0 }]
              .filter(item => kind === 'all' || item.kind === kind) };
        }
        await route.fulfill({ json: data }); return;
      }
      const response = await route.fetch({ url: fixture.origin + url.pathname + url.search,
        headers: { ...route.request().headers(), origin: fixture.origin } });
      await route.fulfill({ response });
    });
    await page.goto(fixture.mobileUrl);
    await page.waitForFunction(() => state.booted);
    await page.evaluate(identity => {
      state.loggedIn = true; state.owner = identity.account.ownerId; state.username = identity.account.username;
      state.deviceId = identity.device.id; state.authEpoch++;
      document.body.classList.remove('cloud-auth-active'); $('cloud-auth-page').classList.remove('active');
      uiCore.syncMobileIdentity(); page('memory');
    }, identity);
    const types = page.getByRole('group', { name: '记忆类型', exact: true });
    const all = types.getByRole('button', { name: '全部', exact: true });
    const cognition = types.getByRole('button', { name: '理解', exact: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.getByRole('button', { name: /合成人物：小明/ }).waitFor().catch(async error => {
        console.error(await page.locator('body').innerText()); throw error;
      });
      assert.equal(await all.getAttribute('aria-pressed'), 'true');
      await cognition.click();
      await page.waitForFunction(() => !state.memory.loading && state.memory.kind === 'cognition');
      assert.equal(await cognition.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('button', { name: /合成人物：小明/ }).count(), 0);
      await all.click();
      await page.getByRole('button', { name: /合成人物：小明/ }).waitFor();
      assert.equal(await all.getAttribute('aria-pressed'), 'true');
      assert.equal(await cognition.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.getByRole('button', { name: /合成理解：喜欢简洁/ }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: resolve(out, `memory-${viewport.width}-${theme}.png`), fullPage: true });
      checks.push(`${viewport.width}×${viewport.height} ${theme}: all → cognition → all; mixed records and pressed states restored`);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'checks.json'), JSON.stringify({ checks, errors }, null, 2) + '\n');
  console.log(`UX-P1b mobile memory filters passed: ${checks.length}/4.`);
} finally {
  await browser?.close();
  await fixture?.close();
}
