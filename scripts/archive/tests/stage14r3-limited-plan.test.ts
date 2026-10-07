import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveLimited8kPlan } from '../stage14r3-limited-plan.mjs'

test('8K review plan changes only two runtime limits and does not claim daily chat compatibility', () => {
  const argv = ['C:\\Synthetic\\ninfer-serve.exe', 'C:\\Synthetic\\model.ninfer',
    '--host', '127.0.0.1', '--port', '8080', '--model-id', 'qwen3.8-27b',
    '--max-context', '110592', '--kv-capacity', '110592', '--kv-dtype', 'rk8v4',
    '--max-concurrency', '1', '--max-pending-requests', '8', '--prefill-chunk', '512',
    '--vision', '--spec', 'mtp', '--draft-tokens', '3', '--lm-head-draft']
  const manifest = { original: { pid: 25644, sessionId: 0, exe: argv[0], argv },
    expectedConfigSha256: 'a'.repeat(64) }
  const plan = deriveLimited8kPlan(manifest)
  assert.equal(plan.executable, false)
  assert.deepEqual(plan.changes.map((item) => [item.flag, item.from, item.to]), [
    ['--max-context', '110592', '8192'], ['--kv-capacity', '110592', '8192'],
  ])
  assert.deepEqual(plan.limitedArgv.filter((item) => item.startsWith('--spec') ||
    item.startsWith('--draft') || item.startsWith('--lm-head')),
  ['--spec', '--draft-tokens', '--lm-head-draft'])
  assert.equal(plan.compatibility.dailyConversationReadyProven, false)
  assert.equal(plan.compatibility.configuredDshMaxTokens, 32768)
  assert.equal(argv[9], '110592', 'the source command remains unchanged')
  assert.throws(() => deriveLimited8kPlan({ ...manifest, original: {
    ...manifest.original, argv: [...argv, '--unknown'],
  } }), /ORIGINAL_ARGV_UNVERIFIED/)
})
