// WeftMate-Perception DSH 插件（M3-01/04）：桌面感知采集（运行时内直接 ingest）。
// 边界 E 已实测通过：get-windows（N-API 预编译原生模块）在子进程 Node（ELECTRON_RUN_AS_NODE）可用。
// 隐私纪律：
//   - opt-in：每次采样热读 DSH_HOME settings 的 perception.sources.desktop.enabled——开关即热生效（不开不采）；
//   - observed 默认不上云：ingestObservation 不传任何授权位 → 库默认 false（fail-closed，与桥 /api/observe 同纪律）；
//   - 采集内容按 capture 设置：app_only 只记 App 名（不采窗口标题）；
//   - 换窗才记（lastKey 去重）+ originId 小时桶幂等（同窗口跨重启同小时不重复）；
//   - 子进程无 Electron powerMonitor：不采「空闲/锁屏」判定，靠换窗去重防噪（离开电脑时无窗口切换、天然不记）。
// 状态写 DSH_HOME/perception-status.json（原子写）——桥经它回 running/presence，不引入服务硬依赖。
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'weftmate-perception'
export const inject = ['memoweft']

const BRIDGE_HOME = '__BRIDGE_HOME__'
const GET_WINDOWS = '__GET_WINDOWS__'
const STATUS_FILE = join(BRIDGE_HOME, 'perception-status.json')
const DEFAULT_SAMPLE_MS = 20_000

/** 采样间隔：测试可经 settings.weftmatePerception.sampleMs 缩短；生产默认 20s。 */
function readConfig() {
  try {
    const settings = JSON.parse(readFileSync(join(BRIDGE_HOME, 'weftmate-settings.json'), 'utf8'))
    const desktop = settings?.perception?.sources?.desktop
    const sampleMs = Number(settings?.weftmatePerception?.sampleMs)
    return {
      enabled: desktop?.enabled === true,
      capture: desktop?.capture === 'app_only' ? 'app_only' : 'app_title',
      sampleMs: Number.isFinite(sampleMs) && sampleMs >= 200 && sampleMs <= 300_000 ? sampleMs : DEFAULT_SAMPLE_MS,
    }
  } catch { return { enabled: false, capture: 'app_title', sampleMs: DEFAULT_SAMPLE_MS } }
}

function writeStatus(status) {
  try {
    mkdirSync(BRIDGE_HOME, { recursive: true })
    const payload = `${JSON.stringify(status, null, 2)}\n`
    writeFileSync(`${STATUS_FILE}.tmp`, payload, 'utf8')
    renameSync(`${STATUS_FILE}.tmp`, STATUS_FILE)
  } catch { /* 状态写失败不影响采集 */ }
}

export function apply(ctx) {
  const core = ctx.memoweft
  if (!core) return // 组合纪律：memoweft 行缺失时不挂感知

  const state = { lastKey: '', running: false, presence: 'off', updatedAt: new Date().toISOString() }
  const setPresence = (presence) => {
    if (state.presence === presence) return
    state.presence = presence
    state.updatedAt = new Date().toISOString()
    writeStatus({ running: state.running, state: state.presence, updatedAt: state.updatedAt })
  }

  let activeWindowFn = null
  const loadActiveWindow = async () => {
    if (!activeWindowFn) {
      const mod = await import(GET_WINDOWS) // 绝对 file URL：CJS 上下文的动态 import 也能加载 ESM 原生包
      activeWindowFn = mod.activeWindow
    }
    return activeWindowFn
  }

  let timer = null

  const sampleOnce = async () => {
    const config = readConfig()
    if (!config.enabled) {
      // 开关关（或热关）：不采。单一定时器常驻，开关热开即恢复。
      if (state.running) {
        state.running = false
        state.lastKey = ''
        setPresence('off')
        writeStatus({ running: false, state: 'off', updatedAt: new Date().toISOString() })
      }
      return
    }
    if (!state.running) {
      state.running = true
      writeStatus({ running: true, state: state.presence, updatedAt: state.updatedAt })
    }
    try {
      const fn = await loadActiveWindow()
      const w = await fn()
      if (!w) { setPresence('unknown'); return }
      setPresence('active')
      const app = (w.owner && w.owner.name) || 'unknown'
      const titleOn = config.capture !== 'app_only'
      const title = titleOn ? String(w.title || '') : ''
      const key = app + '|' + title
      if (key === state.lastKey) return // 没换窗口不重复记
      state.lastKey = key
      const originId = `aw:${key}@${new Date().toISOString().slice(0, 13)}`
      await core.ingestObservation({
        observations: [{
          kind: 'active_window',
          content: title ? `${app} — ${title}` : app,
          occurredAt: new Date().toISOString(),
          originId,
          ...(titleOn ? { meta: { app, title } } : { meta: { app } }),
        }],
      })
    } catch { /* 取窗/采样出错静默，别让感知拖垮运行时 */ }
  }

  // 单一常驻定时器：开关/采集内容每 tick 热读（热生效）；间隔在启动时按配置定（测试可加速）。
  const initial = readConfig()
  void sampleOnce()
  timer = setInterval(() => { void sampleOnce() }, initial.sampleMs)

  ctx.on('dispose', () => {
    if (timer) clearInterval(timer)
    timer = null
  })
}
