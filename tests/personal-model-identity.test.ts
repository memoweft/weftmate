import assert from 'node:assert/strict'
import test from 'node:test'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'

test('host model directory exposes only an exact comparable public route identity', () => {
  const backend = createPersonalAccessBackend({
    currentOrigin: () => null, referenceScan: () => ({ state: 'pending' }),
    profiles: () => [
      { id: 'mimo-cloud', name: 'MiMo cloud', model: 'mimo-v2.6-flash',
        baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'synthetic-marker' },
      { id: 'local-qwen', name: 'Qwen local', model: 'qwen', baseUrl: 'http://127.0.0.1:8081/v1' },
    ],
    hasCredential: () => true,
  } as any)
  const models = backend.listModels()
  assert.equal(models[0].routeFingerprint,
    '309411cbfe27ae5fcc8816d24c68b8fd594599c0b50b0e064207ac9c9d65aa60')
  assert.equal(models[1].routeFingerprint, null)
  assert.equal(JSON.stringify(models).includes('api.xiaomimimo.com'), false)
  assert.equal(JSON.stringify(models).includes('synthetic-marker'), false)
})
