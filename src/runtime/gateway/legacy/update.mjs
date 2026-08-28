/**
 * WeftMate Gateway · legacy seam · 升级请求面（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * 动作面：官方 UI 点「检查更新/重启安装」→ `POST /weftmate/update` → 本模块写
 * `$DSH_HOME/weftmate-update-request.json` → main 轮询消费执行（check → electron-updater，
 * install → quitAndInstall）→ 结果经状态文件回写。
 */
import { writeFileSync } from 'node:fs'
import { REQUEST_FILE } from './files.mjs'

/** 官方 UI 侧的动作请求写入请求文件（main 每 1s 轮询消费；消费即删，天然防重）。 */
export function writeUpdateRequest(action) {
  if (action !== 'check' && action !== 'install') return { ok: false, code: 'BAD_ACTION' }
  try {
    writeFileSync(REQUEST_FILE(), `${JSON.stringify({ action, at: Date.now() })}\n`, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'WRITE_FAILED', error: error?.message ?? String(error) }
  }
}
