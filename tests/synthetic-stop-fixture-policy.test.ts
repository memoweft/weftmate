import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { syntheticStopFixtureRoute } from '../src/synthetic-stop-fixture-policy.mjs'

test('synthetic model route requires opt-in isolated profile and exact loopback URL', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-'))
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const frame = { type: 'weftmate:manage', requestId: 'request-1',
    action: 'model.configure-synthetic-stop-fixture', baseUrl: 'http://127.0.0.1:43123/v1' }
  try {
    assert.equal(syntheticStopFixtureRoute(frame, { enabled: false, profile }), null)
    assert.deepEqual(syntheticStopFixtureRoute(frame, { enabled: true, profile }),
      { baseUrl: frame.baseUrl })
    for (const baseUrl of ['https://127.0.0.1:43123/v1', 'http://localhost:43123/v1',
      'http://127.0.0.2:43123/v1', 'http://user@127.0.0.1:43123/v1',
      'http://127.0.0.1:43123/v1?redirect=https://example.com',
      'http://127.0.0.1:43123/v1#fragment', 'http://127.0.0.1:43123/v1/',
      'http://127.0.0.1:0/v1', 'http://127.0.0.1:99999/v1']) {
      assert.equal(syntheticStopFixtureRoute({ ...frame, baseUrl }, { enabled: true, profile }), null,
        `must refuse ${baseUrl}`)
    }
    assert.equal(syntheticStopFixtureRoute({ ...frame, apiKey: 'secret' }, { enabled: true, profile }), null)
    assert.equal(syntheticStopFixtureRoute(frame, { enabled: true, profile: tmpdir() }), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
