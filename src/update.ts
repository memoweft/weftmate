/**
 * WeftMate 自动更新（M5-01）——electron-updater 的 main 侧接缝。
 *
 * 纪律（诚实发布）：
 *  - 只在「打包形态 + 配置了更新渠道」时启用；开发形态/无渠道 → enabled:false，UI 显示未配置。
 *  - 渠道 = 打包目录里的 app-update.yml（electron-builder 在配置 publish 时生成），或
 *    WEFTMATE_UPDATE_FEED 环境变量（预发布验证用）。
 *  - 签名：下载前验证 Ed25519 清单，下载后核对安装包 SHA-256；正式发布仍需可信签名证书。
 *  - 状态机只保留 UI 需要的极简叶子，绝不 log 任何路径/凭据。
 */
import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeUpdateFailure } from './update-policy.ts'
import { readAppUpdateManifest, verifyDownloadedApp } from './personal-update/app-package.mjs'
import type { UpdateManifest } from './personal-update/manifest.mjs'
import { compareVersions } from './personal-update/manifest.mjs'
import { rejectedAppVersion } from './personal-update/app-rollback.mjs'

export type UpdateStatus =
  | 'disabled'      // 未打包或未配置渠道
  | 'idle'          // 已启用，未开始
  | 'checking'
  | 'available'     // 有新版（下载中）
  | 'downloaded'    // 已下载完成，等用户重启安装
  | 'not-available'
  | 'error'

export interface UpdateState {
  enabled: boolean
  status: UpdateStatus
  /** 发现的新版本号（available 时）。 */
  version: string | null
  /** 错误信息（error 时，普通用户可读）。 */
  error: string | null
  releaseNotes?: string
}

const state: UpdateState = { enabled: false, status: 'disabled', version: null, error: null }
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null
let installed = false
let stateListener: ((state: UpdateState) => void) | null = null
let signedAppManifest: UpdateManifest | null = null
let checking = false
let downloadedInstaller: string | null = null

function publishState(getWindow?: () => BrowserWindow | null): void {
  const snapshot = updateState()
  try { getWindow?.()?.webContents.send('wm:update-state', snapshot) } catch { /* window may be closing */ }
  try { stateListener?.(snapshot) } catch { /* lifecycle UI must not break updater */ }
}

/** 更新渠道：app-update.yml（打包内）或 WEFTMATE_UPDATE_FEED 环境变量（预发布验证）。 */
function resolveFeed(): string | null {
  if (process.env.WEFTMATE_UPDATES_DISABLED === 'true') return null
  const envFeed = process.env.WEFTMATE_UPDATE_FEED
  if (typeof envFeed === 'string' && envFeed.length > 0) return envFeed
  if (!app.isPackaged) return null
  const appUpdaterYml = join(process.resourcesPath ?? '', 'app-update.yml')
  if (!existsSync(appUpdaterYml)) return null
  try {
    const parsed = readFileSync(appUpdaterYml, 'utf8')
    return /^\s*url:\s*\S/m.test(parsed) ? 'packaged' : null
  } catch { return null }
}

/** 组装并返回当前状态（IPC 回渲染用）。 */
export function updateState(): UpdateState {
  return { ...state }
}

/** 初始化：打包形态 + 有渠道才装 electron-updater（懒 import，dev 不加载）。 */
export async function initUpdater(getWindow: () => BrowserWindow | null, onStateChange?: (state: UpdateState) => void): Promise<UpdateState> {
  if (onStateChange) stateListener = onStateChange
  if (installed) { publishState(getWindow); return state }
  installed = true
  if (!app.isPackaged) return state // 开发形态永远 disabled
  const feed = resolveFeed()
  if (feed === null) return state
  try {
    const updaterModule: any = await import('electron-updater')
    // ESM 动态 import CJS 包的互操作形状：tsdown 产物把 autoUpdater 挂在 default（运行时赋值，
    // cjs-module-lexer 静态探测不到命名导出）；两种形状都认。
    type AutoUpdaterShape = typeof import('electron-updater').autoUpdater
    const updater = (updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater) as AutoUpdaterShape | undefined
    if (!updater) {
      state.status = 'error'
      state.error = 'electron-updater 模块导出形状不识别'
      return state
    }
    autoUpdater = updater
    // 渠道来源：'packaged' = 打包内 app-update.yml（feed 构建产物），electron-updater 自读；
    // env 来源（WEFTMATE_UPDATE_FEED，预发布验证）必须显式 setFeedURL——否则默认去找
    // resources/app-update.yml（普通构建没有）直接 ENOENT。
    if (feed !== 'packaged') {
      updater.setFeedURL({ provider: 'generic', url: feed, useMultipleRangeRequest: false })
    }
    updater.logger = {
      info: () => undefined,
      debug: () => undefined,
      warn: (message: unknown) => console.warn(`[weftmate-updater] ${sanitizeUpdateFailure(message)}`),
      error: (message: unknown) => console.error(`[weftmate-updater] ${sanitizeUpdateFailure(message)}`),
    }
    // The signed layer manifest authorizes the version before updater downloads it.
    updater.autoDownload = false
    updater.disableDifferentialDownload = false
    updater.allowPrerelease = process.env.WEFTMATE_UPDATE_CHANNEL === 'preview'
    updater.channel = updater.allowPrerelease ? 'preview' : 'latest'
    updater.allowDowngrade = false
    // Preview updates are installed only after the user chooses the explicit
    // tray action. A normal app exit must never silently mutate the install.
    updater.autoInstallOnAppQuit = false
    updater.on('checking-for-update', () => { state.status = 'checking'; state.error = null; publishState(getWindow) })
    updater.on('update-available', (info) => {
      if (!signedAppManifest || signedAppManifest.version !== info.version) {
        state.status = 'error'; state.error = sanitizeUpdateFailure('signature version mismatch'); publishState(getWindow); return
      }
      state.status = 'available'; state.version = info.version; publishState(getWindow)
      void updater.downloadUpdate().catch(error => { state.status = 'error'; state.error = sanitizeUpdateFailure(error); publishState(getWindow) })
    })
    updater.on('update-not-available', () => { state.status = 'not-available'; publishState(getWindow) })
    updater.on('download-progress', () => { state.status = 'available'; publishState(getWindow) })
    updater.on('update-downloaded', async (info) => {
      try {
        if (!signedAppManifest || info.version !== signedAppManifest.version) throw new Error('signature version mismatch')
        await verifyDownloadedApp(signedAppManifest, info.downloadedFile)
        downloadedInstaller = info.downloadedFile
        state.status = 'downloaded'; state.version = info.version; state.error = null
      } catch (error) { state.status = 'error'; state.error = sanitizeUpdateFailure(error) }
      publishState(getWindow)
    })
    updater.on('error', (error) => {
      state.status = 'error'
      state.error = sanitizeUpdateFailure(error)
      publishState(getWindow)
    })
    state.enabled = true
    state.status = 'idle'
    publishState(getWindow)
  } catch (error) {
    state.status = 'error'
    state.error = sanitizeUpdateFailure(error)
    publishState(getWindow)
  }
  return state
}

/** 检查更新（未启用时 no-op 返回当前状态）。 */
export async function checkForUpdates(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  await initUpdater(getWindow)
  if (!state.enabled || autoUpdater === null) return state
  if (checking || state.status === 'available' || state.status === 'downloaded') return updateState()
  checking = true
  try {
    state.status = 'checking'; state.error = null; publishState(getWindow)
    const feed = resolveFeed()
    // UPD-3 must provide the companion signed manifest URL for a packaged provider.
    const manifestFeed = process.env.WEFTMATE_APP_MANIFEST_FEED || (feed !== 'packaged' ? feed : null)
    if (!manifestFeed) throw new Error('signature manifest source missing')
    signedAppManifest = await readAppUpdateManifest(manifestFeed, app.getVersion(), process.env.WEFTMATE_UPDATE_CHANNEL || 'stable')
    if (await rejectedAppVersion(signedAppManifest.version)) throw new Error('startup version rejected')
    state.releaseNotes = typeof signedAppManifest.releaseNotes === 'string' ? signedAppManifest.releaseNotes : ''
    if (compareVersions(signedAppManifest.version, app.getVersion()) <= 0) {
      state.status = 'not-available'; state.version = null; publishState(getWindow); return updateState()
    }
    await autoUpdater.checkForUpdates()
  } catch (error) {
    state.status = 'error'
    state.error = sanitizeUpdateFailure(error)
    publishState(getWindow)
  } finally { checking = false }
  return state
}

/** 用户确认「重启安装」——只有已下载完成时可用。 */
export function quitAndInstall(): boolean {
  if (!state.enabled || autoUpdater === null || state.status !== 'downloaded') return false
  try {
    // The recovery monitor owns the reviewed NSIS installer. Main's shutdown
    // deliberately calls app.exit(), which does not emit will-quit.
    app.quit()
    return true
  } catch { return false }
}

/** Channel changes discard authorization for the previous feed and its downloaded installer. */
export function changeUpdateChannel(): void {
  if (checking || state.status === 'available') throw new Error('UPDATE_DOWNLOAD_IN_PROGRESS')
  signedAppManifest = null
  downloadedInstaller = null
  state.version = null; state.releaseNotes = ''; state.error = null
  if (autoUpdater) {
    const feed = resolveFeed()
    if (feed && feed !== 'packaged') autoUpdater.setFeedURL({ provider: 'generic', url: feed, useMultipleRangeRequest: false })
    autoUpdater.allowPrerelease = process.env.WEFTMATE_UPDATE_CHANNEL === 'preview'
    autoUpdater.channel = autoUpdater.allowPrerelease ? 'preview' : 'latest'
    autoUpdater.allowDowngrade = false
    state.enabled = !!feed; state.status = feed ? 'idle' : 'disabled'
  }
}
export function preparedInstallerPath(): string | null { return state.status === 'downloaded' ? downloadedInstaller : null }
export function preparedInstallerHash(): string | null {
  const file = downloadedInstaller?.split(/[\\/]/).at(-1)
  return state.status === 'downloaded' ? signedAppManifest?.files.find(row => row.path === file)?.sha256 || null : null
}
