import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { contractDir, isolatedEnv, loadPin, resolveCheckout, runNode } from './support/checkout.ts'

test('P1-05 exact-pin diagnostics L2（pin/health/paths/last-errors）', { timeout: 180_000 }, async () => {
  const checkout = await resolveCheckout(await loadPin()); const env = isolatedEnv(join(tmpdir(), 'weftmate-p1-05-l2-home')); env.WEFTMATE_CHECKOUT = checkout
  const result = await runNode({ args: ['--import', 'tsx/esm', join(contractDir, 'fixtures', 'p1-05-c-diagnostics.mts')], cwd: checkout, env, timeoutMs: 150_000 })
  assert.equal(result.timedOut, false, result.stderr.slice(-2000)); assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`)
  const match = /\[p1-05\] EVIDENCE (.*)/.exec(result.stdout); assert.ok(match, result.stdout.slice(-2000)); const evidence = JSON.parse(match[1])
  // pin 准确：commit 如实上报；占位版本（0.0.1）使身份确认如实降级为 false。
  assert.equal(evidence.pinReported, (await loadPin()).commit); assert.equal(evidence.pinnedDowngradedAsDesigned, true)
  // 错误环：注错后进环且只有 at/code/digest；state 转 degraded。
  assert.equal(evidence.ringRecorded, true); assert.equal(evidence.stateAfterError, 'degraded')
})
