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
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen } from 'electron';
import { join } from 'node:path';
import { appendFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createLocalDataWipeMarker,
  localDataWipeLaunchRequest,
  wipeLocalDataFromMarker,
} from './local-data-wipe.ts';
import {
  clampPetBounds,
  choosePetWorkArea,
  distanceFromPointToRect,
  pickPetAvoidTarget,
  pickPetDockTarget,
  pickPetRoamTarget,
  petRoamDelayMs,
  samePetBounds,
} from './desktop-pet-motion.ts';

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
let settingsMod = null;
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
let desktopPetLastAvoidAt = 0;
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
  return {
    persona: { id: personaId, name: personaName },
    pet: {
      schemaVersion: 1, id: petId, name: petName, description,
      appearance: {
        kind: 'procedural', shape: appearance.shape, primary: appearance.primary.toLowerCase(),
        accent: appearance.accent.toLowerCase(), feature: appearance.feature,
      },
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
  const presence = enabled
    ? (collectorMod?.presenceView?.() ?? { running: false, state: 'unknown' })
    : { running: false, state: 'off' };
  try { desktopPetWin.webContents.send('wm:pet-state', { ...desktopCompanion, presence }); } catch { /* 窗口正在关闭 */ }
}

function desktopPetPresenceAllowsRoam() {
  if (settingsMod?.getPerceptionEnabled?.() !== true) return true;
  const state = collectorMod?.presenceView?.().state;
  return state === 'active' || state === undefined || state === 'unknown';
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

function sendDesktopPetBehavior(kind, cursor = null) {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return;
  const allowed = new Set(['idle', 'watch', 'notice', 'wander', 'avoid', 'dock', 'rest']);
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
    });
  } catch { /* 宠物窗口正在关闭 */ }
}

function startDesktopPetMotion(target, reason, save = true) {
  if (!desktopPetWin || desktopPetWin.isDestroyed() || desktopPetDragState) return;
  cancelDesktopPetMotion();
  const start = desktopPetWin.getBounds();
  if (samePetBounds(start, target)) return;
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const duration = reason === 'avoid' ? Math.min(850, Math.max(420, distance * 3))
    : Math.min(2_400, Math.max(700, distance * 4));
  const workAreas = screen.getAllDisplays().map((item) => item.workArea);
  desktopPetMotion = {
    start, target, reason, save, startedAt: Date.now(), duration, workAreas,
    arc: Math.min(18, Math.max(6, distance * .055)), lastX: start.x, lastY: start.y,
  };
  sendDesktopPetBehavior(reason === 'restore' ? 'wander' : reason, {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
}

function completeDesktopPetMotion(motion) {
  if (!desktopPetWin || desktopPetWin.isDestroyed() || desktopPetMotion !== motion) return;
  desktopPetMotion = null;
  desktopPetProgrammaticMove = false;
  if (motion.reason === 'dock') desktopPetDocked = true;
  if (motion.reason === 'restore') { desktopPetDocked = false; desktopPetPreDockBounds = null; }
  clampDesktopPetWindow(motion.save);
  desktopPetNextWanderAt = Date.now() + (petRoamDelayMs(desktopCompanion?.proactivity || 'light') ?? 15_000);
  sendDesktopPetBehavior('idle');
}

function advanceDesktopPetMotion(now) {
  const motion = desktopPetMotion;
  if (!motion || !desktopPetWin || desktopPetWin.isDestroyed()) return false;
  const progress = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.duration));
  const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  const candidate = clampPetBounds({
    ...motion.start,
    x: Math.round(motion.start.x + (motion.target.x - motion.start.x) * eased),
    y: Math.round(motion.start.y + (motion.target.y - motion.start.y) * eased - Math.sin(Math.PI * progress) * motion.arc),
  }, motion.workAreas);
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

function startDesktopPetAvoid(cursor) {
  if (!desktopPetWin || desktopPetWin.isDestroyed()) return;
  const bounds = desktopPetWin.getBounds();
  const area = choosePetWorkArea(bounds, screen.getAllDisplays().map((item) => item.workArea));
  const target = pickPetAvoidTarget(bounds, cursor, area, desktopPetMainExclusions());
  desktopPetLastAvoidAt = Date.now();
  if (!samePetBounds(bounds, target)) startDesktopPetMotion(target, 'avoid', true);
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
  const bounds = desktopPetWin.getBounds();
  const distance = distanceFromPointToRect(cursor, bounds);
  const moved = !desktopPetLastCursor || Math.hypot(cursor.x - desktopPetLastCursor.x, cursor.y - desktopPetLastCursor.y) >= 3;
  desktopPetLastCursor = cursor;
  if (moved && now - desktopPetLastBehaviorAt > 90) {
    desktopPetLastBehaviorAt = now;
    sendDesktopPetBehavior(distance < 140 ? 'notice' : 'watch', cursor);
  }

  const mayAvoid = now >= desktopPetInteractionUntil && now - desktopPetLastAvoidAt >= 1_600;
  if (desktopPetPointerInside) {
    if (mayAvoid && now - desktopPetPointerEnteredAt >= 900) startDesktopPetAvoid(cursor);
    return;
  }
  if (distance < 58 && mayAvoid) { startDesktopPetAvoid(cursor); return; }
  if (!desktopPetCanWander() || now < desktopPetNextWanderAt) return;

  const area = choosePetWorkArea(bounds, screen.getAllDisplays().map((item) => item.workArea));
  let target = pickPetRoamTarget(bounds, area);
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
  desktopPetLastAvoidAt = 0;
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
    clampDesktopPetWindow(false);
    if (desktopPetMoveTimer) clearTimeout(desktopPetMoveTimer);
    desktopPetMoveTimer = setTimeout(() => {
      desktopPetMoveTimer = null;
      clampDesktopPetWindow(true);
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
    settingsMod = await import('./settings.ts');
    process.env.MEMOWEFT_LANG = settingsMod.resolvedLang();
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
  screen.on('display-added', handleDesktopDisplayChange);
  screen.on('display-removed', handleDesktopDisplayChange);
  screen.on('display-metrics-changed', handleDesktopDisplayChange);

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
  ipcMain.on('wm:pet-sync', (event, state) => {
    if (!win || event.sender !== win.webContents) return;
    const sanitized = sanitizeCompanionState(state);
    if (!sanitized) return;
    desktopCompanion = sanitized;
    sendDesktopCompanion();
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
  // 最大化状态变化 → 通知前端切换"最大化/还原"图标。
  win.on('maximize', () => win.webContents.send('wm:maximized', true));
  win.on('unmaximize', () => win.webContents.send('wm:maximized', false));
  const refreshDesktopPetDock = () => {
    if (desktopPetComposerActiveUntil <= Date.now() || !desktopPetFreeActivity()) return;
    cancelDesktopPetMotion();
    desktopPetDocked = false;
    startDesktopPetDock();
  };
  win.on('move', refreshDesktopPetDock);
  win.on('resize', refreshDesktopPetDock);
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

  desktopCompanion = sanitizeCompanionState(serverMod?.currentCompanionView?.());
  if (settingsMod?.getDesktopPetWindowState?.().visible && desktopCompanion) {
    try { await wakeDesktopPet(desktopCompanion); }
    catch (error) { logCrash('desktop-pet-restore', error); }
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
  refreshTrayMenu();
  tray.on('click', showWindow); // Windows 习惯:左键点托盘图标唤起窗口
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 WeftMate', click: showWindow },
    { label: '宠物设置…', click: openDesktopPetPage },
    { label: desktopPetVisible() ? '让桌面宠物休息' : '唤醒桌面宠物', click: () => {
      const latest = sanitizeCompanionState(serverMod?.currentCompanionView?.()) || desktopCompanion;
      void toggleDesktopPet(latest).catch((error) => logCrash('desktop-pet-tray', error));
    } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// 退出前收尾:先拦下(异步 shutdown 跑不完就退会漏关库),清完再放行二次退出。
app.on('before-quit', (e) => {
  isQuitting = true;
  disposeDesktopPetRuntime();
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
