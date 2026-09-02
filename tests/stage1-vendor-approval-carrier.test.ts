import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const vendorApiProxy = new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js', import.meta.url)

describe('阶段 1 真实 vendor approval response carrier', () => {
  it('rejected 和 allowed-once 均通过 DSH 的真实 /api/respond schema，并拒绝缺失 discriminant 的旧形状', async () => {
    const { InProcessApiClient, toFetchHandler } = await import(vendorApiProxy.href)
    const accepted: unknown[] = []
    const client = new InProcessApiClient(toFetchHandler({
      respond: async (message: unknown) => {
        accepted.push(message)
        return { accepted: true }
      },
    }))

    for (const outcome of ['rejected', 'allowed-once']) {
      const receipt = await client.respond({
        type: 'client-response',
        rpcId: `rpc-${outcome}`,
        result: { ok: true, value: { sessionId: 'session-1', approvalId: `approval-${outcome}`, outcome } },
      })
      assert.deepEqual(receipt, { accepted: true })
    }

    const legacyReceipt = await client.respond({
      rpcId: 'legacy-rpc',
      result: { ok: true, value: { sessionId: 'session-1', approvalId: 'approval-legacy', outcome: 'rejected' } },
    } as never)
    assert.deepEqual(legacyReceipt, { accepted: false, reason: 'bad-response' })
    assert.deepEqual(accepted, [
      { type: 'client-response', rpcId: 'rpc-rejected', result: { ok: true, value: { sessionId: 'session-1', approvalId: 'approval-rejected', outcome: 'rejected' } } },
      { type: 'client-response', rpcId: 'rpc-allowed-once', result: { ok: true, value: { sessionId: 'session-1', approvalId: 'approval-allowed-once', outcome: 'allowed-once' } } },
    ])
  })
})
