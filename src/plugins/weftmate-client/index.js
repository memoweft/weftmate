/**
 * WeftMate 客户端插件，node half（宿主侧占位）。
 *
 * 官方 client-modules node half 只有在宿主 loader 为该 `dsh.client` 行成功创建 fiber
 * （`entry.fiber !== undefined`）后才会把它编进 window.__DSH_BOOT__ 图（见
 * packages/client/modules/src/index.ts 的 processOne）。因此本包需要可被宿主 import 的
 * node half；它本身无宿主侧行为（与官方 @deepseek-ai/dsh-client-runtime 的 node half 同款
 * 「empty host apply」）。浏览器 half 经 exports["./client"] 由 modules node half 发现并服务。
 */
export function apply(_ctx) {}
