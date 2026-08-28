/**
 * WeftMate 自动更新（M5-01）——electron-updater 的 main 侧接缝。
 *
 * 纪律（诚实发布）：
 *  - 只在「打包形态 + 配置了更新渠道」时启用；开发形态/无渠道 → enabled:false，UI 显示未配置。
 *  - 渠道 = 打包目录里的 app-update.yml（electron-builder 在配置 publish 时生成），或
 *    WEFTMATE_UPDATE_FEED 环境变量（预发布验证用）。
 *  - 签名：正式发布必须有签名证书（electron-builder 经 CSC_LINK/CSC_KEY_PASSWORD 环境变量；
 *    mac 另需公证）。未签名的包不做自动更新（updater 会拒绝不一致签名）。
 *  - 状态机只保留 UI 需要的极简叶子，绝不 log 任何路径/凭据。
 */
import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
}

const state: UpdateState = { enabled: false, status: 'disabled', version: null, error: null }
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null
let installed = false

/** 更新渠道：app-update.yml（打包内）或 WEFTMATE_UPDATE_FEED 环境变量（预发布验证）。 */
function resolveFeed(): string | null {
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
export async function initUpdater(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  if (installed) return state
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
      updater.setFeedURL({ provider: 'generic', url: feed })
    }
    const send = (s: UpdateState) => {
      try { getWindow()?.webContents.send('wm:update-state', s) } catch { /* 窗口未就绪 */ }
    }
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => { state.status = 'checking'; state.error = null; send(state) })
    updater.on('update-available', (info) => { state.status = 'available'; state.version = info?.version ?? null; send(state) })
    updater.on('update-not-available', () => { state.status = 'not-available'; send(state) })
    updater.on('download-progress', () => { state.status = 'available'; send(state) })
    updater.on('update-downloaded', (info) => { state.status = 'downloaded'; state.version = info?.version ?? state.version; send(state) })
    updater.on('error', (error) => {
      state.status = 'error'
      state.error = error?.message ? error.message : String(error)
      send(state)
    })
    state.enabled = true
    state.status = 'idle'
  } catch (error) {
    state.status = 'error'
    state.error = error instanceof Error ? error.message : String(error)
  }
  return state
}

/** 检查更新（未启用时 no-op 返回当前状态）。 */
export async function checkForUpdates(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  await initUpdater(getWindow)
  if (!state.enabled || autoUpdater === null) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    state.status = 'error'
    state.error = error instanceof Error ? error.message : String(error)
  }
  return state
}

/** 用户确认「重启安装」——只有已下载完成时可用。 */
export function quitAndInstall(): boolean {
  if (!state.enabled || autoUpdater === null || state.status !== 'downloaded') return false
  try {
    autoUpdater.quitAndInstall()
    return true
  } catch { return false }
}
