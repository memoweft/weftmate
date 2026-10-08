import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
const repository = resolve(import.meta.dirname, '../..'), evidence = join(repository, 'tests/evidence/ui-4');
await mkdir(evidence, { recursive: true });
const fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, usageSamples: true, schedules: true, backups: true });
const profile = await mkdtemp(join(tmpdir(), 'weftmate-ui4-'));
const env = { ...process.env, REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_THEME: 'light' };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let application, browser;
const errors = [], checks = [];
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository, args: ['scripts/review-gallery/electron.mjs', '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-gpu'], env });
  await application.evaluate(({ app, ipcMain }) => {
    app.getLoginItemSettings = () => ({ openAtLogin: false }); app.setLoginItemSettings = () => {};
    globalThis.ui4UpdateChecks = 0; globalThis.ui4CanRestart = false;
    const state = () => ({layers:[{layer:'app',currentVersion:'0.1.0',status:'current'},{layer:'ui',currentVersion:'synthetic-ui',status:'current'},{layer:'mobile-ui',currentVersion:'synthetic-mobile',status:'current'}],canRestart:globalThis.ui4CanRestart});
    ipcMain.handle('wm:desktop:update-restart',()=>({restarted:false,reason:'合成任务运行中，请稍后重试。'}));
    ipcMain.handle('wm:desktop:update-state',state);ipcMain.handle('wm:desktop:update-check',()=>{globalThis.ui4UpdateChecks++;return state()});
  });
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
  await dialog.waitFor(); assert.equal(await page.getByRole('button',{name:'允许一次',exact:true}).count(),0); checks.push('modal hides background controls from accessibility');
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
    for (const [id, name] of [['general','常规'],['appearance','外观'],['account','账户'],['devices','设备'],['usage','用量'],['models','模型'],['approvals','审批'],['memory','记忆'],['schedules','提醒与定时任务'],['resources','资料访问'],['system','系统状态'],['backups','备份与恢复'],['about','关于']]) {
      await nav.getByRole('button', { name, exact: true }).click();
      if (id === 'about') await dialog.getByRole('button', {name:'检查更新',exact:true}).waitFor();
      if (id === 'backups') await page.waitForFunction(() => document.querySelector('.backup-settings [name=directory]').value === 'D:/Synthetic/UI-4-Backups');
      if (id === 'schedules') await dialog.getByRole('listitem', {name:'提交合成报告',exact:true}).waitFor();
      if (id === 'devices') assert.equal(await dialog.getByRole('button', {name:'配对连接',exact:true}).count(),0);
      if (id === 'usage') await dialog.getByRole('button', { name: '刷新用量', exact: true }).waitFor();
      await capture(`desktop-${theme}-${id}.png`);
    }
  }
  checks.push('all desktop categories light/dark');
  await nav.getByRole('button',{name:'关于',exact:true}).click();await dialog.getByRole('button',{name:'检查更新',exact:true}).click();
  await application.evaluate(async()=>{while(!globalThis.ui4UpdateChecks)await new Promise(done=>setTimeout(done,10))});checks.push('About version state and existing update action');
  await application.evaluate(()=>{globalThis.ui4CanRestart=true});await dialog.getByRole('button',{name:'检查更新',exact:true}).click();
  const restart=dialog.getByRole('button',{name:'重启并更新',exact:true});await restart.click();
  await dialog.getByRole('status').filter({hasText:'合成任务运行中，请稍后重试。'}).waitFor();assert.equal(await restart.isEnabled(),true);
  await application.evaluate(()=>{globalThis.ui4CanRestart=false});checks.push('blocked update restart displays recovery and reenables control');
  await nav.getByRole('button',{name:'备份与恢复',exact:true}).click();
  await dialog.getByRole('spinbutton',{name:'最近保留天数',exact:true}).fill('14');await dialog.getByRole('button',{name:'保存备份设置',exact:true}).click();
  await page.waitForFunction(async()=>{const value=await(await fetch('/personal/v1/backups')).json();return value.settings.dailyDays===14;});
  await dialog.getByRole('button',{name:'立即备份',exact:true}).click();await dialog.getByRole('button',{name:/^恢复 /}).waitFor();
  await dialog.getByRole('button',{name:/^恢复 /}).click();const restore=page.getByRole('dialog',{name:'恢复备份',exact:true});await restore.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(fixture.backupOperations.some(value=>value.startsWith('restore:')),false);
  await dialog.getByRole('textbox',{name:'另一台电脑的备份路径',exact:true}).fill('D:/Synthetic/import.wmb');await dialog.getByRole('button',{name:'导入备份',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.backup-settings').textContent.includes('备份已导入并通过校验'));
  assert.ok(fixture.backupOperations.includes('import'));checks.push('backup settings, create, import and restore cancellation');
  await nav.getByRole('button',{name:'提醒与定时任务',exact:true}).click();
  const reminder=dialog.getByRole('listitem',{name:'提交合成报告',exact:true});
  await reminder.getByRole('button',{name:'暂停',exact:true}).click();await reminder.getByRole('button',{name:'恢复',exact:true}).waitFor();
  assert.equal((await fixture.request('/schedules')).items[0].state,'paused');
  await reminder.getByRole('button',{name:'恢复',exact:true}).click();await reminder.getByRole('button',{name:'暂停',exact:true}).waitFor();
  await reminder.getByRole('button',{name:'立即运行',exact:true}).click();await page.waitForFunction(async()=>{const value=await(await fetch('/personal/v1/schedules')).json();return value.items[0].state==='completed';});
  await reminder.getByRole('button',{name:'删除',exact:true}).click();await reminder.waitFor({state:'hidden'});
  assert.equal((await fixture.request('/schedules')).items.length,0);checks.push('reminder pause, resume, run and delete');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await button('允许一次').waitFor(); checks.push('Escape close and background accessibility restored');
  await button('本对话用量').click(); await dialog.getByRole('heading', { name: '本对话用量', exact: true }).waitFor(); checks.push('conversation usage deep link');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(680, 800));
  await dialog.getByRole('combobox', { name: '设置分类', exact: true }).waitFor();
  assert.equal(await nav.isVisible(), false); await dialog.getByRole('combobox', { name: '设置分类', exact: true }).selectOption('appearance');
  await dialog.getByRole('group', { name: '颜色模式' }).waitFor(); checks.push('narrow category picker');
  await capture('desktop-narrow.png');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dialog.getByRole('combobox', { name: '设置分类', exact: true }).selectOption('general');
  const remainingMotion = await page.evaluate(() => document.getElementById('settings-dialog').getAnimations({ subtree: true }).map(animation => ({ target: animation.effect.target?.id || animation.effect.target?.className, duration: animation.effect.getComputedTiming().duration, state: animation.playState })));
  if(remainingMotion.length) console.log('Remaining settings motion:', JSON.stringify(remainingMotion));
  assert.equal(remainingMotion.length, 0); checks.push('reduced motion');
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
  for (const [id, name] of [['general','常规'],['appearance','外观'],['usage','用量'],['schedules','提醒与定时任务']]) {
    await list.getByRole('button', { name: new RegExp('^' + name + ' ') }).click();
    if (id === 'appearance') { await mobile.getByRole('button', { name: '深色', exact: true }).click(); await mobile.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await mobile.locator('html').getAttribute('data-theme'), 'dark'); }
    if(id === 'schedules') await mobile.getByRole('status').filter({hasText:'还没有提醒。'}).waitFor();
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
