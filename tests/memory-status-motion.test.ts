import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { cleanupOwnedProcesses } from './helpers/process-evidence.mjs';
import { protectProcessOutput } from '../src/process-output.mjs';

protectProcessOutput();
test('memory loading animation preserves the disabled-state download link', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'memory-status-motion-'));
  const executable = createRequire(import.meta.url)('electron'), startedAt = Date.now();
  const env = { ...process.env, UX5_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    app = await _electron.launch({ executablePath: executable, args: [resolve('tests/helpers/rendering-electron.mjs')], env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!globalThis.WeftContent);
    await page.evaluate(() => {
      document.body.innerHTML = '<p id="memory-status" role="status" aria-live="polite"></p>';
      globalThis.WeftUiComponents = { factories: {} };
    });
    await page.addScriptTag({ path: resolve('src/ui-core/reply-motion.js') });
    await page.addScriptTag({ path: resolve('src/personal-access-ui/components/memory.js') });
    await page.evaluate(() => {
      const core = { memory: { status: null } };
      const ui = { byId: (id: string) => document.getElementById(id), element: (tag: string, className: string, text: string) => {
        const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
      } };
      globalThis.memoryStatusMotionFixture = { core, component: globalThis.WeftUiComponents.factories.memory(core, ui) };
      globalThis.memoryStatusMotionFixture.component.memoryStatus('正在检查记忆服务…');
    });
    await page.waitForFunction(() => document.getElementById('memory-status')?.classList.contains('reply-status'));
    await page.evaluate(() => {
      const fixture = globalThis.memoryStatusMotionFixture;
      fixture.core.memory.status = { state: 'disabled' };
      fixture.component.memoryStatus('这台电脑尚未开启记忆。');
    });
    // A second browser turn lets the real MutationObserver process the update.
    const result = await page.evaluate(() => {
      const status = document.getElementById('memory-status')!;
      const link = status.querySelector('a');
      return { href: link?.href, text: link?.textContent, role: status.getAttribute('role'), live: status.getAttribute('aria-live') };
    });
    assert.equal(result.href, 'https://weftmate.com/downloads/');
    assert.equal(result.text, '下载并安装最新版');
    assert.equal(result.role, 'status'); assert.equal(result.live, 'polite');
  } finally {
    if (app) await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
    cleanupOwnedProcesses({ startedAt, executables: [executable], commandRoots: [profile] });
    await rm(profile, { recursive: true, force: true });
  }
});
