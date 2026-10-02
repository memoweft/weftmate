/**
 * WeftMate 的官方 DSH CredentialProvider 实现。
 *
 * 这是一个很窄的 host-side bridge：DSH 保持 `ctx.credentials` 的标准 API，主进程
 * 通过 Node child IPC 执行实际 safeStorage 读写。这个子进程插件不写文件、不读环境变量、
 * 不开 HTTP 端口，也从不记录 credential value。
 */
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'

export const name = 'weftmate-credentials'
export const WEFTMATE_CREDENTIALS_IPC_PROTOCOL = 'weftmate.credentials.v1'
const REQUEST_TIMEOUT_MS = 10_000
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,160}$/
// Browser-auth records belong to the candidate process, not to one Cordis
// provider Fiber. A live settings edit can replace the provider instance; if
// that discarded this map, its otherwise valid authenticated browser cookie
// would immediately become a 401. The map is still never written to disk or
// sent over the reference-credential IPC, and a process restart clears it.
const PROCESS_LOCAL_RECORDS = Symbol.for('weftmate.credentials.process-local-records.v1')
// Cordis may evaluate a reloaded plugin in a new isolate, which has a new
// `globalThis`. Node's `process` object is the child-process lifetime owner
// shared by those isolates, so this remains volatile yet survives a provider
// re-mount caused by a live settings edit.
const processLocalRecords = process[PROCESS_LOCAL_RECORDS] ??= new Map()

function credentialError(code) {
  // 错误只保留受控 code：永远不能把 safeStorage/Electron 的错误或密钥折回 DSH/UI 日志。
  return new Error(`weftmate-credentials: ${code}`)
}

/** 单个 child IPC 通道；每个请求独立 correlation id，断线、超时与 dispose 都 fail-closed。 */
export class WeftMateCredentialBridge {
  constructor({ timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
    this.onMessage = this.onMessage.bind(this)
    this.onDisconnect = this.onDisconnect.bind(this)
    if (typeof process.on === 'function') {
      process.on('message', this.onMessage)
      process.once('disconnect', this.onDisconnect)
    }
  }

  request(operation, ref, value) {
    if (this.closed) return Promise.reject(credentialError('closed'))
    if (typeof process.send !== 'function' || process.connected !== true) {
      return Promise.reject(credentialError('unavailable'))
    }
    const id = `weftmate-credential-${process.pid}-${this.nextId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(credentialError('timeout'))
      }, this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, { operation, resolve, reject, timer })
      const frame = {
        protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL,
        id,
        operation,
        ref,
        ...(operation === 'set' ? { value } : {}),
      }
      try {
        process.send(frame, (error) => {
          if (error === null || error === undefined) return
          const pending = this.pending.get(id)
          if (pending === undefined) return
          this.pending.delete(id)
          clearTimeout(pending.timer)
          pending.reject(credentialError('disconnected'))
        })
      } catch {
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        clearTimeout(pending.timer)
        pending.reject(credentialError('disconnected'))
      }
    })
  }

  onMessage(message) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return
    const raw = message
    if (raw.protocol !== WEFTMATE_CREDENTIALS_IPC_PROTOCOL || typeof raw.id !== 'string' || !REQUEST_ID.test(raw.id)) return
    const pending = this.pending.get(raw.id)
    if (pending === undefined) return
    this.pending.delete(raw.id)
    clearTimeout(pending.timer)
    if (raw.ok !== true) {
      pending.reject(credentialError(typeof raw.error === 'string' ? raw.error : 'failed'))
      return
    }
    const result = raw.result !== null && typeof raw.result === 'object' && !Array.isArray(raw.result)
      ? raw.result
      : {}
    // Operation is carried by pending state, never trusted from the response. The provider consumes only the
    // corresponding public shape, so a malformed/overbroad main response cannot make describe reveal a value.
    pending.resolve(result)
  }

  onDisconnect() {
    this.failAll('disconnected')
  }

  failAll(code) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(credentialError(code))
    }
    this.pending.clear()
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.failAll('closed')
    process.off?.('message', this.onMessage)
    process.off?.('disconnect', this.onDisconnect)
  }
}

export class WeftMateCredentialProvider extends CredentialProvider {
  constructor(ctx) {
    super(ctx)
    this.bridge = new WeftMateCredentialBridge()
    // DSH V4's local browser carrier creates an authentication record during
    // startup. Keep that record process-local: it is not an LLM credential,
    // it never enters DSH_HOME, and a restart intentionally creates a new one.
    this.records = processLocalRecords
    // Cordis lifecycle uses effect return values, not an ad-hoc dispose event.
    ctx.effect(() => () => { this.bridge.close() }, 'weftmate-credentials: ipc lifecycle')
  }

  async resolve(ref) {
    const result = await this.bridge.request('resolve', ref)
    return typeof result.value === 'string' && result.value.length > 0
      ? { value: result.value, source: typeof result.source === 'string' ? result.source : 'weftmate-safe-storage' }
      : undefined
  }

  async describe(ref) {
    const result = await this.bridge.request('describe', ref)
    const configured = result.configured === true
    return {
      configured,
      ...(configured && typeof result.source === 'string' ? { source: result.source } : {}),
      writable: result.writable !== false,
    }
  }

  async set(ref, value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw credentialError('empty_value_use_unset')
    }
    const result = await this.bridge.request('set', ref, value)
    if (result.changed !== false) this.notifyUpdated(ref)
  }

  async unset(ref) {
    const result = await this.bridge.request('unset', ref)
    if (result.changed !== false) this.notifyUpdated(ref)
  }

  // DSH V4 adds plugin-owned credential records beside the existing reference
  // API. The candidate needs this for the browser-auth nonce, but it must not
  // fall back to DSH's file-backed provider.  Records are therefore bounded to
  // this provider process; durable plugin-owned records need a later explicit
  // safeStorage protocol extension.
  async readRecord(key) { return this.records.get(String(key)) }

  async describeRecord(key) {
    const current = this.records.get(String(key))
    return current === undefined ? { configured: false, writable: true } : { configured: true, kind: current.kind, writable: true }
  }

  async listRecords() { return [...this.records.entries()].map(([key, record]) => ({ key, kind: record.kind })) }

  async modifyRecord(key, mutate) {
    const name = String(key)
    const next = await mutate(this.records.get(name))
    if (next !== undefined) {
      this.records.set(name, next)
      this.notifyRecordUpdated(key)
    }
    return next ?? this.records.get(name)
  }

  async deleteRecord(key) {
    if (this.records.delete(String(key))) this.notifyRecordUpdated(key)
  }
}

/** Cordis 组合入口：profile patch 关闭 `dsh-credentials-local` 后，只挂这个 provider。 */
export function apply(ctx) {
  return ctx.plugin(WeftMateCredentialProvider)
}

export default WeftMateCredentialProvider
