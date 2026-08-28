/**
 * WeftMate Gateway · legacy seam · 感知注入面（P1-02 自 weftmate-host.mjs 原样拆分）。
 *
 * R6-01 感知注入面：agent/pre-step 追加桌面感知快照（官方 time-context 同款接缝）。
 * 注入开关（settings.perception.inject.enabled）与最小间隔（intervalMs）每次读
 * 双工文件热生效；剪贴板内容永不注入（仅 UI 可见）。任何一步失败都原样放行
 * decision，绝不影响主链路。
 */
import { readPerception } from './perception.mjs'

export function createPerceptionInjector() {
  let lastInjectAt = 0
  return async (payload, next) => {
    const decision = await next()
    try {
      if (decision.kind === 'reject' || payload?.signal?.aborted) return decision
      const perception = readPerception()
      const cfg = perception?.config
      if (!cfg?.inject?.enabled) return decision
      const intervalMs = typeof cfg.inject?.intervalMs === 'number' ? cfg.inject.intervalMs : 60_000
      const now = Date.now()
      if (now - lastInjectAt < intervalMs) return decision
      const sample = perception?.sample
      if (!sample) return decision
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      if (typeof createUserMessage !== 'function') return decision
      const windowText = sample.activeWindow
        ? (sample.activeWindow.title ? `${sample.activeWindow.app} — ${sample.activeWindow.title}` : sample.activeWindow.app)
        : '未知'
      const seconds = Math.max(0, Math.floor(Number(sample.idleSeconds) || 0))
      const idleText = `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
      const lines = [
        'WeftMate 桌面感知快照（用户已开启注入；来源：本机实时采样）：',
        `- 当前窗口：${windowText}`,
        `- 空闲时长：${idleText}`,
        `- 锁屏状态：${sample.locked ? '已锁屏' : '未锁屏'}`,
        `- 剪贴板：${cfg.clipboard ? '已启用（内容不注入模型，仅界面可见）' : '未启用'}`,
      ]
      if (sample.mobile && typeof sample.mobile.content === 'string' && sample.mobile.content) {
        lines.push(`- 手机（用户已开启手机源，设备 ${sample.mobile.deviceName || '未知'}）：${sample.mobile.content}`)
      }
      const text = lines.join('\n')
      lastInjectAt = now
      return {
        kind: 'enter',
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: 'weftmate-perception', form: 'snapshot', sections: [{ name: 'weftmate-perception', text }] },
          }),
        ],
      }
    } catch { return decision } // 注入面任何异常都不挡主链路
  }
}
