import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { contractDir, isolatedEnv, loadPin, resolveCheckout, runNode } from './support/checkout.ts'

test('P1-03 exact-pin Gateway-only fake-model L2（strict-C）', { timeout: 180_000 }, async () => {
  const checkout = await resolveCheckout(await loadPin()); const env = isolatedEnv(join(tmpdir(), 'weftmate-p1-03-l2-home')); env.WEFTMATE_CHECKOUT = checkout
  const result = await runNode({ args: ['--import', 'tsx/esm', join(contractDir, 'fixtures', 'p1-03-c-gateway-clean-pin.mts')], cwd: checkout, env, timeoutMs: 150_000 })
  assert.equal(result.timedOut, false, result.stderr.slice(-2000)); assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`)
  const match = /\[p1-03-c\] EVIDENCE (.*)/.exec(result.stdout); assert.ok(match, result.stdout.slice(-2000)); const evidence = JSON.parse(match[1])
  // create -> send -> assistant.delta(>=1) -> assistant.completed，经 /weftmate/api/v1 全程。
  assert.ok(evidence.deltaCount >= 1); assert.ok(evidence.eventTypes.includes('assistant.completed'))
  // 工具链路：tool.started -> tool.completed。
  assert.equal(evidence.toolStarted.length >= 1, true); assert.ok(evidence.toolOutcomes.some((o: { type: string }) => o.type === 'tool.completed'))
  // 回合唯一终态：正常完成 -> turn.stopped{reason:'completed'}。
  assert.equal(evidence.turnStopReason, 'completed')
  // 会话落盘 + replay 全量消费。
  assert.equal(evidence.archiveExists, true); assert.equal(evidence.replayConsumed, true)
})
