import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
const repository = resolve(import.meta.dirname, '../..'), evidence = join(repository, 'tests/evidence/ui-4');
await mkdir(evidence, { recursive: true });
const fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, usageSamples: true });
const profile = await mkdtemp(join(tmpdir(), 'weftmate-ui4-'));
const env = { ...process.env, REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_THEME: 'light' };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let application, browser;
const errors = [], checks = [];
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository, args: ['scripts/review-gallery/electron.mjs', '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-gpu'], env });
  await application.evaluate(({ app }) => { app.getLoginItemSettings = () => ({ openAtLogin: false }); app.setLoginItemSettings = () => {}; });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
  await page.goto(fixture.origin + '/personal/v1/ui');
  await page.evaluate(async credentials => {
    const r = await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
    if (!r.ok) throw Error('Isolated login failed');
  }, fixture.credentials);
  await page.reload();
  const capture = async name => {
    if (process.argv.includes('--verify-only')) return;
    console.log("Capture", name);
    await page.evaluate(() => { for (const animation of document.getAnimations()) { if (animation.effect.getComputedTiming().iterations !== Infinity) animation.finish(); } });
    await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.waitForTimeout(250);
    const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(join(evidence, name), Buffer.from(png, 'base64'));
  };
  const button = name => page.getByRole('button', { name, exact: true });
  await button('账户菜单').click(); await button('设置').click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }), nav = dialog.getByRole('navigation', { name: '设置分类' });
  await dialog.waitFor();
  await nav.getByRole('button', { name: '外观', exact: true }).click();
  await button('深色').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.reload(); await button('账户菜单').click(); await button('设置').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark'); checks.push('appearance save and reload');
  await dialog.getByRole('searchbox', { name: '搜索设置' }).fill('费用');
  assert.equal(await nav.getByRole('button').count(), 1); await nav.getByRole('button', { name: '用量', exact: true }).click();
  await dialog.getByRole('heading', { name: '用量与费用', exact: true }).waitFor(); checks.push('keyword search');
  await dialog.getByRole('spinbutton', {name:'月度上限（元）',exact:true}).fill('10');
  await dialog.getByRole('spinbutton', {name:'仅本月临时上限（元）',exact:true}).fill('11');
  await dialog.getByRole('button', {name:'保存月度上限',exact:true}).click();
  await page.waitForFunction(async () => { const value=await(await fetch('/personal/v1/settings/usage')).json(); return value.monthlyLimit===10; });
  const savedUsage=await fixture.request('/settings/usage'); assert.equal(savedUsage.monthlyLimit,10);
  const totals=await fixture.request('/usage'); assert.equal(totals.total.requests,3); assert.ok(totals.total.cost>0); assert.equal(totals.budget.effectiveLimit,11);
  checks.push('usage totals and persisted monthly/temporary limits');
  await dialog.getByRole('searchbox', { name: '搜索设置' }).fill('');
  for (const theme of ['light', 'dark']) {
    await nav.getByRole('button', { name: '外观', exact: true }).click(); await button(theme === 'light' ? '浅色' : '深色').click();
    for (const [id, name] of [['general','常规'],['appearance','外观'],['account','账户'],['devices','设备'],['usage','用量'],['models','模型'],['approvals','审批'],['memory','记忆'],['resources','资料访问'],['system','系统状态'],['about','关于']]) {
      await nav.getByRole('button', { name, exact: true }).click();
      if (id === 'devices') assert.equal(await dialog.getByRole('button', {name:'配对连接',exact:true}).count(),0);
      if (id === 'usage') await dialog.getByRole('button', { name: '刷新用量', exact: true }).waitFor();
      await capture(`desktop-${theme}-${id}.png`);
    }
  }
  checks.push('all desktop categories light/dark');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); checks.push('Escape close');
  await button('本对话用量').click(); await dialog.getByRole('heading', { name: '本对话用量', exact: true }).waitFor(); checks.push('conversation usage deep link');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(680, 800));
  await dialog.getByRole('combobox', { name: '设置分类', exact: true }).waitFor();
  assert.equal(await nav.isVisible(), false); await dialog.getByRole('combobox', { name: '设置分类', exact: true }).selectOption('appearance');
  await dialog.getByRole('group', { name: '颜色模式' }).waitFor(); checks.push('narrow category picker');
  await capture('desktop-narrow.png');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dialog.getByRole('combobox', { name: '设置分类', exact: true }).selectOption('general');
  assert.equal(await page.evaluate(() => document.getElementById('settings-dialog').getAnimations({ subtree: true }).length), 0); checks.push('reduced motion');
  browser = await chromium.launch();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
  let mobileTheme = 'light';
  await mobile.route('**/bridge', async route => {
    const input=route.request().postDataJSON();
    if(input.method === 'cloud.callback') return route.fulfill({json:{result:{}}});
    if(input.method === 'settings.appearance') { mobileTheme = input.params.value || mobileTheme; return route.fulfill({json:{result:{value:mobileTheme}}}); }
    if(input.method === 'host.business') { try { return await route.fulfill({json:{result:await fixture.request(input.params.path.replace('/personal/v1',''),input.params.body,input.params.method)}}); } catch { return await route.fulfill({json:{error:{code:'CAPABILITY_UNAVAILABLE'}}}); } }
    await route.continue();
  });
  await mobile.goto(fixture.mobileUrl); await mobile.waitForFunction(() => state.booted);
  await mobile.evaluate(() => page('settings'));
  await mobile.getByRole('heading', { name: '设置', exact: true, level: 1 }).waitFor(); assert.equal(await mobile.locator('#home-page').isVisible(),false);
  await mobile.waitForTimeout(300);
  if (!process.argv.includes('--verify-only')) await mobile.screenshot({ path: join(evidence, 'mobile-list.png'), animations: 'disabled' });
  const list = mobile.getByRole('navigation', { name: '设置分类' });
  for (const [id, name] of [['general','常规'],['appearance','外观'],['usage','用量']]) {
    await list.getByRole('button', { name: new RegExp('^' + name + ' ') }).click();
    if (id === 'appearance') { await mobile.getByRole('button', { name: '深色', exact: true }).click(); await mobile.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await mobile.locator('html').getAttribute('data-theme'), 'dark'); }
    if(id === 'usage') await mobile.getByRole('button', {name:'刷新用量',exact:true}).waitFor();
    await mobile.waitForTimeout(300);
    if (!process.argv.includes('--verify-only')) await mobile.screenshot({ path: join(evidence, `mobile-${id}.png`), animations: 'disabled' });
    await mobile.keyboard.press('Escape'); await mobile.getByRole('heading', { name: '设置', exact: true, level: 1 }).waitFor(); assert.equal(await mobile.locator('#home-page').isVisible(),false);
  }
  await mobile.getByRole('searchbox', { name: '搜索设置' }).fill('费用'); assert.equal(await list.getByRole('button').count(), 1);
  await list.getByRole('button').click(); await mobile.keyboard.press('Escape'); assert.equal(await mobile.getByRole('searchbox', { name: '搜索设置' }).inputValue(), '费用');
  checks.push('mobile list, subpages, search and return');
  assert.deepEqual(errors, []);
  if (!process.argv.includes('--verify-only')) await writeFile(join(evidence, 'verification.json'), JSON.stringify({ realElectron: true, isolatedAccount: true, paidModelRequests: 0, checks, errors }, null, 2) + '\n');
  console.log('UI-4 passed:', checks.join(', '));
} finally {
  await browser?.close(); await application?.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application?.close().catch(() => {});
  await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(fixture.root, { recursive: true, force: true });
}
