import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const root = mkdtempSync(join(tmpdir(), 'weftmate-recall-noise-'));
process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(root, 'fixtures');
const { startTimelineCandidate } = await import('./timeline-ui-candidate.mjs');
for (const stream of [process.stdout, process.stderr]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const repository = resolve(import.meta.dirname, '../..');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_RECALL_TEST_PROFILE = root;
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const candidate = await startTimelineCandidate({ historyCount: 0, interactive: true });
const ownerId = (await candidate.request('/auth/me')).account.ownerId;
env.WEFTMATE_RECALL_TEST_ORIGIN = candidate.origin;
env.WEFTMATE_RECALL_TEST_TOKEN = candidate.libraryDesktopToken;
let application, pid, page;
const timeout = setTimeout(() => {
  if (pid && process.platform === 'win32') try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
  process.exit(1);
}, 120000);
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['tests/helpers/recall-noise-electron.mjs', '--personal-host', '--access-port=0', `--user-data-dir=${root}`], env, timeout: 60000 });
  pid = application.process().pid;
  console.log('Isolated desktop launched.');
  page = await application.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(15000);
  await page.waitForURL('**/personal/v1/ui*');
  console.log('Desktop client loaded.');
  await page.route('**/personal/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/ui')) return route.continue();
    if (/\/memory\/items\/cognition\/autumn(?:\/sources)?$/.test(url.pathname)) return route.fulfill({ json:
      url.pathname.endsWith('/sources') ? { ownerId, sources: [{ evidenceId: 'source-1', contentAvailable: true,
        rawContent: '我喜欢秋天。', recordedAt: '2026-01-01T08:00:00Z' }] } : { ownerId, item: { text: '用户喜欢秋天。' } } });
    const response = await route.fetch({ url: candidate.origin + url.pathname + url.search,
      headers: { ...route.request().headers(), origin: candidate.origin, 'x-weftmate-desktop': candidate.libraryDesktopToken } });
    if (/\/events$/.test(url.pathname)) {
      const body = await response.json();
      for (const event of body.events || []) if (event.type === 'assistant.message') event.data.memoryUsed = [
        { kind: 'cognition', id: 'autumn', summary: '记忆：用户喜欢秋天。\n用户原话 [2026-01-01T08:00:00Z]: 我喜欢秋天。' }];
      return route.fulfill({ response, json: body });
    }
    await route.fulfill({ response });
  });
  await page.reload();
  console.log('Synthetic routes ready.');
  await localUiSession(page, candidate.credentials, 'Synthetic recall regression', {
    nativeIdentity: { origin: candidate.origin, libraryDesktopToken: candidate.libraryDesktopToken },
  });
  const button = page.getByRole('button', { name: '查看这条回复参考的 1 条记忆来源', exact: true });
  await button.waitFor();
  assert.equal(await button.textContent(), '参考了 1 条记忆');
  await button.click();
  const section = page.locator('.reply-memory-source');
  await section.getByText('我喜欢秋天。', { exact: true }).waitFor();
  assert.equal(await section.getByText('用户喜欢秋天。', { exact: true }).count(), 1);
  assert.equal(await section.getByText('我喜欢秋天。', { exact: true }).count(), 1);
  assert.equal(await section.locator('p').filter({ hasText: /^记录于 / }).count(), 1);
  assert.doesNotMatch(await section.innerText(), /用户原话 \[|2026-01-01T|记忆：/);
  if (process.env.WEFTMATE_RECALL_SCREENSHOT) await page.screenshot({ path: process.env.WEFTMATE_RECALL_SCREENSHOT });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
  console.log('Recall label and readable sources passed in isolated hidden Electron.');
} catch (error) {
  if (page) console.error((await page.locator('body').innerText()).slice(-1800));
  throw error;
} finally {
  await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  // Kill only the test application process tree, including any children it started.
  if (pid && process.platform === 'win32') try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
  await application?.close().catch(() => {});
  await candidate.close();
  clearTimeout(timeout);
}
