/**
 * WeftMate · Electron 主进程 —— 第一步只做一件事:趟平 sqlite 头号风险。
 *
 * memoweft 的 sqlite 驱动在 import/建 core 时【顶层急切执行】选择链:先 node:sqlite,
 * 失败再 better-sqlite3,都没有就抛人话错误(见库 src/store/nodeSqliteDriver.ts)。
 * 所以这个 smoke = 在 Electron 主进程里 createMemoWeftCore + 存一条 + 读回:
 *   - 跑通 → node:sqlite 在这个 Electron 版本的内置 Node 里可用,MVP 走它(零原生模块、最省事)。
 *   - 抛错 → node:sqlite 在 Electron 不可用,得装 better-sqlite3 + 对 Electron ABI 做 electron-rebuild。
 * 这一步结论定架构,所以放最前、主线亲验。
 */
import { app } from 'electron';
import { join } from 'node:path';
import { createMemoWeftCore } from 'memoweft';

app.whenReady().then(async () => {
  console.log('─'.repeat(60));
  console.log('[weftmate/smoke] Electron ready');
  console.log('[weftmate/smoke]   node   =', process.versions.node);
  console.log('[weftmate/smoke]   electron =', process.versions.electron);
  console.log('[weftmate/smoke]   chrome =', process.versions.chrome);

  const dbPath = join(app.getPath('userData'), 'weftmate-smoke.db');
  console.log('[weftmate/smoke]   dbPath =', dbPath);

  try {
    // 建 core 这一句就会触发 memoweft 的 sqlite 驱动选择链(顶层急切执行)。
    const core = createMemoWeftCore({ dbPath });
    console.log('[weftmate/smoke] ✓ createMemoWeftCore OK — 某个 sqlite 驱动在 Electron 主进程可用');

    const ev = await core.ingestUserMessage({ content: 'sqlite smoke test in electron main' });
    console.log('[weftmate/smoke] ✓ ingest OK — evidence id =', ev.id);

    const back = core.memory.listEvidence();
    console.log('[weftmate/smoke] ✓ read back OK — evidence count =', back.length);

    core.close();
    console.log('[weftmate/smoke] ═══ SMOKE PASSED — sqlite 在 Electron 可用,MVP 可直接 import memoweft 建 core ═══');
  } catch (e) {
    console.error('[weftmate/smoke] ✗ SMOKE FAILED:', e && e.message ? e.message : e);
    console.error('[weftmate/smoke] → node:sqlite 极可能在此 Electron 不可用;下一步:装 better-sqlite3 + @electron/rebuild 重编原生模块,打包时 asarUnpack 出 .node。');
  } finally {
    app.quit();
  }
});
