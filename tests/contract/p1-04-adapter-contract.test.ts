import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { contractDir, isolatedEnv, loadPin, resolveCheckout, runNode } from './support/checkout.ts'

test('P1-04 exact-pin adapter contract L2（workspace/model/permission）', { timeout: 180_000 }, async () => {
  const checkout = await resolveCheckout(await loadPin()); const env = isolatedEnv(join(tmpdir(), 'weftmate-p1-04-l2-home')); env.WEFTMATE_CHECKOUT = checkout
  const result = await runNode({ args: ['--import', 'tsx/esm', join(contractDir, 'fixtures', 'p1-04-c-adapter-contract.mts')], cwd: checkout, env, timeoutMs: 150_000 })
  assert.equal(result.timedOut, false, result.stderr.slice(-2000)); assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`)
  const match = /\[p1-04\] EVIDENCE (.*)/.exec(result.stdout); assert.ok(match, result.stdout.slice(-2000)); const evidence = JSON.parse(match[1])
  // workspace：create 幂等解析 + 未知 id rename 404。
  assert.equal(evidence.workspace.createIdempotentResolved, true); assert.equal(evidence.workspace.notFound404, true)
  // model：宿主目录含 replay provider；会话选择写回一致。
  assert.ok(evidence.models.groups >= 1); assert.equal(evidence.models.selectedProvider, 'deepseek-official')
  // permission：命名空间已注册，revision 单调。
  assert.equal(evidence.permission.revisionBefore !== null, true); assert.ok(evidence.permission.revisionAfter >= evidence.permission.revisionBefore)
})
