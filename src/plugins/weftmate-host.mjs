/**
 * WeftMate 宿主插件（P1-02 起 = Gateway composition 入口；R3-02 起为品牌壳/托盘/更新接缝）。
 *
 * 加载：cordis.patch.yml 的相对路径行 `name: './plugins/weftmate-host.mjs'`，由 host loader 的
 * tree.import 以 `new URL(name, baseUrl)` 解析（baseUrl = profile 目录 cordis.yml）。
 *
 * P1-02 拆分：本文件只保留 composition 入口职责（服务面 + 路由挂载 + 注入面注册 +
 * 启动日志）；路由表 / 接缝文件读写 / 注入实现全部下沉到 src/runtime/gateway/
 * （writePluginAssets 同形复制到 profile 的 runtime/gateway/，本文件以相对路径 import）。
 *
 * 接缝（main ↔ 本插件 ↔ 官方 UI，实现见 runtime/gateway/legacy/）：
 *  - 状态面：main 每 5s 写 `$DSH_HOME/weftmate-host-state.json`；`GET /weftmate/status.json`
 *    按请求实时读文件回给官方 UI。文件缺失（main 未起，如 vendor 冒烟）时回退 env 组合。
 *  - 动作面：官方 UI → `POST /weftmate/update` 等 → 写请求文件 → main 轮询消费。
 *  - 服务面：provide `weftmateRuntime`（version/startedAt/statePath/readState…），供
 *    契约测试与后续宿主行消费；当前客户端走 HTTP 面，不经 cordis RPC。
 */
import {
  STATE_FILE,
  REQUEST_FILE,
  PERCEPTION_FILE,
  readState,
  readPerception,
  serveWeftmate as serveLegacyWeftmate,
  composeWeftmateHandler,
  createGatewayV1,
  createPerceptionInjector,
} from '../runtime/gateway/index.mjs'
import { InProcessApiClient, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { nativeTimelineLog } from '../runtime/dsh-adapter/timeline.mjs'
import { nativeSessionLifecycle } from '../runtime/dsh-adapter/session-lifecycle.mjs'

export const name = 'weftmate-host'
// apiProxy is a hard composition dependency: Gateway v1 constructs its
// supported in-process client during apply(), so Cordis must not schedule this
// host before the official api-gateway service is ready.
export const inject = ['webServer', 'apiProxy', 'agents', 'sessions', 'sessionPersistence', 'agentPresets']

export function apply(ctx) {
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) throw new Error('weftmate-host requires DSH apiProxy')
  // Required supported seam: same composed runtime only, never a second DSH client/runtime.
  const gatewayV1 = createGatewayV1({
    client: new InProcessApiClient(toFetchHandler(apiProxy)),
    readLog: nativeTimelineLog(ctx),
    lifecycle: nativeSessionLifecycle(ctx),
    // P1-05 diagnostics deps：pin 由打包/启动方注入（env），不自行推断。
    diagnostics: {
      runtime: { version: process.env.WEFTMATE_APP_VERSION ?? 'dev', startedAt: Date.now() },
      paths: {
        dshHome: process.env.DSH_HOME ?? null,
        statePath: STATE_FILE(),
        requestPath: REQUEST_FILE(),
        perceptionPath: PERCEPTION_FILE(),
      },
      pin: process.env.WEFTMATE_DSH_PIN ?? null,
      dshRuntimeVersion: process.env.WEFTMATE_DSH_RUNTIME_VERSION ?? null,
    },
  })
  const serveWeftmate = composeWeftmateHandler(gatewayV1, serveLegacyWeftmate)
  const runtime = Object.freeze({
    version: process.env.WEFTMATE_APP_VERSION ?? 'dev',
    startedAt: Date.now(),
    statePath: STATE_FILE(),
    requestPath: REQUEST_FILE(),
    perceptionPath: PERCEPTION_FILE(),
    readState,
    readPerception,
  })
  ctx.provide('weftmateRuntime', runtime)
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/weftmate', handler: serveWeftmate }),
    'weftmate-host: legacy seam + v1 session gateway route',
  )
  // ── R6-01 · 感知注入面：agent/pre-step 追加桌面感知快照（实现见 gateway/legacy/inject.mjs；
  //   注入开关/间隔热生效、剪贴板内容永不注入，契约测试锁源码形状）──
  ctx.on('agent/pre-step', createPerceptionInjector(), { prepend: true })
  if (typeof ctx.logger?.info === 'function') {
    ctx.logger.info(`weftmate-host: seam ready (${runtime.version})`)
  }
}
