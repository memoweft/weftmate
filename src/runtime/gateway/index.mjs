/**
 * WeftMate Gateway · 运行时入口（P1-02 起）。
 *
 * 本 barrel 是宿主插件（src/plugins/weftmate-host.mjs）与后续 Gateway 面
 * （v1 API / 事件流归一 / 健康面）的统一 import 点。P1-02 阶段先收编迁移期的
 * legacy seam 面（旧 /weftmate/* 端点与注入面，行为逐字节不变）；P1-01 的
 * schemas/ 仍是编译期契约护栏，不参与运行时 import。
 *
 * 落位：源码树 src/runtime/gateway/；profile 侧由 writePluginAssets 同形复制到
 * $DSH_HOME/profiles/<name>/runtime/gateway/（插件进程从 profile 副本运行）。
 */
export {
  DSH_HOME,
  STATE_FILE,
  REQUEST_FILE,
  PERCEPTION_FILE,
  PERCEPTION_REQUEST_FILE,
  PET_REQUEST_FILE,
  DEVICE_STATE_FILE,
  DEVICE_REQUEST_FILE,
} from './legacy/files.mjs'
export { fallbackState, readState } from './legacy/state.mjs'
export { writeUpdateRequest } from './legacy/update.mjs'
export { fallbackPerception, readPerception, writePerceptionRequest } from './legacy/perception.mjs'
export { writePetRequest } from './legacy/pet.mjs'
export { readDeviceState, verifyDeviceToken, writeDeviceRequest } from './legacy/device.mjs'
export { serveWeftmate } from './legacy/http.mjs'
export { createPerceptionInjector } from './legacy/inject.mjs'
export { createGatewayV1 } from './routes/v1.mjs'

/** v1 is additive: legacy `/weftmate/*` remains solely owned by legacy/http.mjs. */
export function composeWeftmateHandler(gatewayV1, legacyHandler) {
  return (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://gateway').pathname
    return pathname.startsWith('/weftmate/api/v1/') ? gatewayV1.handle(req, res) : legacyHandler(req, res)
  }
}
