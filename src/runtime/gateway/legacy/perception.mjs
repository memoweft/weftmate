/**
 * WeftMate Gateway · legacy seam · 桌面感知面（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * 感知双工：main 每 1s 轮询写采样文件、消费插件动作请求（白名单 set-*）；
 * 注入面见 inject.mjs（剪贴板内容永不注入，仅 UI 可见）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { PERCEPTION_FILE, PERCEPTION_REQUEST_FILE } from './files.mjs'

/** 感知双工文件回退（main 未起/未写文件时）：config 全关 + sample null。 */
export function fallbackPerception() {
  return {
    schemaVersion: 1,
    config: {
      enabled: false,
      capture: 'app_title',
      clipboard: false,
      inject: { enabled: false, intervalMs: 60_000 },
      mobile: false,
    },
    sample: null,
  }
}

/** 读 main 侧感知采样文件（不存在/坏文件 → 回退；绝不抛错）。 */
export function readPerception() {
  try {
    if (existsSync(PERCEPTION_FILE())) return JSON.parse(readFileSync(PERCEPTION_FILE(), 'utf8'))
  } catch { /* 半写/坏文件走回退 */ }
  return fallbackPerception()
}

/** 感知设置动作请求（main 每 1s 轮询消费；白名单 set-* 确定性动作，value 按动作校验）。 */
export function writePerceptionRequest(action, value) {
  if (action !== 'set-enabled' && action !== 'set-capture' && action !== 'set-clipboard'
    && action !== 'set-inject' && action !== 'set-mobile') {
    return { ok: false, code: 'BAD_ACTION' }
  }
  if (action === 'set-capture') {
    if (value !== 'app_title' && value !== 'app_only') return { ok: false, code: 'BAD_VALUE' }
  } else if (typeof value !== 'boolean') {
    return { ok: false, code: 'BAD_VALUE' }
  }
  try {
    writeFileSync(PERCEPTION_REQUEST_FILE(), `${JSON.stringify({ action, value, at: Date.now() })}\n`, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'WRITE_FAILED', error: error?.message ?? String(error) }
  }
}
