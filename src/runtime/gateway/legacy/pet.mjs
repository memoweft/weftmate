/**
 * WeftMate Gateway · legacy seam · 桌宠动作面（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * 桌宠动作请求（main 每 1s 轮询消费；白名单 set-visible/set-free-activity，value 布尔）。
 * 已有代码冻结保留（Core 1.0 执行期不增强），仅随 seam 面迁移。
 */
import { writeFileSync } from 'node:fs'
import { PET_REQUEST_FILE } from './files.mjs'

/** 桌宠动作请求（main 每 1s 轮询消费；白名单 set-visible/set-free-activity，value 布尔）。 */
export function writePetRequest(action, value) {
  if (action !== 'set-visible' && action !== 'set-free-activity') {
    return { ok: false, code: 'BAD_ACTION' }
  }
  if (typeof value !== 'boolean') return { ok: false, code: 'BAD_VALUE' }
  try {
    writeFileSync(PET_REQUEST_FILE(), `${JSON.stringify({ action, value, at: Date.now() })}\n`, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'WRITE_FAILED', error: error?.message ?? String(error) }
  }
}
