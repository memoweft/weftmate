/**
 * WeftMate · Electron 主进程（R1 · 官方 DSH web 基座）。
 *
 * 职责（docs/ARCHITECTURE.md v3 §2）：
 *   ① 凭据接缝：safeStorage 解密 active 模型档 → 只经子进程 env 注入（DEEPSEEK_API_KEY /
 *     DEEPSEEK_BASE_URL），key 不明文落盘。
 *   ② 运行时：boot 时把 profile `weftmate` 写进 dsh-home（bundles [dsh-base, dsh-web-app]
 *     + cordis.patch.yml 补丁层），spawn 官方 CLI `dsh --profile weftmate --port 0`
 *     （ELECTRON_RUN_AS_NODE=1，Node 用 Electron 自带，不依赖 PATH 里的 node）。
 *   ③ 窗口：等官方 URL 行（`dsh web: http://127.0.0.1:<port>`）→ BrowserWindow 加载官方前端
 *     origin（loopback + 官方 trust fence；受信 webContents 只留在运行时 origin）。
 *   ④ 桌面壳遗产（v2 保留）：托盘常驻、单实例、关窗收托盘、before-quit 收口、更新接缝、
 *     桌面宠物窗口（R4 收口为「托盘+主窗口」，宠物代码保留在盘上待 R6 恢复完整桌宠）。
 *
 * v2 的 SDK 聊天/桥/旧 UI 等主链路已随 R4 退役删除（见 docs/ARCHITECTURE.md §4 退役清单）。
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen } from 'electron';
import { join } from 'node:path';
import { appendFileSync, writeFileSync, statSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createLocalDataWipeMarker,
  localDataWipeLaunchRequest,
  wipeLocalDataFromMarker,
} from './local-data-wipe.ts';
import {
  clampPetBounds,
  choosePetWorkArea,
  extendedWorkAreas,
  pickPetDockTarget,
  pickPetRoamTargetBiased,
  petRoamDelayMs,
  samePetBounds,
  tuckPetBounds,
} from './desktop-pet-motion.ts';
import { DshWebRuntime } from './dsh-web-runtime.ts';
import { checkForUpdates, initUpdater, quitAndInstall, updateState } from './update.ts';
import { initPerception } from './perception.ts';
import { initDevices } from './devices.ts';

// ── R5 · userData 隔离 ──
// 打包形态产品数据目录 = <appData>/com.memoweft.weftmate（appId 命名，与 dev 的 'weftmate'
// 大小写不敏感冲突——Windows 上 'WeftMate' ≡ 'weftmate' 是同一目录，产品名命名无效）。
// 隔离目的：① 单实例锁不再互斥（dev 与打包可同时跑）；② v2 遗留的开发数据
// （weftmate.db/旧画像/旧设置）不进产品目录。必须在任何 userData 读取（含顶部擦除请求）之前设置。
if (app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'com.memoweft.weftmate'));
}

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

// 去掉 Electron 默认应用菜单(顶栏那条 File/Edit/View/Window)——桌面产品不该露原生菜单,不像成品。
Menu.setApplicationMenu(null);

// ── B4·崩溃/错误上报最小闭环（v2 遗产）──
function logCrash(kind, err) {
  try {
    const p = join(app.getPath('userData'), 'weftmate-crash.log');
    try { if (statSync(p).size > 1_000_000) writeFileSync(p, ''); } catch { /* 首次无文件 */ }
    const detail = err && err.stack ? err.stack : String(err);
    appendFileSync(p, `[${new Date().toISOString()}] ${kind}: ${detail}\n`);
  } catch { /* 日志都写不了就算了,别二次崩 */ }
}
process.on('uncaughtException', (err) => { logCrash('uncaughtException', err); });
process.on('unhandledRejection', (reason) => { logCrash('unhandledRejection', reason); });

// 托盘图标:内嵌 data URL(32x32 冷蓝纬线纹,与 build/icon.png 同源),免打包路径/asarUnpack 麻烦。
const TRAY_ICON =
  'data:image/png;base64,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';

// 单实例锁:桌面常驻防开多份进程抢同一个数据目录。抢不到 = 已有一个在跑,退出自己,让那个把窗口唤前台。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 第二个实例被拉起(用户又点了图标):把已在跑的窗口唤到前台。
  app.on('second-instance', showWindow);
  app.whenReady().then(bootstrap);
}

let win = null;
let tray = null;
let settingsMod = null; // settings.ts 模块(宠物窗口状态——本机显示偏好)
let configStoreMod = null; // config-store.ts 模块(模型档 safeStorage 存取;DSH 凭据接缝从这里取)
let webRuntime = null; // DSH web 运行时管理器(R1-02:写 profile→spawn 官方 CLI→URL 行→退出收口)
let perceptionRuntime = null; // 桌面感知采集面(R6-01:opt-in 采集→双工文件→运行时宿主插件)
let devicesRuntime = null; // 设备接缝(R8-01:配对 token/设备登记/手机观察消费)
let petStoreMod = null; // 宠物 Store(R6-02:userData/weftmate-pets.json→companion 状态)
let desktopPetWin = null;
let desktopCompanion = null;
let desktopPetMoveTimer = null;
let desktopPetActivityTimer = null;
let desktopPetMotion = null;
let desktopPetPresenceTimer = null;
let desktopPetProgrammaticMove = false;
let desktopPetPointerInside = false;
let desktopPetPointerEnteredAt = 0;
let desktopPetManualPauseUntil = 0;
let desktopPetDragState = null;
let desktopPetNextWanderAt = 0;
let desktopPetDwellTimer = null;
let desktopPetLastBehaviorAt = 0;
let desktopPetLastActivityCheckAt = 0;
let desktopPetLastCursor = null;
let desktopPetInteractionUntil = 0;
let desktopPetComposerActiveUntil = 0;
let desktopPetPreDockBounds = null;
let desktopPetDocked = false;
let desktopPetIgnoreMovedUntil = 0;
let isQuitting = false; // 是否在真退出(区分"关窗收托盘" vs "退出应用")
let cleanupDone = false; // shutdown() 是否已跑完(before-quit 二次放行)
let wipeRelaunching = false;
let webBootReloads = 0; // web boot 失败自愈计数（防抖限次）

/** 把窗口唤到前台(托盘点击 / 第二实例 / 菜单"显示")。 */
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const PET_WINDOW_SIZE = { width: 132, height: 132 };
const PET_SHAPES = new Set(['orbit', 'sprout', 'wisp']);
const PET_FEATURES = new Set(['thread', 'leaf', 'halo', 'ears']);
const PET_PROACTIVITY = new Set(['quiet', 'light', 'companion']);
const PET_ACTIVITY = new Set(['idle', 'running', 'waiting', 'review', 'failed']);
const PET_COLOR = /^#[0-9a-f]{6}$/i;

/** renderer 输入只取显示所需字段；宠物窗口永远拿不到记忆、提示词、工具、密钥或路径。 */
function sanitizeCompanionState(value) {
  if (!value || typeof value !== 'object' || !value.persona || !value.pet) return null;
  const persona = value.persona;
  const pet = value.pet;
  const appearance = pet.appearance;
  const clean = (candidate, max) => typeof candidate === 'string' ? candidate.trim().slice(0, max) : '';
  const personaId = clean(persona.id, 120), personaName = clean(persona.name, 80);
  const petId = clean(pet.id, 120), petName = clean(pet.name, 80), description = clean(pet.description, 300);
  if (!personaId || !personaName || !petId || !petName || !appearance || typeof appearance !== 'object') return null;
  if (!PET_SHAPES.has(appearance.shape) || !PET_FEATURES.has(appearance.feature)) return null;
  if (!PET_COLOR.test(appearance.primary) || !PET_COLOR.test(appearance.accent)) return null;
  const proactivity = PET_PROACTIVITY.has(value.proactivity) ? value.proactivity : 'light';
  const activity = PET_ACTIVITY.has(value.activity) ? value.activity : 'idle';
  // 形态（owner 拍板：逻辑固定、形态可变）：只放行图片形态（data URL 形状 + 体积上限），其余一律内置星瑶。
  const form = pet.form && pet.form.kind === 'image'
    && typeof pet.form.dataUrl === 'string'
    && pet.form.dataUrl.length <= 4_000_000
    && /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(pet.form.dataUrl)
    ? { kind: 'image', dataUrl: pet.form.dataUrl }
    : null;
  return {
    persona: { id: personaId, name: personaName },
    pet: {
      schemaVersion: 1, id: petId, name: petName, description,
      appearance: {
        kind: 'procedural', shape: appearance.shape, primary: appearance.primary.toLowerCase(),
        accent: appearance.accent.toLowerCase(), feature: appearance.feature,
      },
      ...(form ? { form } : {}),
    },
    proactivity, activity,
  };
}

function desktopPetBounds(saved = {}) {
  const width = PET_WINDOW_SIZE.width, height = PET_WINDOW_SIZE.height;
  const hasSaved = Number.isFinite(saved.x) && Number.isFinite(saved.y);
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const candidate = {
    x: hasSaved ? Math.round(saved.x) : area.x + area.width - width - 24,
    y: hasSaved ? Math.round(saved.y) : area.y + area.height - height - 24,
    width, height,
  };
  return clampPetBounds(candidate, screen.getAllDisplays().map((item) => item.workArea));
}

function persistDesktopPet(visible) {
  if (!settingsMod) return;
  const bounds = desktopPetWin && !desktopPetWin.isDestroyed() ? desktopPetWin.getBounds() : settingsMod.getDesktopPetWindowState?.();
  const freeActivity = settingsMod.getDesktopPetWindowState?.().freeActivity === true;
  try { settingsMod.setDesktopPetWindowState?.({ visible: visible === true, x: bounds?.x, y: bounds?.y, freeActivity }); }
  catch (error) { logCrash('desktop-pet-settings', error); }
}

function desktopPetVisible() {
  return !!desktopPetWin && !desktopPetWin.isDestroyed() && desktopPetWin.isVisible();
}

function desktopPetFreeActivity() {
  return settingsMod?.getDesktopPetWindowState?.().freeActivity === true;
}

function notifyDesktopPetVisibility() {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('wm:pet-visibility', { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() }); } catch { /* 主窗口正在关闭 */ }
  refreshTrayMenu();
}

function setDesktopPetFreeActivity(enabled) {
  const previous = settingsMod?.getDesktopPetWindowState?.() ?? { visible: desktopPetVisible(), freeActivity: false };
  settingsMod?.setDesktopPetWindowState?.({ ...previous, visible: desktopPetVisible(), freeActivity: enabled === true });
  if (enabled) {
    desktopPetNextWanderAt = Date.now() + 8_000;
    startDesktopPetActivityController();
  } else {
    stopDesktopPetActivityController(true);
  }
  notifyDesktopPetVisibility();
}

function sendDesktopCompanion() {
  if (!desktopPetWin || desktopPetWin.isDestroyed() || !desktopCompanion) return;
  const enabled = settingsMod?.getPerceptionEnabled?.() === true;
  // 感知采集器随旧运行时退役（R1 官方基座无 presence 面）；在场态恒为未知。
  const presence = enabled ? { running: false, state: 'unknown' } : { running: false, state: 'off' };
  try { desktopPetWin.webContents.send('wm:pet-state', { ...desktopCompanion, presence }); } catch { /* 窗口正在关闭 */ }
}

function desktopPetPresenceAllowsRoam() {
  if (settingsMod?.getPerceptionEnabled?.() !== true) return true;
  return true; // 旧采集器已退役；在场态恒允许
}

function cancelDesktopPetMotion() {
  desktopPetMotion = null;
  desktopPetProgrammaticMove = false;
}

function desktopPetCanWander() {
  return desktopPetVisible() && desktopPetFreeActivity() && !desktopPetPointerInside && !desktopPetDragState
    && Date.now() >= desktopPetManualPauseUntil
    && desktopCompanion?.activity === 'idle'
    && desktopPetPresenceAllowsRoam();
}

function clampDesktopPetWindow(save = true) {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return null;
  const current = desktopPetWin.getBounds();
  const safe = clampPetBounds(current, screen.getAllDisplays().map((item) => item.workArea));
  if (!samePetBounds(current, safe)) {
    desktopPetProgrammaticMove = true;
    desktopPetWin.setBounds(safe);
    desktopPetProgrammaticMove = false;
  }
  if (save) persistDesktopPet(desktopPetWin.isVisible());
  return safe;
}

function recoverDesktopPetToCorner() {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return;
  cancelDesktopPetMotion();
  desktopPetPreDockBounds = null;
  desktopPetDocked = false;
  const area = screen.getPrimaryDisplay().workArea;
  desktopPetProgrammaticMove = true;
  desktopPetIgnoreMovedUntil = Date.now() + 500;
  desktopPetWin.setBounds({
    x: area.x + area.width - PET_WINDOW_SIZE.width - 24,
    y: area.y + area.height - PET_WINDOW_SIZE.height - 24,
    ...PET_WINDOW_SIZE,
  });
  desktopPetProgrammaticMove = false;
  clampDesktopPetWindow(true);
  desktopPetNextWanderAt = Date.now() + 45_000;
}

function sendDesktopPetBehavior(kind, cursor = null, speed = 0) {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return;
  // avoid 已退役（owner 拍板 2026-08-16）：宠物不躲鼠标，靠近只注视。
  const allowed = new Set(['idle', 'watch', 'notice', 'wander', 'dock', 'rest']);
  const safeKind = allowed.has(kind) ? kind : 'idle';
  const bounds = desktopPetWin.getBounds();
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const dx = cursor ? cursor.x - center.x : 0, dy = cursor ? cursor.y - center.y : 0;
  const length = Math.hypot(dx, dy) || 1;
  try {
    desktopPetWin.webContents.send('wm:pet-behavior', {
      kind: safeKind,
      lookX: Math.round(Math.max(-1, Math.min(1, dx / length)) * 100) / 100,
      lookY: Math.round(Math.max(-1, Math.min(1, dy / length)) * 100) / 100,
      speed: Math.round(speed),
    });
  } catch { /* 宠物窗口正在关闭 */ }
}

function startDesktopPetMotion(target, reason, save = true) {
  if (!desktopPetWin || desktopPetWin.isDestroyed() || desktopPetDragState) return;
  cancelDesktopPetMotion();
  clearTimeout(desktopPetDwellTimer);
  const start = desktopPetWin.getBounds();
  if (samePetBounds(start, target)) return;
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const duration = Math.min(2_400, Math.max(700, distance * 4));
  const workAreas = screen.getAllDisplays().map((item) => item.workArea);
  desktopPetMotion = {
    start, target, reason, save, startedAt: Date.now(), duration, workAreas,
    arc: Math.min(18, Math.max(6, distance * .055)), lastX: start.x, lastY: start.y,
    // 真人感：长距离游走有约一半概率中途停一下看看四周再继续。
    midPause: reason === 'wander' && distance > 240 && Math.random() < 0.5
      ? { startTime: 0, until: 0, holdMs: 0, done: false }
      : null,
  };
  sendDesktopPetBehavior(reason === 'restore' ? 'wander' : reason, {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  }, Math.round(distance / duration * 1000));
}

function completeDesktopPetMotion(motion) {
  if (!desktopPetWin || desktopPetWin.isDestroyed() || desktopPetMotion !== motion) return;
  desktopPetMotion = null;
  desktopPetProgrammaticMove = false;
  if (motion.reason === 'dock') desktopPetDocked = true;
  if (motion.reason === 'restore') { desktopPetDocked = false; desktopPetPreDockBounds = null; }
  // 游走收尾允许半隐藏出屏（owner 拍板）：软夹取只防完全跑丢，不把挂边的宠物拽回屏内。
  if (motion.reason === 'wander') {
    const current = desktopPetWin.getBounds();
    const soft = clampPetBounds(current, extendedWorkAreas(screen.getAllDisplays().map((item) => item.workArea), {
      width: Math.round(PET_WINDOW_SIZE.width * .6),
      height: Math.round(PET_WINDOW_SIZE.height * .6),
    }));
    if (!samePetBounds(current, soft)) {
      desktopPetProgrammaticMove = true;
      desktopPetWin.setBounds(soft);
      desktopPetProgrammaticMove = false;
    }
    if (motion.save) persistDesktopPet(desktopPetWin.isVisible());
  } else {
    clampDesktopPetWindow(motion.save);
  }
  desktopPetNextWanderAt = Date.now() + (petRoamDelayMs(desktopCompanion?.proactivity || 'light') ?? 15_000);
  if (motion.reason === 'wander') {
    // 真人感游走（owner 拍板）：到地方先「看看这个」——朝落脚点注视一小会儿，再回到待机。
    const center = { x: motion.target.x + motion.target.width / 2, y: motion.target.y + motion.target.height / 2 };
    sendDesktopPetBehavior('watch', center);
    clearTimeout(desktopPetDwellTimer);
    desktopPetDwellTimer = setTimeout(() => sendDesktopPetBehavior('idle'), 1_400 + Math.random() * 1_600);
    return;
  }
  sendDesktopPetBehavior('idle');
}

function advanceDesktopPetMotion(now) {
  const motion = desktopPetMotion;
  if (!motion || !desktopPetWin || desktopPetWin.isDestroyed()) return false;
  // 真人感中途停顿：走到一半左右停 0.6–1.5s，原地看看四周（随机方向），再继续走。
  if (motion.midPause && !motion.midPause.done) {
    const raw = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.duration));
    if (raw >= 0.5) {
      if (motion.midPause.startTime === 0) {
        motion.midPause.startTime = now;
        motion.midPause.until = now + 600 + Math.round(Math.random() * 900);
        desktopPetIgnoreMovedUntil = now + 2_500; // 停顿期间不再被 moved 硬夹取打断
        const b = desktopPetWin.getBounds();
        sendDesktopPetBehavior('watch', {
          x: b.x + b.width / 2 + Math.round((Math.random() - .5) * 700),
          y: b.y + b.height / 2 + Math.round((Math.random() - .5) * 420),
        });
      }
      if (now < motion.midPause.until) return true; // 原地停留（保持当前位置）
      motion.midPause.done = true;
      motion.midPause.holdMs = motion.midPause.until - motion.midPause.startTime;
    }
  }
  const holdMs = motion.midPause?.holdMs ?? 0;
  const progress = Math.min(1, Math.max(0, (now - motion.startedAt - holdMs) / motion.duration));
  const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  const candidate = clampPetBounds({
    ...motion.start,
    x: Math.round(motion.start.x + (motion.target.x - motion.start.x) * eased),
    y: Math.round(motion.start.y + (motion.target.y - motion.start.y) * eased - Math.sin(Math.PI * progress) * motion.arc),
  }, motion.reason === 'wander'
    ? extendedWorkAreas(motion.workAreas, { width: Math.round(PET_WINDOW_SIZE.width * .6), height: Math.round(PET_WINDOW_SIZE.height * .6) })
    : motion.workAreas);
  const x = candidate.x, y = candidate.y;
  if (x === motion.lastX && y === motion.lastY && progress < 1) return true;
  motion.lastX = x;
  motion.lastY = y;
  desktopPetProgrammaticMove = true;
  desktopPetIgnoreMovedUntil = now + 350;
  desktopPetWin.setPosition(x, y, false);
  desktopPetProgrammaticMove = false;
  if (progress >= 1) completeDesktopPetMotion(motion);
  return true;
}

function desktopPetMainExclusions() {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return [];
  return [win.getBounds()];
}

function startDesktopPetDock() {
  if (!desktopPetWin || desktopPetWin.isDestroyed() || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
  if (!desktopPetPreDockBounds) desktopPetPreDockBounds = desktopPetWin.getBounds();
  const target = pickPetDockTarget(win.getBounds(), PET_WINDOW_SIZE, screen.getAllDisplays().map((item) => item.workArea));
  if (target && !samePetBounds(desktopPetWin.getBounds(), target)) startDesktopPetMotion(target, 'dock', false);
  else if (!target) desktopPetPreDockBounds = null;
}

function restoreDesktopPetFromDock(immediate = false) {
  if (!desktopPetPreDockBounds || !desktopPetWin || desktopPetWin.isDestroyed()) {
    desktopPetDocked = false;
    desktopPetPreDockBounds = null;
    return;
  }
  const target = clampPetBounds(desktopPetPreDockBounds, screen.getAllDisplays().map((item) => item.workArea));
  if (samePetBounds(desktopPetWin.getBounds(), target)) {
    desktopPetDocked = false;
    desktopPetPreDockBounds = null;
    return;
  }
  if (immediate) {
    cancelDesktopPetMotion();
    desktopPetProgrammaticMove = true;
    desktopPetIgnoreMovedUntil = Date.now() + 500;
    desktopPetWin.setBounds(target);
    desktopPetProgrammaticMove = false;
    desktopPetDocked = false;
    desktopPetPreDockBounds = null;
    persistDesktopPet(desktopPetWin.isVisible());
  } else {
    startDesktopPetMotion(target, 'restore', false);
  }
}

function desktopPetActivityTick() {
  if (!desktopPetVisible() || !desktopPetFreeActivity()) return;
  const now = Date.now();
  if (advanceDesktopPetMotion(now)) return;
  if (now - desktopPetLastActivityCheckAt < 80) return;
  desktopPetLastActivityCheckAt = now;
  if (desktopPetDragState) return;

  if (desktopPetComposerActiveUntil > now) {
    if (!desktopPetDocked && desktopPetMotion?.reason !== 'dock') startDesktopPetDock();
    return;
  }
  if (desktopPetPreDockBounds) { restoreDesktopPetFromDock(false); return; }

  const cursor = screen.getCursorScreenPoint();
  const moved = !desktopPetLastCursor || Math.hypot(cursor.x - desktopPetLastCursor.x, cursor.y - desktopPetLastCursor.y) >= 3;
  desktopPetLastCursor = cursor;
  // 不躲鼠标（owner 拍板）：光标动它就看看你（watch）；notice 只留给真实主动提醒。
  if (moved && now - desktopPetLastBehaviorAt > 90) {
    desktopPetLastBehaviorAt = now;
    sendDesktopPetBehavior('watch', cursor);
  }

  // 光标悬停在宠物上：不逃跑，留在原地由宠物窗口自己处理 hover（呼吸/按压反馈）。
  if (desktopPetPointerInside) return;
  if (!desktopPetCanWander() || now < desktopPetNextWanderAt) return;

  const bounds = desktopPetWin.getBounds();
  const area = choosePetWorkArea(bounds, screen.getAllDisplays().map((item) => item.workArea));
  // Shimeji 式：底部地板 60% / 左右边缘 25% / 全域 15%，随后按角色矩形贴边半隐藏。
  let target = tuckPetBounds(pickPetRoamTargetBiased(bounds, area), area);
  const [mainBounds] = desktopPetMainExclusions();
  if (mainBounds && target.x < mainBounds.x + mainBounds.width && target.x + target.width > mainBounds.x
    && target.y < mainBounds.y + mainBounds.height && target.y + target.height > mainBounds.y) {
    target = pickPetDockTarget(mainBounds, PET_WINDOW_SIZE, [area]) || target;
  }
  startDesktopPetMotion(target, 'wander', true);
}

function startDesktopPetActivityController() {
  if (desktopPetActivityTimer || !desktopPetVisible() || !desktopPetFreeActivity()) return;
  desktopPetNextWanderAt = Math.max(desktopPetNextWanderAt, Date.now() + 8_000);
  // 窗口移动按约 60 FPS 推进；空闲状态的意图判断在 tick 内限流到 80ms，避免无意义轮询。
  desktopPetActivityTimer = setInterval(desktopPetActivityTick, 16);
  desktopPetActivityTimer.unref?.();
}

function stopDesktopPetActivityController(restoreDock = false) {
  if (desktopPetActivityTimer) clearInterval(desktopPetActivityTimer);
  desktopPetActivityTimer = null;
  cancelDesktopPetMotion();
  if (restoreDock) restoreDesktopPetFromDock(true);
  desktopPetLastCursor = null;
  desktopPetLastActivityCheckAt = 0;
  sendDesktopPetBehavior('idle');
}

function noteDesktopPetComposerActivity() {
  if (!desktopPetVisible() || !desktopPetFreeActivity()) return;
  desktopPetComposerActiveUntil = Date.now() + 5_000;
  startDesktopPetActivityController();
}

function startDesktopPetPresenceLoop() {
  if (desktopPetPresenceTimer) return;
  desktopPetPresenceTimer = setInterval(() => {
    if (!desktopPetVisible()) return;
    sendDesktopCompanion();
    if (!desktopPetPresenceAllowsRoam()) cancelDesktopPetMotion();
  }, 2_000);
  desktopPetPresenceTimer.unref?.();
}

function stopDesktopPetPresenceLoop() {
  if (desktopPetPresenceTimer) clearInterval(desktopPetPresenceTimer);
  desktopPetPresenceTimer = null;
}

function disposeDesktopPetRuntime() {
  stopDesktopPetActivityController(false);
  stopDesktopPetPresenceLoop();
  if (desktopPetMoveTimer) clearTimeout(desktopPetMoveTimer);
  desktopPetMoveTimer = null;
  desktopPetDragState = null;
  desktopPetPointerInside = false;
  desktopPetPointerEnteredAt = 0;
  desktopPetProgrammaticMove = false;
  desktopPetManualPauseUntil = 0;
  desktopPetNextWanderAt = 0;
  clearTimeout(desktopPetDwellTimer);
  desktopPetLastBehaviorAt = 0;
  desktopPetLastActivityCheckAt = 0;
  desktopPetLastCursor = null;
  desktopPetInteractionUntil = 0;
  desktopPetComposerActiveUntil = 0;
  desktopPetPreDockBounds = null;
  desktopPetDocked = false;
  desktopPetIgnoreMovedUntil = 0;
}

function desktopPetPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) return null;
  return { x, y };
}

function beginDesktopPetDrag(point) {
  const start = desktopPetPoint(point);
  if (!start || !desktopPetWin || desktopPetWin.isDestroyed()) return;
  desktopPetManualPauseUntil = Date.now() + 20_000;
  cancelDesktopPetMotion();
  desktopPetPreDockBounds = null;
  desktopPetDocked = false;
  desktopPetInteractionUntil = Date.now() + 8_000;
  desktopPetDragState = { start, bounds: desktopPetWin.getBounds() };
}

function moveDesktopPetDrag(point) {
  const current = desktopPetPoint(point);
  if (!current || !desktopPetDragState || !desktopPetWin || desktopPetWin.isDestroyed()) return;
  const { start, bounds } = desktopPetDragState;
  const target = clampPetBounds({
    ...bounds,
    x: Math.round(bounds.x + current.x - start.x),
    y: Math.round(bounds.y + current.y - start.y),
  }, screen.getAllDisplays().map((item) => item.workArea));
  desktopPetProgrammaticMove = true;
  desktopPetIgnoreMovedUntil = Date.now() + 500;
  desktopPetWin.setBounds(target);
  desktopPetProgrammaticMove = false;
}

function endDesktopPetDrag() {
  if (!desktopPetDragState) return;
  desktopPetDragState = null;
  clampDesktopPetWindow(true);
  desktopPetNextWanderAt = Date.now() + 20_000;
  startDesktopPetActivityController();
}

async function ensureDesktopPetWindow() {
  if (desktopPetWin && !desktopPetWin.isDestroyed()) return desktopPetWin;
  const saved = settingsMod?.getDesktopPetWindowState?.() ?? { visible: false };
  desktopPetWin = new BrowserWindow({
    ...desktopPetBounds(saved), show: false, frame: false, transparent: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, title: 'WeftMate Pet',
    webPreferences: {
      preload: join(import.meta.dirname, 'desktop-pet-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
    },
  });
  desktopPetWin.setAlwaysOnTop(true, 'floating');
  desktopPetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 默认整窗穿透；renderer 只会在当前帧真正可见的宠物像素下恢复交互。
  desktopPetWin.setIgnoreMouseEvents(true, { forward: true });
  desktopPetWin.webContents.on('will-navigate', (event) => event.preventDefault());
  desktopPetWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  desktopPetWin.webContents.on('did-finish-load', sendDesktopCompanion);
  desktopPetWin.on('will-move', (event, nextBounds) => {
    if (!desktopPetProgrammaticMove) {
      desktopPetManualPauseUntil = Date.now() + 20_000;
      cancelDesktopPetMotion();
    }
    const safe = clampPetBounds(nextBounds, screen.getAllDisplays().map((item) => item.workArea));
    if (!samePetBounds(nextBounds, safe)) {
      event.preventDefault();
      desktopPetProgrammaticMove = true;
      desktopPetWin?.setBounds(safe);
      desktopPetProgrammaticMove = false;
    }
  });
  desktopPetWin.on('moved', () => {
    if (Date.now() < desktopPetIgnoreMovedUntil) return;
    // 漂移修复（owner 报告）：挂边半隐藏是合法停靠位——moved 后只做软夹取（防完全跑丢），
    // 不硬拽回屏内（否则贴边位置反复被破坏，宠物看起来在漂/在逃）。
    const current = desktopPetWin.getBounds();
    const soft = clampPetBounds(current, extendedWorkAreas(screen.getAllDisplays().map((item) => item.workArea), {
      width: Math.round(PET_WINDOW_SIZE.width * .6),
      height: Math.round(PET_WINDOW_SIZE.height * .6),
    }));
    if (!samePetBounds(current, soft)) {
      desktopPetProgrammaticMove = true;
      desktopPetWin?.setBounds(soft);
      desktopPetProgrammaticMove = false;
    }
    if (desktopPetMoveTimer) clearTimeout(desktopPetMoveTimer);
    desktopPetMoveTimer = setTimeout(() => {
      desktopPetMoveTimer = null;
      persistDesktopPet(desktopPetWin?.isVisible() ?? false);
      desktopPetNextWanderAt = Math.max(desktopPetNextWanderAt, desktopPetManualPauseUntil);
    }, 250);
    desktopPetMoveTimer.unref?.();
  });
  desktopPetWin.on('show', notifyDesktopPetVisibility);
  desktopPetWin.on('hide', notifyDesktopPetVisibility);
  desktopPetWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideDesktopPet();
  });
  desktopPetWin.on('closed', () => {
    disposeDesktopPetRuntime();
    desktopPetWin = null;
  });
  await desktopPetWin.loadFile(join(import.meta.dirname, 'web', 'desktop-pet.html'));
  return desktopPetWin;
}

async function wakeDesktopPet(state = desktopCompanion) {
  const sanitized = sanitizeCompanionState(state);
  if (sanitized) desktopCompanion = sanitized;
  if (!desktopCompanion) return;
  const petWindow = await ensureDesktopPetWindow();
  sendDesktopCompanion();
  petWindow.showInactive();
  persistDesktopPet(true);
  startDesktopPetPresenceLoop();
  desktopPetNextWanderAt = Date.now() + 8_000;
  startDesktopPetActivityController();
  notifyDesktopPetVisibility();
}

function hideDesktopPet() {
  stopDesktopPetActivityController(true);
  stopDesktopPetPresenceLoop();
  if (desktopPetWin && !desktopPetWin.isDestroyed()) desktopPetWin.hide();
  persistDesktopPet(false);
  notifyDesktopPetVisibility();
}

function handleDesktopDisplayChange() {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return;
  cancelDesktopPetMotion();
  clampDesktopPetWindow(true);
  desktopPetNextWanderAt = Date.now() + 15_000;
  startDesktopPetActivityController();
}

async function toggleDesktopPet(state = desktopCompanion) {
  if (desktopPetVisible()) hideDesktopPet(); else await wakeDesktopPet(state);
  return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
}

function openDesktopPetPage() {
  showWindow();
  try { win?.webContents.send('wm:open-pets'); } catch { /* 主窗口正在加载 */ }
}

function showDesktopPetContextMenu() {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return;
  desktopPetInteractionUntil = Date.now() + 8_000;
  const name = desktopCompanion ? `${desktopCompanion.pet.name} · ${desktopCompanion.persona.name}` : 'WeftMate';
  Menu.buildFromTemplate([
    { label: name, enabled: false },
    { type: 'separator' },
    { label: '去聊天', click: showWindow },
    { label: '宠物设置…', click: openDesktopPetPage },
    { label: '允许自由活动', type: 'checkbox', checked: desktopPetFreeActivity(), click: (item) => setDesktopPetFreeActivity(item.checked) },
    { label: '回到屏幕右下角', click: recoverDesktopPetToCorner },
    { type: 'separator' },
    { label: '让它休息', click: hideDesktopPet },
  ]).popup({ window: desktopPetWin });
}

// ── R6-02 · 伴侣状态源：userData/weftmate-pets.json（PetStore）→ sanitize → 宠物窗口 ──
//   新基座无旧人格层：persona 面用产品身份（WeftMate），宠物 = store 绑定（默认内置星瑶）。
//   记忆驱动接缝（§7.8）：proactivity/activity 已在 companion 状态里，R7 记忆内核接上后驱动。
async function loadCompanion() {
  try {
    const { PetStore } = await import('./pets/store.ts');
    petStoreMod = new PetStore(join(app.getPath('userData'), 'weftmate-pets.json'));
    const pet = petStoreMod.petForPersona('weftmate');
    desktopCompanion = sanitizeCompanionState({
      persona: { id: 'weftmate', name: 'WeftMate' },
      // image 形态的 asset 是文件 id（v2 pet-assets 机制），sanitize 只放行 dataUrl——
      // 不匹配时回落内置星瑶渲染（形态资产解析留 R6 后续）。
      pet: { ...pet, form: pet.form?.kind === 'image' ? undefined : pet.form },
      proactivity: petStoreMod.proactivityForPersona('weftmate'),
      activity: 'idle',
    });
    console.log(`[weftmate] ✓ 伴侣状态就绪:${desktopCompanion?.pet?.name ?? '(未识别)'}`);
  } catch (error) {
    logCrash('pet-store', error);
  }
}

async function bootstrap() {
  // ── R1 · 官方 DSH web 基座：产品面全部经官方 web（子进程托管 127.0.0.1 前端）──
  // 先解密已存模型配置（safeStorage 只在 main；凭据接缝在 spawn 时经子进程 env 注入）。
  try {
    configStoreMod = await import('./config-store.ts');
    configStoreMod.injectEnv();
    console.log('[weftmate] ✓ 模型配置已注入 env(若已配)');
  } catch (e) {
    console.error('[weftmate] 读模型配置失败(当作未配,官方 Models 页可配):', e && e.message ? e.message : e);
  }

  // settings.ts 仍驻 main：桌面宠物窗口状态（本机显示偏好）归它。
  try {
    settingsMod = await import('./settings.ts');
  } catch (e) {
    console.error('[weftmate] 读宠物窗口状态模块失败:', e && e.message ? e.message : e);
  }

  // R6-02 · 伴侣状态（宠物窗口显示源）：PetStore → sanitize。
  await loadCompanion();

  // ── R1-02 · DSH web 运行时：写 profile → spawn 官方 CLI → 等官方 URL 行 ──
  //   DSH_HOME 指到 userData 隔离目录(profile/会话/设置/凭据文件同域)。
  //   凭据接缝:active 模型档经 safeStorage 解密 → 只经子进程 env(DEEPSEEK_API_KEY/BASE_URL),不明文落盘。
  //   Electron 里用 process.execPath + ELECTRON_RUN_AS_NODE=1 当 node 用(不依赖 PATH 里的 node)。
  const dshHome = join(app.getPath('userData'), 'dsh-home');
  // R2-02：工作区默认值 = userData/workspace（REQUIREMENTS 口径）。子进程 cwd = 此目录 →
  // sandbox-policy workspaceRoot = process.cwd()，沙箱 workspace-write 以它为界；官方 UI 工作区选择器可换。
  const workspaceDir = join(app.getPath('userData'), 'workspace');
  try { mkdirSync(workspaceDir, { recursive: true }); } catch { /* 已有 */ }

  // ── R3-02 · 品牌壳/托盘联动/数据目录/更新接缝：main ↔ 运行时子进程的本地文件双工 ──
  //   main 写状态文件（更新态/托盘常驻/数据目录/版本）→ 宿主插件读 → 官方 UI 展示；
  //   UI 触发「检查更新/重启安装」→ 宿主插件写请求文件 → main 轮询消费执行 → 状态文件回写。
  const HOST_STATE_FILE = join(dshHome, 'weftmate-host-state.json');
  const UPDATE_REQUEST_FILE = join(dshHome, 'weftmate-update-request.json');
  const readAppVersion = () => {
    try {
      const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
      return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
    } catch { return '0.0.0'; }
  };
  const appVersion = readAppVersion();
  function writeHostState() {
    try {
      const payload = {
        schemaVersion: 1,
        app: { name: 'WeftMate', version: appVersion },
        tray: { resident: true }, // 关窗收托盘，托盘常驻（桌面伴侣形态）
        dataDirs: {
          userData: app.getPath('userData'),
          dshHome,
          workspace: workspaceDir,
        },
        update: updateState(),
        // R6-02 · 桌宠状态块：官方 UI 宠物胶囊读这里（唤醒/休息/自由活动展示与动作）。
        pet: {
          name: desktopCompanion?.pet?.name ?? null,
          persona: desktopCompanion?.persona?.name ?? null,
          visible: desktopPetVisible(),
          freeActivity: desktopPetFreeActivity(),
        },
      };
      writeFileSync(HOST_STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch (error) { logCrash('host-state-write', error); }
  }
  /** 消费 UI 侧发来的更新请求（check / install）；消费即删，防重复触发。 */
  function handleUpdateRequests() {
    let raw = null;
    try {
      if (existsSync(UPDATE_REQUEST_FILE)) raw = JSON.parse(readFileSync(UPDATE_REQUEST_FILE, 'utf8'));
    } catch { return; } // 半写/坏文件：下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { rmSync(UPDATE_REQUEST_FILE, { force: true }); } catch { /* 删不掉下轮再试 */ }
    if (raw.action === 'check') void checkForUpdates(() => win);
    else if (raw.action === 'install') quitAndInstall();
  }
  // ── R6-01 · 感知请求面：官方 UI（客户端插件）→ 宿主插件写请求文件 → main 消费切换开关 ──
  const PERCEPTION_REQUEST_FILE = join(dshHome, 'weftmate-perception-request.json');
  function handlePerceptionRequests() {
    let raw = null;
    try {
      if (existsSync(PERCEPTION_REQUEST_FILE)) raw = JSON.parse(readFileSync(PERCEPTION_REQUEST_FILE, 'utf8'));
    } catch { return; } // 半写/坏文件：下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { rmSync(PERCEPTION_REQUEST_FILE, { force: true }); } catch { /* 删不掉下轮再试 */ }
    try {
      if (raw.action === 'set-enabled') {
        settingsMod?.setPerceptionEnabled?.(raw.value === true);
      } else if (raw.action === 'set-capture') {
        settingsMod?.setDesktopCapture?.(raw.value === 'app_only' ? 'app_only' : 'app_title');
      } else if (raw.action === 'set-clipboard') {
        settingsMod?.setClipboardEnabled?.(raw.value === true);
      } else if (raw.action === 'set-inject') {
        settingsMod?.setInjectEnabled?.(raw.value === true);
      } else if (raw.action === 'set-mobile') {
        settingsMod?.setMobilePerceptionEnabled?.(raw.value === true);
      }
    } catch (error) { logCrash('perception-request', error); }
  }
  // R6-01 · 感知采集面（main 侧）：opt-in、热生效；采样双工文件供运行时宿主插件出 UI/注入面。
  // R8-01 · 设备接缝（main 侧）：配对 token/设备登记/手机观察消费；手机段合并进感知采样。
  devicesRuntime = initDevices({ dshHome });
  perceptionRuntime = initPerception({
    dshHome,
    readMobileObservations: () => devicesRuntime?.readMobileObservations() ?? [],
  });
  // ── R6-02 · 桌宠动作请求面：官方 UI 胶囊 → 宿主插件写请求文件 → main 消费 ──
  const PET_REQUEST_FILE = join(dshHome, 'weftmate-pet-request.json');
  function handlePetRequests() {
    let raw = null;
    try {
      if (existsSync(PET_REQUEST_FILE)) raw = JSON.parse(readFileSync(PET_REQUEST_FILE, 'utf8'));
    } catch { return; } // 半写/坏文件：下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { rmSync(PET_REQUEST_FILE, { force: true }); } catch { /* 删不掉下轮再试 */ }
    try {
      if (raw.action === 'set-visible') {
        const want = raw.value === true;
        if (want !== desktopPetVisible()) {
          if (want) void toggleDesktopPet(desktopCompanion).catch((error) => logCrash('pet-toggle', error));
          else hideDesktopPet();
        }
      } else if (raw.action === 'set-free-activity') {
        const want = raw.value === true;
        if (want !== desktopPetFreeActivity()) setDesktopPetFreeActivity(want);
      }
    } catch (error) { logCrash('pet-request', error); }
  }
  writeHostState();
  setInterval(writeHostState, 5_000).unref?.();
  setInterval(handleUpdateRequests, 1_000).unref?.();
  setInterval(handlePerceptionRequests, 1_000).unref?.();
  setInterval(handlePetRequests, 1_000).unref?.();

  webRuntime = new DshWebRuntime({
    homeDir: dshHome,
    workspaceDir,
    nodeElectron: true,
    // M5-01：打包形态强制 vendor 运行时（安装包 resources/dsh-runtime；开发形态沿用 checkout 默认）。
    ...(app.isPackaged ? { runtimePath: join(process.resourcesPath, 'dsh-runtime') } : {}),
    credentialEnv: () => {
      const llm = configStoreMod?.readActiveLlms?.().llm;
      // R3-02：品牌/数据目录接缝经子进程 env（宿主插件读；与凭据同纪律——只经 env，不落明文 key 之外的敏感物）。
      const env = {
        WEFTMATE_APP_VERSION: appVersion,
        WEFTMATE_USER_DATA: app.getPath('userData'),
        WEFTMATE_DSH_HOME: dshHome,
        WEFTMATE_WORKSPACE: workspaceDir,
        // R7：MemoWeft 本地桥环境（宿主插件 spawn python 用；可经外层 env 覆盖，缺省本机开发值）。
        WEFTMATE_MEMOWEFT_PYTHON: process.env.WEFTMATE_MEMOWEFT_PYTHON || 'D:\\MemoWeft\\.venv-memoweft\\Scripts\\python.exe',
        WEFTMATE_MEMOWEFT_PYTHONPATH: process.env.WEFTMATE_MEMOWEFT_PYTHONPATH || 'D:\\AIProjects\\MemoWeft\\Core\\py\\src',
      };
      if (!llm?.apiKey) return env;
      // 官方 llm-deepseek 适配器：key 经 DEEPSEEK_API_KEY（credentials-local env 层优先），
      // baseUrl 经 DEEPSEEK_BASE_URL（trusted env 层回退）。key 只经子进程 env，不明文落盘。
      env.DEEPSEEK_API_KEY = llm.apiKey;
      if (typeof llm.baseUrl === 'string' && llm.baseUrl.length > 0) env.DEEPSEEK_BASE_URL = llm.baseUrl;
      return env;
    },
    log: (line) => console.log(`[weftmate] ${line}`),
  });
  console.log('[weftmate] DSH_HOME =', dshHome);
  let runtimeOrigin = null; // 当前受信 origin（崩溃重拉换源时跟随更新）
  try {
    runtimeOrigin = await webRuntime.start();
    console.log('[weftmate] ✓ DSH web 运行时就绪:', runtimeOrigin, '（官方 URL 行出现）');
  } catch (e) {
    console.error('[weftmate] ✗ DSH web 运行时启动失败:', e && e.message ? e.message : e);
    app.quit();
    return;
  }
  // 崩溃重拉换源 → 主窗口重载新 origin（官方 UI 状态由官方 storage/会话落盘保底）。
  webRuntime.onOrigin = (origin) => {
    if (origin === null) {
      console.log('[weftmate] DSH web 运行时已退出，后台重拉中…');
      return;
    }
    runtimeOrigin = origin;
    console.log('[weftmate] ✓ DSH web 运行时已重拉:', origin);
    if (win && !win.isDestroyed() && win.webContents.getURL() !== origin) {
      win.loadURL(origin).catch((e) => console.error('[weftmate] ✗ 重载新 origin 失败:', e && e.message ? e.message : e));
    }
  };

  // ── R1-03 · 主窗口：官方前端 origin（loopback + 官方 trust fence；受信 webContents）──
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 760, minHeight: 520,
    title: 'WeftMate', backgroundColor: '#111418',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[weftmate] ✗ 前端加载失败', code, desc));
  // 渲染进程诊断：全部 console 转发主进程日志（排查 appShell boot 竞态；定位后收紧回 warning+）。
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.error(`[weftmate:renderer:${level}] ${message} (${sourceId}:${line})`);
    // 自愈：官方 web boot 偶发竞态（web boot: appShell service missing after settled）时
    // 自动重载窗口恢复（防抖限次，最多 3 次，之后放弃并留日志）。
    if (typeof message === 'string' && message.includes('web boot:') && webBootReloads < 3) {
      webBootReloads += 1;
      const attempt = webBootReloads;
      setTimeout(() => {
        console.log(`[weftmate] web boot 失败自愈：第 ${attempt} 次重载`);
        try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch { /* 窗口已关忽略 */ }
      }, 1500);
    }
  });
  screen.on('display-added', handleDesktopDisplayChange);
  screen.on('display-removed', handleDesktopDisplayChange);
  screen.on('display-metrics-changed', handleDesktopDisplayChange);

  // M5-01：自动更新（打包形态 + 有更新渠道才启用；dev/未配置 = disabled）。
  void initUpdater(() => win);

  // ── 下载落盘（v2 遗产）：官方 web 的 /export 会话导出走浏览器下载 ──
  win.webContents.session.on('will-download', (event, item) => {
    const suggested = typeof item.getFilename === 'function' ? item.getFilename() : '';
    const name = (suggested || `weftmate-${Date.now()}.download`).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
    const target = join(app.getPath('downloads'), name);
    item.setSavePath(target);
    console.log('[weftmate] ✓ 下载开始:', target);
    item.on('done', (_event, state) => {
      if (state !== 'completed') console.error('[weftmate] 下载未完成:', state);
    });
  });

  // 主窗口永远留在运行时 origin（loopback）。新开的 http(s) 链接交给系统浏览器，其余协议一律拒绝。
  const allowedOrigin = () => {
    try { return new URL(runtimeOrigin).origin; } catch { return null; }
  };
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== allowedOrigin()) event.preventDefault();
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

  // ── 删除全部本机数据（v2 遗产，ARCHITECTURE §5 保留）：只走这一个窄 IPC。renderer 不接触
  //    marker/token/文件系统；主进程创建一次性授权并重启擦除。──
  ipcMain.handle('wm:delete-all-local-data', async (event, confirmation) => {
    if (!win || event.sender !== win.webContents) return { ok: false, code: 'WIPE_UNTRUSTED_SOURCE', error: '请求来源不可信' };
    if (confirmation !== '删除 WeftMate' && confirmation !== 'Delete WeftMate') return { ok: false, code: 'WIPE_BAD_CONFIRMATION', error: '确认短语不正确' };
    if (wipeRelaunching) return { ok: false, code: 'WIPE_ALREADY_PREPARING', error: '删除已经在准备中' };
    try {
      const marker = createLocalDataWipeMarker({ tempDir: tmpdir(), userData: app.getPath('userData') });
      const args = process.argv.slice(1).filter((arg) => !arg.startsWith('--weftmate-wipe-marker=') && !arg.startsWith('--weftmate-wipe-token='));
      args.push(`--weftmate-wipe-marker=${marker.markerPath}`, `--weftmate-wipe-token=${marker.token}`);
      wipeRelaunching = true;
      isQuitting = true;
      app.relaunch({ args });
      app.quit(); // 仍走既有 before-quit：DSH 运行时收口后才真正退出。
      return { ok: true, relaunching: true };
    } catch (error) {
      return { ok: false, code: 'WIPE_MARKER_FAILED', error: error && error.message ? error.message : String(error) };
    }
  });

  // ── 宠物窗口 IPC（宠物窗口自身交互用；R6 恢复完整桌宠机制）──
  ipcMain.on('wm:pet-sync', (event, state) => {
    if (!win || event.sender !== win.webContents) return;
    const sanitized = sanitizeCompanionState(state);
    if (!sanitized) return;
    desktopCompanion = sanitized;
    sendDesktopCompanion();
    // 启动自愈：上次宠物可见 + 渲染层已同步状态 → 补唤醒（状态源从旧 UI 换到渲染层后的等价路径）。
    if (settingsMod?.getDesktopPetWindowState?.().visible && !desktopPetVisible()) {
      void wakeDesktopPet(sanitized).catch((error) => logCrash('desktop-pet-restore', error));
    }
    if (desktopPetNextWanderAt <= Date.now()) desktopPetNextWanderAt = Date.now() + 8_000;
    startDesktopPetActivityController();
  });
  ipcMain.handle('wm:pet-toggle', async (event, state) => {
    if (!win || event.sender !== win.webContents) return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
    const sanitized = sanitizeCompanionState(state);
    if (!desktopPetVisible() && !sanitized && !desktopCompanion) return { visible: false, freeActivity: desktopPetFreeActivity() };
    return toggleDesktopPet(sanitized || desktopCompanion);
  });
  ipcMain.handle('wm:pet-visibility', (event) => {
    if (!win || event.sender !== win.webContents) return { visible: false, freeActivity: false };
    return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
  });
  ipcMain.handle('wm:pet-free-activity', (event, enabled) => {
    if (!win || event.sender !== win.webContents) return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
    setDesktopPetFreeActivity(enabled === true);
    return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
  });
  ipcMain.on('wm:pet-composer-activity', (event) => {
    if (win && event.sender === win.webContents) noteDesktopPetComposerActivity();
  });
  ipcMain.on('wm:pet-hide', (event) => {
    const trustedMain = !!win && event.sender === win.webContents;
    const trustedPet = !!desktopPetWin && !desktopPetWin.isDestroyed() && event.sender === desktopPetWin.webContents;
    if (trustedMain || trustedPet) hideDesktopPet();
  });
  ipcMain.on('wm:pet-show-main', (event) => {
    if (desktopPetWin && !desktopPetWin.isDestroyed() && event.sender === desktopPetWin.webContents) showWindow();
  });
  ipcMain.on('wm:pet-open-page', (event) => {
    if (desktopPetWin && !desktopPetWin.isDestroyed() && event.sender === desktopPetWin.webContents) openDesktopPetPage();
  });
  ipcMain.on('wm:pet-context-menu', (event) => {
    if (desktopPetWin && !desktopPetWin.isDestroyed() && event.sender === desktopPetWin.webContents) {
      desktopPetInteractionUntil = Date.now() + 8_000;
      showDesktopPetContextMenu();
    }
  });
  ipcMain.on('wm:pet-pointer', (event, inside) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    if (inside === true && !desktopPetPointerInside) desktopPetPointerEnteredAt = Date.now();
    desktopPetPointerInside = inside === true;
    if (desktopPetPointerInside) cancelDesktopPetMotion();
  });
  ipcMain.on('wm:pet-hit-test', (event, state) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    const valid = state && typeof state === 'object'
      && typeof state.interactive === 'boolean'
      && typeof state.hovering === 'boolean';
    if (!valid || state.interactive !== true) {
      desktopPetWin.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    desktopPetWin.setIgnoreMouseEvents(false);
  });
  ipcMain.on('wm:pet-interact', (event, kind) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    if (!['click', 'doubleclick', 'context'].includes(kind)) return;
    desktopPetInteractionUntil = Date.now() + 8_000;
    desktopPetNextWanderAt = Math.max(desktopPetNextWanderAt, desktopPetInteractionUntil);
  });
  ipcMain.on('wm:pet-drag-start', (event, point) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    beginDesktopPetDrag(point);
  });
  ipcMain.on('wm:pet-drag-move', (event, point) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    moveDesktopPetDrag(point);
  });
  ipcMain.on('wm:pet-drag-end', (event) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    endDesktopPetDrag();
  });
  // ImageForm：图片形态按内容尺寸收窄窗口（窄校验 + 脚底锚定；形态可变、窗口机制固定）。
  ipcMain.on('wm:pet-resize', (event, raw) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return;
    const width = Number.isInteger(raw?.width) ? Math.min(240, Math.max(56, raw.width)) : 0;
    const height = Number.isInteger(raw?.height) ? Math.min(240, Math.max(56, raw.height)) : 0;
    if (!width || !height) return;
    const bounds = desktopPetWin.getBounds();
    const next = {
      x: Math.round(bounds.x + (bounds.width - width) / 2),
      y: Math.round(bounds.y + (bounds.height - height)),
      width,
      height,
    };
    desktopPetProgrammaticMove = true;
    desktopPetIgnoreMovedUntil = Date.now() + 600;
    desktopPetWin.setBounds(clampPetBounds(next, screen.getAllDisplays().map((item) => item.workArea)));
    desktopPetProgrammaticMove = false;
  });
  // R6-02 · sprite 图集通道：沙箱渲染器不能 fetch(file://)，由 main 从 asar 读图集回传
  //   ArrayBuffer（白名单仅 xingyao；只信任宠物窗口自身；读失败回 null，渲染器走程序化兜底）。
  ipcMain.handle('wm:pet-sprite', async (event, name) => {
    if (!desktopPetWin || desktopPetWin.isDestroyed() || event.sender !== desktopPetWin.webContents) return null;
    if (name !== 'xingyao') return null;
    try {
      const buffer = readFileSync(join(import.meta.dirname, 'pets', 'assets', name, 'spritesheet.webp'));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      logCrash('pet-sprite', error);
      return null;
    }
  });
  // 最大化状态变化 → 通知前端切换"最大化/还原"图标（官方 UI 忽略未知事件，保留无害）。
  win.on('maximize', () => win.webContents.send('wm:maximized', true));
  win.on('unmaximize', () => win.webContents.send('wm:maximized', false));
  // 页面加载完主动推一次当前最大化态——防"启动即最大化"时前端图标停在"最大化"没切成"还原"。
  win.webContents.on('did-finish-load', () => { try { win.webContents.send('wm:maximized', win.isMaximized()); } catch { /* 窗口已关忽略 */ } });

  try {
    await win.loadURL(runtimeOrigin);
    console.log('[weftmate] ✓ 窗口加载完成:', runtimeOrigin);
  } catch (e) {
    console.error('[weftmate] ✗ window.loadURL 失败:', e && e.message ? e.message : e);
    app.quit();
    return;
  }

  // 关窗不退:X = 收进托盘。只有走"退出"(isQuitting=true)才让窗口真关。
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  setupTray();

  // R6-02 · 桌宠自愈：上次可见（设置里 visible=true）→ 启动补唤醒（v2 等价路径的恢复）。
  if (desktopCompanion && settingsMod?.getDesktopPetWindowState?.().visible) {
    void wakeDesktopPet().catch((error) => logCrash('desktop-pet-autowake', error));
  }

  console.log('[weftmate] ═══ 官方 DSH web 基座就位:关窗收托盘、托盘"退出"才真退 ═══');
}

/** 系统托盘:常驻图标 + 菜单(显示/退出),左键点=显示窗口。 */
function setupTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  tray.setToolTip('WeftMate');
  refreshTrayMenu();
  tray.on('click', showWindow); // Windows 习惯:左键点托盘图标唤起窗口
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 WeftMate', click: showWindow },
    { label: '宠物设置…', click: openDesktopPetPage },
    { label: desktopPetVisible() ? '让桌面宠物休息' : '唤醒桌面宠物', click: () => {
      const latest = desktopCompanion;
      void toggleDesktopPet(latest).catch((error) => logCrash('desktop-pet-tray', error));
    } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// 退出前收尾:先拦下(异步 shutdown 跑不完就退会漏收口),清完再放行二次退出。
app.on('before-quit', (e) => {
  isQuitting = true;
  disposeDesktopPetRuntime();
  if (cleanupDone) return; // 已清理完 → 放行真正退出
  e.preventDefault();
  (async () => {
    try {
      perceptionRuntime?.dispose?.(); // R6-01：停感知采集
      devicesRuntime?.dispose?.(); // R8-01：停设备接缝
      await webRuntime?.close?.(); // 收口 DSH web 运行时子进程
      console.log('[weftmate] ✓ 退出收尾:DSH web 运行时收口完成');
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
