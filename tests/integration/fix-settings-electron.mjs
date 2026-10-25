// Real production desktop window, hidden, with a synthetic host and independent identity.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

const profile = await mkdtemp(join(tmpdir(), 'weftmate-fix-settings-'));
process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const out = process.env.WEFTMATE_SETTINGS_OUTPUT;
assert.ok(out, 'screenshots must be outside the repository'); await mkdir(out, { recursive: true });
const bootstrap = join(profile, 'fix-settings-shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';\nconst {app}=createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)})('electron');\napp.setAppUserModelId('com.memoweft.weftmate.test.fix-settings');\nawait import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs', import.meta.url).href)});\n`);
let app, fixture, child, page;
const killTree = () => { if (child?.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); };
const deadline = setTimeout(() => { killTree(); process.exitCode = 1; }, 120000);
const capture = async name => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')); await writeFile(join(out, name + '.png'), Buffer.from(png, 'base64')); };
try {
  fixture = await startFixture();
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken, REVIEW_THEME: 'light', REVIEW_HIDDEN: '1', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'), args: [bootstrap], env, timeout: 30000 });
  child = app.process();
  for (const stream of [child.stdout, child.stderr]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await feedbackUiSession(page, fixture, { native: true });
  await page.evaluate(async () => { await globalThis.__feedbackSessionCore.enterAssistant(); });
  await page.getByRole('textbox', { name: '输入消息', exact: true }).waitFor();
  await page.evaluate(() => WeftSettingsNavigation.open('general')); await page.locator('#settings-dialog').waitFor();
  if (!process.argv.includes('--appearance-only')) {
    await capture('general-before-or-after');
    const size = await page.evaluate(() => ({ dialog: document.querySelector('#settings-dialog').getBoundingClientRect().width, content: document.querySelector('.settings-category[data-category=general]').getBoundingClientRect().width }));
    assert.ok(size.dialog <= 1040, '#639 settings window is bounded'); assert.ok(size.content <= 700, '#639 content has a centered reading width');
    assert.ok(await page.locator('[data-category=general] .settings-group').count(), '#639 settings rows have titled groups');
  }
  await page.evaluate(() => WeftSettingsNavigation.open('appearance'));
  await capture('appearance-before-or-after');
  const advanced = page.locator('.appearance-advanced'); assert.equal(await advanced.count(), 1, '#646 advanced controls are collapsible');
  await advanced.locator('summary').click();
  await page.getByRole('spinbutton', { name: '界面字号', exact: true }).fill('16'); await page.getByRole('spinbutton', { name: '界面字号', exact: true }).press('Tab');
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '16px');
  await page.getByRole('spinbutton', { name: '内容字号', exact: true }).fill('19'); await page.getByRole('spinbutton', { name: '内容字号', exact: true }).press('Tab');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.appearance-code-preview')).fontSize === '19px');
  await page.evaluate(() => WeftDesktop.setAppearance({uiFontSize:'14',fontSize:'15'}));
  for (const theme of ['light', 'dark']) {
    await page.getByRole('group', { name: '颜色模式', exact: true }).getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await page.getByRole('textbox', { name: '背景色值', exact: true }).fill(theme === 'light' ? '#f5f5f5' : '#202020'); await page.getByRole('textbox', { name: '背景色值', exact: true }).press('Tab');
    await page.waitForFunction(color => document.documentElement.style.getPropertyValue('--canvas') === color, theme === 'light' ? '#f5f5f5' : '#202020');
    await page.locator('.settings-content').evaluate(el => el.scrollTop = 0); await capture('appearance-' + theme);
    await advanced.locator('summary').evaluate(el => el.scrollIntoView({block:'start'})); await capture('advanced-' + theme);
    await page.evaluate(() => WeftSettingsNavigation.open('general')); await capture('general-' + theme);
    await page.evaluate(() => WeftSettingsNavigation.open('account')); await capture('account-' + theme);
    await page.evaluate(() => WeftSettingsNavigation.open('appearance'));
  }
  const choose = async (label, value) => { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: value, exact: true }).click(); };
  await choose('强调色', '蓝色'); assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'blue');
  await page.getByRole('spinbutton', { name: '代码字号', exact: true }).fill('17'); await page.getByRole('spinbutton', { name: '代码字号', exact: true }).press('Tab');
  assert.equal(await page.locator('.appearance-code-preview pre code').evaluate(el => getComputedStyle(el).fontSize),'17px');
  await page.getByRole('textbox', { name: '前景色值', exact: true }).fill('#eeeeee'); await page.getByRole('textbox', { name: '前景色值', exact: true }).press('Tab');
  assert.equal(await page.locator('#settings-dialog').evaluate(el => getComputedStyle(el).color),'rgb(238, 238, 238)');
  const lineBefore = await page.locator('#settings-dialog').evaluate(el => getComputedStyle(el).getPropertyValue('--line'));
  await page.getByRole('slider', { name: '对比度', exact: true }).fill('90');
  assert.notEqual(await page.locator('#settings-dialog').evaluate(el => getComputedStyle(el).getPropertyValue('--line')),lineBefore);
  await choose('字体', '衬线'); assert.ok((await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily)).includes('Georgia'));
  await page.evaluate(() => WeftDesktop.setAppearance({theme:'system',accentLight:'green',accentDark:'blue',fontLight:'mono',fontDark:'serif'}));
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await page.locator('#appearance-accent').inputValue(),'blue','system changes keep the active mode control in sync');
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await page.locator('#appearance-accent').inputValue(),'green');
  assert.equal(await page.locator('#appearance-font').inputValue(),'mono');
  await page.getByRole('group', { name: '减少动态效果', exact: true }).getByRole('button', { name: '开启', exact: true }).click(); assert.equal(await page.evaluate(() => WeftReplyMotion.preference), 'reduce');
  await page.getByRole('group', { name: '减少动态效果', exact: true }).getByRole('button', { name: '系统', exact: true }).click(); assert.equal(await page.evaluate(() => WeftReplyMotion.preference), 'system');
  await page.getByRole('switch', { name: '页面全宽显示', exact: true }).check(); assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-page-full-width')), true);
  assert.equal(await page.locator('.chat-scroll').evaluate(el => getComputedStyle(el).paddingLeft),'24px');
  await page.getByRole('switch', { name: '半透明侧边栏', exact: true }).check(); assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-translucent-sidebar')), true);
  const before = await page.evaluate(() => WeftDesktop.getAppearance()); await page.reload(); await page.waitForFunction(() => !!globalThis.WeftDesktop && globalThis.__feedbackSessionCore?.state.device?.authKind === 'desktop'); await page.evaluate(async () => { await globalThis.__feedbackSessionCore.enterAssistant(); }); assert.deepEqual(await page.evaluate(() => WeftDesktop.getAppearance()), before);
  await page.getByRole('button', { name: '账户菜单', exact: true }).click(); await page.locator('#account-menu').waitFor(); await capture('account-menu');
  await page.getByRole('button', { name: '帮助', exact: true }).click(); await page.getByRole('menuitem', { name: '用户指南', exact: true }).waitFor(); await capture('account-help');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false); assert.deepEqual(errors, []);
  console.log('PASS #639/#646: bounded grouped settings, light/dark production Electron, live appearance preferences, renderer reload persistence, account help menu.');
} catch (error) {
  console.error(error); await capture('failure').catch(() => {}); throw error;
} finally {
  const closeDeadline = setTimeout(killTree, 5000);
  await app?.close().catch(error => { if (!/closed|EPIPE|Target/.test(error.message)) throw error; }); killTree();
  clearTimeout(closeDeadline); clearTimeout(deadline); await fixture?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
