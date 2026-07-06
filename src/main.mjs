/**
 * WeftMate · Electron 主进程(阶段1·桌面常驻版)。
 *
 * 复用思路(S1 已验):现有 server.ts 顶层就建 core(node:sqlite)+ 起 127.0.0.1 loopback + serve 前端。
 *   主进程只需:设好库路径(userData)/端口/默认人格 → import server.ts 起服务 → 开 BrowserWindow 加载
 *   loopback URL。前端 fetch('/api/*') 打到同一 loopback,几乎零改(D6)。
 *
 * 阶段1·桌面化收尾(本文件本轮的活):
 *   ① 托盘常驻:系统托盘图标 + 右键菜单(显示/退出),左键点=显示窗口。
 *   ② 关窗不退:点窗口 X = 收进托盘(hide),不真退——桌面伴侣要一直在。真退只走托盘"退出"。
 *   ③ before-quit 生命周期:退出前调 server 的 shutdown()(scheduler.dispose + core.close + 关 loopback),
 *      别让后台整理计时器/库连接悬着。异步收尾用 preventDefault 兜住,清完再放行。
 *   ④ 单实例:抢不到锁的第二个实例直接退;已在跑的实例收到 second-instance 事件时把窗口唤到前台。
 */
import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';

const PORT = 7788;

// 托盘图标:内嵌 data URL(32x32 金色圆),免打包路径/asarUnpack 麻烦。生成脚本见 scratchpad/gen-tray-icon.mjs。
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAw0lEQVR42t2XvQ3EIAxGmYCt2IHGC7CDd8gW3oAd6L1PTidBE5F/sH1XvAYl+l4ggO2YwGniflHAM0FggsQEWEl1zM8UiEyQmWA9Iddnhwl8v6xcCN5S6ruvBPBB8BZ8KrAMCG8sdwVwYPjhTOyt+TqJcEWgTBQoZwJxYngjHglkAYG8J+AFwhu+JxAEBUJPIAkKpJ4ACgqgSQH1JVD/CdW3ofpBZOIoVr+MTFzH6gWJiZLMRFFqoiw30ZiYac3+szv+AFmwm0RJO4seAAAAAElFTkSuQmCC';

// 单实例锁:桌面常驻防开多份进程抢同一个 sqlite 库(单写)。抢不到 = 已有一个在跑,退出自己,让那个把窗口唤前台。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 第二个实例被拉起(用户又点了图标):把已在跑的窗口唤到前台。
  app.on('second-instance', showWindow);
  app.whenReady().then(bootstrap);
}

let win = null;
let tray = null;
let serverMod = null; // server.ts 模块(拿它的 shutdown())
let isQuitting = false; // 是否在真退出(区分"关窗收托盘" vs "退出应用")
let cleanupDone = false; // shutdown() 是否已跑完(before-quit 二次放行)

/** 把窗口唤到前台(托盘点击 / 第二实例 / 菜单"显示")。 */
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function bootstrap() {
  // 让复用的 server.ts 建对库(打包后 app 目录只读,DB 必须落 userData)、起对端口、默认星瑶、非纯库模式。
  const dbPath = join(app.getPath('userData'), 'weftmate.db');
  process.env.MEMOWEFT_HOST_DB = dbPath;
  process.env.PORT = String(PORT);
  process.env.MEMOWEFT_EXPERIENCE = 'xingyao';
  delete process.env.MEMOWEFT_EXPERIENCE_UI; // 确保不是"纯库模式"(那会 process.exit)
  console.log('[weftmate] db =', dbPath);
  console.log('[weftmate] port =', PORT);

  // 先解密已存模型配置塞进 env(必须在 import server.ts 建 core 之前)——库构造时一次性读死 key(见 config-store)。
  //   没配/解不开 → injectEnv 静默跳过,core 起来但 llmReady=false,前端进配置向导("装完能用"路径)。
  try {
    const configStore = await import('./config-store.ts');
    configStore.injectEnv();
    console.log('[weftmate] ✓ 模型配置已注入 env(若已配)');
  } catch (e) {
    console.error('[weftmate] 读模型配置失败(当作未配,进配置向导):', e && e.message ? e.message : e);
  }

  try {
    // 复用现有 server.ts:主进程内起 loopback + 建 core(node:sqlite 已 S0 验)。捕获模块以便退出时调 shutdown()。
    serverMod = await import('./server.ts');
    console.log('[weftmate] ✓ server.ts 起来了(loopback + core)');
  } catch (e) {
    console.error('[weftmate] ✗ import server.ts 失败:', e && e.message ? e.message : e);
    app.quit();
    return;
  }

  // server.listen 异步,粗糙等一下 ready(够用;后续可换成等 server 事件)。
  await new Promise((r) => setTimeout(r, 800));

  win = new BrowserWindow({ width: 1040, height: 740, title: 'WeftMate', backgroundColor: '#191a1e' });
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[weftmate] ✗ 前端加载失败', code, desc));

  // 关窗不退:X = 收进托盘。只有走"退出"(isQuitting=true)才让窗口真关。
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  try {
    await win.loadURL(`http://127.0.0.1:${PORT}`);
    console.log('[weftmate] ✓ 窗口加载完成');
  } catch (e) {
    console.error('[weftmate] ✗ window.loadURL 失败:', e && e.message ? e.message : e);
  }

  setupTray();
  console.log('[weftmate] ═══ 桌面常驻就位:关窗收托盘、托盘"退出"才真退 ═══');
}

/** 系统托盘:常驻图标 + 菜单(显示/退出),左键点=显示窗口。 */
function setupTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  tray.setToolTip('WeftMate');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 WeftMate', click: showWindow },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow); // Windows 习惯:左键点托盘图标唤起窗口
}

// 退出前收尾:先拦下(异步 shutdown 跑不完就退会漏关库),清完再放行二次退出。
app.on('before-quit', (e) => {
  isQuitting = true;
  if (cleanupDone) return; // 已清理完 → 放行真正退出
  e.preventDefault();
  (async () => {
    try {
      await serverMod?.shutdown?.();
      console.log('[weftmate] ✓ 退出收尾:scheduler.dispose + core.close 完成');
    } catch (err) {
      console.error('[weftmate] 退出收尾出错(仍继续退出):', err && err.message ? err.message : err);
    }
    cleanupDone = true;
    app.quit(); // 再触发 before-quit,这次 cleanupDone=true 放行
  })();
});

// 托盘常驻:窗口全关也不退出(关窗已被 hide 兜住,这里是双保险)。真退只走托盘"退出"→ before-quit。
app.on('window-all-closed', () => {
  /* 桌面伴侣常驻托盘,不随窗口关闭而退出 */
});
