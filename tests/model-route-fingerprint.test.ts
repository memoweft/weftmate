import assert from 'node:assert/strict'
import test from 'node:test'
import { modelRouteFingerprint } from '../src/model-route-fingerprint.mjs'

const official = '309411cbfe27ae5fcc8816d24c68b8fd594599c0b50b0e064207ac9c9d65aa60'

test('public actual request route matches its base URL spelling and exact actual model ID', () => {
  assert.equal(modelRouteFingerprint('https://api.xiaomimimo.com/v1/chat/completions',
    'mimo-v2.6-flash'), official)
  assert.equal(modelRouteFingerprint('https://API.XIAOMIMIMO.COM:443/v1/',
    'mimo-v2.6-flash'), official)
  assert.notEqual(modelRouteFingerprint('https://api.xiaomimimo.com/v1',
    'MiMo-V2.6-Flash'), official, 'model IDs stay case-sensitive')
})

test('device-local, private and malformed routes cannot authorize cross-device matching', () => {
  for (const route of ['http://127.0.0.1:55351/v1', 'http://192.168.1.4/v1',
    'http://model.local/v1', 'https://localhost/v1', 'https://example.invalid/v1',
    'https://user:secret@api.xiaomimimo.com/v1',
    'https://api.xiaomimimo.com/v1?key=secret']) {
    assert.equal(modelRouteFingerprint(route, 'mimo-v2.6-flash'), null)
  }
})
