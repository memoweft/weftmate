import { usageResponse } from './personal-access/usage-response.mjs';
import { readFile as readFileAsync, rm as rmAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { createLatestFileWriter } from './latest-file-writer.mjs';
/**
 * WeftMate · Electron 主进程：个人宿主 + 原生桌面窗口。
 *
 * 职责（docs/ARCHITECTURE.md v3 §2）：
 *   ① 凭据接缝：safeStorage 解密按 ref 请求的模型密钥 → 只经受管 Node child IPC 返回给
 *     固定 DSH provider；密钥不明文落盘，也不进入子进程环境。
 *   ② 运行时：boot 时把 profile `weftmate` 写进 dsh-home（bundles [dsh-base, dsh-web-app]
 *     + cordis.patch.yml 补丁层），spawn 官方 CLI `dsh --profile weftmate --port 0`
 *     （ELECTRON_RUN_AS_NODE=1，Node 用 Electron 自带，不依赖 PATH 里的 node）。
 *   ③ 窗口：默认加载个人宿主的 WeftMate /personal/v1/ui；--headless 不创建窗口，
 *     --dsh-window 显式保留官方 DSH 管理/诊断页面。
 *   ④ 桌面壳遗产（v2 保留）：托盘常驻、单实例、关窗收托盘、before-quit 收口、更新接缝、
 *     桌面宠物窗口（R4 收口为「托盘+主窗口」，宠物代码保留在盘上待 R6 恢复完整桌宠）。
 *
 * v2 的 SDK 聊天/桥/旧 UI 等主链路已随 R4 退役删除（见 docs/ARCHITECTURE.md §4 退役清单）。
 */
import { createHostLog } from './host-log.mjs';
import { selectBackgroundProfile, backgroundModelReady } from './background-model-selection.mjs';
import { checkModelConnection } from './model-connection-check.mjs';
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen, dialog, nativeTheme, session } from 'electron';
import packageInfo from '../package.json' with { type: 'json' };
import { createBackupManager } from './personal-backup/index.mjs';
import { windowIcon, trayIcon } from './app-icons.mjs';
import { normalizeApiBaseUrl } from './stage2-config.ts';
import { switchActiveModel } from './model-switch-transaction.ts';
import { discoverOpenAICompatibleModels, verifyOpenAICompatibleModel } from './openai-compatible-client.ts';
import { resolveModelDiscoveryRequest } from './model-discovery-policy.ts';
import { resolveModelSaveCredential } from './model-save-policy.ts';
import { modelCapacityFor, routeForProfile, writeModelRoutesPatch } from './harness-model-routes.ts';
import { readModelCapacity } from './model-budget.mjs';
import { createModelScheduler } from './model-scheduler.mjs';
import { scheduledModelFetch } from './model-scheduler-client.mjs';
import { createLocalModelController } from './local-model-service.mjs';
import { buildRedactedDiagnostics } from './diagnostics-export.ts';
import { restoreInternalSessionRoute } from './session-model-route-restore.ts';
import { assertAuthoritativeSessionsIdle, assertModelProfileMutationAllowed, assertSessionReferenceScanReady, resolveSafeSessionBinding, scanSharedSessionBindings } from './stage2-session-guards.ts';
import { createRouteMutationJournal, recoverRouteMutationJournalFiles, runRecoverableProfileMutation } from './route-mutation-journal.ts';
import { createRouteMutationQueue } from './route-mutation-queue.ts';
import { blocksUnexpectedRendererNavigation, isTrustedRendererInvocation } from './renderer-trust.ts';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { appendFileSync, writeFileSync, statSync, mkdirSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { loadPhoneExecutionConfig } from './phone-execution-config.mjs';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
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
import {
  createOfficialDshSettingsClient,
  migrateLegacyRoutes,
  officialCredentialRef,
  projectOfficialProviderConfig,
  repairOfficialLocalRouteLimits,
  verifyLegacyRouteMigration,
} from './dsh-settings-migration.ts';
import { formatHarnessStartupError } from './harness-startup-error.ts';
import { checkForUpdates, initUpdater, quitAndInstall, updateState, preparedInstallerPath, preparedInstallerHash } from './update.ts';
import { createDesktopUpdates } from './personal-update/desktop.mjs';
import { applyDesktopConfig } from './desktop-config.mjs';
import { appBootSignal, prepareAppRollback } from './personal-update/app-rollback.mjs';
import { initPerception } from './perception.ts';
import { initDevices } from './devices.ts';
import { ManagedAiGameRuntime } from './managed-ai-game-runtime.mjs';
import { ModWindowManager } from './mod-window-manager.mjs';
import { createPersonalAccessBackend } from './personal-access-backend.mjs';
import { loadPersonalDevelopmentTools } from './personal-development-tools.mjs';
import { createPersonalDesktopTask } from './personal-desktop-task.mjs';
import { FORMAL_LOCAL_BASE_URL, OCCAMY_VISION_PROFILE_ID, listFormalLocalModels, prepareLocalModelConfig,
  projectOccamyImageInput, reconcileOccamyImageInput,
  readUserModelSwitcherKey } from './local-model-config.mjs';
import { servePersonalAccessUi } from './personal-access-ui/index.mjs';
import { createPersonalDesktop } from './personal-desktop.mjs';
import { loadPersonalMemoryConfig } from './personal-memory/config.mjs';
import { createPersonalMemoryManager } from './personal-memory/index.mjs';
import { assertOwnerBoundBoundary } from './personal-memory/boundary.mjs';
import { memoryRecallDestination, memoryRecallModelTier, memorySessionPolicy } from './personal-memory/policy.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from './private-host-storage.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT, assertLoopbackOrigin, hostRuntimeState, personalAccessPort, personalPublicOrigin as parsePersonalPublicOrigin, personalHostRequested, personalWorkspaceDirectory, startPersonalHost, validatePersonalHostProfile } from './host-mode.mjs';

const desktopControlAppData = packageInfo.desktopIdentity ? join(app.getPath('appData'), packageInfo.desktopIdentity) : app.getPath('appData');
if (process.argv.includes('--uninstall-cleanup')) {
  try {
    if (!app.isPackaged) throw new Error('UNINSTALL_REQUIRES_INSTALLED_PROGRAM');
    const { uninstallDesktopData } = await import('./desktop-uninstall.mjs');
    app.setLoginItemSettings({ openAtLogin: false, name: packageInfo.desktopIdentity || 'WeftMate', path: process.execPath });
    await uninstallDesktopData({ appData: desktopControlAppData, deleteData: process.argv.includes('--delete-data') });
    app.exit(0);
  } catch { app.exit(1); }
}
const installedDesktopConfig = applyDesktopConfig({ appData: desktopControlAppData, packaged: app.isPackaged });
if (app.isPackaged && process.env.WEFTMATE_RELAY_ENABLED === 'true') {
  process.env.WEFTMATE_FRPC_FILE = join(process.resourcesPath, 'relay', 'frpc.exe');
  process.env.WEFTMATE_RELAY_CA_FILE = join(process.resourcesPath, 'relay', 'transport-ca.pem');
}
await appBootSignal('starting', desktopControlAppData);
const { syntheticStopFixtureRoute, syntheticBrowserFixtureSettings,
  createObservationRecorder, createPersonalModelObservationProxy,
  stage14R2ObservationProfile } = await loadPersonalDevelopmentTools();

// The old DSH window remains an explicit diagnostics/development surface.
const personalHostMode = !process.argv.includes('--dsh-window');
const headless = process.argv.includes('--headless');
const desktopRequested = personalHostMode && !headless;
if (personalHostMode && process.env.WEFTMATE_MEMOWEFT_ENABLED === '1') {
  console.error('[weftmate] personal-host refused: account-scoped memory is not connected');
  process.exit(2);
}
let accessPort = null;
try { accessPort = personalAccessPort(process.argv, personalHostMode); }
catch (error) { console.error('[weftmate] personal access refused:', error.message); process.exit(2); }
if (desktopRequested && accessPort === null) accessPort = 0;
let personalPublicOrigin = null;
try { personalPublicOrigin = parsePersonalPublicOrigin(process.argv, personalHostMode, accessPort); }
catch (error) { console.error('[weftmate] public access refused:', error.message); process.exit(2); }
const androidPackageArgs = process.argv.filter((arg) => arg.startsWith('--android-package-path'));
let androidPackagePath = null;
if (androidPackageArgs.length) {
  const value = androidPackageArgs.length === 1 && androidPackageArgs[0].startsWith('--android-package-path=')
    ? androidPackageArgs[0].slice('--android-package-path='.length) : '';
  if (!personalHostMode || accessPort === null || !isAbsolute(value) ||
      basename(value).toLowerCase() !== 'android-candidate.apk') {
    console.error('[weftmate] Android package path refused');
    process.exit(2);
  }
  androidPackagePath = resolve(value);
}
const mobileUiArgs = process.argv.filter((arg) => arg.startsWith('--mobile-ui-dir'));
let mobileUiDir = null;
if (mobileUiArgs.length) {
  const value = mobileUiArgs.length === 1 && mobileUiArgs[0].startsWith('--mobile-ui-dir=')
    ? mobileUiArgs[0].slice('--mobile-ui-dir='.length) : '';
  if (!personalHostMode || accessPort === null || !isAbsolute(value)) {
    console.error('[weftmate] mobile UI release directory refused');
    process.exit(2);
  }
  mobileUiDir = resolve(value);
}
const memoryArgs = process.argv.filter((arg) => arg.startsWith('--personal-memory-config'));
let personalMemoryConfigPath = null;
if (memoryArgs.length) {
  const value = memoryArgs.length === 1 && memoryArgs[0].startsWith('--personal-memory-config=')
    ? memoryArgs[0].slice('--personal-memory-config='.length) : '';
  if (!personalHostMode || accessPort === null || !isAbsolute(value)) {
    console.error('[weftmate] account memory configuration refused');
    process.exit(2);
  }
  personalMemoryConfigPath = resolve(value);
}
let personalHostUserData = null;
const profileArgument = process.argv.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
if (profileArgument) process.env.WEFTMATE_USER_DATA = profileArgument;
if (personalHostMode) {
  try {
    let candidate = process.env.WEFTMATE_USER_DATA?.trim();
    if (!candidate && !personalHostRequested(process.argv)) {
      candidate = join(app.getPath('appData'), 'com.memoweft.weftmate');
      mkdirSync(candidate, { recursive: true });
      if (!existsSync(join(candidate, PERSONAL_HOST_MARKER))) writeFileSync(join(candidate, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT), { flag: 'wx' });
    }
    personalHostUserData = validatePersonalHostProfile(candidate);
  }
  catch (error) {
    console.error('[weftmate] personal-host refused:', error.message);
    process.exit(2);
  }
}

// ── R5 · userData 隔离 ──
// 打包形态产品数据目录 = <appData>/com.memoweft.weftmate（appId 命名，与 dev 的 'weftmate'
// 大小写不敏感冲突——Windows 上 'WeftMate' ≡ 'weftmate' 是同一目录，产品名命名无效）。
// 隔离目的：① 单实例锁不再互斥（dev 与打包可同时跑）；② v2 遗留的开发数据
// （weftmate.db/旧画像/旧设置）不进产品目录。必须在任何 userData 读取（含顶部擦除请求）之前设置。
const requestedUserData = personalHostUserData ?? process.env.WEFTMATE_USER_DATA?.trim() ?? '';
if (requestedUserData) {
  // dogfood/自动化使用专用目录；必须早于 wipe、单实例锁和任何设置读取。
  app.setPath('userData', resolve(requestedUserData));
} else if (app.isPackaged) {
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
// electron-builder removes build metadata from the packaged package.json.
if (process.platform === 'win32') app.setAppUserModelId(packageInfo.desktopAppId ?? packageInfo.build?.appId ?? 'com.memoweft.weftmate');

// ── B4·崩溃/错误上报最小闭环（v2 遗产）──
function redactSecretText(value) {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"'}]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*["']?)[^\s,;"'}]+/gi, '$1[REDACTED]');
}

const hostLog = createHostLog(app.getPath('userData'));
hostLog.write('host.start', { mode: personalHostMode ? 'personal-host' : 'desktop', pid: process.pid,
  version: app.getVersion(), headless: process.argv.includes('--headless'),
  memoryEnabled: process.argv.some(arg => arg.startsWith('--personal-memory-config=')),
  localModelConfigured: process.argv.some(arg => arg.startsWith('--local-model-config=')) });
function logCrash(kind, err) {
  hostLog.write('host.failure', { source: kind, code: /^[A-Z_]{2,64}$/.test(err?.code) ? err.code : 'HOST_ERROR' });
}
process.on('uncaughtException', (err) => { logCrash('uncaughtException', err); });
process.on('unhandledRejection', (reason) => { logCrash('unhandledRejection', reason); });

// 托盘图标由 design/icons/app 单色母版生成，跟随系统任务栏主题。

// 单实例锁:桌面常驻防开多份进程抢同一个数据目录。抢不到 = 已有一个在跑,退出自己,让那个把窗口唤前台。
if (!app.requestSingleInstanceLock()) {
  if (personalHostMode && headless) {
    console.error('[weftmate] personal-host refused: this userData already has a WeftMate instance');
    app.exit(2);
  } else app.quit();
} else {
  // 第二个实例被拉起(用户又点了图标):把已在跑的窗口唤到前台。
  app.on('second-instance', () => { if (!headless) showWindow(); });
  console.log(`[weftmate] startup mode=${personalHostMode ? 'personal-host' : 'desktop'}`);
  app.whenReady().then(bootstrap).catch((error) => failBootstrap(error));
}

let win = null;
let tray = null;
let settingsMod = null; // settings.ts 模块(宠物窗口状态——本机显示偏好)
let configStoreMod = null; // config-store.ts 模块(模型档 safeStorage 存取;DSH 凭据接缝从这里取)
let webRuntime = null; // DSH web 运行时管理器(R1-02:写 profile→spawn 官方 CLI→URL 行→退出收口)
let personalAccessService = null;
let personalBackupManager = null;
let backupRestartRequested = false;
let personalAccessOrigin = null;
let personalDesktop = null;
let desktopUpdates = null;
let desktopStatus = { host: '启动中', model: '未选择' };
let personalMemoryManager = null;
let modelScheduler = null;
let personalMemoryRuntimeConfig = null;
let personalBrowserReader = null;
let accountModelRouteGate = { idle: false, reasonCode: 'unknown', changedAt: null };
const personalMemoryIpc = { recallAttempts: 0, recallRequests: 0,
  recallWithContext: 0, recallReplies: 0, ingestRequests: 0, rejectedBindings: 0 };
let modWindowManager = null; // 独立 Mod 视图；只管理窗口，不拥有 Mod 生命周期。
let aiGameRuntime = null; // Electron main-only; never projected with its origin or process details.
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
let shutdownPromise = null; // 只允许一个异步退出收尾，避免 before-quit 重入。
let startupExitCode = 0;
let startupFailureReported = false;
let wipeRelaunching = false;
let webBootReloads = 0; // web boot 失败自愈计数（防抖限次）
let runtimeOrigin = null; // 当前共享官方 DSH Web 的精确 loopback origin。
let hostLifecycleState = 'starting';
let writeHostStateForLifecycle = null;
let trustedRuntimeOrigin = null; // 仅当前 origin + 当前 main frame 才可拥有壳 IPC。
let stageOneEventsAbort = null;
const activeStageOneTurns = new Set();
let ensureSharedRuntime = null;
let saveModelRoute = null;
let configureLocalModel = null;
let configureObservedLocalModel = null;
let configureObservedSyntheticLowModel = null;
let configureLocalCatalog = null;
let stage14R2Observation = null;
let modelObservationProxy = null;
let modelObservationRecorder = null;
const ownedModelObservationProxies = new Set();
let enqueueExclusiveMainOperation = null;
let exclusiveMainQueue = null;
// Sidebar fetching is intentionally best-effort, but the startup reference
// scan is a safety boundary: until it has completed, profile mutation must not
// be allowed to orphan a session merely because the gateway was unavailable.
let sessionReferenceScan = { state: 'pending', error: null };
const execFileAsync = promisify(execFile);

function stageOneFailure(error) {
  if (error?.code === 'approval-not-pending') {
    return { ok: false, error: '该工具许可已经失效，请重新发起这项操作。' };
  }
  if (error?.code === 'session-model-ownership-unknown') {
    return { ok: false, error: error.message };
  }
  const name = error?.name === 'AbortError' ? '连接超时' : '连接或验证失败';
  return { ok: false, error: `${name}。请检查 API 地址、API Key 和模型后重试。` };
}

/** Keep unrelated settings writes from being lost to a failed raw-byte rollback. */
function enqueueSettingsFileWrite(label, work) {
  if (!enqueueExclusiveMainOperation) {
    try { work(); } catch (error) { logCrash(label, error); }
    return;
  }
  void enqueueExclusiveMainOperation(() => work()).catch((error) => logCrash(label, error));
}

function activeModelProfile() {
  const view = settingsMod?.listModelProfiles?.() ?? { profiles: [], activeId: null };
  return view.profiles.find((profile) => profile.id === view.activeId) ?? null;
}

function hasProfileCredential(profile) {
  return !!credentialForModelProfile(profile);
}

function credentialForModelProfile(profile) {
  const route = routeForProfile(profile.id);
  if (profile.id.startsWith('private-model-')) {
    return configStoreMod?.getCredential?.(officialCredentialRef(route.provider)) ?? null;
  }
  for (const ref of [profile.id, route.apiKeyEnv, officialCredentialRef(route.provider)]) {
    const credential = configStoreMod?.getCredential?.(ref);
    if (credential) return credential;
  }
  return null;
}

function publicModelView() {
  const view = settingsMod?.listModelProfiles?.() ?? { profiles: [], activeId: null };
  const profiles = view.profiles.map((profile) => {
    // During the one-time migration the same secret moves from the private
    // profile id to DSH's route ref and finally to the official provider ref.
    // Diagnostics and retained-data checks must recognise every exact alias
    // without decrypting or projecting the value.
    const hasKey = hasProfileCredential(profile);
    return { ...profile, hasKey };
  });
  const active = profiles.find((profile) => profile.id === view.activeId) ?? null;
  return { profiles, activeId: view.activeId, configured: !!active?.hasKey, active };
}

async function discoverOpenAICompatible({ baseUrl, apiKey }) {
  return discoverOpenAICompatibleModels({ baseUrl, apiKey });
}

async function validateStageOneModel({ baseUrl, apiKey, model }) {
  return verifyOpenAICompatibleModel({ baseUrl, apiKey, model });
}

/**
 * 本机测试便利入口。密钥只经子进程 stdout 管道进入当前主进程栈，
 * 随即完成真实验证并交给 config-store 的 safeStorage；绝不进入 renderer、命令行、
 * 普通配置、日志或错误对象。调用方不得保留返回值。
 */
async function readCurrentLocalServiceKey() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'llama-server.exe'\" | Where-Object { $_.CommandLine -match '--api[-_]key' })",
    'if ($items.Count -ne 1) { exit 41 }',
    "$match = [regex]::Match($items[0].CommandLine, '(?i)--api[-_]key\\s+(?:\\\"(?<key>[^\\\"]+)\\\"|(?<key>[^\\s]+))')",
    'if (!$match.Success) { exit 42 }',
    '[Console]::Out.Write($match.Groups[\'key\'].Value)',
  ].join('; ');
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 8 * 1024 });
    const apiKey = String(stdout).trim();
    if (!apiKey || apiKey.length > 4096) throw new Error('local service credential is unavailable');
    return apiKey;
  } catch {
    throw new Error('local service credential is unavailable');
  }
}

async function activateStageOneConfig(clean) {
  if (!saveModelRoute) throw new Error('模型路由尚未完成安全初始化');
  return saveModelRoute({ ...clean, provider: 'openai-compatible' });
}

async function stageOneGateway(path, init = {}) {
  if (!runtimeOrigin) throw new Error('runtime unavailable');
  const response = await fetch(new URL(`/weftmate/api/v1${path}`, runtimeOrigin), { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const nativeCode = typeof body.error?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.error.code)
      ? body.error.code : 'unknown';
    console.error(`[weftmate] gateway ${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${response.status} ${nativeCode}`);
    const error = Object.assign(new Error(`gateway request failed: HTTP ${response.status} ${nativeCode}`),
      { code: 'BACKEND_UNAVAILABLE', status: 503, nativeStatus: response.status, nativeCode });
    if (path === '/backup-pause') error.code = body.error?.code;
    throw error;
  }
  return body;
}

function stopStageOneEvents() { stageOneEventsAbort?.abort(); stageOneEventsAbort = null; }
function startStageOneEvents(sessionId) {
  stopStageOneEvents(); const controller = new AbortController(); stageOneEventsAbort = controller;
  void (async () => { try {
    if (!runtimeOrigin) throw new Error('session runtime unavailable');
    const response = await fetch(new URL(`/weftmate/api/v1/sessions/${encodeURIComponent(sessionId)}/events`, runtimeOrigin), { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('event stream unavailable');
    const reader = response.body.getReader(); let pending = '';
    while (!controller.signal.aborted) { const next = await reader.read(); if (next.done) break; pending += new TextDecoder().decode(next.value, { stream: true }); let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) { const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2); const data = frame.split('\n').find((line) => line.startsWith('data: ')); if (!data) continue; try { const event = JSON.parse(data.slice(6)); if (event?.type === 'turn.started') activeStageOneTurns.add(sessionId); if (event?.type === 'turn.stopped') activeStageOneTurns.delete(sessionId); win?.webContents.send('wm:stage1:event', event); } catch {} }
    }
  } catch (error) { if (!controller.signal.aborted) win?.webContents.send('wm:stage1:runtime-error', stageOneFailure(error)); } })();
}

/** 把窗口唤到前台(托盘点击 / 第二实例 / 菜单"显示")。 */
function showWindow() {
  if (personalDesktop) { personalDesktop.show(); return; }
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function requestFatalStartupExit(kind, error, view) {
  if (startupFailureReported) return;
  startupFailureReported = true;
  startupExitCode = 1;
  logCrash(kind, error);
  console.error(`[weftmate] ✗ ${kind}:`, redactSecretText(error && error.message ? error.message : error));
  if (!personalHostMode) {
    try {
      dialog.showErrorBox(view.title, view.message);
    } catch (dialogError) {
      // Windows 原生对话框若不可用，崩溃日志和 stderr 仍保留完整诊断。
      logCrash('startup-error-dialog', dialogError);
    }
  }
  app.quit();
}

function failHarnessStartup(error) {
  requestFatalStartupExit('Harness 启动失败', error, formatHarnessStartupError(error));
}

function failBootstrap(error) {
  requestFatalStartupExit('主进程启动失败', error, {
    title: 'WeftMate 启动失败',
    message: 'WeftMate 未能完成启动。请重试；若问题持续，请查看本机 WeftMate 崩溃日志。',
  });
}

// 仅连接中的父进程可用本机 IPC 管理个人接入；网络侧没有管理路由。
process.on('message', (message) => {
  if (process.env.WEFTMATE_DOGFOOD_CONTROL !== '1'
    || !process.connected || !message || typeof message !== 'object') return;
  if (message.type === 'weftmate:quit') {
    console.log('[weftmate] 收到 dogfood 退出请求');
    isQuitting = true;
    app.quit();
    return;
  }
  if (!personalHostMode || message.type !== 'weftmate:manage'
    || typeof message.requestId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(message.requestId)) return;
  void (async () => {
    let result;
    try {
      if (!personalAccessService || isQuitting) throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
      switch (message.action) {
        case 'device.add': result = await personalAccessService.enrollDevice({ name: message.name, scopes: message.scopes }); break;
        case 'device.revoke': result = await personalAccessService.revokeDevice(message.deviceId); break;
        case 'device.list': result = personalAccessService.listDevices(); break;
        case 'session.attach': result = await personalAccessService.attachSession(message.sessionId); break;
        case 'account.setup': {
          if (message.open !== undefined && typeof message.open !== 'boolean') {
            throw Object.assign(new Error('invalid setup request'), { code: 'INVALID_COMMAND' });
          }
          if (!personalAccessOrigin) throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
          const issued = await personalAccessService.issueSetupGrant();
          if (message.open === true) {
            const setupUrl = new URL('/personal/v1/ui', personalAccessOrigin);
            setupUrl.hash = `setup=${encodeURIComponent(issued.grant)}`;
            try { await shell.openExternal(setupUrl.href); }
            catch { throw Object.assign(new Error('browser unavailable'), { code: 'SETUP_OPEN_FAILED' }); }
            result = { opened: true, expiresAt: issued.expiresAt };
          } else result = { grant: issued.grant, expiresAt: issued.expiresAt, origin: personalAccessOrigin };
          break;
        }
        case 'model.configure-local': {
          if (!configureLocalModel) throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
          result = await configureLocalModel({ modelId: message.modelId, name: message.name });
          break;
        }
        case 'model.configure-observed-local': {
          if (!stage14R2Observation || !configureObservedLocalModel ||
              Object.keys(message).some((key) => !['type', 'requestId', 'action'].includes(key))) {
            throw Object.assign(new Error('invalid observation request'), { code: 'INVALID_COMMAND' });
          }
          result = await configureObservedLocalModel();
          break;
        }
        case 'model.configure-observed-low': {
          if (!stage14R2Observation || !configureObservedLocalModel ||
              Object.keys(message).some((key) => !['type', 'requestId', 'action'].includes(key))) {
            throw Object.assign(new Error('invalid observation request'), { code: 'INVALID_COMMAND' });
          }
          result = await configureObservedLocalModel({ low: true });
          break;
        }
        case 'model.configure-observed-low-fixture': {
          const fixture = syntheticStopFixtureRoute({ ...message,
            action: 'model.configure-synthetic-stop-fixture' }, {
            enabled: stage14R2Observation && process.env.WEFTMATE_SYNTHETIC_STOP_FIXTURE === '1',
            profile: app.getPath('userData'),
          });
          if (!fixture || !configureObservedSyntheticLowModel) {
            throw Object.assign(new Error('invalid low fixture'), { code: 'INVALID_COMMAND' });
          }
          result = await configureObservedSyntheticLowModel(fixture.baseUrl);
          break;
        }
        case 'model.configure-local-catalog': {
          if (Object.keys(message).some((key) => !['type', 'requestId', 'action'].includes(key)) ||
              !configureLocalCatalog) throw Object.assign(new Error('invalid catalog request'), { code: 'INVALID_COMMAND' });
          result = await configureLocalCatalog();
          break;
        }
        case 'model.configure-synthetic-stop-fixture': {
          const fixture = syntheticStopFixtureRoute(message, {
            enabled: process.env.WEFTMATE_SYNTHETIC_STOP_FIXTURE === '1',
            profile: app.getPath('userData'),
          });
          if (!fixture) {
            throw Object.assign(new Error('invalid fixture configuration'), { code: 'INVALID_COMMAND' });
          }
          const observer = stage14R2Observation
            ? await createPersonalModelObservationProxy({
              targetOrigin: new URL(fixture.baseUrl).origin, recorder: modelObservationRecorder,
              runId: stage14R2Observation.runId,
            }) : null;
          if (observer) ownedModelObservationProxies.add(observer);
          try {
            result = await saveModelRoute({ id: 'synthetic-stop-fixture', name: 'Synthetic stop fixture',
              provider: 'openai-compatible', baseUrl: observer?.baseUrl ?? fixture.baseUrl,
              model: 'synthetic-stop-model', apiKey: 'synthetic-stop-fixture-only',
              contextWindow: 8192, outputReserve: 1024 }, { catalogOnly: true });
          } catch (error) {
            if (observer) {
              try { await observer.close(); ownedModelObservationProxies.delete(observer); }
              catch { /* Shutdown will retry this owned observer. */ }
            }
            throw error;
          }
          if (observer) {
            const previous = modelObservationProxy;
            modelObservationProxy = observer;
            if (previous && previous !== observer) {
              try { await previous.close(); ownedModelObservationProxies.delete(previous); }
              catch { /* New route is already committed; keep old observer tracked for shutdown. */ }
            }
          }
          break;
        }
        case 'status': result = personalAccessService.status(); break;
        default: throw Object.assign(new Error('invalid action'), { code: 'INVALID_COMMAND' });
      }
      try { process.send?.({ type: 'weftmate:manage-result', requestId: message.requestId, ok: true, result }); } catch { /* parent disconnected */ }
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z_]{2,48}$/.test(error.code) ? error.code : 'MANAGEMENT_FAILED';
      try { process.send?.({ type: 'weftmate:manage-result', requestId: message.requestId, ok: false, code }); } catch { /* parent disconnected */ }
    }
  })();
});

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
  enqueueSettingsFileWrite('desktop-pet-settings', () => {
    const bounds = desktopPetWin && !desktopPetWin.isDestroyed() ? desktopPetWin.getBounds() : settingsMod.getDesktopPetWindowState?.();
    const freeActivity = settingsMod.getDesktopPetWindowState?.().freeActivity === true;
    settingsMod.setDesktopPetWindowState?.({ visible: visible === true, x: bounds?.x, y: bounds?.y, freeActivity });
  });
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
  enqueueSettingsFileWrite('desktop-pet-free-activity', () => {
    const previous = settingsMod?.getDesktopPetWindowState?.() ?? { visible: desktopPetVisible(), freeActivity: false };
    settingsMod?.setDesktopPetWindowState?.({ ...previous, visible: desktopPetVisible(), freeActivity: enabled === true });
  });
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
  // A crash journal must be restored before *any* config/vault import, legacy
  // migration, patch read, or runtime construction.  Those modules may
  // otherwise normalize/rewrite exactly the bytes the journal protects.
  const userDataDir = app.getPath('userData');
  if (personalHostMode) await ensurePrivateDirectory(userDataDir);
  if (personalHostMode) personalBackupManager = await createBackupManager({
    root: userDataDir, appVersion: app.getVersion(),
    isIdle: async () => !isQuitting && !personalAccessService?.hasUnissuedDshCommands?.() &&
      (await webRuntime?.personalModelQueueIdle?.())?.idle === true,
    requestRestart: () => { backupRestartRequested = true; setTimeout(() => app.quit(), 250); },
    captureBoundary: (work, { signal, deadline, check, stage }) => exclusiveMainQueue.run(async () => {
      check();
      if (personalAccessService?.hasUnissuedDshCommands?.() || !(await webRuntime.personalModelQueueIdle()).idle)
        throw Object.assign(new Error('SESSION_BUSY'), { code: 'SESSION_BUSY' });
      const id = randomUUID();
      try {
        await stageOneGateway('/backup-pause', { method: 'POST', body: JSON.stringify({ id, deadline, stage }), signal });
        check(); await work();
      } finally {
        // The native lease also expires independently if the host is stalled.
        await stageOneGateway('/backup-resume', { method: 'POST', body: JSON.stringify({ id }), signal: AbortSignal.timeout(2000) }).catch(() => {});
      }
    }),
  });
  if (process.env.WEFTMATE_STAGE14_R2_OBSERVE === '1') {
    if (!personalHostMode || app.isPackaged) throw new Error('Stage14R2 observer requires an isolated development host');
    stage14R2Observation = stage14R2ObservationProfile({ enabled: '1', profile: userDataDir,
      repository: process.cwd(), runId: process.env.WEFTMATE_STAGE14_R2_RUN_ID });
    const observationDir = await ensurePrivateDirectory(join(userDataDir, 'stage14-r2-observation'));
    const semanticFile = join(observationDir, 'semantic.jsonl');
    const networkFile = join(observationDir, 'network.jsonl');
    for (const file of [semanticFile, networkFile]) {
      if (!existsSync(file)) writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
      await ensurePrivateFile(file);
    }
    process.env.WEFTMATE_STAGE14_R2_SEMANTIC_LOG = semanticFile;
    modelObservationRecorder = createObservationRecorder(networkFile);
    stage14R2Observation = { ...stage14R2Observation, semanticFile, networkFile };
  }
  const dshHome = join(userDataDir, 'dsh-home');
  const ROUTES_PATCH = join(dshHome, 'weftmate-stage2-model-routes.patch.yml');
  const SECURITY_PATCH = join(dshHome, 'weftmate-security-credentials.patch.yml');
  const ROUTE_MUTATION_JOURNAL = join(dshHome, 'weftmate-stage2-model-routes.recovery.json');
  const OFFICIAL_ROUTE_MIGRATION_MARKER = join(dshHome, 'weftmate-stage2-official-routes-migration.json');
  const isRoutePatchRetired = () => {
    try { return /providers:\s*\{\}/.test(readFileSync(ROUTES_PATCH, 'utf8')); }
    catch { return false; }
  };
  const readOfficialRouteMigrationMarker = () => {
    try {
      const marker = JSON.parse(readFileSync(OFFICIAL_ROUTE_MIGRATION_MARKER, 'utf8'));
      if (marker?.schemaVersion !== 1 || marker?.authority !== 'official-dsh-user-settings'
        || !Array.isArray(marker?.routes) || !marker.routes.every((route) => typeof route === 'string' && route.length > 0)) return null;
      return new Set(marker.routes);
    } catch { return null; }
  };
  const writeOfficialRouteMigrationMarker = (routes) => {
    const marker = JSON.stringify({
      schemaVersion: 1,
      authority: 'official-dsh-user-settings',
      routes: [...routes],
    }, null, 2) + '\n';
    mkdirSync(dshHome, { recursive: true });
    const temporary = `${OFFICIAL_ROUTE_MIGRATION_MARKER}.${process.pid}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, marker, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, OFFICIAL_ROUTE_MIGRATION_MARKER); }
    catch (error) { try { rmSync(temporary, { force: true }); } catch { /* do not replace a valid prior marker */ } throw error; }
  };
  // This is deliberately recomputed *after* recovery below. A recovered
  // route-mutation journal may replace the bytes of ROUTES_PATCH.
  let legacyRoutePatchRetired = false;
  let officialRouteMigrationComplete = false;
  let officialRouteMigrationRoutes = new Set();
  /** Last CLI overlay: even a handwritten profile patch cannot re-enable the
   * file-backed credential provider after WeftMate selected safeStorage IPC. */
  function writeCredentialSecurityPatch() {
    const content = [
      '# Generated by WeftMate. This final CLI overlay keeps secrets out of DSH_HOME.',
      '- id: credentials',
      '  disabled: true',
      '- id: weftmate-credentials',
      '  disabled: true',
      '# This reserved root insert is authoritative even when an owner patch',
      '# omits or edits the old provider. A second credential service is a',
      '# Cordis collision and therefore fails boot rather than falling back.',
      '- insert:',
      '    - id: weftmate-safe-credentials',
      '      name: ./plugins/weftmate-credentials.mjs',
      '    - id: weftmate-personal-model-idle',
      '      name: ./plugins/weftmate-personal-model-idle.mjs',
      ...(personalHostMode ? [
        '# Personal host retains one ApiProxy but omits its default-model write callback.',
        '- id: api-gateway',
        '  disabled: true',
        '- insert:',
        '    - id: weftmate-personal-api-gateway',
        '      name: ./plugins/weftmate-personal-api-proxy.mjs',
        '- insert:',
        '    - id: weftmate-personal-reply-evidence',
        '      name: ./plugins/weftmate-personal-reply-evidence.mjs',
        ...(stage14R2Observation ? [
          '- insert:',
          '    - id: weftmate-personal-model-observer',
          '      name: ./plugins/weftmate-personal-model-observer.mjs',
        ] : []),
      ] : []),
      '',
    ].join('\n');
    mkdirSync(dshHome, { recursive: true });
    const temporary = `${SECURITY_PATCH}.${process.pid}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, SECURITY_PATCH); }
    catch (error) { try { rmSync(temporary, { force: true }); } catch { /* retain last safe patch */ } throw error; }
  }
  try {
    recoverRouteMutationJournalFiles({ journalPath: ROUTE_MUTATION_JOURNAL,
      settingsPath: join(userDataDir, 'weftmate-settings.json'), vaultPath: join(userDataDir, 'weftmate-model.enc'), patchPath: ROUTES_PATCH });
  } catch (error) {
    requestFatalStartupExit('模型路由恢复失败', error, {
      title: 'WeftMate 启动已安全停止',
      message: '检测到损坏或无法恢复的模型路由记录。为保护原有模型设置和凭据，WeftMate 没有继续启动。',
    });
    return;
  }
  const restoredOfficialMigrationRoutes = readOfficialRouteMigrationMarker();
  officialRouteMigrationComplete = restoredOfficialMigrationRoutes !== null;
  officialRouteMigrationRoutes = restoredOfficialMigrationRoutes ?? new Set();
  legacyRoutePatchRetired = officialRouteMigrationComplete || isRoutePatchRetired();
  // 先加载 safeStorage vault；现有密钥只在 DSH 受管 child IPC 按 ref 请求时解密。
  try {
    configStoreMod = await import('./config-store.ts');
    console.log('[weftmate] ✓ 模型凭据保险库已就绪');
  } catch (e) {
    console.error('[weftmate] 读模型配置失败(当作未配,官方 Models 页可配):', e && e.message ? e.message : e);
  }

  // Stage 4A development seam: an operator may seed the AI-Game capability
  // once into safeStorage. The value is deleted from Electron's environment
  // before the managed DSH child is constructed; only ctx.credentials can
  // resolve it afterward. Packaged Stage 3 does not start or imply AI-Game.
  const AI_GAME_CREDENTIAL_REF = 'WEFTMATE_AI_GAME_CAPABILITY_TOKEN';
  const AI_GAME_PRINCIPAL_REF = 'WEFTMATE_AI_GAME_PRINCIPAL_ID';
  const AI_GAME_CONTROLLER_REF = 'WEFTMATE_AI_GAME_CONTROLLER_ID';
  const aiGameDevelopmentToken = app.isPackaged
    ? undefined
    : process.env.WEFTMATE_AI_GAME_DEV_TOKEN;
  delete process.env.WEFTMATE_AI_GAME_DEV_TOKEN;
  if (typeof aiGameDevelopmentToken === 'string'
    && aiGameDevelopmentToken.length >= 16 && aiGameDevelopmentToken.length <= 4096) {
    try { configStoreMod?.saveCredential?.(AI_GAME_CREDENTIAL_REF, aiGameDevelopmentToken); }
    catch { console.warn('[weftmate] AI-Game 开发 capability 未能写入安全凭据库。'); }
  }
  // Stable per-installation capability owner pair. These values are
  // intentionally non-secret, but remain host-only: the credential bridge
  // keeps them out of renderer state, URLs, ordinary settings, child env, and
  // logs. The bearer token authenticates requests but never defines ownership.
  try {
    for (const [ref, prefix] of [
      [AI_GAME_PRINCIPAL_REF, 'principal'],
      [AI_GAME_CONTROLLER_REF, 'controller'],
    ]) {
      const existingId = configStoreMod?.getCredential?.(ref);
      if (typeof existingId !== 'string'
        || !/^[A-Za-z0-9._:-]{1,256}$/.test(existingId)) {
        configStoreMod?.saveCredential?.(
          ref,
          `${prefix}_${randomUUID().replaceAll('-', '')}`,
        );
      }
    }
  } catch {
    console.warn('[weftmate] AI-Game 本机 owner identity 未能持久化；v2 capability 将保持不可用。');
  }
  // Legacy source-contract boundary: there is intentionally no development
  // origin value. The following runtime-root capture replaces ambient origin
  // adoption, and the DSH child receives neither value.
  // let aiGameDevelopmentOrigin
  // Development may point at a fixed, independently reviewed managed artifact.
  // Capture and immediately remove it; DSH never inherits a runtime path or a
  // historical ambient origin.
  const aiGameManagedRuntimeRoot = app.isPackaged ? null : process.env.WEFTMATE_AI_GAME_RUNTIME_ROOT;
  delete process.env.WEFTMATE_AI_GAME_RUNTIME_ROOT;
  delete process.env.WEFTMATE_AI_GAME_ORIGIN;
  const phoneExecutionConfigPath = app.isPackaged ? null : process.env.WEFTMATE_PHONE_EXECUTION_CONFIG;
  delete process.env.WEFTMATE_PHONE_EXECUTION_CONFIG;
  if (aiGameManagedRuntimeRoot || (app.isPackaged && existsSync(join(process.resourcesPath, 'ai-game-runtime')))) {
    try {
      if (!configStoreMod.getCredential(AI_GAME_CREDENTIAL_REF)) {
        configStoreMod.saveCredential(AI_GAME_CREDENTIAL_REF, randomBytes(32).toString('hex'));
      }
    } catch { console.warn('[weftmate] 手机运行组件的本机凭据尚未就绪。'); }
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
  //   凭据接缝:DSH provider 经受管 child IPC 按 ref 请求 safeStorage；密钥不进 child env 或普通文件。
  //   Electron 里用 process.execPath + ELECTRON_RUN_AS_NODE=1 当 node 用(不依赖 PATH 里的 node)。
  // R2-02：工作区默认值 = userData/workspace（REQUIREMENTS 口径）。子进程 cwd = 此目录 →
  // 显式个人宿主目录沿同一 cwd 通路；sandbox-policy 与新会话仍使用正常工作区边界。
  const workspaceDir = personalWorkspaceDirectory(process.argv, personalHostMode, app.getPath('userData'));
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
  // These are product metadata only. DshWebRuntime removes all secret-shaped
  // variables before spawning; its credential IPC remains the sole key path.
  Object.assign(process.env, {
    WEFTMATE_APP_VERSION: appVersion,
    WEFTMATE_USER_DATA: app.getPath('userData'),
    WEFTMATE_DSH_HOME: dshHome,
    WEFTMATE_WORKSPACE: workspaceDir,
    WEFTMATE_MEMOWEFT_ENABLED: process.env.WEFTMATE_MEMOWEFT_ENABLED === '1' ? '1' : '0',
    WEFTMATE_PERSONAL_MEMORY_ENABLED: personalMemoryConfigPath ? '1' : '0',
  });
  const writeHostSnapshot = createLatestFileWriter(HOST_STATE_FILE);
  function writeHostState() {
    try {
      // 故障路径也要留下可读诊断：DSH checkout 的预检失败可能发生在 profile
      // 首次创建 dshHome 之前，不能让状态文件的父目录缺失掩盖原始失败原因。
      mkdirSync(dshHome, { recursive: true });
      const payload = {
        schemaVersion: 1,
        app: { name: 'WeftMate', version: appVersion },
        mode: personalHostMode ? 'personal-host' : 'desktop',
        tray: { resident: !headless },
        runtime: hostRuntimeState(hostLifecycleState, runtimeOrigin),
        referenceScan: {
          state: sessionReferenceScan.state,
          modelRouteChangesBlocked: sessionReferenceScan.state !== 'ready',
        },
        personalAccess: {
          enabled: accessPort !== null,
          state: hostLifecycleState === 'stopped' ? 'stopped'
            : hostLifecycleState === 'stopping' ? 'stopping'
              : personalAccessOrigin ? 'listening' : accessPort === null ? 'disabled' : 'starting',
          origin: hostLifecycleState === 'stopping' || hostLifecycleState === 'stopped' ? null : personalAccessOrigin,
        },
        dataDirs: {
          userData: app.getPath('userData'),
          dshHome,
          workspace: workspaceDir,
        },
        update: updateState(),
        memoweft: { enabled: process.env.WEFTMATE_MEMOWEFT_ENABLED === '1' },
        ...(personalHostMode && accessPort !== null
          ? { accountModelRouteGate: { ...accountModelRouteGate } } : {}),
        ...(personalHostMode && personalMemoryConfigPath ? { accountMemoryIpc: { ...personalMemoryIpc } } : {}),
        aiGame: (() => {
          const state = aiGameRuntime?.diagnostics?.() ?? { managed: true, state: 'not_installed', reasonCode: 'runtime_not_installed', runtimeVersion: null, apiVersion: null, retryable: false };
          return { managed: state.managed === true, state: state.state, reasonCode: state.reasonCode, runtimeVersion: state.runtimeVersion, apiVersion: state.apiVersion, retryable: state.retryable === true };
        })(),
        // R6-02 · 桌宠状态块：官方 UI 宠物胶囊读这里（唤醒/休息/自由活动展示与动作）。
        pet: {
          name: desktopCompanion?.pet?.name ?? null,
          persona: desktopCompanion?.persona?.name ?? null,
          visible: desktopPetVisible(),
          freeActivity: desktopPetFreeActivity(),
        },
      };
      void writeHostSnapshot(`${JSON.stringify(payload, null, 2)}\n`).catch(error => logCrash('host-state-write', error));
    } catch (error) { logCrash('host-state-write', error); }
  }
  writeHostStateForLifecycle = writeHostState;
  /** 消费 UI 侧发来的更新请求（check / install）；消费即删，防重复触发。 */
  async function handleUpdateRequests() {
    let raw = null;
    try {
      raw = JSON.parse(await readFileAsync(UPDATE_REQUEST_FILE, 'utf8'));
    } catch { return; } // 半写/坏文件：下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { await rmAsync(UPDATE_REQUEST_FILE, { force: true }); } catch { /* 删不掉下轮再试 */ }
    if (raw.action === 'check') void checkForUpdates(() => win);
    else if (raw.action === 'install') installPreviewUpdateFromTray();
  }
  // ── R6-01 · 感知请求面：官方 UI（客户端插件）→ 宿主插件写请求文件 → main 消费切换开关 ──
  const PERCEPTION_REQUEST_FILE = join(dshHome, 'weftmate-perception-request.json');
  async function handlePerceptionRequests() {
    let raw = null;
    try {
      raw = JSON.parse(await readFileAsync(PERCEPTION_REQUEST_FILE, 'utf8'));
    } catch { return; } // 半写/坏文件：下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { await rmAsync(PERCEPTION_REQUEST_FILE, { force: true }); } catch { /* 删不掉下轮再试 */ }
    enqueueSettingsFileWrite('perception-request', () => {
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
    });
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
  async function handlePetRequests() {
    if (headless) return;
    let raw = null;
    try {
      raw = JSON.parse(await readFileAsync(PET_REQUEST_FILE, 'utf8'));
    } catch { return; } // 半写/坏文件：下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { await rmAsync(PET_REQUEST_FILE, { force: true }); } catch { /* 删不掉下轮再试 */ }
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
  let requestPolling = Promise.resolve();
  setInterval(() => {
    requestPolling = requestPolling.then(handleUpdateRequests).then(handlePerceptionRequests)
      .then(handlePetRequests).catch(error => logCrash('host-request-poll', error));
  }, 1_000).unref?.();

  const routeMutationJournal = createRouteMutationJournal({ journalPath: ROUTE_MUTATION_JOURNAL, patchPath: ROUTES_PATCH,
    restoreSettingsBytes: (bytes) => settingsMod.restoreSettingsBytes(bytes), restoreVaultBytes: (bytes) => configStoreMod.restoreVaultBytes(bytes) });
  const routeMutationQueue = createRouteMutationQueue();
  // One exclusive lane covers the snapshot/rollback transaction *and* any
  // session or settings-file write that could otherwise cross its idle fence.
  const enqueueRouteMutation = (work) => routeMutationQueue.run(work);
  enqueueExclusiveMainOperation = enqueueRouteMutation;
  exclusiveMainQueue = routeMutationQueue;
  function verifiedLegacyCompatibilityProfile(profiles = settingsMod.listModelProfiles().profiles) {
    const recorded = settingsMod.legacyCompatibilityProfileId();
    const evidence = configStoreMod.legacyCompatibilityEvidence();
    if (!recorded || !evidence || recorded !== evidence.id) return null;
    const profile = profiles.find((item) => item.id === evidence.id) ?? null;
    return profile && profile.baseUrl === evidence.baseUrl && profile.model === evidence.model ? profile : null;
  }
  /**
   * DSH credential references are deliberately just POSIX-style identifiers.
   * They are names, not environment variables in WeftMate: the child receives
   * no secret environment at all, and this handler is the sole resolver.
   */
  const isCredentialRef = (value) => typeof value === 'string'
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    && value.length <= 160;
  const profileForCredentialRef = (ref) => settingsMod.listModelProfiles().profiles
    .find((profile) => routeForProfile(profile.id).apiKeyEnv === ref) ?? null;
  /**
   * Stage 2's first candidate keyed the vault by public profile id.  The DSH
   * Models surface addresses credentials by `apiKeyEnv`, so migrate only the
   * exact deterministic route alias on first access.  This stays entirely in
   * Electron main and never exposes either identifier's value to the page.
   */
  const legacyCredentialForRef = (ref) => {
    const current = configStoreMod.getCredential(ref);
    if (current) return current;
    const profile = profileForCredentialRef(ref);
    if (!profile) return null;
    return configStoreMod.getCredential(profile.id);
  };
  const migrateLegacyCredentialRef = (ref) => {
    const current = configStoreMod.getCredential(ref);
    if (current) return current;
    const profile = profileForCredentialRef(ref);
    if (!profile) return null;
    const legacy = configStoreMod.getCredential(profile.id);
    if (!legacy) return null;
    configStoreMod.saveCredential(ref, legacy);
    configStoreMod.removeCredential(profile.id);
    return legacy;
  };
  const credentialRequestHandler = async ({ operation, ref, value }) => {
    if (!isCredentialRef(ref)) throw new Error('invalid credential ref');
    const managedRefs = new Set(['WEFTMATE_AI_GAME_MANAGED_STATE', 'WEFTMATE_AI_GAME_MANAGED_ORIGIN']);
    if (managedRefs.has(ref)) {
      if (operation === 'resolve') {
        const state = aiGameRuntime?.diagnostics?.() ?? { state: 'not_installed' };
        const resolved = ref === 'WEFTMATE_AI_GAME_MANAGED_STATE' ? state.state : aiGameRuntime?.originForHost?.();
        return resolved ? { value: resolved, source: 'weftmate-managed-ai-game' } : {};
      }
      if (operation === 'describe') return { configured: true, source: 'weftmate-managed-ai-game', writable: false };
      throw new Error('managed AI-GAME refs are read-only');
    }
    if (operation === 'resolve') {
      const resolved = migrateLegacyCredentialRef(ref);
      return resolved ? { value: resolved, source: 'weftmate-safe-storage' } : {};
    }
    if (operation === 'describe') {
      return { configured: !!migrateLegacyCredentialRef(ref), source: 'weftmate-safe-storage', writable: true };
    }
    if (operation === 'set') {
      if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error('invalid credential value');
      configStoreMod.saveCredential(ref, value);
      // If a legacy profile-id entry remains, the ref is now authoritative.
      const profile = profileForCredentialRef(ref);
      if (profile) configStoreMod.removeCredential(profile.id);
      return { changed: true };
    }
    if (operation === 'unset') {
      configStoreMod.removeCredential(ref);
      // A delete from the official page must not leave the old profile-id
      // fallback silently usable after a restart.
      const profile = profileForCredentialRef(ref);
      if (profile) configStoreMod.removeCredential(profile.id);
      return { changed: true };
    }
    throw new Error('unsupported credential operation');
  };
  aiGameRuntime = new ManagedAiGameRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    runtimeRoot: aiGameManagedRuntimeRoot,
    userDataDir: app.getPath('userData'),
    resolveCredentials: async () => ({
      capability: configStoreMod?.getCredential?.(AI_GAME_CREDENTIAL_REF),
      principalId: configStoreMod?.getCredential?.(AI_GAME_PRINCIPAL_REF),
      controllerId: configStoreMod?.getCredential?.(AI_GAME_CONTROLLER_REF),
    }),
    resolveExecution: () => loadPhoneExecutionConfig(phoneExecutionConfigPath, migrateLegacyCredentialRef),
    onState: () => writeHostState(),
  });
  // Deliberately independent: a slow/missing managed runtime must not delay
  // DSH bootstrap, window creation, or ordinary conversation.
  void aiGameRuntime.start();
  const productDshRuntime = app.isPackaged
    ? join(process.resourcesPath, 'dsh-runtime')
    : join(app.getAppPath(), 'vendor', 'dsh-runtime');
  if (personalHostMode && process.env.WEFTMATE_SYNTHETIC_STOP_FIXTURE === '1') {
    console.log('[weftmate] synthetic source provenance=' + JSON.stringify({
      appPath: app.getAppPath(), mainModule: fileURLToPath(import.meta.url),
      runtimeModule: fileURLToPath(new URL('./dsh-web-runtime.ts', import.meta.url)),
      gatewaySource: fileURLToPath(new URL('./runtime/gateway/routes/v1.mjs', import.meta.url)),
      adapterSource: fileURLToPath(new URL('./runtime/dsh-adapter/agents.mjs', import.meta.url)),
      fixedDshRuntime: productDshRuntime,
    }));
  }
  function memoryPolicyAccess() {
    return { ...personalAccessService,
      privateAccountModelProof: (ownerId, profileId) => {
        const proof = personalAccessService?.privateAccountModelProof?.(ownerId, profileId);
        return proof && accountModelManager?.hasCredential(profileId) === true
          ? { ...proof, credential: true } : null;
      } };
  }
  function memoryProcessingRouteForSession(ownerId, sessionId) {
    if (!personalAccessService || !personalMemoryRuntimeConfig) return null;
    const profiles = settingsMod.listModelProfiles().profiles;
    let boundProfileId = null;
    if (sessionId !== null) {
      const binding = personalAccessService.ownerForSession(sessionId);
      if (!binding || binding.ownerId !== ownerId) return null;
      const described = { agentPreset: binding.origin === 'shared-chat'
        ? 'personal-shared-chat' : binding.origin === 'personal-remote' ? 'personal-remote' : null };
      boundProfileId = settingsMod.sessionModelBinding(sessionId);
      const destination = memoryRecallDestination({ binding, described, boundProfileId,
        profiles, access: memoryPolicyAccess(), hasCredential: hasProfileCredential });
      if (!destination.allowed) return null;
    }
    const backgroundProfileId = personalAccessService.backgroundModelProfile(ownerId);
    const selected = selectBackgroundProfile({ explicit: backgroundProfileId, bound: boundProfileId,
      current: personalAccessService.currentChatModelProfile(ownerId), profiles,
      allowed: id => personalAccessService.canUseModelProfile(ownerId, id, 'new') });
    hostLog.write('background.route', { profileId: selected?.id, sessionId: sessionId ?? undefined, configured: !!selected });
    if (!selected || !personalAccessService.canUseModelProfile(ownerId, selected.id, 'new')) return null;
    const key = credentialForModelProfile(selected);
    return key ? { profileId: selected.id, baseUrl: modelScheduler.memoryBaseUrl(selected.id, ownerId, sessionId),
      model: selected.model, modelTier: memoryRecallModelTier(selected),
      routeFingerprint: personalAccessService.privateAccountModelProof(ownerId, selected.id)?.routeFingerprint ?? null,
      credential: key } : null;
  }
  const localModelFlag = process.argv.find(arg => arg.startsWith('--local-model-config='));
  const localModelController = localModelFlag
    ? createLocalModelController(localModelFlag.slice('--local-model-config='.length)) : null;
  modelScheduler = await createModelScheduler({
    onEvent: (event, data) => hostLog.write(event, data),
    backgroundReady: profile => backgroundModelReady(profile, { credentialFor: credentialForModelProfile }),
    beginUsage: input => input.sessionId && !personalAccessService?.ownerForSession(input.sessionId)
      ? null : personalAccessService?.beginUsage(input),
    finishUsage: input => personalAccessService?.finishUsage(input),
    isIdle: async () => !personalAccessService?.hasUnissuedDshCommands?.() &&
      (await webRuntime?.personalModelQueueIdle?.(true))?.idle === true,
    profileFor: id => settingsMod.listModelProfiles().profiles.find(profile => profile.id === id ||
      routeForProfile(profile.id).provider === id || profile.baseUrl?.replace(/\/+$/, '') === id?.replace(/\/+$/, '')),
    credentialFor: credentialForModelProfile,
    backgroundRoute: async (sessionId, profileId) => {
      const binding = personalAccessService?.ownerForSession(sessionId);
      const selectedId = binding ? personalAccessService.backgroundModelProfile(binding.ownerId) ?? personalAccessService.currentChatModelProfile(binding.ownerId) : null;
      const profile = settingsMod.listModelProfiles().profiles.find(row => selectedId
        ? row.id === selectedId : row.id === profileId || routeForProfile(row.id).provider === profileId);
      if (!profile || binding && !personalAccessService.canUseModelProfile(binding.ownerId, profile.id, 'new')) {
        throw new Error('MODEL_UNAVAILABLE');
      }
      return { provider: routeForProfile(profile.id).provider, model: profile.model };
    },
  });
  process.env.WEFTMATE_MODEL_SCHEDULER_URL = modelScheduler.url;
  const createWebRuntime = () => new DshWebRuntime({
    // One process and one home are the Stage 0/1 durability boundary. Session
    // provider/model selection, not a child process, owns model affinity.
    homeDir: dshHome,
    workspaceDir,
    nodeElectron: true,
    noOpen: personalHostMode,
    personalHostApiProxy: personalHostMode,
    modelScheduling: true,
    // WeftMate 始终使用产品自有的固定 vendor runtime。开发版来自仓内
    // vendor/dsh-runtime，安装版来自 resources/dsh-runtime；显式传值也会压过
    // shell 中遗留的 WEFTMATE_DSH_CHECKOUT/WEFTMATE_DSH_RUNTIME，绝不启动个人 DSH checkout。
    runtimePath: productDshRuntime,
    // Security overlay is last: a preserved/handwritten profile patch cannot
    // turn dsh-credentials-local back on after we chose safeStorage IPC.
    patchFiles: [ROUTES_PATCH, SECURITY_PATCH],
    // The child IPC bridge is the only secret path.  The non-secret runtime
    // identity fields remain ordinary process metadata for our host plugins.
    credentialRequestHandler,
    personalDesktopRequestHandler: personalHostMode ? async (request) => {
      if (!personalAccessService || isQuitting || !runtimeOrigin) {
        throw Object.assign(new Error('unavailable'), { code: 'CAPABILITY_UNAVAILABLE' });
      }
      const described = await accessBackend.describeSession(request.sessionId);
      if (described?.agentPreset !== 'personal-remote') {
        throw Object.assign(new Error('unsafe preset'), { code: 'SESSION_READ_ONLY' });
      }
      if (request.action === 'approval_policy') return personalAccessService.getApprovalPolicy(request);
      if (['register_approval', 'read_approval', 'resolve_approval'].includes(request.action)) {
        return personalAccessService.trackToolApproval(request);
      }
      if (['authorize_execution', 'finish_execution', 'observe_execution_job'].includes(request.action)) {
        return personalAccessService.trackToolExecution(request);
      }
      if (request.action === 'register_file') return personalAccessService.registerNativeFile(request);
      if (request.action === 'browse') return personalAccessService.browse(request);
      throw Object.assign(new Error('unsupported personal tool action'), { code: 'INVALID_COMMAND' });
    } : undefined,
    personalApprovalRuntimeClosedHandler: personalHostMode ? ({ runtimeId }) =>
      personalAccessService?.invalidateToolApprovals({ runtimeId, outcome: 'unavailable',
        reasonCode: 'RUNTIME_UNAVAILABLE' }) : undefined,
    personalMemoryRequestHandler: personalHostMode && personalMemoryConfigPath ? async (request) => {
      if (request.action === 'recall') personalMemoryIpc.recallAttempts++;
      writeHostState();
      if (!personalAccessService || !personalMemoryManager || isQuitting || !runtimeOrigin) {
        throw Object.assign(new Error('unavailable'), { code: 'MEMORY_UNAVAILABLE' });
      }
      const binding = personalAccessService.ownerForSession(request.sessionId);
      // The account store recorded origin when this authenticated session was
      // created with its fixed preset. Do not call describeSession here: it
      // resolves through DSH while DSH is waiting on this very IPC response.
      const described = { agentPreset: binding?.origin === 'shared-chat'
        ? 'personal-shared-chat' : binding?.origin === 'personal-remote' ? 'personal-remote' : null };
      const bound = memorySessionPolicy({ binding, described, access: personalAccessService });
      if (!bound.allowed) {
        personalMemoryIpc.rejectedBindings++;
        writeHostState();
        throw Object.assign(new Error('memory preset mismatch'), { code: 'MEMORY_OWNER_UNAVAILABLE' });
      }
      if (request.action === 'ingest') {
        const boundary = assertOwnerBoundBoundary(request.sessionId, request.boundary);
        if (!memoryProcessingRouteForSession(binding.ownerId, request.sessionId)) {
          throw Object.assign(new Error('memory model destination unavailable'),
            { code: 'MEMORY_DESTINATION_BLOCKED' });
        }
        personalMemoryIpc.ingestRequests++;
        writeHostState();
        return personalMemoryManager.ingest(binding.ownerId, boundary);
      }
      // DSH is awaiting this pre-step IPC. Calling its session/model gateway here
      // can re-enter the same active turn, so use the host's durable route only.
      if (!memoryProcessingRouteForSession(binding.ownerId, request.sessionId)) {
        personalMemoryIpc.recallReplies++;
        writeHostState();
        return { state: 'withheld', reasonCode: 'MEMORY_DESTINATION_BLOCKED' };
      }
      personalMemoryIpc.recallRequests++;
      const foregroundProfile = settingsMod.listModelProfiles().profiles.find(profile =>
        profile.id === settingsMod.sessionModelBinding(request.sessionId));
      const finishMemory = modelScheduler.beginMemory(request.sessionId);
      const recalled = await personalMemoryManager.recall(binding.ownerId, { query: request.query,
        sessionId: request.sessionId, modelTier: memoryRecallModelTier(foregroundProfile) }).finally(finishMemory);
      if (recalled?.state === 'ready' && typeof recalled.contextText === 'string' && recalled.contextText.trim()) {
        personalMemoryIpc.recallWithContext++;
      }
      personalMemoryIpc.recallReplies++;
      writeHostState();
      return recalled;
    } : undefined,
    personalScheduleHandler: personalHostMode ? async request => {
      if (!personalAccessService || isQuitting) throw new Error('SCHEDULE_UNAVAILABLE');
      return personalAccessService.handleScheduleRuntime(request);
    } : undefined,
    personalConversationContextHandler: personalHostMode ? async (request) => {
      if (!personalAccessService || isQuitting || !runtimeOrigin) {
        throw Object.assign(new Error('unavailable'), { code: 'CONVERSATION_CONTEXT_UNAVAILABLE' });
      }
      // The child is blocked at pre-step. The service checks its own owner-bound
      // command receipt and sync snapshot; do not re-enter the DSH gateway here.
      return personalAccessService.getConversationContext({ sessionId: request.sessionId,
        turn: request.turn, step: request.step, receiptId: request.receiptId,
        messageHash: request.messageHash });
    } : undefined,
    log: (line) => { hostLog.write('runtime.event', { source: 'dsh', code: /error|failed|失败/i.test(line) ? 'RUNTIME_FAILURE' : 'RUNTIME_STATE' }); console.log(`[weftmate] ${redactSecretText(line)}`); },
  });
  async function replaceSharedRuntime() {
    const profiles = settingsMod.listModelProfiles().profiles
      .filter((profile) => !profile.id.startsWith('private-model-'));
    // Once the official settings migration is authoritative, this private
    // overlay must stay empty forever. Otherwise an official Models delete
    // would silently resurrect on the next child restart.
    writeModelRoutesPatch(ROUTES_PATCH, (legacyRoutePatchRetired || officialRouteMigrationComplete) ? [] : profiles);
    writeCredentialSecurityPatch();
    const previous = webRuntime;
    runtimeOrigin = null;
    trustedRuntimeOrigin = null;
    await modWindowManager?.rebind?.(null);
    if (previous) await previous.close();
    webRuntime = createWebRuntime();
    webRuntime.onOrigin = (origin) => {
      runtimeOrigin = origin;
      if (origin) void personalAccessService?.restoreSchedules?.().catch(() => {});
      writeHostState();
      if (origin) {
        if (!personalHostMode) void navigateToRuntimeSurface(origin).catch((error) => logCrash('dsh-surface-navigation', error));
        void modWindowManager?.rebind?.(origin);
      }
      else trustedRuntimeOrigin = null;
    };
    runtimeOrigin = await webRuntime.start();
    await modWindowManager?.rebind?.(runtimeOrigin);
    return runtimeOrigin;
  }
  async function mutateModelRouteTransaction(mutator) {
    // Preflight both persistent documents before changing either one. The raw
    // vault snapshot is opaque ciphertext; it never crosses the main-process
    // boundary, diagnostics, or logs.
    const settingsSnapshot = settingsMod.snapshotSettingsBytes();
    configStoreMod.preflightVault();
    const vaultSnapshot = configStoreMod.snapshotVaultBytes();
    const patchSnapshot = existsSync(ROUTES_PATCH) ? readFileSync(ROUTES_PATCH) : null;
    return runRecoverableProfileMutation({
      snapshot: { settingsSnapshot, vaultSnapshot, patchSnapshot },
      writeJournal: ({ settingsSnapshot, vaultSnapshot, patchSnapshot }) => routeMutationJournal.write({ settingsSnapshot, vaultSnapshot, patchSnapshot }),
      apply: mutator,
      restore: async ({ settingsSnapshot: settings, vaultSnapshot: vault, patchSnapshot: patch }) => {
        settingsMod.restoreSettingsBytes(settings);
        configStoreMod.restoreVaultBytes(vault);
        if (patch === null) { if (existsSync(ROUTES_PATCH)) rmSync(ROUTES_PATCH, { force: true }); }
        else writeFileSync(ROUTES_PATCH, patch, { mode: 0o600 });
        // replaceSharedRuntime may already have closed the old child. Rebuild
        // exactly one child using the compensated public/vault/patch state.
        await replaceSharedRuntime();
      },
      clearJournal: routeMutationJournal.clear,
    });
  }
  ensureSharedRuntime = async ({ reload = false } = {}) => {
    if (reload || !webRuntime) return replaceSharedRuntime();
    if (!runtimeOrigin) {
      runtimeOrigin = await webRuntime.start();
    }
    return runtimeOrigin;
  };
  /**
   * Private Stage-2 routes originally arrived through the CLI base patch. The
   * official Models page correctly treats those as non-removable. Copy them
   * once through DSH's own settings API, then restart with an empty base
   * overlay so delete/edit is owned by the durable user settings layer.
   *
   * Ordering is recoverable: copy the target safeStorage ref first, commit
   * the official live settings mutation, then retire the base patch. A crash
   * can leave a harmless duplicate source, never a route without its key.
   */
  async function migrateLegacyRoutesToOfficialSettings() {
    // A durable marker means the official user layer owns these routes. Do
    // not inspect the retained Stage-2 compatibility profiles again: a user
    // deletion in official Models is intentional and must not resurrect.
    if (officialRouteMigrationComplete) return runtimeOrigin;
    const profiles = settingsMod.listModelProfiles().profiles
      .filter((profile) => !profile.id.startsWith('private-model-'));
    if (profiles.length === 0) {
      legacyRoutePatchRetired = true;
      writeModelRoutesPatch(ROUTES_PATCH, []);
      return runtimeOrigin;
    }
    await assertRouteReloadSafe();
    const expectedRoutes = await Promise.all(profiles.map(async (profile) => {
      const route = routeForProfile(profile.id);
      const targetRef = officialCredentialRef(route.provider);
      return {
        profile, route, targetRef,
        routeProjection: {
          route: route.provider,
          displayName: profile.name,
          baseURL: profile.baseUrl,
          models: [{ id: profile.model, name: profile.name, ...await readModelCapacity({
            baseUrl: profile.baseUrl, modelId: profile.model,
            apiKey: configStoreMod.getCredential(profile.id) ?? undefined }) }],
        },
      };
    }));
    // Copy first; if the process stops before the official mutation, the old
    // base route and original key remain valid. We remove aliases only after
    // restart verification below.
    for (const item of expectedRoutes) {
      const legacy = legacyCredentialForRef(item.route.apiKeyEnv) ?? configStoreMod.getCredential(item.profile.id);
      if (legacy && !configStoreMod.getCredential(item.targetRef)) configStoreMod.saveCredential(item.targetRef, legacy);
    }
    if (!runtimeOrigin) throw new Error('official DSH runtime is unavailable');
    const officialDsh = createOfficialDshSettingsClient({ origin: runtimeOrigin });
    // The helper validates exact loopback origin, rpcId correlation, bounded
    // unary transport, optimistic-concurrency retry, and user-route conflicts.
    await migrateLegacyRoutes(officialDsh, expectedRoutes.map((item) => item.routeProjection));
    legacyRoutePatchRetired = true;
    writeModelRoutesPatch(ROUTES_PATCH, []);
    const restarted = await replaceSharedRuntime();
    const restartedDsh = createOfficialDshSettingsClient({ origin: restarted });
    const restartedSettings = await restartedDsh.describeSettings();
    const migratedCredentials = expectedRoutes.filter((item) => (
      legacyCredentialForRef(item.route.apiKeyEnv) ?? configStoreMod.getCredential(item.profile.id)
    )).map((item) => item.targetRef);
    const credentialRows = migratedCredentials.length > 0
      ? await restartedDsh.describeCredentials(migratedCredentials)
      : undefined;
    // `verifyLegacyRouteMigration` treats a supplied map as a requirement for
    // every route. Some legacy profiles legitimately had no key, so verify
    // route ownership first and only require rows for credentials that existed.
    const verification = verifyLegacyRouteMigration(expectedRoutes.map((item) => item.routeProjection), restartedSettings);
    if (!verification.ok) throw new Error(`official DSH route migration verification failed after restart: ${verification.reasons.join('; ')}`);
    for (const ref of migratedCredentials) {
      if (credentialRows?.[ref]?.configured !== true || credentialRows?.[ref]?.writable !== true) {
        throw new Error(`official DSH migrated credential is unavailable after restart: ${ref}`);
      }
    }
    // Crash-forward marker is written only after the restarted child proves
    // user-layer ownership. It prevents future reloads from restoring a base
    // route the user has later deleted in official Models.
    const migratedRouteNames = expectedRoutes.map((item) => item.route.provider);
    writeOfficialRouteMigrationMarker(migratedRouteNames);
    officialRouteMigrationComplete = true;
    officialRouteMigrationRoutes = new Set(migratedRouteNames);
    for (const item of expectedRoutes) {
      // Now, and only now, remove the pre-official aliases.
      configStoreMod.removeCredential(item.route.apiKeyEnv);
      configStoreMod.removeCredential(item.profile.id);
    }
    return restarted;
  }
  /**
   * A marker is written only after the restarted runtime verified durable
   * official ownership. If the app died between that marker and alias cleanup,
   * finish the idempotent cleanup on the next boot. We deliberately do not
   * recreate routes here: an absent route is an official Models deletion.
   */
  function cleanupMarkedLegacyCredentialAliases() {
    if (!officialRouteMigrationComplete) return;
    for (const profile of settingsMod.listModelProfiles().profiles) {
      const route = routeForProfile(profile.id);
      if (!officialRouteMigrationRoutes.has(route.provider)) continue;
      configStoreMod.removeCredential(route.apiKeyEnv);
      configStoreMod.removeCredential(profile.id);
    }
  }
  webRuntime = createWebRuntime();
  webRuntime.onOrigin = (origin) => {
    runtimeOrigin = origin;
    writeHostState();
    if (origin) {
      if (!personalHostMode) void navigateToRuntimeSurface(origin).catch((error) => logCrash('dsh-surface-navigation', error));
      void modWindowManager?.rebind?.(origin);
    } else {
      trustedRuntimeOrigin = null;
      void modWindowManager?.rebind?.(null);
    }
  };
  // The journal was recovered before imports above.  From this point onward
  // every route mutation enters the same queue before it can write one again.
  try {
    const legacy = configStoreMod?.migrateLegacyProfiles?.();
    if (legacy?.pending) {
      await enqueueRouteMutation(() => mutateModelRouteTransaction(async () => {
        const imported = settingsMod.importLegacyModelProfiles?.(legacy.profiles, legacy.activeId);
        if (!imported || imported.rejected.length > 0) throw new Error('旧模型公开元数据未被完整接受；保留原凭据档。');
        // Replace the Stage 1 vault only after the public profiles and the
        // explicit legacy compatibility profile are durable.
        configStoreMod?.completeLegacyMigration?.();
      }));
    }
  } catch (error) {
    requestFatalStartupExit('旧模型迁移失败', error, {
      title: 'WeftMate 启动已安全停止',
      message: '旧模型配置无法在受保护的路由事务中迁移，原始配置已保留。',
    });
    return;
  }
  // Older v2 candidate installs retain encrypted legacyPayload but predate the
  // public compatibility marker.  Backfill only exact evidence, journalled so
  // a crash restores the prior public/vault/patch bytes as one transaction.
  if (!settingsMod.legacyCompatibilityProfileId() && configStoreMod.legacyCompatibilityEvidence()) {
    try {
      await enqueueRouteMutation(() => mutateModelRouteTransaction(async () => {
        settingsMod.backfillLegacyCompatibilityProfile(configStoreMod.legacyCompatibilityEvidence());
      }));
    } catch (error) {
      requestFatalStartupExit('旧模型兼容归属回填失败', error, {
        title: 'WeftMate 启动已安全停止',
        message: '旧模型兼容归属无法安全回填，原有设置与凭据已保留。',
      });
      return;
    }
  }
  try { cleanupMarkedLegacyCredentialAliases(); }
  catch (error) { logCrash('official-route-migration-alias-cleanup', error); }
  console.log('[weftmate] DSH_HOME =', dshHome);
  runtimeOrigin = null;
  // Official DSH also owns first-run setup. The desktop view starts after
  // its exact-origin fence; personal host starts after IPC registration.
  sessionReferenceScan = { state: personalHostMode ? 'pending' : 'ready', error: null };
  // Kept solely to fail closed for dormant migration-only stage-1 handlers.
  // The main window never loads this local page once the DSH surface is ready.
  const legacyRendererUrl = pathToFileURL(join(import.meta.dirname, 'web', 'weftmate.html')).href;
  const TITLE_BAR_OVERLAY_HEIGHT = 44;
  let dshResolvedTheme = null;
  let dshSurfaceBackgroundColor = null;
  // The renderer sends only `getComputedStyle(body).backgroundColor`. Recheck
  // it in main: CSS variables, URLs, named colours and unbounded expressions
  // never cross this narrow visual-only IPC seam.
  const normalizeSurfaceColor = (value) => {
    if (typeof value !== 'string') return null;
    const color = value.trim();
    if (color.length < 4 || color.length > 32) return null;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
    const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0\.\d{1,3}))?\s*\)$/i.exec(color);
    if (!match || (color.slice(0, 4).toLowerCase() === 'rgba' && match[4] === undefined)
      || (color.slice(0, 4).toLowerCase() === 'rgb(' && match[4] !== undefined)) return null;
    if ([match[1], match[2], match[3]].some((part) => Number(part) > 255)) return null;
    return color;
  };
  const nativeWindowPalette = (resolvedTheme = dshResolvedTheme) => (resolvedTheme === 'dark'
    || (resolvedTheme !== 'light' && nativeTheme.shouldUseDarkColors))
    ? { background: '#121619', symbols: '#e8edf1' }
    : { background: '#f7f8fa', symbols: '#15202b' };
  const updateNativeWindowColors = (resolvedTheme = dshResolvedTheme, surfaceColor = dshSurfaceBackgroundColor) => {
    const palette = nativeWindowPalette(resolvedTheme);
    const background = surfaceColor ?? palette.background;
    if (!win || win.isDestroyed()) return palette;
    try { win.setBackgroundColor(background); } catch { /* window closed between the guard and update */ }
    if (process.platform === 'win32' && typeof win.setTitleBarOverlay === 'function') {
      try { win.setTitleBarOverlay({ color: background, symbolColor: palette.symbols, height: TITLE_BAR_OVERLAY_HEIGHT }); }
      catch { /* retain the already-applied renderer theme if native overlay is unavailable */ }
    }
    return palette;
  };
  const applyNativeTheme = (theme) => {
    const value = theme === 'light' || theme === 'dark' ? theme : 'system';
    nativeTheme.themeSource = value;
    updateNativeWindowColors();
    return value;
  };
  let surfaceNavigation = Promise.resolve();
  /**
   * A DSH restart receives a new port. Revoke the old origin before loading
   * the replacement, then make the new one authoritative only for this exact
   * BrowserWindow main frame.  No `localhost`/host-only trust shortcut.
   */
  function navigateToRuntimeSurface(origin) {
    // Preserve a rejected caller result, but never poison the serial lane:
    // the next runtime port must still be able to navigate after one failed
    // loadURL (for example a child that died during first paint).
    const request = surfaceNavigation.catch(() => undefined).then(async () => {
      if (!win || win.isDestroyed() || runtimeOrigin !== origin) return;
      if (trustedRuntimeOrigin === origin && !blocksUnexpectedRendererNavigation(win.webContents.getURL(), origin)) return;
      trustedRuntimeOrigin = null;
      // Set the exact *new* origin before navigation. The old document still
      // fails the main-frame URL check, while DSH's boot-time theme observer
      // can synchronise the native bar on its first paint.
      trustedRuntimeOrigin = origin;
      try {
        await win.loadURL(origin);
      } catch (error) {
        if (trustedRuntimeOrigin === origin) trustedRuntimeOrigin = null;
        throw error;
      }
      if (runtimeOrigin !== origin || win.isDestroyed()
        || blocksUnexpectedRendererNavigation(win.webContents.getURL(), origin)) {
        if (trustedRuntimeOrigin === origin) trustedRuntimeOrigin = null;
        throw new Error('official DSH navigation did not finish at the current exact runtime origin');
      }
    });
    surfaceNavigation = request.catch(() => undefined);
    return request;
  }
  // DSH owns the durable theme preference. Before its boot script resolves
  // light/dark, follow Windows system colors; the page then sends only the
  // resolved palette to update the native bar without changing themeSource.
  if (!personalHostMode) {
  nativeTheme.themeSource = 'system';
  const initialWindowPalette = nativeWindowPalette();
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 760, minHeight: 520,
    title: 'WeftMate', icon: windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI), show: false, backgroundColor: initialWindowPalette.background,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: initialWindowPalette.background, symbolColor: initialWindowPalette.symbols, height: TITLE_BAR_OVERLAY_HEIGHT },
    } : {}),
    webPreferences: {
      // The DSH page gets only the theme bridge below.  It never receives the
      // old local-renderer model/session IPC surface.
      preload: join(import.meta.dirname, 'dsh-surface-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  // DSH owns the document body, but its browser title must not replace the
  // product name in the native frame/taskbar. This only changes Electron's
  // outer shell identity and does not alter the official DSH page title/DOM.
  win.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    if (!win.isDestroyed()) win.setTitle('WeftMate');
  });
  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource === 'system' && dshResolvedTheme === null && win && !win.isDestroyed()) {
      updateNativeWindowColors();
    }
  });
  }
  // Active selection is a future-session preference. It never swaps the
  // shared child, so an in-flight/old DSH session retains its own persisted
  // provider+model request header.
  async function listSharedSessionsForUi() {
    return stageOneGateway('/sessions').catch(() => ({ items: [] }));
  }
  let recoveredLifecycleRuntime = null;
  const recoveredLifecycles = new Set();
  async function listSharedSessionsForReferenceGuard() {
    const result = await stageOneGateway('/sessions');
    if (!Array.isArray(result?.items)) throw new Error('session reference scan returned an invalid response');
    const runtime = webRuntime?.currentPersonalRuntimeId();
    if (runtime !== recoveredLifecycleRuntime) { recoveredLifecycleRuntime = runtime; recoveredLifecycles.clear(); }
    // Only the first startup after a restore claims native disposers before
    // model inspection. Ordinary startup never resumes all personal sessions.
    for (const item of result.items) if (personalBackupManager?.isRestoredStartup() && item.agentPreset?.startsWith('personal-') && !recoveredLifecycles.has(item.sessionId)) {
      await stageOneGateway(`/sessions/${encodeURIComponent(item.sessionId)}/resume`, { method: 'POST', body: '{}' });
      recoveredLifecycles.add(item.sessionId);
    }
    return result;
  }
  function assertSessionReferenceScanComplete() {
    assertSessionReferenceScanReady(sessionReferenceScan);
  }
  /** Cold-start migration guard: enumerate the one shared root, never sidebar-origin scanning. */
  async function hydrateLegacySessionBindings() {
    try {
      const profiles = settingsMod.listModelProfiles().profiles;
      // Before the first profile exists there is no managed DSH child to scan.
      // This establishes no ownership and therefore cannot bind an old session;
      // after the first controlled start the post-save scan will fail closed for
      // any unresolved history.
      if (!runtimeOrigin && profiles.length === 0) {
        sessionReferenceScan = { state: 'ready', error: null };
        return;
      }
      await scanSharedSessionBindings({ profiles, listSessions: listSharedSessionsForReferenceGuard,
        readSelectedModel: (sessionId) => stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/models`),
        providerForProfile: (profile) => routeForProfile(profile.id).provider,
        priorBinding: (sessionId) => settingsMod.sessionModelBinding(sessionId),
        legacyCompatibilityProfileId: verifiedLegacyCompatibilityProfile(profiles)?.id ?? null,
        bind: (sessionId, profileId) => settingsMod.bindSessionModel(sessionId, profileId, true) });
      sessionReferenceScan = { state: 'ready', error: null };
    } catch (error) {
      sessionReferenceScan = { state: 'failed', error: error instanceof Error ? error.message : 'scan failed' };
    } finally {
      writeHostState();
    }
  }
  async function assertRouteReloadSafe() {
    if (activeStageOneTurns.size > 0) throw new Error('当前仍有生成中的会话。请等待完成或停止后，再修改、添加或删除模型路由。');
    // Renderer SSE is only a convenience signal. Before a route-changing
    // mutation, query the authoritative shared DSH session list. An invalid or
    // unavailable response is treated as unsafe rather than guessing idle.
    if (!runtimeOrigin) return;
    const sessions = await listSharedSessionsForReferenceGuard();
    assertAuthoritativeSessionsIdle(sessions);
  }
  async function resolveKnownSession(sessionId, sessionSnapshot = null) {
    const sessions = sessionSnapshot ?? await listSharedSessionsForReferenceGuard();
    if (!Array.isArray(sessions.items) || !sessions.items.some((item) => item?.sessionId === sessionId)) throw new Error('unknown session');
    const selected = await stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/models`);
    const chosen = resolveSafeSessionBinding({ provider: selected?.current?.provider,
      profiles: settingsMod.listModelProfiles().profiles, providerForProfile: (profile) => routeForProfile(profile.id).provider,
      priorBinding: settingsMod.sessionModelBinding(sessionId), legacyCompatibilityProfileId: verifiedLegacyCompatibilityProfile()?.id ?? null });
    const profile = chosen.profile;
    if (!profile || !hasProfileCredential(profile)) throw new Error('session model profile is unavailable');
    return { chosen, profile, route: routeForProfile(profile.id) };
  }
  async function ensureKnownSession(sessionId) {
    const { chosen, profile, route } = await resolveKnownSession(sessionId);
    // Header and explicitly-recorded legacy sources are persisted only after
    // resolution succeeds.  Unknown sessions never reach resume/send/cancel.
    if (chosen.source !== 'durable-binding') settingsMod.bindSessionModel(sessionId, chosen.profile.id, true);
    // After a managed child reload, Gateway's in-memory record is empty. Its
    // supported resume route owns that record; model PUT requires it to exist.
    await stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', body: '{}' });
    await restoreInternalSessionRoute({ sessionId, profile, provider: route.provider, needsRestore: settingsMod.sessionBindingNeedsInternalRoute(sessionId),
      current: () => stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/models`),
      select: (value) => stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/models`, { method: 'PUT', body: JSON.stringify(value) }),
    });
  }
  // 关窗与托盘先于 loadURL 接线：DSH 页面加载慢时，用户点击 X 也只能最小化到托盘，
  // 不会把窗口销毁在 await loadURL 的中途。
  if (!personalHostMode) {
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
  setupTray();
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[weftmate] ✗ 前端加载失败', code, desc));
  // 本地 renderer 不把内容或表单错误逐字转发到日志，避免第三方错误回显秘密。
  win.webContents.on('console-message', (_e, level, message) => {
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
  void initUpdater(() => win, () => refreshTrayMenu());

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

  // The official page is local but still untrusted until it is the current
  // dynamic loopback origin in this exact main frame.
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (blocksUnexpectedRendererNavigation(targetUrl, trustedRuntimeOrigin)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, targetUrl) => {
    if (blocksUnexpectedRendererNavigation(targetUrl, trustedRuntimeOrigin)) event.preventDefault();
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
  }

  // Both the initial setup bridge and Stage 2 CRUD use this exact queue/journal
  // path.  It is intentionally assigned before the preload-facing handlers.
  saveModelRoute = async (input, { catalogOnly = false } = {}) => {
    if (input?.provider !== 'openai-compatible') throw new TypeError('unsupported provider');
    const id = typeof input?.id === 'string' && input.id.length > 0 ? input.id : `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const providedKey = String(input?.apiKey ?? '').trim();
    const baseUrl = normalizeApiBaseUrl(String(input?.baseUrl ?? '').trim());
    const nextModel = String(input?.model ?? '').trim();
    if (input?.modelTier !== undefined && !['auto', 'local', 'cloud'].includes(input.modelTier)) {
      throw new TypeError('模型位置必须是 auto、local 或 cloud');
    }
    if (!baseUrl) throw new TypeError('API 地址必须是 HTTPS，或不含凭据、查询参数或片段的本机/局域网 HTTP 地址');
    return enqueueRouteMutation(async () => {
      const profilesBefore = settingsMod.listModelProfiles().profiles;
      const wasUnconfigured = profilesBefore.length === 0;
      const prior = profilesBefore.find((item) => item.id === id);
      const publicName = String(input?.name ?? '').trim() || nextModel;
      const modelTier = input.modelTier ?? prior?.modelTier;
      const tierSetting = modelTier !== undefined ? { modelTier } : {};
      const officialRoute = routeForProfile(id);
      const exactLocalRepair = catalogOnly && prior && prior.baseUrl === baseUrl &&
        prior.model === nextModel && prior.name === publicName && prior.modelTier === modelTier &&
        providedKey.length > 0 &&
        providedKey === (configStoreMod.getCredential(id) ??
          configStoreMod.getCredential(officialCredentialRef(officialRoute.provider)));
      if (exactLocalRepair && prior.provider === 'openai-compatible' &&
          id === OCCAMY_VISION_PROFILE_ID && runtimeOrigin) {
        const official = createOfficialDshSettingsClient({ origin: runtimeOrigin });
        const snapshot = await official.describeSettings();
        if (Object.hasOwn(snapshot.userProviders, officialRoute.provider)) {
          await reconcileOccamyImageInput(official, { route: officialRoute.provider, modelId: nextModel });
          return prior;
        }
      }
      // A retained credential is scoped to its exact provider+endpoint. Never
      // send it to a newly typed address merely because the edit field is blank.
      const routeChanged = !prior || prior.baseUrl !== baseUrl || prior.model !== nextModel;
      const childEnvironmentChanged = routeChanged || providedKey.length > 0;
      // Every endpoint/model/key change has a route-bearing child environment.
      // Retry the authoritative scan in this exclusive lane before any guard,
      // validation, journal write, or runtime replacement.
      if (childEnvironmentChanged) {
        await hydrateLegacySessionBindings();
        assertSessionReferenceScanComplete();
      }
      if (prior && !exactLocalRepair) {
        assertModelProfileMutationAllowed({ referenced: settingsMod.profileHasSessionBinding(id), operation: 'edit',
          displayNameOnly: prior.baseUrl === baseUrl && prior.model === nextModel && providedKey.length === 0 });
      }
      if (childEnvironmentChanged) await assertRouteReloadSafe();
      const apiKey = resolveModelSaveCredential({ prior, provider: input.provider, baseUrl, providedKey,
        storedKey: prior ? configStoreMod.getCredential(id) : null });
      const clean = { name: String(input?.name ?? '').trim(), baseUrl, apiKey, model: nextModel };
      if (catalogOnly) {
        if (!Number.isSafeInteger(input.contextWindow) || input.contextWindow < 4_096 ||
            input.contextWindow > 1_048_576 || !Number.isSafeInteger(input.outputReserve) ||
            input.outputReserve < 1 || input.outputReserve > 131_072 ||
            input.outputReserve >= input.contextWindow) throw new TypeError('invalid formal local model limits');
        const models = await discoverOpenAICompatibleModels({ baseUrl: clean.baseUrl, apiKey: clean.apiKey });
        if (!models.includes(clean.model)) throw new Error('selected model was not returned by local catalog');
        if (!runtimeOrigin) throw new Error('official DSH runtime unavailable');
        const projection = { route: officialRoute.provider, displayName: publicName, baseURL: baseUrl,
          models: [{ id: clean.model, name: publicName, ...await readModelCapacity({
            baseUrl, modelId: clean.model, apiKey,
            contextWindow: input.contextWindow, maxTokens: input.outputReserve }) }] };
        const visionProjection = id === OCCAMY_VISION_PROFILE_ID
          ? projectOccamyImageInput(projectOfficialProviderConfig(projection),
            { route: officialRoute.provider, modelId: clean.model }) : null;
        const targetRef = officialCredentialRef(officialRoute.provider);
        let addedOfficialRoute = false;
        let profile;
        try {
          profile = await mutateModelRouteTransaction(async () => {
            configStoreMod.saveCredential(id, apiKey);
            configStoreMod.saveCredential(targetRef, apiKey);
            const client = createOfficialDshSettingsClient({ origin: runtimeOrigin });
            if (exactLocalRepair && officialRouteMigrationComplete &&
                officialRouteMigrationRoutes.has(officialRoute.provider)) {
              await repairOfficialLocalRouteLimits(client, projection);
            }
            const installed = await migrateLegacyRoutes(client, [projection]);
            addedOfficialRoute = installed.mutated;
            const saved = exactLocalRepair ? prior : settingsMod.upsertModelProfile({
              id, name: publicName, provider: 'openai-compatible', baseUrl, model: clean.model, reasoningEffort: 'off', ...tierSetting,
            });
            await ensureSharedRuntime({ reload: true });
            const restarted = createOfficialDshSettingsClient({ origin: runtimeOrigin });
            const [snapshot, credentials] = await Promise.all([
              restarted.describeSettings(), restarted.describeCredentials([targetRef]),
            ]);
            const verification = verifyLegacyRouteMigration([projection], snapshot, credentials);
            if (!verification.ok) throw new Error('official local model route not verified after restart');
            if (visionProjection) {
              await reconcileOccamyImageInput(restarted, { route: officialRoute.provider, modelId: clean.model });
            }
            // A first local catalog route can be installed after the no-profile
            // startup migration. Persist official ownership now, after the
            // restarted child proves the route and credential. Otherwise a
            // cold boot would run the legacy fixed-limit projection again.
            if (!officialRouteMigrationRoutes.has(officialRoute.provider)) {
              const routes = new Set([...officialRouteMigrationRoutes, officialRoute.provider]);
              writeModelRoutesPatch(ROUTES_PATCH, []);
              writeOfficialRouteMigrationMarker([...routes]);
              officialRouteMigrationRoutes = routes;
              officialRouteMigrationComplete = true;
              legacyRoutePatchRetired = true;
            }
            return saved;
          });
          if (wasUnconfigured && runtimeOrigin) await hydrateLegacySessionBindings();
        } catch (error) {
          // A route newly added by this transaction is removed only when the
          // current official user row still exactly matches our projection.
          if (addedOfficialRoute && runtimeOrigin) {
            try {
              const current = createOfficialDshSettingsClient({ origin: runtimeOrigin });
              const snapshot = await current.describeSettings();
              if (isDeepStrictEqual(snapshot.userProviders[officialRoute.provider],
                projectOfficialProviderConfig(projection)) || visionProjection &&
                  isDeepStrictEqual(snapshot.userProviders[officialRoute.provider], visionProjection)) {
                await current.mutateSettings([{ op: 'unset', path: ['providers', officialRoute.provider] }], snapshot.revision);
              }
            } catch { /* Keep the original failure; a later retry remains idempotent. */ }
          }
          throw error;
        }
        return profile;
      }
      await validateStageOneModel(clean);
      const profile = await mutateModelRouteTransaction(async () => {
        configStoreMod.saveCredential(id, apiKey);
        const saved = settingsMod.upsertModelProfile({ id, name: clean.name || clean.model, provider: 'openai-compatible', baseUrl, model: clean.model, reasoningEffort: 'off', ...tierSetting });
        if (childEnvironmentChanged) await ensureSharedRuntime({ reload: true });
        return saved;
      });
      // A no-profile startup cannot have proved old-session ownership before a
      // route existed.  Scan after its first controlled runtime start; unknown
      // history remains blocked rather than being bound to this new profile.
      if (wasUnconfigured && childEnvironmentChanged && runtimeOrigin) await hydrateLegacySessionBindings();
      return profile;
    });
  };
  configureLocalModel = async ({ modelId, name }) => {
    if (!personalHostMode || !personalAccessService || isQuitting) {
      throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
    }
    const id = `personal-local-${modelId}`;
    const prior = settingsMod.listModelProfiles().profiles.find((item) => item.id === id);
    const input = await prepareLocalModelConfig({ modelId, name: name ?? prior?.name });
    const profile = await saveModelRoute(input, { catalogOnly: true });
    return { configured: true, profileId: profile.id, modelId: profile.model,
      verification: 'catalog_only', inferenceVerified: false };
  };
  const enableStage14LowCapability = async (profile, input) => {
    const route = routeForProfile(profile.id).provider;
    const client = createOfficialDshSettingsClient({ origin: runtimeOrigin });
    const snapshot = await client.describeSettings();
    if (!snapshot.writable || snapshot.applies !== 'live') throw new Error('observed low route is not writable live');
    const expected = projectOfficialProviderConfig({ route, displayName: profile.name,
      baseURL: profile.baseUrl, models: [{ id: profile.model, name: profile.name,
        contextWindow: input.contextWindow, maxTokens: input.outputReserve }] });
    if (!isDeepStrictEqual(snapshot.userProviders[route], expected)) {
      throw new Error('observed low route differs before capability installation');
    }
    const enabled = structuredClone(expected);
    enabled.models[0].reasoningEfforts = { off: null, low: 'low' };
    enabled.models[0].compat = { thinkingFormat: 'openai', supportsReasoningEffort: true };
    await client.mutateSettings([{ op: 'set', path: ['providers', route], value: enabled }], snapshot.revision);
    const verified = await client.describeSettings();
    if (!isDeepStrictEqual(verified.userProviders[route], enabled)) {
      throw new Error('observed low capability was not confirmed by official settings');
    }
    const activeBefore = settingsMod.listModelProfiles().activeId;
    const updated = settingsMod.upsertModelProfile({ id: profile.id, name: profile.name,
      provider: 'openai-compatible', baseUrl: profile.baseUrl, model: profile.model,
      reasoningEffort: 'low', ...(profile.modelTier !== undefined ? { modelTier: profile.modelTier } : {}) });
    if (settingsMod.listModelProfiles().activeId !== activeBefore) {
      throw new Error('observed low profile changed active model');
    }
    return updated;
  };
  configureObservedLocalModel = async ({ low = false } = {}) => {
    if (!stage14R2Observation || !personalHostMode || !personalAccessService || isQuitting ||
        !modelObservationRecorder) {
      throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
    }
    const observer = await createPersonalModelObservationProxy({
      targetOrigin: 'http://127.0.0.1:8081', recorder: modelObservationRecorder,
      runId: stage14R2Observation.runId,
    });
    ownedModelObservationProxies.add(observer);
    let profile;
    try {
      const prepared = await prepareLocalModelConfig({ modelId: 'qwen3.8-27b' });
      const input = { ...prepared, ...(low ? {
        id: 'personal-local-qwen3.8-27b-stage14r2-low',
        name: `${prepared.name} (Stage14R2 low)`,
      } : {}), baseUrl: observer.baseUrl };
      profile = await saveModelRoute(input, { catalogOnly: true });
      if (low) profile = await enableStage14LowCapability(profile, input);
    } catch (error) {
      try { await observer.close(); ownedModelObservationProxies.delete(observer); }
      catch { /* Shutdown will retry this owned observer. */ }
      throw error;
    }
    const previous = modelObservationProxy;
    modelObservationProxy = observer;
    if (previous && previous !== observer) {
      try { await previous.close(); ownedModelObservationProxies.delete(previous); }
      catch { /* Route is already committed; retain old observer for shutdown. */ }
    }
    return { configured: true, profileId: profile.id, modelId: profile.model,
      verification: 'catalog_only', inferenceVerified: false, observation: 'isolated',
      ...(low ? { reasoningEffort: 'low' } : {}) };
  };
  configureObservedSyntheticLowModel = async (baseUrl) => {
    if (!stage14R2Observation || !modelObservationRecorder || isQuitting) {
      throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
    }
    const observer = await createPersonalModelObservationProxy({
      targetOrigin: new URL(baseUrl).origin, recorder: modelObservationRecorder,
      runId: stage14R2Observation.runId,
    });
    ownedModelObservationProxies.add(observer);
    let profile;
    try {
      const input = { id: 'synthetic-stop-fixture-stage14r2-low',
        name: 'Synthetic stop fixture (Stage14R2 low)', provider: 'openai-compatible',
        baseUrl: observer.baseUrl, model: 'synthetic-stop-model',
        apiKey: 'synthetic-stop-fixture-only', contextWindow: 8192, outputReserve: 1024 };
      profile = await saveModelRoute(input, { catalogOnly: true });
      profile = await enableStage14LowCapability(profile, input);
    } catch (error) {
      try { await observer.close(); ownedModelObservationProxies.delete(observer); }
      catch { /* Shutdown will retry this owned observer. */ }
      throw error;
    }
    const previous = modelObservationProxy;
    modelObservationProxy = observer;
    if (previous && previous !== observer) {
      try { await previous.close(); ownedModelObservationProxies.delete(previous); }
      catch { /* New route is committed; old proxy remains tracked for shutdown. */ }
    }
    return { configured: true, profileId: profile.id, modelId: profile.model,
      verification: 'catalog_only', inferenceVerified: false, observation: 'isolated',
      reasoningEffort: 'low' };
  };
  configureLocalCatalog = async () => {
    if (!personalHostMode || !personalAccessService || isQuitting) {
      throw Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
    }
    const formal = await listFormalLocalModels();
    if (formal.length !== 9) throw Object.assign(new Error('expected nine formal local models'), { code: 'LOCAL_MODEL_INVALID' });
    const apiKey = await readUserModelSwitcherKey();
    const sharedMarkers = formal.map((item) => ({
      id: `personal-local-${item.modelId}`, model: item.modelId,
      baseUrl: FORMAL_LOCAL_BASE_URL, provider: 'openai-compatible', source: 'formal-host-catalog',
      credentialHash: createHash('sha256').update(apiKey).digest('hex'),
    }));
    const prepared = await Promise.all(formal.map((item) => prepareLocalModelConfig({
      modelId: item.modelId, readKey: async () => apiKey,
    })));
    const models = await discoverOpenAICompatibleModels({ baseUrl: prepared[0].baseUrl, apiKey });
    if (prepared.some((item) => !models.includes(item.model))) {
      throw Object.assign(new Error('formal model is absent from local catalog'), { code: 'MODEL_UNAVAILABLE' });
    }
    return enqueueRouteMutation(async () => {
      await hydrateLegacySessionBindings();
      assertSessionReferenceScanComplete();
      await assertRouteReloadSafe();
      if (!runtimeOrigin) throw Object.assign(new Error('runtime unavailable'), { code: 'RUNTIME_UNAVAILABLE' });
      const current = settingsMod.listModelProfiles();
      const bindingsBefore = settingsMod.snapshotSettings().sessionBindings;
      const additions = [];
      for (const input of prepared) {
        const prior = current.profiles.find((item) => item.id === input.id);
        if (prior) {
          if (prior.provider !== 'openai-compatible' || prior.baseUrl !== input.baseUrl ||
              prior.model !== input.model || !hasProfileCredential(prior)) {
            throw Object.assign(new Error('existing local profile differs'), { code: 'MODEL_ROUTE_BLOCKED' });
          }
        } else additions.push(input);
      }
      if (additions.length === 0) {
        const catalog = await stageOneGateway('/models');
        if (!Array.isArray(catalog?.groups) || prepared.some((input) =>
          !catalog.groups.some((group) => group?.id === routeForProfile(input.id).provider &&
            Array.isArray(group.models) && group.models.some((model) => model?.id === input.model)))) {
          throw Object.assign(new Error('official local catalog route is unavailable'), { code: 'MODEL_ROUTE_BLOCKED' });
        }
        await reconcileOccamyImageInput(createOfficialDshSettingsClient({ origin: runtimeOrigin }),
          { route: routeForProfile(OCCAMY_VISION_PROFILE_ID).provider });
        await personalAccessService.setSharedModelProfiles(sharedMarkers);
        return { configured: true, total: formal.length, added: 0,
          reused: formal.length, reloads: 0, modelIds: formal.map((item) => item.modelId),
          verification: 'catalog_only', inferenceVerified: false };
      }
      const projections = await Promise.all(additions.map(async (input) => {
        const route = routeForProfile(input.id);
        return { route: route.provider, displayName: input.name, baseURL: input.baseUrl,
          models: [{ id: input.model, name: input.name, ...await readModelCapacity({
            baseUrl: input.baseUrl, modelId: input.model, apiKey,
            contextWindow: input.contextWindow, maxTokens: input.outputReserve }) }] };
      }));
      const occamyRoute = routeForProfile(OCCAMY_VISION_PROFILE_ID).provider;
      const freshOccamy = additions.some((item) => item.id === OCCAMY_VISION_PROFILE_ID);
      if (!freshOccamy) {
        await reconcileOccamyImageInput(createOfficialDshSettingsClient({ origin: runtimeOrigin }),
          { route: occamyRoute });
      }
      const beforeOfficial = await createOfficialDshSettingsClient({ origin: runtimeOrigin }).describeSettings();
      try {
        await mutateModelRouteTransaction(async () => {
          for (const input of additions) {
            const route = routeForProfile(input.id);
            configStoreMod.saveCredential(input.id, apiKey);
            configStoreMod.saveCredential(officialCredentialRef(route.provider), apiKey);
          }
          const official = createOfficialDshSettingsClient({ origin: runtimeOrigin });
          await migrateLegacyRoutes(official, projections);
          for (const input of additions) settingsMod.upsertModelProfile({
            id: input.id, name: input.name, provider: 'openai-compatible', baseUrl: input.baseUrl,
            model: input.model, reasoningEffort: 'off',
          });
          if (current.activeId === null && !settingsMod.setActiveModelProfile('personal-local-occamy-miniplus-v21')) {
            throw new Error('MiniPlus default could not be retained');
          }
          await ensureSharedRuntime({ reload: true });
          const restarted = createOfficialDshSettingsClient({ origin: runtimeOrigin });
          const refs = projections.map((item) => officialCredentialRef(item.route));
          const [snapshot, credentials] = await Promise.all([
            restarted.describeSettings(), restarted.describeCredentials(refs),
          ]);
          const verified = verifyLegacyRouteMigration(projections, snapshot, credentials);
          if (!verified.ok || settingsMod.listModelProfiles().activeId !==
              (current.activeId ?? 'personal-local-occamy-miniplus-v21') ||
              !isDeepStrictEqual(settingsMod.snapshotSettings().sessionBindings, bindingsBefore)) {
            throw new Error('formal local catalog did not preserve route ownership and selection');
          }
          if (freshOccamy) await reconcileOccamyImageInput(restarted, { route: occamyRoute });
          const routes = new Set([...officialRouteMigrationRoutes, ...projections.map((item) => item.route)]);
          writeModelRoutesPatch(ROUTES_PATCH, []);
          writeOfficialRouteMigrationMarker([...routes]);
          officialRouteMigrationRoutes = routes;
          officialRouteMigrationComplete = true;
          legacyRoutePatchRetired = true;
        });
      } catch (error) {
        // The product settings/vault journal already restored its own files.
        // Undo only official user routes newly added by this call, and only
        // while their content still exactly matches our non-secret projection.
        if (runtimeOrigin) try {
          const official = createOfficialDshSettingsClient({ origin: runtimeOrigin });
          const snapshot = await official.describeSettings();
          const operations = projections.filter((item) => !Object.hasOwn(beforeOfficial.userProviders, item.route) &&
            (isDeepStrictEqual(snapshot.userProviders[item.route], projectOfficialProviderConfig(item)) ||
              item.route === occamyRoute && isDeepStrictEqual(snapshot.userProviders[item.route],
                projectOccamyImageInput(projectOfficialProviderConfig(item), { route: item.route }))))
            .map((item) => ({ op: 'unset', path: ['providers', item.route] }));
          if (operations.length) {
            await official.mutateSettings(operations, snapshot.revision);
            await ensureSharedRuntime({ reload: true });
          }
        } catch { /* Keep the original failure; never overwrite a changed user route. */ }
        throw error;
      }
      await personalAccessService.setSharedModelProfiles(sharedMarkers);
      return { configured: true, total: formal.length, added: additions.length,
        reused: formal.length - additions.length, reloads: 1,
        modelIds: formal.map((item) => item.modelId),
        verification: 'catalog_only', inferenceVerified: false };
    });
  };

  const stageOneTrusted = (event) => !!win && isTrustedRendererInvocation({ expectedOrigin: legacyRendererUrl,
    sender: event.sender, expectedSender: win.webContents, senderFrame: event.senderFrame, mainFrame: win.webContents.mainFrame });
  const dshSurfaceTrusted = (event) => !!win && isTrustedRendererInvocation({ expectedOrigin: trustedRuntimeOrigin,
    sender: event.sender, expectedSender: win.webContents, senderFrame: event.senderFrame, mainFrame: win.webContents.mainFrame });
  const modWindowRequest = async ({ projectId, sessionId, action, frameToken = null, request = null, userInitiated = false }) => {
    if (!runtimeOrigin) throw new Error('WeftMate runtime is unavailable')
    const response = await fetch(new URL('/weftmate/mods/request', runtimeOrigin), {
      method: 'POST',
      headers: { origin: runtimeOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, project_id: projectId, action, ...(frameToken ? { frame_token: frameToken } : {}), ...(request ? { request } : {}), ...(userInitiated ? { user_initiated: true } : {}) }),
    })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'Mod request failed')
    return value
  }
  const modWindowSnapshot = async ({ projectId, sessionId, frameToken = null }) => {
    if (!runtimeOrigin) throw new Error('WeftMate runtime is unavailable')
    const url = new URL('/weftmate/mods/window/snapshot', runtimeOrigin)
    url.searchParams.set('project_id', projectId); url.searchParams.set('session_id', sessionId)
    if (frameToken) url.searchParams.set('frame_token', frameToken)
    const response = await fetch(url, { headers: { origin: runtimeOrigin } })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'Mod detail unavailable')
    return value
  }
  modWindowManager = new ModWindowManager({
    BrowserWindow,
    ipcMain,
    getOrigin: () => runtimeOrigin,
    getTheme: () => dshResolvedTheme ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    fetchSnapshot: modWindowSnapshot,
    invoke: ({ projectId, sessionId, frameToken, request }) => modWindowRequest({ projectId, sessionId, action: 'invoke', frameToken, request }),
    control: ({ projectId, sessionId, action }) => modWindowRequest({ projectId, sessionId, action, userInitiated: action === 'start' }),
    preload: join(import.meta.dirname, 'mod-window-preload.cjs'),
    parent: () => win,
    showWorkspace: showWindow,
    onOpenWorkspace: ({ projectId, sessionId }) => { if (win && !win.isDestroyed()) win.webContents.send('wm:mod-window:open-project', { projectId, sessionId }); },
  })
  ipcMain.handle('wm:mod-window:open', async (event, payload) => {
    if (!dshSurfaceTrusted(event)) throw new Error('请求来源不可信。')
    return modWindowManager.open({ projectId: payload?.projectId, sessionId: payload?.sessionId })
  })
  // The official DSH page has no product IPC. This one-way visual hint only
  // keeps Windows' native titlebar aligned with DSH's resolved light/dark
  // token; persistence remains in official DSH settings, not this bridge.
  ipcMain.handle('wm:dsh-surface:theme', (event, payload) => {
    if (!dshSurfaceTrusted(event)) return { ok: false };
    const value = payload?.theme === 'dark' ? 'dark' : 'light';
    const background = normalizeSurfaceColor(payload?.color);
    if (!background) return { ok: false };
    dshResolvedTheme = value;
    dshSurfaceBackgroundColor = background;
    updateNativeWindowColors(value, background);
    modWindowManager?.syncTheme();
    return { ok: true };
  });
  ipcMain.handle('wm:stage1:bootstrap', async (event) => stageOneTrusted(event) ? { ...publicModelView(), settings: settingsMod.readProductSettings(), runtimeReady: !!runtimeOrigin } : { configured: false, error: '请求来源不可信。' });
  ipcMain.handle('wm:stage1:setup', async (event, input) => {
    if (!stageOneTrusted(event)) return { ok: false, error: '请求来源不可信。' };
    try { const clean = { name: String(input?.name ?? '').trim(), baseUrl: String(input?.baseUrl ?? '').trim(), apiKey: String(input?.apiKey ?? '').trim(), model: String(input?.model ?? '').trim() }; await activateStageOneConfig(clean); return { ok: true }; } catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage1:import-current-local-model', async (event) => {
    if (!stageOneTrusted(event)) return { ok: false, error: '请求来源不可信。' };
    try {
      const apiKey = await readCurrentLocalServiceKey();
      await activateStageOneConfig({ name: '本机 Qwen', baseUrl: 'http://127.0.0.1:8080/v1', apiKey, model: 'qwen3.8-27b-u' });
      return { ok: true };
    } catch (error) { return stageOneFailure(error); }
  });
  // Stage 2 model management: only OpenAI-compatible discovery is currently
  // supported because it performs a real GET /models with the supplied key.
  // No generic Harness provider directory is used as evidence of credentials.
  ipcMain.handle('wm:stage2:discover-models', async (event, input) => {
    if (!stageOneTrusted(event)) return stageOneFailure(new Error());
    try {
      if (input?.provider !== 'openai-compatible') return { ok: false, error: '当前只支持 OpenAI-compatible 服务；该协议尚未实现真实发现与验证。', models: [] };
      const request = resolveModelDiscoveryRequest(input ?? {}, settingsMod.listModelProfiles().profiles,
        (profileId) => configStoreMod.getCredential(profileId));
      const models = await discoverOpenAICompatible(request);
      return { ok: true, models };
    } catch (error) { return { ...stageOneFailure(error), models: [] }; }
  });
  ipcMain.handle('wm:stage2:save-model', async (event, input) => {
    if (!stageOneTrusted(event)) return stageOneFailure(new Error());
    try {
      const profile = await saveModelRoute(input);
      return { ok: true, profile: { ...profile, hasKey: true }, models: { ...publicModelView(), runtimeReady: !!runtimeOrigin } };
    } catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage2:test-model', async (event, id) => {
    if (!stageOneTrusted(event)) return stageOneFailure(new Error());
    try {
      const profile = settingsMod.listModelProfiles().profiles.find((item) => item.id === id);
      const apiKey = profile ? configStoreMod.getCredential(profile.id) : null;
      if (!profile || !apiKey) throw new Error('missing model credential');
      await validateStageOneModel({ ...profile, apiKey });
      return { ok: true };
    } catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage2:set-active-model', async (event, id) => {
    if (!stageOneTrusted(event) || typeof id !== 'string') return stageOneFailure(new Error());
    try {
      await enqueueRouteMutation(() => switchActiveModel({
        id,
        list: () => settingsMod.listModelProfiles(),
        hasCredential: (profileId) => !!configStoreMod.getCredential(profileId),
        setActive: (profileId) => settingsMod.restoreActiveModelProfile(profileId),
      }));
      return { ok: true, models: { ...publicModelView(), runtimeReady: !!runtimeOrigin } };
    } catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage2:delete-model', async (event, id) => {
    if (!stageOneTrusted(event) || typeof id !== 'string') return stageOneFailure(new Error());
    try {
      await enqueueRouteMutation(async () => {
        await hydrateLegacySessionBindings();
        assertSessionReferenceScanComplete();
        assertModelProfileMutationAllowed({ referenced: settingsMod.profileHasSessionBinding(id), operation: 'delete' });
        await assertRouteReloadSafe();
        await mutateModelRouteTransaction(async () => {
          settingsMod.removeModelProfile(id);
          configStoreMod.removeCredential(id);
          await ensureSharedRuntime({ reload: true });
        });
      });
      return { ok: true, models: { ...publicModelView(), runtimeReady: !!runtimeOrigin } };
    } catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage2:set-theme', async (event, theme) => {
    if (!stageOneTrusted(event)) return stageOneFailure(new Error());
    try {
      const savedTheme = await enqueueRouteMutation(() => settingsMod.setThemePreference(theme));
      return { ok: true, theme: applyNativeTheme(savedTheme) };
    }
    catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage2:export-diagnostics', async (event) => {
    if (!stageOneTrusted(event)) return stageOneFailure(new Error());
    try {
      return await exportRedactedDiagnosticsFromMain();
    } catch (error) { return { ok: false, error: '导出失败。请检查保存位置后重试。' }; }
  });
  ipcMain.handle('wm:stage1:sessions', async (event) => !stageOneTrusted(event) ? { items: [] } : listSharedSessionsForUi());
  ipcMain.handle('wm:stage1:create', async (event) => {
    if (!stageOneTrusted(event)) return stageOneFailure(new Error());
    try {
      const created = await enqueueRouteMutation(async () => {
        const value = await stageOneGateway('/sessions', { method: 'POST', body: '{}' });
        const profile = activeModelProfile();
        if (!profile?.model) throw new Error('active model is missing');
        settingsMod.bindSessionModel(value.sessionId, profile.id);
        const route = routeForProfile(profile.id);
        await stageOneGateway(`/sessions/${encodeURIComponent(value.sessionId)}/models`, {
          method: 'PUT', body: JSON.stringify({ provider: route.provider, model: profile.model,
            ...(profile.reasoningEffort && profile.reasoningEffort !== 'off' ? { reasoningEffort: profile.reasoningEffort } : {}) }),
        });
        return value;
      });
      return { ok: true, ...created };
    } catch (error) { return stageOneFailure(error); }
  });
  ipcMain.handle('wm:stage1:select', async (event, sessionId) => { if (!stageOneTrusted(event) || typeof sessionId !== 'string') return stageOneFailure(new Error()); try { await enqueueRouteMutation(async () => { await ensureKnownSession(sessionId); await stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', body: '{}' }); }); startStageOneEvents(sessionId); return { ok: true }; } catch (error) { return stageOneFailure(error); } });
  ipcMain.handle('wm:stage1:send', async (event, { sessionId, content, mode = 'queue' } = {}) => { if (!stageOneTrusted(event) || typeof sessionId !== 'string' || typeof content !== 'string' || !content.trim()) return stageOneFailure(new Error()); return enqueueRouteMutation(async () => { await ensureKnownSession(sessionId); const value = await stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', body: JSON.stringify({ content: content.trim(), mode }) }); return { ok: true, ...value }; }).catch(stageOneFailure); });
  ipcMain.handle('wm:stage1:cancel', async (event, sessionId) => { if (!stageOneTrusted(event) || typeof sessionId !== 'string') return stageOneFailure(new Error()); return enqueueRouteMutation(async () => { await ensureKnownSession(sessionId); const value = await stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', body: '{}' }); return { ok: true, ...value }; }).catch(stageOneFailure); });
  ipcMain.handle('wm:stage1:approval', async (event, { sessionId, rpcId, approvalId, outcome } = {}) => { if (!stageOneTrusted(event) || typeof sessionId !== 'string') return stageOneFailure(new Error()); return enqueueRouteMutation(async () => { await ensureKnownSession(sessionId); const value = await stageOneGateway(`/sessions/${encodeURIComponent(sessionId)}/approval`, { method: 'POST', body: JSON.stringify({ rpcId, approvalId, outcome }) }); return { ok: true, ...value }; }).catch(stageOneFailure); });

  // ── 删除全部本机数据（v2 遗产，ARCHITECTURE §5 保留）：只走这一个窄 IPC。renderer 不接触
  //    marker/token/文件系统；主进程创建一次性授权并重启擦除。──
  ipcMain.handle('wm:delete-all-local-data', async (event, confirmation) => {
    if (!stageOneTrusted(event)) return { ok: false, code: 'WIPE_UNTRUSTED_SOURCE', error: '请求来源不可信' };
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
    if (!stageOneTrusted(event)) return;
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
    if (!stageOneTrusted(event)) return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
    const sanitized = sanitizeCompanionState(state);
    if (!desktopPetVisible() && !sanitized && !desktopCompanion) return { visible: false, freeActivity: desktopPetFreeActivity() };
    return toggleDesktopPet(sanitized || desktopCompanion);
  });
  ipcMain.handle('wm:pet-visibility', (event) => {
    if (!stageOneTrusted(event)) return { visible: false, freeActivity: false };
    return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
  });
  ipcMain.handle('wm:pet-free-activity', (event, enabled) => {
    if (!stageOneTrusted(event)) return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
    setDesktopPetFreeActivity(enabled === true);
    return { visible: desktopPetVisible(), freeActivity: desktopPetFreeActivity() };
  });
  ipcMain.on('wm:pet-composer-activity', (event) => {
    if (stageOneTrusted(event)) noteDesktopPetComposerActivity();
  });
  ipcMain.on('wm:pet-hide', (event) => {
    const trustedMain = stageOneTrusted(event);
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
      const buffer = await readFileAsync(join(import.meta.dirname, 'pets', 'assets', name, 'spritesheet.webp'));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      logCrash('pet-sprite', error);
      return null;
    }
  });
  // 最大化状态变化 → 通知前端切换"最大化/还原"图标（官方 UI 忽略未知事件，保留无害）。
  if (!personalHostMode) {
  win.on('maximize', () => win.webContents.send('wm:maximized', true));
  win.on('unmaximize', () => win.webContents.send('wm:maximized', false));
  // 页面加载完主动推一次当前最大化态——防"启动即最大化"时前端图标停在"最大化"没切成"还原"。
  win.webContents.on('did-finish-load', () => { try { win.webContents.send('wm:maximized', win.isMaximized()); } catch { /* 窗口已关忽略 */ } });
  }

  if (personalMemoryConfigPath !== null) {
    const memoryConfig = await loadPersonalMemoryConfig(personalMemoryConfigPath);
    personalMemoryRuntimeConfig = memoryConfig;
    hostLog.write('memory.bridge', { phase: 'configured', configured: true });
    personalMemoryManager = createPersonalMemoryManager({
      root: join(userDataDir, 'personal-access'), enabled: true,
      cleanupDeletedMemory: (ownerId, options) => personalAccessService.cleanupMemoryCopies(ownerId, options),
      python: memoryConfig.python, pythonPath: memoryConfig.pythonPath,
      baseUrl: modelScheduler.memoryBaseUrl(memoryConfig.authRef), model: memoryConfig.model,
      credential: (ownerId) => {
        if (!personalAccessService?.canUseModelProfile?.(ownerId, memoryConfig.authRef)) return null;
        const profile = settingsMod.listModelProfiles().profiles.find((item) => item.id === memoryConfig.authRef);
        return profile ? credentialForModelProfile(profile) : null;
      },
      processingRoute: (ownerId, sessionId) => memoryProcessingRouteForSession(ownerId, sessionId),
      defaultProcessingRoute: ownerId => memoryProcessingRouteForSession(ownerId, null),
    });
  }
  const personalDesktopTask = accessPort === null ? null : createPersonalDesktopTask();
  personalBrowserReader = accessPort === null ? null :
    (await import('./personal-browser/index.mjs')).createPersonalBrowserReader({ BrowserWindow, session,
      ...syntheticBrowserFixtureSettings(process.env, userDataDir) });
  const accessBackend = accessPort === null ? null : createPersonalAccessBackend({
    currentOrigin: () => runtimeOrigin,
    getRuntimeId: () => webRuntime?.currentPersonalRuntimeId() ?? null,
    referenceScan: () => sessionReferenceScan,
    profiles: () => settingsMod.listModelProfiles().profiles,
    hasCredential: hasProfileCredential,
    credentialForProfile: credentialForModelProfile,
    processingStatus: (sessionId) => modelScheduler.progress(sessionId),
    modelFetch: (url, options) => options?.method === 'POST'
      ? scheduledModelFetch(url, options, modelScheduler.url) : fetch(url, options),
    hostOwnerId: () => personalAccessService?.executionOwnerId?.() ?? null,
    ownerForSession: (sessionId) => personalAccessService?.ownerForSession?.(sessionId)?.ownerId ?? null,
    modelAllowed: (ownerId, profileId, usage) => personalAccessService?.canUseModelProfile?.(ownerId, profileId, usage) === true,
    moduleStatus: () => ({ memory: process.env.WEFTMATE_MEMOWEFT_ENABLED === '1' ? 'unknown' : 'disabled' }),
    routeForProfile,
    listSessions: listSharedSessionsForReferenceGuard,
    resolveSession: resolveKnownSession,
    ensureKnownSession,
    gateway: stageOneGateway,
    queue: enqueueRouteMutation,
    bindSession: (sessionId, profileId) => settingsMod.bindSessionModel(sessionId, profileId),
    desktopTask: personalDesktopTask,
    sessionWorkspaceRoot: join(userDataDir, 'conversations'),
    taskStop: (input) => webRuntime?.stopPersonalTask(input) ?? Promise.resolve({ status: 'unconfirmed',
      outcomes: input.receiptIds.map((receiptId) => ({ receiptId, status: 'unconfirmed' })) }),
    toolResultProof: (input) => webRuntime?.verifyPersonalToolResult(input) ?? Promise.resolve(false),
    replyEvidence: (input) => webRuntime?.readPersonalReplyEvidence(input) ?? Promise.resolve({
      status: 'unconfirmed', turn: null, assistantChunks: 0, textChunks: 0,
      reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: false }),
    naturalLanguageDesktopReady: () => personalAccessService !== null && personalHostMode,
    naturalLanguageDesktopVerified: () => personalAccessService?.hasVerifiedPersonalTool?.() === true,
  });

  const accountModelGateReasons = new Set(['idle', 'host_command_pending', 'session_state_busy',
    'reference_scan_incomplete', 'reference_scan_failed', 'agent_running', 'inbox_pending',
    'agent_state_unknown', 'agent_list_unknown', 'runtime_unavailable', 'timeout',
    'ipc_unavailable', 'invalid_response']);
  const accountModelBusy = () => Object.assign(new Error('account model route is busy'),
    { code: 'ACCOUNT_MODEL_BUSY' });
  function noteAccountModelGate(candidate) {
    const reasonCode = accountModelGateReasons.has(candidate) ? candidate : 'invalid_response';
    const idle = reasonCode === 'idle';
    if (accountModelRouteGate.idle === idle && accountModelRouteGate.reasonCode === reasonCode) return;
    const previous = accountModelRouteGate.reasonCode;
    accountModelRouteGate = { idle, reasonCode, changedAt: new Date().toISOString() };
    writeHostState();
    if (idle) console.log(`[weftmate] ✓ account-model route gate idle previous=${previous}`);
    else console.warn(`[weftmate] ⚠ account-model route gate blocked reason=${reasonCode}`);
  }
  async function assertAccountModelReloadSafe() {
    if (personalAccessService?.hasUnissuedDshCommands?.()) {
      noteAccountModelGate('host_command_pending'); throw accountModelBusy();
    }
    try { await assertRouteReloadSafe(); }
    catch { noteAccountModelGate('session_state_busy'); throw accountModelBusy(); }
    const snapshot = await webRuntime?.personalModelQueueIdle?.() ??
      { idle: false, reason: 'runtime_unavailable' };
    noteAccountModelGate(snapshot?.reason);
    if (snapshot?.idle !== true || snapshot.reason !== 'idle') throw accountModelBusy();
    if (personalAccessService?.hasUnissuedDshCommands?.()) {
      noteAccountModelGate('host_command_pending'); throw accountModelBusy();
    }
  }

  const accountModelManager = accessPort === null ? null : {
    hasCredential(profileId) {
      if (typeof profileId !== 'string' || !/^private-model-[a-f0-9]{40}$/.test(profileId)) return false;
      const profile = settingsMod.listModelProfiles().profiles.find((item) => item.id === profileId);
      return !!profile && !!configStoreMod.getCredential(officialCredentialRef(routeForProfile(profileId).provider));
    },
    async stageSecret({ stageRef, apiKey }) {
      if (typeof stageRef !== 'string' || !/^pending-model-[a-f0-9]{48}$/.test(stageRef) ||
          typeof apiKey !== 'string' || !apiKey || apiKey.length > 4096) {
        throw Object.assign(new Error('invalid staged model secret'), { code: 'INVALID_REQUEST' });
      }
      return enqueueRouteMutation(() => {
        configStoreMod.preflightVault();
        const existing = configStoreMod.getCredential(stageRef);
        if (existing && existing !== apiKey) {
          throw Object.assign(new Error('staged secret conflict'), { code: 'REQUEST_CONFLICT' });
        }
        if (!existing) configStoreMod.saveCredential(stageRef, apiKey);
      });
    },
    async apply({ target, stageRef, previousProfileId }) {
      if (!target || !/^private-model-[a-f0-9]{40}$/.test(target.profileId) ||
          (stageRef && !/^pending-model-[a-f0-9]{48}$/.test(stageRef)) ||
          (previousProfileId && !/^private-model-[a-f0-9]{40}$/.test(previousProfileId))) {
        throw Object.assign(new Error('invalid account model target'), { code: 'INVALID_REQUEST', definite: true });
      }
      return enqueueRouteMutation(async () => {
        if (!runtimeOrigin || isQuitting) throw Object.assign(new Error('runtime unavailable'), { code: 'ACCOUNT_MODEL_BUSY' });
        configStoreMod.preflightVault();
        await hydrateLegacySessionBindings();
        try { assertSessionReferenceScanComplete(); }
        catch {
          noteAccountModelGate(sessionReferenceScan.state === 'failed'
            ? 'reference_scan_failed' : 'reference_scan_incomplete');
          throw accountModelBusy();
        }
        await assertAccountModelReloadSafe();
        const route = routeForProfile(target.profileId);
        const credentialRef = officialCredentialRef(route.provider);
        const secret = stageRef ? configStoreMod.getCredential(stageRef)
          : previousProfileId ? configStoreMod.getCredential(
            officialCredentialRef(routeForProfile(previousProfileId).provider)) : null;
        if (!secret) throw Object.assign(new Error('model credential unavailable'),
          { code: 'ACCOUNT_MODEL_SECRET_REQUIRED', definite: true });
        const projection = { route: route.provider, displayName: target.name, baseURL: target.baseUrl,
          models: [{ id: target.modelId, name: target.name, ...await readModelCapacity({ ...target, apiKey: secret }) }] };
        const previousActive = settingsMod.listModelProfiles().activeId;
        const routeBefore = await createOfficialDshSettingsClient({ origin: runtimeOrigin }).describeSettings();
        let addedOfficialRoute = false;
        try {
          await mutateModelRouteTransaction(async () => {
            configStoreMod.saveCredential(credentialRef, secret);
            const official = createOfficialDshSettingsClient({ origin: runtimeOrigin });
            const installed = await migrateLegacyRoutes(official, [projection]);
            addedOfficialRoute = installed.mutated;
            settingsMod.upsertModelProfile({ id: target.profileId, name: target.name,
              provider: 'openai-compatible', baseUrl: target.baseUrl,
              model: target.modelId, reasoningEffort: 'off',
              ...(target.modelTier !== undefined ? { modelTier: target.modelTier } : {}) }, { preserveActive: true });
            if (settingsMod.listModelProfiles().activeId !== previousActive) {
              throw new Error('product default model changed while registering account route');
            }
            await ensureSharedRuntime({ reload: true });
            const restarted = createOfficialDshSettingsClient({ origin: runtimeOrigin });
            const [snapshot, credentials] = await Promise.all([
              restarted.describeSettings(), restarted.describeCredentials([credentialRef]),
            ]);
            const verified = verifyLegacyRouteMigration([projection], snapshot, credentials);
            if (!verified.ok || settingsMod.listModelProfiles().activeId !== previousActive) {
              throw new Error('account model route not verified after restart');
            }
          });
        } catch (error) {
          if (addedOfficialRoute && !Object.hasOwn(routeBefore.userProviders, route.provider) && runtimeOrigin) {
            try {
              const official = createOfficialDshSettingsClient({ origin: runtimeOrigin });
              const snapshot = await official.describeSettings();
              if (isDeepStrictEqual(snapshot.userProviders[route.provider],
                projectOfficialProviderConfig(projection))) {
                await official.mutateSettings([{ op: 'unset', path: ['providers', route.provider] }], snapshot.revision);
              }
            } catch { /* Failed compensation is observed, never retried as a new route. */ }
          }
          throw error;
        }
        if (stageRef) configStoreMod.removeCredential(stageRef);
        return { applied: true };
      });
    },
    async inspect({ kind, target, profileIds = [] }) {
      return enqueueRouteMutation(async () => {
        if (!runtimeOrigin) return { applied: false, clean: false };
        configStoreMod.preflightVault();
        if (kind === 'stop_using' || kind === 'remove') {
          return { applied: profileIds.every((id) => !configStoreMod.getCredential(
            officialCredentialRef(routeForProfile(id).provider))) };
        }
        if (!target) return { applied: false, clean: false };
        const route = routeForProfile(target.profileId);
        const ref = officialCredentialRef(route.provider);
        const profile = settingsMod.listModelProfiles().profiles.find((item) => item.id === target.profileId);
        const snapshot = await createOfficialDshSettingsClient({ origin: runtimeOrigin }).describeSettings();
        // Capacity is service metadata, not account-model identity. Recovery
        // compares the installed limits; a temporarily offline service must not
        // make an already committed route look unapplied.
        const installed = snapshot.userProviders[route.provider]?.models?.[0];
        const projection = { route: route.provider, displayName: target.name, baseURL: target.baseUrl,
          models: [{ id: target.modelId, name: target.name, ...modelCapacityFor({ ...target,
            contextWindow: installed?.contextWindow, maxTokens: installed?.maxTokens }) }] };
        const exact = isDeepStrictEqual(snapshot.userProviders[route.provider],
          projectOfficialProviderConfig(projection)) && profile?.baseUrl === target.baseUrl &&
          profile.model === target.modelId && profile.modelTier === target.modelTier && !!configStoreMod.getCredential(ref);
        const clean = !Object.hasOwn(snapshot.userProviders, route.provider) && !profile &&
          !configStoreMod.getCredential(ref);
        return { applied: exact, clean };
      });
    },
    async check({ ownerId, input }) {
      let profile, apiKey = input.apiKey;
      if (input.profileId) {
        if (!personalAccessService.canUseModelProfile(ownerId, input.profileId, 'new')) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
        profile = settingsMod.listModelProfiles().profiles.find(row => row.id === input.profileId);
        if (!profile || input.baseUrl && input.baseUrl !== profile.baseUrl && !apiKey) throw Object.assign(new Error('ACCOUNT_MODEL_SECRET_REQUIRED'), { code: 'ACCOUNT_MODEL_SECRET_REQUIRED' });
        if (!apiKey) apiKey = credentialForModelProfile(profile);
      }
      return checkModelConnection({ baseUrl: input.baseUrl ?? profile?.baseUrl, modelId: input.modelId ?? profile?.model,
        apiKey, sendTestMessage: input.sendTestMessage === true,
        fetchImpl: async (url, options) => {
          if (options.method !== 'POST') return fetch(url, options);
          const ticket = await personalAccessService.beginModelConnectionUsage(ownerId, { baseUrl: input.baseUrl ?? profile?.baseUrl,
            modelId: input.modelId ?? profile?.model, profileId: profile?.id, modelTier: profile?.modelTier });
          hostLog.write('model.start', { profileId: profile?.id, priority: 'foreground', source: 'connection-test' });
          try {
            const reply = await scheduledModelFetch(url, options, modelScheduler.url);
            hostLog.write('model.end', { profileId: profile?.id, priority: 'foreground', status: reply.status });
            return ticket ? usageResponse(reply, usage => personalAccessService.finishUsage({ ...ticket, usage, source: 'openai' })) : reply;
          } catch (error) { if (ticket) await personalAccessService.finishUsage({ ...ticket, usage: null }); hostLog.write('model.failure', { code: 'CONNECTION_TEST_FAILED' }); throw error; }
        } });
    },
    async test({ profileId, ownerId }) {
      return accessBackend.verifyModelProfile(profileId, ownerId);
    },
    async disable({ ownerId, profileIds, stageRefs = [] }) {
      return enqueueRouteMutation(async () => {
        configStoreMod.preflightVault();
        await personalMemoryManager?.invalidateOwnerRoute(ownerId);
        if (profileIds.every((profileId) => /^private-model-[a-f0-9]{40}$/.test(profileId) &&
            !configStoreMod.getCredential(officialCredentialRef(routeForProfile(profileId).provider)) &&
            !configStoreMod.getCredential(profileId)) &&
            stageRefs.every((ref) => /^pending-model-[a-f0-9]{48}$/.test(ref) &&
              !configStoreMod.getCredential(ref))) {
          return { applied: true };
        }
        if (!runtimeOrigin || isQuitting) throw Object.assign(new Error('runtime unavailable'), { code: 'ACCOUNT_MODEL_BUSY' });
        try { await assertAccountModelReloadSafe(); }
        catch { throw Object.assign(new Error('runtime busy'), { code: 'ACCOUNT_MODEL_BUSY' }); }
        await mutateModelRouteTransaction(async () => {
          const refs = [];
          for (const profileId of profileIds) {
            if (!/^private-model-[a-f0-9]{40}$/.test(profileId)) throw new Error('invalid private model identity');
            const ref = officialCredentialRef(routeForProfile(profileId).provider);
            refs.push(ref);
            configStoreMod.removeCredential(ref);
            configStoreMod.removeCredential(profileId);
          }
          for (const ref of stageRefs) {
            if (!/^pending-model-[a-f0-9]{48}$/.test(ref)) throw new Error('invalid staged model credential');
            configStoreMod.removeCredential(ref);
          }
          await ensureSharedRuntime({ reload: true });
          const official = createOfficialDshSettingsClient({ origin: runtimeOrigin });
          for (let start = 0; start < refs.length; start += 64) {
            const batch = refs.slice(start, start + 64);
            const described = await official.describeCredentials(batch);
            if (batch.some((ref) => described[ref]?.configured !== false)) {
              throw new Error('account model credential revocation was not verified');
            }
          }
        });
        return { applied: true };
      });
    },
    async readSecret({ profileId }) {
      if (!/^private-model-[a-f0-9]{40}$/.test(profileId)) return null;
      configStoreMod.preflightVault();
      return configStoreMod.getCredential(officialCredentialRef(routeForProfile(profileId).provider));
    },
    async readOfflineModel({ profileId }) {
      const profile = settingsMod.listModelProfiles().profiles.find(item => item.id === profileId);
      if (!profile || memoryRecallModelTier(profile) !== 'cloud') return null;
      const apiKey = credentialForModelProfile(profile);
      return apiKey ? { baseUrl: profile.baseUrl, modelId: profile.model, apiKey } : null;
    },
  };

  try {
    if (personalHostMode) {
      await startPersonalHost({
        startRuntime: () => ensureSharedRuntime({ reload: true }),
        migrateRoutes: migrateLegacyRoutesToOfficialSettings,
        hydrateBindings: async () => {
          await hydrateLegacySessionBindings();
        },
        log: (message) => {
          writeHostState();
          if (sessionReferenceScan.state === 'failed') {
            console.warn(`[weftmate] ⚠ personal-host degraded origin=${runtimeOrigin} referenceScan=failed modelRouteChangesBlocked=true`);
          } else console.log(message);
        },
      });
      if (accessPort !== null) {
        desktopUpdates = await createDesktopUpdates({ getWindow: () => win, mobileUiDir, desktopConfig: installedDesktopConfig,
          beforeAppInstall: async () => {
            if (personalBackupManager) await personalBackupManager.request('before-upgrade');
            if (app.isPackaged) await prepareAppRollback({ configFile: installedDesktopConfig.file, nextVersion: updateState().version, appData: desktopControlAppData,
              installer: preparedInstallerPath(),
              installerSha256: preparedInstallerHash(),
              cacheDirectory: join(process.env.LOCALAPPDATA || app.getPath('appData'), packageInfo.name + '-updater') });
          }, isIdle: async () => {
          if (activeStageOneTurns.size) return false;
          if (!runtimeOrigin) return !activeModelProfile();
          try { assertAuthoritativeSessionsIdle(await listSharedSessionsForReferenceGuard()); return true; }
          catch { return false; }
        } });
        const { createPersonalAccessService } = await import('./personal-access/index.mjs');
        const { relayFromEnvironment } = await import('./personal-relay/index.mjs');
        const { cloudIdentityFromEnvironment } = await import('./personal-cloud/index.mjs');
        personalAccessService = await createPersonalAccessService({
          root: join(userDataDir, 'personal-access'), port: accessPort, backend: accessBackend,
          cloudIdentity: cloudIdentityFromEnvironment(),
          relay: relayFromEnvironment(),
          verifyToolResult: (input) => accessBackend.verifyToolResult(input),
          uiHandler: servePersonalAccessUi,
          androidPackagePath,
           mobileUiDir,
           mobileUiTrustedKeys: desktopUpdates.store.trustedKeys,
           hostVersion: appVersion,
           updateStatus: () => desktopUpdates.state(),
           memoryManager: personalMemoryManager,
          browserReader: personalBrowserReader,
          accountModelManager,
          backupManager: personalBackupManager,
          systemManager: {
            async status(ownerId) {
              const model = localModelController ? await localModelController.status()
                : { state: 'unconfigured', version: null, contextWindow: null, slots: null,
                  currentModelId: null, lastSwitch: null, canRestart: false, lastError: null };
              const memory = personalMemoryManager ? await personalMemoryManager.status(ownerId)
                : { state: 'disabled', lastFailureCode: null };
              hostLog.write('memory.bridge', { phase: memory.state, code: memory.lastFailureCode ?? memory.reasonCode ?? undefined, configured: !!personalMemoryManager });
              return { model,
                host: { state: runtimeOrigin ? 'ready' : 'unavailable', version: appVersion,
                  lastError: sessionReferenceScan.state === 'failed' ? 'REFERENCE_SCAN_FAILED' : null, canRestart: true },
                memory: { state: memory.state, version: memory.version ?? null,
                  lastError: memory.lastFailureCode ?? memory.reasonCode ?? null, canRestart: !!personalMemoryManager },
                queue: modelScheduler.queue.status() };
            },
            async restart(component, ownerId) {
              if (component === 'model') {
                if (!localModelController) throw Object.assign(new Error('unconfigured'), { code: 'CAPABILITY_UNAVAILABLE' });
                await localModelController.control('restart');
                // A restarted service may have a different n_ctx. Recreate the
                // native adapter so its capacity cache is probed before inference.
                await enqueueRouteMutation(() => replaceSharedRuntime());
              } else if (component === 'host') await enqueueRouteMutation(() => replaceSharedRuntime());
              else if (personalMemoryManager) await personalMemoryManager.invalidateOwnerRoute(ownerId);
              else throw Object.assign(new Error('disabled'), { code: 'CAPABILITY_UNAVAILABLE' });
            },
          },
           sharedProfileIsFormal: (marker) => {
             const profile = settingsMod.listModelProfiles().profiles.find((item) => item.id === marker.id);
             if (profile?.provider !== marker.provider || profile.baseUrl !== marker.baseUrl ||
                 profile.model !== marker.model || marker.baseUrl !== FORMAL_LOCAL_BASE_URL ||
                 marker.source !== 'formal-host-catalog') return false;
             const credential = credentialForModelProfile(profile);
             return typeof credential === 'string' &&
               createHash('sha256').update(credential).digest('hex') === marker.credentialHash;
           },
          ...(personalPublicOrigin ? { allowedOrigins: [personalPublicOrigin], trustedProxy: true } : {}),
        });
        const started = await personalAccessService.start();
        personalAccessOrigin = assertLoopbackOrigin(started.origin);
        writeHostState();
        console.log(`[weftmate] ✓ personal-access listening origin=${personalAccessOrigin}`);
        if (desktopRequested) {
          // Explicit legacy setup links remain valid; the default first page is account login.
          const setupGrant = null;
          await desktopUpdates.prepareWindow();
          personalDesktop = createPersonalDesktop({ origin: personalAccessOrigin, setupGrant, isQuitting: () => isQuitting,
            startInTray: process.argv.includes('--start-in-tray'),
            onStatus: status => { desktopStatus = status; refreshTrayMenu(); } });
          win = personalDesktop.window;
          desktopUpdates.attach(win);
          setupTray();
          await personalDesktop.ready;
          if (await win.webContents.executeJavaScript('globalThis.__WeftUiStarted === true')) await appBootSignal('healthy', desktopControlAppData);
        }
      }
    } else {
      // DSH is the complete first-run and conversation surface.
      let origin = await ensureSharedRuntime({ reload: true });
      if (!origin) throw new Error('official DSH runtime did not publish an origin');
      origin = await migrateLegacyRoutesToOfficialSettings();
      await navigateToRuntimeSurface(origin);
      await hydrateLegacySessionBindings();
      win.show();
      writeHostState();
      console.log('[weftmate] ✓ WeftMate 官方 DSH 界面加载完成');
    }
  } catch (e) {
    requestFatalStartupExit(personalHostMode ? 'Personal host 启动失败' : 'Harness 前端加载失败', e, formatHarnessStartupError(e));
    return;
  }

  await personalBackupManager?.started();

  // R6-02 · 桌宠自愈：上次可见（设置里 visible=true）→ 启动补唤醒（v2 等价路径的恢复）。
  if (!headless && desktopCompanion && settingsMod?.getDesktopPetWindowState?.().visible) {
    void wakeDesktopPet().catch((error) => logCrash('desktop-pet-autowake', error));
  }

  console.log(personalHostMode
    ? '[weftmate] personal-host active; managed shutdown via launcher IPC'
    : '[weftmate] ═══ 官方 DSH web 基座就位:关窗收托盘、托盘"退出"才真退 ═══');
}

async function exportRedactedDiagnosticsFromMain() {
  const options = {
    title: '导出 WeftMate 脱敏诊断',
    defaultPath: `weftmate-diagnostics-${app.getVersion()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const choice = win && !win.isDestroyed()
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };

  const settings = settingsMod?.readProductSettings?.() ?? {
    schemaVersion: 0,
    appearance: { theme: 'system' },
    models: { profiles: [], activeId: null },
  };
  const models = publicModelView();
  const redacted = buildRedactedDiagnostics({
    version: app.getVersion(),
    settings,
    models,
    configured: models.configured,
    ready: !!runtimeOrigin,
    packaged: app.isPackaged,
    safeStorageAvailable: configStoreMod?.encryptionAvailable?.() === true,
    aiGame: aiGameRuntime?.diagnostics?.(),
    update: updateState(),
  });
  await writeFileAsync(choice.filePath, `${JSON.stringify(redacted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, canceled: false };
}

async function checkPreviewUpdateFromTray() {
  const state = await checkForUpdates(() => win);
  refreshTrayMenu();
  if (state.status === 'error') {
    const options = {
      type: 'warning',
      title: 'WeftMate 更新检查未完成',
      message: state.error ?? '更新未完成。当前版本保持不变，请稍后重试。',
      buttons: ['知道了'],
    };
    if (win && !win.isDestroyed()) await dialog.showMessageBox(win, options);
    else await dialog.showMessageBox(options);
  }
}

async function installPreviewUpdateFromTray() {
  let installed = false;
  try {
    if (desktopUpdates) installed = await desktopUpdates.restart();
    else {
      if (personalBackupManager && updateState().status === 'downloaded') await personalBackupManager.request('before-upgrade');
      installed = quitAndInstall();
    }
  } catch (error) { logCrash('backup-before-upgrade', error); }
  if (!installed) {
    const options = {
      type: 'info',
      title: 'WeftMate 更新尚未就绪',
      message: '更新尚未就绪或任务仍在运行。请等待下载与任务完成后重试。',
      buttons: ['知道了'],
    };
    void (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  }
}

/** 系统托盘:常驻图标 + 生命周期/诊断入口,左键点=显示窗口。 */
function setupTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(trayIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI)));
  tray.setToolTip('WeftMate');
  nativeTheme.on('updated', () => {
    if (tray && !tray.isDestroyed()) tray.setImage(nativeImage.createFromPath(trayIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI)));
    if (win && !win.isDestroyed()) win.setIcon(windowIcon(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI));
  });
  refreshTrayMenu();
  tray.on('click', showWindow); // Windows 习惯:左键点托盘图标唤起窗口
}

function refreshTrayMenu() {
  if (!tray) return;
  const update = updateState();
  const updateBusy = update.status === 'checking' || update.status === 'available';
  const updateReady = update.status === 'downloaded';
  const updateLabel = updateReady
    ? `安装更新${update.version ? ` v${update.version}` : ''}…`
    : updateBusy
      ? '正在检查或下载更新…'
      : update.enabled
        ? '检查更新…'
        : '检查更新（未配置更新源）';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 WeftMate', click: showWindow },
    ...(personalHostMode ? [{ label: `宿主：${desktopStatus.host} · 模型：${desktopStatus.model}`, enabled: false }] : []),
    { type: 'separator' },
    { label: updateLabel, enabled: updateReady || (update.enabled && !updateBusy), click: updateReady ? installPreviewUpdateFromTray : () => { void checkPreviewUpdateFromTray(); } },
    { label: '导出脱敏诊断…', click: () => { void exportRedactedDiagnosticsFromMain().catch((error) => logCrash('diagnostics-export', error)); } },
    { label: '宠物设置…', click: openDesktopPetPage },
    { label: desktopPetVisible() ? '让桌面宠物休息' : '唤醒桌面宠物', click: () => {
      const latest = desktopCompanion;
      void toggleDesktopPet(latest).catch((error) => logCrash('desktop-pet-tray', error));
    } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// 退出前收尾：首次 before-quit 唯一创建 shutdown Promise；其余重入只等待同一份收尾。
app.on('before-quit', (e) => {
  isQuitting = true;
  if (cleanupDone) return; // 已清理完 → 放行真正退出
  e.preventDefault();
  if (shutdownPromise) return;
  hostLifecycleState = 'stopping';
  runtimeOrigin = null;
  writeHostStateForLifecycle?.();

  shutdownPromise = (async () => {
    let backupSafe = true;
    await personalBackupManager?.stopOnline();
    try { await personalDesktop?.close(); }
    catch (error) { logCrash('shutdown-desktop-session', error); }
    finally { desktopUpdates?.close(); }
    let accessClosing = null;
    try { accessClosing = personalAccessService?.close?.() ?? null; }
    catch (error) { backupSafe = false; logCrash('shutdown-personal-access', error); }
    // Stop admission before any asynchronous cleanup.  A mutation already in
    // this lane may finish/compensate, but no new session/settings/model work
    // can cross the shutdown fence.
    exclusiveMainQueue?.stopAcceptingAndDrain();
    if (accessClosing) {
      let timer;
      try {
        await Promise.race([accessClosing, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('personal access close timed out')), 5_000);
        })]);
      } catch (error) { backupSafe = false; logCrash('shutdown-personal-access', error); }
      finally { if (timer) clearTimeout(timer); }
    }
    personalAccessOrigin = null;
    writeHostStateForLifecycle?.();
    if (personalBrowserReader) {
      let timer;
      try {
        await Promise.race([personalBrowserReader.close(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('personal browser reader close timed out')), 5_000);
        })]);
      } catch (error) { backupSafe = false; logCrash('shutdown-personal-browser', error); }
      finally { if (timer) clearTimeout(timer); personalBrowserReader = null; }
    }
    if (personalMemoryManager) {
      let timer;
      try {
        await Promise.race([personalMemoryManager.close(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('account memory close timed out')), 5_000);
        })]);
      } catch (error) { backupSafe = false; logCrash('shutdown-account-memory', error); }
      finally { if (timer) clearTimeout(timer); }
    }
    await modWindowManager?.dispose?.();
    // Revoking manager admission happens synchronously at close entry; wait a
    // bounded manager close before ending DSH, but never let a failed child
    // confirmation block application exit forever.
    try {
      await aiGameRuntime?.close?.();
    } catch (err) {
      logCrash('shutdown-managed-ai-game', new Error('managed AI-GAME shutdown could not be confirmed'));
      console.error('[weftmate] AI-GAME 受管子进程未确认退出(继续关闭 DSH):', err && err.message ? err.message : err);
    }
    try {
      disposeDesktopPetRuntime();
    } catch (err) {
      logCrash('shutdown-desktop-pet', err);
      console.error('[weftmate] 桌宠退出收尾出错(继续关闭 DSH):', err && err.message ? err.message : err);
    }
    try {
      await perceptionRuntime?.dispose?.(); // R6-01：停感知采集
    } catch (err) {
      logCrash('shutdown-perception', err);
      console.error('[weftmate] 感知退出收尾出错(继续关闭 DSH):', err && err.message ? err.message : err);
    }
    try {
      await devicesRuntime?.dispose?.(); // R8-01：停设备接缝
    } catch (err) {
      logCrash('shutdown-devices', err);
      console.error('[weftmate] 设备退出收尾出错(继续关闭 DSH):', err && err.message ? err.message : err);
    }
    try {
      if (exclusiveMainQueue) {
        await exclusiveMainQueue.stopAcceptingAndDrain(async () => {
          await webRuntime?.close?.();
        });
      } else {
        // Startup failed before the lane existed: no admitted work can race a
        // runtime close, so retain the bounded fallback.
        await webRuntime?.close?.();
      }
      console.log('[weftmate] ✓ 退出收尾:DSH web 运行时收口完成');
    } catch (err) {
      backupSafe = false;
      logCrash('shutdown-dsh-runtime', err);
      console.error('[weftmate] DSH 退出收尾出错(仍继续退出):', err && err.message ? err.message : err);
    }
    for (const observer of ownedModelObservationProxies) {
      try { await observer.close(); ownedModelObservationProxies.delete(observer); }
      catch { /* Preserve host shutdown; owned sockets were destroyed by close entry. */ }
    }
    await modelScheduler?.close(); modelScheduler = null;
    modelObservationProxy = null;
    modelObservationRecorder?.close?.();
    modelObservationRecorder = null;
    if (startupFailureReported && await personalBackupManager?.startupFailed()) backupRestartRequested = true;
    else await personalBackupManager?.finishShutdown({ safe: backupSafe });
  })();
  void shutdownPromise.finally(() => {
    cleanupDone = true;
    hostLifecycleState = 'stopped';
    runtimeOrigin = null;
    writeHostStateForLifecycle?.();
    if (backupRestartRequested) app.relaunch();
    app.exit(startupExitCode); // cleanup 完成后一次性退出；启动失败必须保留非零码。
  });
});

// 托盘常驻:窗口全关也不退出(关窗已被 hide 兜住,这里是双保险)。真退只走托盘"退出"→ before-quit。
app.on('window-all-closed', () => {
  /* 桌面伴侣常驻托盘,不随窗口关闭而退出 */
});
