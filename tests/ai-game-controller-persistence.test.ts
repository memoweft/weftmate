import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ensureAiGameOwnerIds, AI_GAME_PRINCIPAL_REF, AI_GAME_CONTROLLER_REF } from '../src/managed-ai-game-runtime.mjs'

const principal = 'WEFTMATE_AI_GAME_PRINCIPAL_ID'
const controller = 'WEFTMATE_AI_GAME_CONTROLLER_ID'
function fixture(t, initial: Array<[string, unknown]> = []) {
  const values = new Map(initial), calls: unknown[][] = [], logs: unknown[][] = []
  const before = JSON.stringify(process.env)
  for (const level of ['log', 'warn', 'error'] as const) t.mock.method(console, level, (...args) => { logs.push(args) })
  let generated = 0
  const store = {
    getCredential(ref: string) { calls.push(['get', ref]); return values.get(ref) },
    saveCredential(ref: string, value: string) { calls.push(['save', ref, value]); values.set(ref, value) },
  }
  return { values, calls, store, generate() { generated++; calls.push(['generate']); return '12345678-1234-4234-8234-123456789abc' },
    verifyPrivate() {
      assert.equal(JSON.stringify(process.env) === before, true, 'owner initialization must not alter the environment')
      assert.equal(logs.length, 0, 'owner initialization must not log IDs or storage failures')
      return generated
    } }
}

describe('AI-Game installation owner persistence', () => {
  test('reads both saved IDs and keeps them across initialization without generating or saving', t => {
    const f = fixture(t, [[principal, 'synthetic-existing-principal'], [controller, 'synthetic-existing-controller']])
    assert.equal(AI_GAME_PRINCIPAL_REF, principal); assert.equal(AI_GAME_CONTROLLER_REF, controller)
    for (let startup = 0; startup < 2; startup++) ensureAiGameOwnerIds(f.store, f.generate)
    assert.deepEqual(f.calls, [['get', principal], ['get', controller], ['get', principal], ['get', controller]])
    assert.equal(f.values.get(principal), 'synthetic-existing-principal')
    assert.equal(f.values.get(controller), 'synthetic-existing-controller')
    assert.equal(f.verifyPrivate(), 0)
  })
  test('reads each missing ID before generating and persists both with their original prefixes', t => {
    const f = fixture(t)
    ensureAiGameOwnerIds(f.store, f.generate)
    assert.deepEqual(f.calls, [
      ['get', principal], ['generate'], ['save', principal, 'principal_12345678123442348234123456789abc'],
      ['get', controller], ['generate'], ['save', controller, 'controller_12345678123442348234123456789abc'],
    ])
    ensureAiGameOwnerIds(f.store, f.generate)
    assert.deepEqual(f.calls.slice(-2), [['get', principal], ['get', controller]])
    assert.equal(f.verifyPrivate(), 2)
  })
  for (const invalid of [null, '', 'invalid owner!', 'x'.repeat(257)]) test(`replaces an invalid controller only (${JSON.stringify(invalid)?.slice(0, 24)})`, t => {
    const f = fixture(t, [[principal, 'synthetic-saved-principal'], [controller, invalid]])
    ensureAiGameOwnerIds(f.store, f.generate)
    assert.deepEqual(f.calls.slice(0, 3), [['get', principal], ['get', controller], ['generate']])
    assert.equal(f.values.get(principal), 'synthetic-saved-principal')
    assert.equal(f.values.get(controller), 'controller_12345678123442348234123456789abc')
    assert.equal(f.verifyPrivate(), 1)
  })
  for (const phase of ['read', 'save']) test(`${phase} failure does not retry, initialize the other ID, or export details`, t => {
    const f = fixture(t), failure = Error('synthetic-private-identity')
    const store = { ...f.store,
      ...(phase === 'read' ? { getCredential(ref: string) { f.calls.push(['get', ref]); throw failure } }
        : { saveCredential(ref: string) { f.calls.push(['save', ref]); throw failure } }),
    }
    assert.throws(() => ensureAiGameOwnerIds(store, f.generate), error => error === failure)
    assert.equal(f.calls.some(call => call[1] === controller), false)
    assert.equal(f.verifyPrivate(), phase === 'read' ? 0 : 1)
  })
})
