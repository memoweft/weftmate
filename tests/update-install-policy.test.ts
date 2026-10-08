import assert from 'node:assert/strict'
import test from 'node:test'
import { installPreparedUpdate } from '../src/update-policy.ts'
test('explicit native install waits for an idle host and a successful pre-upgrade backup', async () => {
  const calls: string[] = []
  const input = { ready: () => true, idle: async () => { calls.push('idle'); return true },
    beforeInstall: async () => { calls.push('backup') }, install: () => { calls.push('install'); return true } }
  assert.equal(await installPreparedUpdate(input), true)
  assert.deepEqual(calls, ['idle', 'backup', 'idle', 'install'])
  calls.length = 0
  assert.equal(await installPreparedUpdate({ ...input, idle: async () => false }), false)
  assert.deepEqual(calls, [])
  assert.equal(await installPreparedUpdate({ ...input, beforeInstall: async () => { throw new Error('backup failed') } }), false)
  assert.deepEqual(calls, ['idle'])
  calls.length = 0; let idle = true
  assert.equal(await installPreparedUpdate({ ...input, idle: async () => idle, beforeInstall: async () => { idle = false } }), false)
  assert.deepEqual(calls, [])
})
