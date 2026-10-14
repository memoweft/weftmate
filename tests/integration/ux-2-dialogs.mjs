import { evidencePath } from '../helpers/evidence-path.mjs';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, rm, writeFile, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { managedMkdtemp, managedTempRoot, disposeManagedTemp } from '../helpers/managed-temp.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root = resolve(import.meta.dirname, '../..'), out = evidencePath('ux-2');
await mkdir(out, { recursive: true });
let lock, fixture, profile, app;
const checks = [], errors = [];
try {
  for (let index = 1; index <= 3; index++) {
    const path = `D:/AIProjects/WeftMate/Runtime/Orchestrator/heavy-${index}.lock`;
    try { const file = await open(path, 'wx'); await file.writeFile(`UX-2 ${new Date().toISOString()} dialog Electron`); await file.close(); lock = path; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!lock) throw Error('No heavy slot available; retry later');
  fixture = await startTimelineCandidate({ daily: true, sidebar: true, logicalMobile: true, interactive: true, inlineProgress: true, historyCount: 0 });
  fixture.progress.finish('completed');
  console.log('UX-2 synthetic host ready');
  profile = await managedMkdtemp(join(managedTempRoot(), 'weftmate-ux2-dialog-'));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { WEFTMATE_TEST_HOST_NAME: 'synthetic-host', REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, args: ['tests/integration/ux-2-dialog-bootstrap.mjs'], env, timeout:30000 });
  console.log('UX-2 Electron connected');
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', () => errors.push('Unexpected browser dialog'));
  await localUiSession(page, fixture.credentials, 'Synthetic UX-2', { mainChat: true });
  console.log('UX-2 synthetic account ready');
  await page.getByRole('button', { name: '账户菜单', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '权限', exact: true }).click();
  const mode = page.getByRole('combobox', { name: '新对话的默认审批模式' });
  // Use the backing select, as the generated combobox menu is separately covered.
  const choose = async () => { await page.locator('#default-approval-mode').evaluate(n => { n.value = 'allow-all'; n.dispatchEvent(new Event('change', { bubbles: true })); }); };
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await choose();
    const dialog = page.getByRole('dialog', { name: '启用全部允许？', exact: true }); await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(n => n === document.activeElement), true);
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(n => n.contains(document.activeElement)), true); }
    const shape = await dialog.evaluate(n => { const r = n.getBoundingClientRect(), button = n.querySelector('.danger'); return { left: r.left, right: r.right, width: innerWidth, radius: getComputedStyle(n).borderRadius, fill: getComputedStyle(button).backgroundColor, text: getComputedStyle(button).color }; });
    assert.ok(shape.left >= 0 && shape.right <= shape.width); assert.notEqual(shape.radius, '0px'); assert.equal(shape.text,'rgb(255, 255, 255)');
    await page.screenshot({ path: join(out, `allow-all-electron-${theme}.png`) });
    checks.push({ theme, focusContained: true, cancelInitiallyFocused: true, shape });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.notEqual(await page.locator('#default-approval-mode').inputValue(), 'allow-all');
  }
  await app.evaluate(() => { globalThis.__ux2Desktop.window.setMinimumSize(320, 520); globalThis.__ux2Desktop.window.setContentSize(360, 780); });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await choose();
  const dialog = page.getByRole('dialog', { name: '启用全部允许？', exact: true }); await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await dialog.evaluate(n => n.scrollWidth > n.clientWidth), false);
  const narrow = await dialog.evaluate(n => ({ height:n.getBoundingClientRect().height, viewport:innerHeight, css:getComputedStyle(n).height, minHeight:getComputedStyle(n).minHeight, maxHeight:getComputedStyle(n).maxHeight, display:getComputedStyle(n).display, width:innerWidth, footer:getComputedStyle(n.querySelector('.dialog-footer')).marginTop }));
  console.log('UX-2 narrow geometry',JSON.stringify(narrow));
  assert.ok(narrow.height < narrow.viewport / 2);
  await page.screenshot({ path: join(out, 'allow-all-electron-360.png') });
  await page.keyboard.press('Enter'); await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.getElementById('default-approval-mode').value === 'allow-all');
  await app.evaluate(() => globalThis.__ux2Desktop.window.webContents.send('wm:ui:notice', { id:'synthetic-notice', title:'更新尚未就绪', message:'请等待下载与任务完成后重试。' }));
  const notice = page.getByRole('dialog', { name:'更新尚未就绪', exact:true }); await notice.waitFor(); await page.keyboard.press('Enter'); await notice.waitFor({ state:'detached' });
  // The same production component respects both the system and in-app reduced-motion setting.
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.evaluate(() => { void WeftDialogs.allowAll(); });
  const reduced = page.getByRole('dialog', { name:'启用全部允许？', exact:true }); await reduced.waitFor();
  assert.equal(await reduced.evaluate(n => n.getAnimations().length), 0); await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'dialog-checks.json'), JSON.stringify({ realElectron:true, synthetic:true, checks, requestedNarrowWidth:360, narrowViewport:narrow, enterConfirms:true, escapeCancels:true, updateIpc:true, reducedMotion:true, errors }, null, 2) + '\n');
} finally {
  await app?.close(); await fixture?.close(); if (profile) disposeManagedTemp(profile); if (fixture) disposeManagedTemp(fixture.root); if (lock) await rm(lock);
}
