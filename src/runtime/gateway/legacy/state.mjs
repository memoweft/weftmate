/**
 * WeftMate Gateway · legacy seam · 宿主状态面（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * 状态面：main 每 5s 写 `$DSH_HOME/weftmate-host-state.json`（app 名/版本、托盘常驻、
 * 数据目录、更新态）；插件按请求实时读文件。文件缺失（main 未起，如 vendor 冒烟）时
 * 回退 env 组合（WEFTMATE_*）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { DSH_HOME, STATE_FILE } from './files.mjs'

/** 状态文件缺失时的 env 回退组合（vendor 冒烟/契约测试等无 main 形态）。 */
export function fallbackState() {
  return {
    schemaVersion: 1,
    app: { name: 'WeftMate', version: process.env.WEFTMATE_APP_VERSION ?? 'dev' },
    tray: { resident: process.env.WEFTMATE_USER_DATA !== undefined },
    dataDirs: {
      userData: process.env.WEFTMATE_USER_DATA ?? null,
      dshHome: (process.env.WEFTMATE_DSH_HOME ?? DSH_HOME()) || null,
      workspace: process.env.WEFTMATE_WORKSPACE ?? null,
    },
    update: { enabled: false, status: 'disabled', version: null, error: null },
    memoweft: { enabled: process.env.WEFTMATE_MEMOWEFT_ENABLED === '1' },
  }
}

/** 读状态文件（不存在/坏文件 → env 回退；绝不抛错——展示面尽最大努力）。 */
export function readState() {
  try {
    if (existsSync(STATE_FILE())) return JSON.parse(readFileSync(STATE_FILE(), 'utf8'))
  } catch { /* 半写/坏文件走回退 */ }
  return fallbackState()
}
