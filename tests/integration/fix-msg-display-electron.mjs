// Production desktop shell, isolated personal host and synthetic history only.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

const repo = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fix-msg-display-'));
// Keep the shared fixture helper's managed-temp scan inside this test profile.
process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const out = process.env.WEFTMATE_MSG_DISPLAY_OUTPUT;
assert.ok(out, 'screenshot output must be outside the repository');
await mkdir(out, { recursive: true });
const bootstrap = join(profile, 'fix-msg-display-shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';\nconst {app}=createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)})('electron');\napp.setAppUserModelId('com.memoweft.weftmate.test.msg-display');\nawait import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs', import.meta.url).href)});\n`);
let app, fixture;
const killTree = () => {
  const child = app?.process();
  if (child?.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
};
const deadline = setTimeout(() => { killTree(); process.exitCode = 1; }, 90000);
try {
  fixture = await startFixture();
  const accountDay = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const at = new Date(accountDay + 'T06:32:00Z');
  const rows = fixture.logs.get(fixture.source);
  rows.find(row => row.type === 'user.message').at = new Date(+at - 96000).toISOString();
  for (const type of ['assistant.message', 'turn.ended']) rows.find(row => row.type === type).at = at.toISOString();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken, REVIEW_THEME: 'light', REVIEW_HIDDEN: '1', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repo, args: [bootstrap], env, timeout: 30000 });
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  const page = await app.firstWindow(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/personal/v1/settings/usage', route => route.fulfill({ json: { timeZone: 'Asia/Shanghai' } }));
  await feedbackUiSession(page, fixture, { native: true });
  await page.evaluate(async id => { await globalThis.__feedbackSessionCore.selectSession(id); }, fixture.source);
  const row = page.getByRole('group', { name: /助手消息/ }).last(); await row.waitFor();
  const bar = row.locator('.message-actions');
  await page.mouse.move(0, 0); assert.equal(await bar.isVisible(), false);
  await row.hover(); await bar.waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.message.assistant .message-time')].some(time => time.textContent === '14:32 · 用时 1 分 36 秒'));
  assert.match(await row.innerText(), /C:\\Synthetic\\private.txt/);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(out, 'reply-hover.png'), Buffer.from(png, 'base64'));
  await page.mouse.move(0, 0); await page.locator('#message-text').focus(); assert.equal(await bar.isVisible(), false);
  await row.focus(); assert.equal(await bar.isVisible(), true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
  assert.deepEqual(errors, []);
  console.log('PASS: hidden production Electron; hover/focus controls, account timezone, 96-second duration and original paths.');
} finally {
  clearTimeout(deadline); killTree();
  await app?.close().catch(error => { if (!/closed|EPIPE|Target/.test(error.message)) throw error; });
  await fixture?.close();
  await rm(profile, { recursive: true, force: true });
}
