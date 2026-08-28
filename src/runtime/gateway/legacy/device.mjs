/**
 * WeftMate Gateway · legacy seam · 设备面（R8-01 手机 App 上报；P1-02 原样拆分）。
 *
 * loopback + 配对 token；token 校验（等值 + 时效）先于任何动作。
 * 已有代码冻结保留（Core 1.0 执行期不增强），仅随 seam 面迁移。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DEVICE_STATE_FILE, DEVICE_REQUEST_FILE } from './files.mjs'

function readDeviceState() {
  try {
    if (existsSync(DEVICE_STATE_FILE())) return JSON.parse(readFileSync(DEVICE_STATE_FILE(), 'utf8'))
  } catch { /* 半写/坏文件走回退 */ }
  return { schemaVersion: 1, pairing: null, devices: [] }
}

/** 配对 token 校验（等值 + 时效）；失败返回错误码，成功返回 null。 */
function verifyDeviceToken(token) {
  if (typeof token !== 'string' || token.length === 0) return 'BAD_TOKEN'
  const state = readDeviceState()
  const pairing = state.pairing
  if (!pairing || typeof pairing.token !== 'string' || pairing.token.length === 0) return 'NO_PAIRING'
  if (token !== pairing.token) return 'BAD_TOKEN'
  if (typeof pairing.expiresAt !== 'number' || Date.now() >= pairing.expiresAt) return 'EXPIRED_TOKEN'
  return null
}

/** 设备动作请求（main 每 1s 轮询消费；白名单 pair/observation；token 校验先于任何动作）。 */
function writeDeviceRequest(action, payload) {
  if (action !== 'pair' && action !== 'observation') return { ok: false, code: 'BAD_ACTION' }
  try {
    writeFileSync(DEVICE_REQUEST_FILE(), `${JSON.stringify({ action, ...payload, at: Date.now() })}\n`, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'WRITE_FAILED', error: error?.message ?? String(error) }
  }
}

export { readDeviceState, verifyDeviceToken, writeDeviceRequest }
