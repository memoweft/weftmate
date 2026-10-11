/** DIAG-1: shipped phone www pages, synthetic login, local HTTP and no native UI.
 * Screenshots are viewport-only. Native status/navigation bars are not verified.
 * Run separately from Electron/vendor gates: node tests/integration/diag-1-mobile.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const out = process.env.DIAG1_EVIDENCE_DIR ? resolve(process.env.DIAG1_EVIDENCE_DIR) : resolve(import.meta.dirname, '../evidence/diag-1');
await mkdir(out, { recursive: true });
const report = {
  synthetic: true, productionMobile: true, modelRequests: 0, transport: 'local authenticated HTTP',
  screenshotScope: 'viewport-only', systemBars: false, systemVersion: 'headless Chromium; no native system UI',
  nativeBarsVerification: 'Not verified by this browser-only runner; use independent native acceptance for system bars.',
  checks: [], screenshots: [], errors: [],
};
const fixture = await startTimelineCandidate({ daily: true, sidebar: true, logicalMobile: true,
  interactive: true, historyCount: 0, inlineProgress: true });
let browser;

function runRecord(scene) {
  const now = Date.now();
  const summary = ['WeftMate 0.1.0', 'System: synthetic Windows', 'DIAG-1 synthetic diagnostics',
    JSON.stringify(scene === 'record'
      ? { event: 'host.previous_unclean_exit', runId: 'synthetic-previous-run', code: 'UNKNOWN', dumpCount: 1 }
      : { event: 'host.exit', runId: 'synthetic-previous-run', reason: 'user-quit', exitCode: 0 }),
  ].join('\n');
  return { state: 'ready', startedAt: new Date(now - 10 * 60_000).toISOString(),
    previous: scene === 'record'
      ? { normal: false, reason: 'unknown', runId: 'synthetic-previous-run',
        lastAt: new Date(now - 30 * 60_000).toISOString(), lastEvent: 'host.start',
        dumps: [{ file: 'synthetic-crash.dmp', size: 2048 }] }
      : { normal: true, reason: 'user-quit', runId: 'synthetic-previous-run',
        at: new Date(now - 30 * 60_000).toISOString(), exitCode: 0, dumps: [] },
    uncleanCount7Days: scene === 'record' ? 1 : 0, summary };
}

try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 360, height: 780 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark']) {
      for (const scene of ['empty', 'record', 'error']) {
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, colorScheme: theme });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(20_000);
          const prefix = `mobile-web-${viewport.width}x${viewport.height}-${theme}-${scene}`;
          page.on('pageerror', error => report.errors.push({ scene: prefix, message: error.message }));
          await context.addInitScript(() => {
            globalThis.__diag1Copies = [];
            Object.defineProperty(navigator, 'clipboard', { configurable: true,
              value: { writeText: async text => { globalThis.__diag1Copies.push(text); } } });
          });
          // Disable the candidate's native bridge so the shipped page uses its
          // browser transport and actual synthetic-account HTTP session.
          await page.route('**/bridge.js', route => route.fulfill({ contentType: 'text/javascript', body: '// Authenticated browser HTTP transport.' }));
          let currentScene = scene;
          await page.route('**/personal/v1/**', async route => {
            try {
              const url = new URL(route.request().url());
              if (url.pathname === '/personal/v1/system' && currentScene === 'error') {
                return route.fulfill({ status: 503, json: { error: { code: 'DIAGNOSTICS_UNAVAILABLE' } } });
              }
              const response = await route.fetch({ url: fixture.origin + url.pathname + url.search,
                headers: { ...route.request().headers(), origin: fixture.origin } });
              if (url.pathname === '/personal/v1/system') {
                // This timeline fixture has no system manager. Supply explicit
                // synthetic service facts together with the diagnostic scenario.
                const system=response.status()===200 ? await response.json() : {
                  model:{state:'unconfigured',canRestart:false},host:{state:'ready',version:'0.1.0',canRestart:false},
                  memory:{state:'disabled',canRestart:false},queue:{backgroundPending:0},canRestart:false};
                return route.fulfill({ status:200, json: { ...system, runRecord: runRecord(currentScene) } });
              }
              return route.fulfill({ response });
            } catch { return route.abort().catch(() => {}); }
          });

          const login = await page.request.post(fixture.origin + '/personal/v1/auth/login', {
            data: fixture.credentials, headers: { origin: fixture.origin },
          });
          assert.equal(login.status(), 200);
          const identity = await login.json();
          await page.goto(fixture.mobileUrl);
          await page.waitForFunction(() => state.booted);
          await page.evaluate(async ({ identity, theme }) => {
            state.loggedIn = true; state.owner = identity.account.ownerId; state.username = identity.account.username;
            state.deviceId = identity.device.id; state.authEpoch++;
            document.body.classList.remove('cloud-auth-active'); $('cloud-auth-page').classList.remove('active');
            uiCore.syncMobileIdentity(); await listSharedSessions(); await uiCore.selectMainChat(); applyTheme(theme);
          }, { identity, theme });
          await page.waitForFunction(() => typeof globalThis.WeftRunRecords?.mount === 'function');
          await page.evaluate(() => page('general'));
          // DIAG-2 retains browser failures on this device independently of the
          // connected computer. Exercise the actual runtime listener and copy.
          if(scene==='record'){
            await page.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{
              error:new TypeError('synthetic private prompt'),filename:new URL('app.js',location.href).href,lineno:12,colno:3})));
            await page.evaluate(()=>page('general'));
          }
          const localRecords=page.getByRole('region',{name:'运行记录',exact:true}).filter({has:page.getByRole('heading',{name:'本机（这个浏览器）',exact:true})});
          await localRecords.locator('.run-record-facts').waitFor();
          assert.match(await localRecords.innerText(),scene==='record'?/1 条异常记录/:/没有异常记录/);
          await localRecords.getByRole('button',{name:'复制诊断摘要',exact:true}).click();
          const localPreview=localRecords.getByRole('region',{name:'诊断摘要预览',exact:true});
          await localPreview.scrollIntoViewIfNeeded();
          await page.screenshot({path:join(out,`${prefix}-local-summary-preview.png`),animations:'disabled'});
          report.screenshots.push({file:`${prefix}-local-summary-preview.png`,viewport,pageTheme:theme,scope:'viewport-only',systemBars:false});
          await localPreview.getByRole('button',{name:'复制摘要',exact:true}).click();
          const localSummary=JSON.parse(await page.evaluate(()=>__diag1Copies.at(-1)));
          assert.equal(localSummary.platform,'mobile-web');
          assert.equal(localSummary.recentAbnormalRecords.length,scene==='record'?1:0);
          assert.equal(JSON.stringify(localSummary).includes('synthetic private prompt'),false);
          await page.evaluate(()=>{__diag1Copies.length=0;});
          report.checks.push(`${prefix}: local browser records, human preview and private-text-free JSON copy`);
          const records = page.getByRole('region', { name: '运行记录', exact: true }).filter({has:page.getByRole('heading',{name:'已连接的电脑',exact:true})});
          await records.waitFor();
          await page.waitForFunction(expected => [...document.querySelectorAll('.run-records')].at(-1)?.dataset.state === expected,
            scene === 'error' ? 'error' : 'ready');
          assert.equal(await records.getByRole('button', { name: '打开日志文件夹', exact: true }).count(), 0);

          const shot = async suffix => {
            await records.scrollIntoViewIfNeeded();
            await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${prefix}: horizontal overflow`);
            const name = `${prefix}${suffix ? '-' + suffix : ''}.png`;
            await page.screenshot({ path: join(out, name), fullPage: false, animations: 'disabled' });
            report.screenshots.push({ file: name, viewport, pageTheme: theme, browserColorScheme: theme,
              scope: 'viewport-only', systemBars: false, bottomNavigationRegion: 'No native navigation region; page only' });
          };

          if (scene === 'error') {
            assert.match(await records.innerText(), /运行记录暂时无法读取，请重试/);
            assert.equal(await records.getByRole('button', { name: '复制诊断摘要', exact: true }).count(), 0);
            await shot('unavailable');
            currentScene = 'empty';
            await records.getByRole('button', { name: '重试读取', exact: true }).click();
            await page.waitForFunction(() => [...document.querySelectorAll('.run-records')].at(-1)?.dataset.state === 'ready');
            assert.match(await records.innerText(), /没有异常退出记录/);
            report.checks.push(`${prefix}: HTTP 503 error, visible retry, recovered empty records, no desktop folder operation`);
          } else {
            const text = await records.innerText();
            assert.match(text, /本次启动/); assert.match(text, /上次退出/); assert.match(text, /最近 7 天/);
            assert.match(text, scene === 'record' ? /未正常结束/ : /正常结束/);
            assert.match(text, scene === 'record' ? /1 次未正常结束/ : /没有异常退出记录/);
            assert.match(text, scene === 'record' ? /检测到崩溃转储/ : /使用者退出/);
            assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/);
            const preview = records.getByRole('region', { name: '诊断摘要预览', exact: true });
            assert.equal(await preview.isVisible(), false);
            assert.deepEqual(await page.evaluate(() => __diag1Copies), []);
            await shot('records');
            const reveal = records.getByRole('button', { name: '复制诊断摘要', exact: true });
            await reveal.click(); await preview.waitFor();
            assert.equal(await reveal.getAttribute('aria-expanded'), 'true');
            assert.deepEqual(await page.evaluate(() => __diag1Copies), [], 'preview must not copy automatically');
            const summary = await preview.locator('.run-record-summary').innerText();
            assert.match(summary, /WeftMate 0\.1\.0/);
            assert.match(summary, /DIAG-1 synthetic diagnostics/);
            await shot('summary-preview');
            await preview.getByRole('button', { name: '复制摘要', exact: true }).click();
            await page.waitForFunction(() => __diag1Copies.length === 1);
            assert.deepEqual(await page.evaluate(() => __diag1Copies), [summary]);
            report.checks.push(`${prefix}: normal settings entry, human dates, ${scene} records, summary preview before exact clipboard copy, no desktop folder operation`);
          }
          assert.equal(await page.evaluate(() => state.page), 'general');
          assert.deepEqual(report.errors.filter(row => row.scene === prefix), [], `${prefix}: pageerror`);
        } finally { await context.close(); }
      }
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(join(out, 'mobile-web-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await fixture.close();
  await rm(fixture.root, { recursive: true, force: true });
}
