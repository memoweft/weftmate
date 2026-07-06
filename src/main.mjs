/**
 * WeftMate · Electron 主进程(S1 骨架)。
 *
 * 最省事的复用:现有 Host 的 server.ts 顶层就建 core(node:sqlite,已 S0 验)+ 起 127.0.0.1
 * loopback server + serve 前端。所以主进程只需:设好库路径(userData)/端口/默认人格 →
 * import server.ts 起服务 → 开 BrowserWindow 加载 loopback URL。前端 fetch('/api/*') 打到
 * 同一 loopback,几乎零改(D4)。
 *
 * S1 验证版:起服务 + 开窗 + 事件日志,5 秒后自动退(生产版窗口常驻、不自动退)。
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

const PORT = 7788;

// 单实例锁:桌面常驻防开多份进程抢同一个 sqlite 库(单写)。
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

app.whenReady().then(async () => {
  // 让复用的 server.ts 建对库(打包后 app 目录只读,DB 必须落 userData)、起对端口、默认星瑶、非纯库模式。
  const dbPath = join(app.getPath('userData'), 'weftmate.db');
  process.env.MEMOWEFT_HOST_DB = dbPath;
  process.env.PORT = String(PORT);
  process.env.MEMOWEFT_EXPERIENCE = 'xingyao';
  delete process.env.MEMOWEFT_EXPERIENCE_UI; // 确保不是"纯库模式"(那会 process.exit)
  console.log('[weftmate/S1] db =', dbPath);
  console.log('[weftmate/S1] port =', PORT);

  try {
    // 复用现有 Host 的 server.ts:主进程内起 loopback + 建 core(node:sqlite 已 S0 验)。
    await import('./server.ts');
    console.log('[weftmate/S1] ✓ import server.ts OK — loopback server + core 起来了(Electron main 能跑 .ts)');
  } catch (e) {
    console.error('[weftmate/S1] ✗ import server.ts 失败:', e && e.message ? e.message : e);
    console.error('[weftmate/S1] → 若是 TS 解析错,说明 Electron main 不 strip TS,需编译 .ts→.js');
    app.quit();
    return;
  }

  // server.listen 异步,粗糙等一下 ready(S1 够用;后续换成轮询/等 server 事件)。
  await new Promise((r) => setTimeout(r, 800));

  win = new BrowserWindow({ width: 1040, height: 740, title: 'WeftMate', backgroundColor: '#1a1a1a' });
  win.webContents.on('did-finish-load', () => console.log('[weftmate/S1] ✓ 前端 did-finish-load'));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[weftmate/S1] ✗ 前端加载失败', code, desc));
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.error('[weftmate/S1] 前端 console error:', msg);
  });

  try {
    await win.loadURL(`http://127.0.0.1:${PORT}`);
    console.log('[weftmate/S1] ✓ window.loadURL OK');
  } catch (e) {
    console.error('[weftmate/S1] ✗ window.loadURL 失败:', e && e.message ? e.message : e);
  }

  console.log('[weftmate/S1] ═══ 骨架就位:窗口常驻。聊天需先配模型(S3 设置界面);记忆随聊天积累 ═══');
});

app.on('window-all-closed', () => app.quit());
