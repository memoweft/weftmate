/**
 * P1-05 Gateway diagnostics.
 *
 * 生产 P1-01 冻结的 HealthPayload（schemas/health.ts 为编译期护栏；运行时在此
 * 按同形构造，不 import TS）。数据只来自受支持接缝：
 *  - `host.describe`（version/cwd/attachedSessions）—— 唯一的 DSH 健康探针；
 *    它被拒即 runtime.state = 'stopped'（kill/restart 的准确反映点）。
 *  - 组合注入的 pin 信息与路径 —— 不自行推断。
 * lastErrors 是环形缓冲：每项只有 { at, code, digest }，永不携带原始 payload。
 */

const MAX_LAST_ERRORS = 20
const DEGRADED_WINDOW_MS = 60_000

/**
 * @param {{ client: object, runtime: { version: string, startedAt: number }, paths: object,
 *          pin: string | null, dshRuntimeVersion: string | null,
 *          degradedWindowMs?: number }} deps
 */
export function createDiagnostics({ client, runtime, paths, pin = null, dshRuntimeVersion = null, degradedWindowMs = DEGRADED_WINDOW_MS }) {
  if (!client?.host) throw new TypeError('supported DSH client is required')
  const lastErrors = []
  let lastErrorAt = 0

  function recordError(code, digest) {
    lastErrors.push({ at: new Date().toISOString(), code, digest })
    if (lastErrors.length > MAX_LAST_ERRORS) lastErrors.splice(0, lastErrors.length - MAX_LAST_ERRORS)
    lastErrorAt = Date.now()
  }

  function healthState() {
    // 宿主进程活着但窗口内有过网关错误 → degraded；否则 running。
    return lastErrorAt > 0 && Date.now() - lastErrorAt < degradedWindowMs ? 'degraded' : 'running'
  }

  return {
    recordError,
    lastErrorsSnapshot() {
      return [...lastErrors]
    },
    pathsSnapshot() {
      return { ...paths }
    },
    async snapshot() {
      const startedAtIso = new Date(runtime.startedAt).toISOString()
      let describe = null
      try {
        const response = await client.host.describe({})
        if (response?.result?.ok === true) describe = response.result.value
      } catch {
        // 探针失败即 stopped；细节进 lastErrors 由调用侧（v1 catch）负责。
      }
      const state = describe === null ? 'stopped' : healthState()
      // 身份确认 = 运行中的 DSH 自报版本与随包注入的 vendored 运行时版本一致。
      // 已知限制：pin 47f94385 的 host.describe.version 是硬编码占位符 '0.0.1'
      // （上游 TODO），因此该确认在当前 pin 上恒为 false；pin commit 只如实上报，
      // 上游补上真实版本源后本比较自动生效。
      const pinned = pin !== null && dshRuntimeVersion !== null && describe?.version === dshRuntimeVersion
      return {
        app: { name: 'weftmate', version: runtime.version },
        gateway: { protocolVersion: 1, startedAt: startedAtIso },
        runtime: { state },
        dsh: { pin: pin ?? 'unknown', pinned },
        sessions: { active: Number.isInteger(describe?.attachedSessions) ? describe.attachedSessions : 0 },
        memory: { available: false, version: null },
        update: { status: 'unknown', version: null },
        host: describe === null
          ? null
          : { version: describe.version, cwd: describe.cwd, canOpenPath: describe.canOpenPath === true },
        paths: { ...paths },
        lastErrors: [...lastErrors],
      }
    },
  }
}
