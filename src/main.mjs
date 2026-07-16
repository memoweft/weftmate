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
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { appendFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createLocalDataWipeMarker,
  localDataWipeLaunchRequest,
  wipeLocalDataFromMarker,
} from './local-data-wipe.ts';

// 擦除重启必须发生在单实例锁、数据库和窗口之前。参数缺失、marker 伪造、目标不等于当前 userData 或删除失败都直接失败退出。
const wipeLaunch = localDataWipeLaunchRequest(process.argv);
if (wipeLaunch) {
  try {
    wipeLocalDataFromMarker({
      ...wipeLaunch,
      userData: app.getPath('userData'),
      tempDir: tmpdir(),
    });
    console.log('[weftmate] ✓ 已删除全部 WeftMate 本机数据，开始全新初始化');
  } catch (error) {
    console.error('[weftmate] ✗ 删除全部本机数据失败:', error && error.message ? error.message : error);
    process.exit(1);
  }
}

// Electron 默认让 OS 分配空闲端口；开发/诊断时仍可显式 PORT 固定。
const REQUESTED_PORT = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isInteger(REQUESTED_PORT) || REQUESTED_PORT < 0 || REQUESTED_PORT > 65535) {
  throw new RangeError(`PORT 必须是 0–65535 的整数，收到：${process.env.PORT}`);
}

// 去掉 Electron 默认应用菜单(顶栏那条 File/Edit/View/Window)——桌面伴侣产品不该露原生菜单,不像成品。
//   放模块顶层即可(whenReady 前设置也生效);置 null = 整条菜单不显示。
Menu.setApplicationMenu(null);

// ── B4·崩溃/错误上报最小闭环 ──
// 主进程一崩就是静默白屏,用户和作者都拿不到线索。全局兜住未捕获异常,滚动写 userData 日志
//   （前端「设置·关于」有查看/报告入口·G5）。守隐私:只记堆栈、不主动上传(发送要用户点·反馈回流走 issue)。
function logCrash(kind, err) {
  try {
    const p = join(app.getPath('userData'), 'weftmate-crash.log');
    try { if (statSync(p).size > 1_000_000) writeFileSync(p, ''); } catch { /* 首次无文件 */ } // 简单滚动:超 1MB 清一次
    const detail = err && err.stack ? err.stack : String(err);
    appendFileSync(p, `[${new Date().toISOString()}] ${kind}: ${detail}\n`);
  } catch { /* 日志都写不了就算了,别二次崩 */ }
}
process.on('uncaughtException', (err) => { logCrash('uncaughtException', err); });
process.on('unhandledRejection', (reason) => { logCrash('unhandledRejection', reason); });

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
let collectorMod = null; // collector.ts 模块(感知采集器;opt-in 时起,退出时停)
let isQuitting = false; // 是否在真退出(区分"关窗收托盘" vs "退出应用")
let cleanupDone = false; // shutdown() 是否已跑完(before-quit 二次放行)
let wipeRelaunching = false;

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
  process.env.PORT = String(REQUESTED_PORT);
  process.env.MEMOWEFT_EXPERIENCE = 'xingyao';
  delete process.env.MEMOWEFT_EXPERIENCE_UI; // 确保不是"纯库模式"(那会 process.exit)
  console.log('[weftmate] db =', dbPath);
  console.log('[weftmate] requested port =', REQUESTED_PORT === 0 ? 'automatic' : REQUESTED_PORT);

  // 先解密已存模型配置塞进 env(必须在 import server.ts 建 core 之前)——库构造时一次性读死 key(见 config-store)。
  //   没配/解不开 → injectEnv 静默跳过,core 起来但 llmReady=false,前端进配置向导("装完能用"路径)。
  try {
    const configStore = await import('./config-store.ts');
    configStore.injectEnv();
    console.log('[weftmate] ✓ 模型配置已注入 env(若已配)');
  } catch (e) {
    console.error('[weftmate] 读模型配置失败(当作未配,进配置向导):', e && e.message ? e.message : e);
  }

  // 库产出语言(认知/摘要):memoweft 0.4.0 起缺省 en,consolidate/distill 按 config.language 走 → 缺省出英文认知。
  //   按用户设置解析('auto'跟系统 zh-*→zh 否则 en / 'zh' / 'en'),【建 core 前】设 MEMOWEFT_LANG(config 在 import 时读死)。
  //   运行期改语言由 server 直接改 config.language(不重启,见 /api/settings/language)。聊天回复本就跟用户语言、不受此影响。
  try {
    const { resolvedLang } = await import('./settings.ts');
    process.env.MEMOWEFT_LANG = resolvedLang();
    console.log('[weftmate] 库语言 =', process.env.MEMOWEFT_LANG, '(跟设置/系统)');
  } catch (e) {
    console.error('[weftmate] 读语言设置失败(回落 en):', e && e.message ? e.message : e);
  }

  let loopback;
  let loopbackToken;
  try {
    // 复用现有 server.ts:主进程内起 loopback + 建 core(node:sqlite 已 S0 验)。捕获模块以便退出时调 shutdown()。
    serverMod = await import('./server.ts');
    loopback = await serverMod.ready;
    loopbackToken = serverMod.getLoopbackToken();
    console.log('[weftmate] ✓ server.ts 起来了(loopback + core)');
  } catch (e) {
    console.error('[weftmate] ✗ import server.ts 失败:', e && e.message ? e.message : e);
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1040, height: 740, minWidth: 760, minHeight: 520,
    title: 'WeftMate', backgroundColor: '#191a1e',
    // 无原生标题栏:前端自绘一条与 App 风格协调的标题栏(可拖拽 + 自定义 min/max/close,随主题上色)。
    frame: false,
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[weftmate] ✗ 前端加载失败', code, desc));

  // token 只在 Electron 网络层注入精确 /api/*；不进入页面、preload、URL、Cookie、env 或日志。
  const trustedWebContentsId = win.webContents.id;
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`${loopback.origin}/*`] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      let isTrustedApiUrl = false;
      try {
        const target = new URL(details.url);
        isTrustedApiUrl = target.origin === loopback.origin
          && (target.pathname === '/api' || target.pathname.startsWith('/api/'));
      } catch { /* 非法 URL 不注入 */ }
      if (details.webContentsId === trustedWebContentsId && isTrustedApiUrl) {
        for (const name of Object.keys(requestHeaders)) {
          if (name.toLowerCase() === 'authorization') delete requestHeaders[name];
        }
        requestHeaders.Authorization = `Bearer ${loopbackToken}`;
      }
      callback({ requestHeaders });
    },
  );

  // 主窗口永远留在可信 loopback origin。新开的 http(s) 链接交给系统浏览器，其余协议一律拒绝。
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== loopback.origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (protocol === 'http:' || protocol === 'https:') {
        void shell.openExternal(url).catch((error) => logCrash('openExternal', error));
      }
    } catch { /* 非法 URL 直接拒绝 */ }
    return { action: 'deny' };
  });

  // 删除全部本机数据只能走这一个窄 IPC。renderer 不接触 marker/token/文件系统；server 先关 mutation gate，主进程再创建一次性授权并重启擦除。
  ipcMain.handle('wm:delete-all-local-data', async (event, confirmation) => {
    if (!win || event.sender !== win.webContents) return { ok: false, code: 'WIPE_UNTRUSTED_SOURCE', error: '请求来源不可信' };
    if (confirmation !== '删除 WeftMate' && confirmation !== 'Delete WeftMate') return { ok: false, code: 'WIPE_BAD_CONFIRMATION', error: '确认短语不正确' };
    if (wipeRelaunching) return { ok: false, code: 'WIPE_ALREADY_PREPARING', error: '删除已经在准备中' };
    const prepared = await serverMod?.prepareLocalDataWipe?.();
    if (!prepared?.ok) return { ok: false, code: prepared?.code || 'WIPE_PREPARE_FAILED', error: prepared?.error || '当前不能删除本机数据' };
    try {
      const marker = createLocalDataWipeMarker({ tempDir: tmpdir(), userData: app.getPath('userData') });
      const args = process.argv.slice(1).filter((arg) => !arg.startsWith('--weftmate-wipe-marker=') && !arg.startsWith('--weftmate-wipe-token='));
      args.push(`--weftmate-wipe-marker=${marker.markerPath}`, `--weftmate-wipe-token=${marker.token}`);
      wipeRelaunching = true;
      isQuitting = true;
      collectorMod?.stopCollector?.();
      app.relaunch({ args });
      app.quit(); // 仍走既有 before-quit：collector → server/MCP/scheduler/core 全部收干净后才真正退出。
      return { ok: true, relaunching: true };
    } catch (error) {
      serverMod?.cancelPreparedLocalDataWipe?.();
      return { ok: false, code: 'WIPE_MARKER_FAILED', error: error && error.message ? error.message : String(error) };
    }
  });

  // 自绘标题栏的窗口控制(前端经 preload 暴露的 window.wmWindow.* 发来 IPC):
  ipcMain.on('wm:minimize', () => win?.minimize());
  ipcMain.on('wm:toggle-maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.on('wm:close', () => win?.close()); // 复用下面 'close' 处理:非退出=收托盘(与 X 一致)
  // 最大化状态变化 → 通知前端切换"最大化/还原"图标。
  win.on('maximize', () => win.webContents.send('wm:maximized', true));
  win.on('unmaximize', () => win.webContents.send('wm:maximized', false));
  // 页面加载完主动推一次当前最大化态——防"启动即最大化"时前端图标停在"最大化"没切成"还原"。
  win.webContents.on('did-finish-load', () => { try { win.webContents.send('wm:maximized', win.isMaximized()); } catch { /* 窗口已关忽略 */ } });

  // 关窗不退:X = 收进托盘。只有走"退出"(isQuitting=true)才让窗口真关。
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  try {
    await win.loadURL(loopback.origin);
    console.log('[weftmate] ✓ 窗口加载完成');
  } catch (e) {
    console.error('[weftmate] ✗ window.loadURL 失败:', e && e.message ? e.message : e);
    app.quit();
    return;
  }

  setupTray();

  // 感知采集器(阶段2·opt-in):只有用户在设置里开了才起。默认关(感知敏感)。采集走 /api/observe 审核层、observed 不上云。
  try {
    const { getPerceptionEnabled } = await import('./settings.ts');
    collectorMod = await import('./collector.ts');
    const collectorAllowed = (process.env.MEMOWEFT_HOST_COLLECTOR ?? 'on').toLowerCase() !== 'off';
    if (getPerceptionEnabled() && collectorAllowed) {
      collectorMod.startCollector(loopback.port, loopbackToken);
      console.log('[weftmate] ✓ 感知采集已开启(opt-in;活动窗口+活动节奏 → observed 不上云)');
    } else if (!collectorAllowed) {
      console.log('[weftmate] 感知采集被 MEMOWEFT_HOST_COLLECTOR=off 禁用');
    } else {
      console.log('[weftmate] 感知采集默认关(opt-in;设置里可开)');
    }
  } catch (e) {
    console.error('[weftmate] 感知采集器加载失败(忽略,不挡主流程):', e && e.message ? e.message : e);
  }

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
      collectorMod?.stopCollector?.(); // 停感知采集计时器
      await serverMod?.shutdown?.();
      console.log('[weftmate] ✓ 退出收尾:感知停采 + scheduler.dispose + core.close 完成');
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
