/**
 * WeftMate Gateway · legacy seam · 接缝文件路径层（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * main ↔ DSH 插件 的落盘接缝文件统一收口在这里：宿主插件进程读不到 main 的进程内存，
 * 只认 $DSH_HOME 下的 JSON 文件（main 侧对应读写见 src/main.mjs / src/devices.ts）。
 * 文件名是 main↔插件 的硬契约，改名 = 破坏已安装客户端。
 *
 * 注意：本模块跑在 DSH 宿主插件进程内（Node ESM 直载 .mjs），必须保持纯 JS。
 */
import { join } from 'node:path'

export const DSH_HOME = () => process.env.DSH_HOME ?? ''
export const STATE_FILE = () => join(DSH_HOME(), 'weftmate-host-state.json')
export const REQUEST_FILE = () => join(DSH_HOME(), 'weftmate-update-request.json')
export const PERCEPTION_FILE = () => join(DSH_HOME(), 'weftmate-perception-main.json')
export const PERCEPTION_REQUEST_FILE = () => join(DSH_HOME(), 'weftmate-perception-request.json')
export const PET_REQUEST_FILE = () => join(DSH_HOME(), 'weftmate-pet-request.json')
export const DEVICE_STATE_FILE = () => join(DSH_HOME(), 'weftmate-device-state.json')
export const DEVICE_REQUEST_FILE = () => join(DSH_HOME(), 'weftmate-device-request.json')
