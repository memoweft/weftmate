import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { createDiagnostics } from '../src/runtime/gateway/diagnostics.mjs'
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs'

const okDescribe = (value: unknown) => ({ result: { ok: true as const, value } })

function deps(overrides: Partial<Parameters<typeof createDiagnostics>[0]> = {}) {
  return {
    client: { host: { describe: async () => okDescribe({ version: '0.1.0-rc.5', cwd: '/tmp/host-cwd', attachedSessions: 2, canOpenPath: true }) } },
    runtime: { version: '0.1.0-dev', startedAt: Date.now() },
    paths: { dshHome: '/tmp/dsh-home', statePath: '/tmp/state.json' },
    pin: '47f943859bef60e4160492346772ded9b24f765a',
    dshRuntimeVersion: '0.1.0-rc.5',
    ...overrides,
  }
}

describe('P1-05 · Gateway diagnostics', () => {
  it('snapshot：running 态产出 HealthPayload 同形结构，版本匹配时 pinned=true', async () => {
    const diag = createDiagnostics(deps())
    const snap = await diag.snapshot()
    assert.equal(snap.runtime.state, 'running')
    assert.equal(snap.dsh.pinned, true)
    assert.equal(snap.sessions.active, 2)
    assert.equal(snap.app.name, 'weftmate')
    assert.equal(snap.gateway.protocolVersion, 1)
    assert.match(snap.gateway.startedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(snap.memory.available, false)
    assert.equal(snap.update.status, 'unknown')
    assert.equal(snap.paths.dshHome, '/tmp/dsh-home')
    assert.deepEqual(snap.lastErrors, [])
  })

  it('host.describe 被拒（DSH 死亡）→ state=stopped、host=null —— kill/restart 的准确反映点', async () => {
    const diag = createDiagnostics(deps({ client: { host: { describe: async () => { throw new Error('dead') } } } }))
    const snap = await diag.snapshot()
    assert.equal(snap.runtime.state, 'stopped')
    assert.equal(snap.host, null)
    assert.equal(snap.dsh.pinned, false)
  })

  it('lastErrors 环形上限 20；窗口内错误把 state 压成 degraded，零窗实例保持 running', async () => {
    const diag = createDiagnostics(deps())
    for (let i = 0; i < 25; i += 1) diag.recordError('session-not-found', `digest-${i}`)
    const ring = diag.lastErrorsSnapshot()
    assert.equal(ring.length, 20)
    assert.equal(ring[0].digest, 'digest-5') // 最旧的 5 条被挤出
    assert.equal(Object.keys(ring[0]).sort().join(','), 'at,code,digest') // 红字：只有 code+digest(+at)
    const snap = await diag.snapshot()
    assert.equal(snap.runtime.state, 'degraded')
    // 零降级窗（部署可配）→ 有错也不压态。
    const strict = createDiagnostics(deps({ degradedWindowMs: 0 }))
    strict.recordError('internal', 'd')
    assert.equal((await strict.snapshot()).runtime.state, 'running')
  })

  it('重启新鲜度：新实例不继承旧错误，startedAt 各随其组合注入', async () => {
    const first = createDiagnostics(deps({ runtime: { version: 'v', startedAt: 1_000_000 } }))
    first.recordError('internal', 'd1')
    const second = createDiagnostics(deps({ runtime: { version: 'v', startedAt: 2_000_000 } }))
    assert.equal(second.lastErrorsSnapshot().length, 0)
    const snap1 = await first.snapshot(); const snap2 = await second.snapshot()
    assert.equal(snap1.gateway.startedAt, new Date(1_000_000).toISOString())
    assert.equal(snap2.gateway.startedAt, new Date(2_000_000).toISOString())
    assert.notEqual(snap1.gateway.startedAt, snap2.gateway.startedAt)
  })

  it('路由：注入依赖后 /diagnostics|/paths|/last-errors 可用；未注入则 404；网关错误进环', async () => {
    async function serve(withDiag: boolean): Promise<{ base: string; close: () => Promise<void> }> {
      const gateway = createGatewayV1(withDiag
        ? { client: { sessions: {}, events: {}, workspace: {}, llm: {}, settings: {}, host: { describe: async () => okDescribe({ version: 'v', cwd: '/c', attachedSessions: 0 }) } }, diagnostics: deps() }
        : { client: { sessions: {}, events: {}, workspace: {}, llm: {}, settings: {}, host: { describe: async () => okDescribe({ version: 'v', cwd: '/c', attachedSessions: 0 }) } } })
      const server = createServer((req, res) => void gateway.handle(req, res))
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const port = (server.address() as any).port
      return { base: `http://127.0.0.1:${port}/weftmate/api/v1`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
    }
    const a = await serve(true)
    try {
      const health = await (await fetch(`${a.base}/diagnostics`)).json()
      assert.equal(health.runtime.state, 'running')
      await fetch(`${a.base}/sessions/ghost/messages`, { method: 'POST', body: '{}' }) // 404 → 进环
      const ring = await (await fetch(`${a.base}/last-errors`)).json()
      assert.equal(ring.items.length, 1); assert.equal(ring.items[0].code, 'session-not-found')
      const paths = await (await fetch(`${a.base}/paths`)).json()
      assert.equal(paths.dshHome, '/tmp/dsh-home')
    } finally { await a.close() }
    const b = await serve(false)
    try {
      const status = await fetch(`${b.base}/diagnostics`)
      assert.equal(status.status, 404)
    } finally { await b.close() }
  })

  it('缺受支持接缝时 fail loud', () => {
    assert.throws(() => createDiagnostics({} as never), TypeError)
  })
})
