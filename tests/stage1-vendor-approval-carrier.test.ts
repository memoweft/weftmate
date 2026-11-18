import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createTypertAdapterClient } from '../src/runtime/dsh-adapter/typert-client.mjs'

const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href

describe('阶段 1 真实 vendor approval response carrier', () => {
  it('rejected 和 allowed-once 均通过 DSH 的真实 approval + Typert respond schema，并拒绝缺失 discriminant 的旧形状', async () => {
    const [{ Context }, { default: SystemPrompt }, { default: Sessions }, { default: SessionProjections }, { default: Approval }] = await Promise.all([
      import(vendor('cordis')), import(vendor('dsh-system-prompt')), import(vendor('dsh-session')),
      import(vendor('dsh-session-projection')), import(vendor('dsh-user-approval')),
    ])
    const ctx = new Context() as any
    ctx.typertGateway = { async invoke(req: any) { return req.method === 'list' ? { items: [] } : {} } }
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Sessions)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(Approval, { policy: 'ask' })
    const session = ctx.sessions.create('session-1')
    session.append('turn/start', { turn: 1 })
    const agent = { id: 'session-1', session }
    const client = createTypertAdapterClient(ctx)
    const asked: any[] = []
    const streamAbort = new AbortController()
    const stream = client.events.mux({}, streamAbort.signal)
    const reader = (async () => {
      for await (const frame of stream) {
        if (frame.payload?.type === 'approval/requested') asked.push({ rpcId: frame.rpcId, ...frame.payload })
      }
    })().catch(() => {})
    try {
      for (const outcome of ['rejected', 'allowed-once'] as const) {
        const pending = ctx.approval.request({ agent, toolName: 'pwsh', callId: `call-${outcome}`, reason: 'test' })
        for (let i = 0; i < 20 && asked.length === 0; i++) await new Promise((r) => setImmediate(r))
        const req = asked.pop()
        assert.ok(req, `expected approval/request for ${outcome}`)
        const legacyReceipt = await client.respond({
          rpcId: req.rpcId,
          result: { ok: true, value: { sessionId: 'session-1', approvalId: req.approvalId, outcome } },
        } as never)
        assert.deepEqual(legacyReceipt, { accepted: false, reason: 'bad-response' })
        const receipt = await client.respond({
          type: 'client-response',
          rpcId: req.rpcId,
          result: { ok: true, value: { sessionId: 'session-1', approvalId: req.approvalId, outcome } },
        })
        assert.deepEqual(receipt, { accepted: true })
        assert.equal(await pending, outcome)
      }
    } finally {
      streamAbort.abort()
      await reader
      await ctx.fiber.dispose()
    }
  })
})
