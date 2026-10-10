import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

test('browser memory identity is verified only after an authenticated current-host response', async () => {
  let owner = 'owner-A', authorized = true
  const requests: Array<{ path: string; credentials: string }> = []
  const context: any = { URLSearchParams, fetch: async (path: string, options: any) => {
    requests.push({ path, credentials: options.credentials })
    return { ok: authorized, status: authorized ? 200 : 401, json: async () => authorized
      ? { account: { ownerId: owner, username: owner }, device: { id: `device-${owner}` } }
      : { error: { code: 'UNAUTHORIZED' } } }
  } }
  runInNewContext(readFileSync(new URL('../src/ui-core/store.js', import.meta.url), 'utf8') + '\n' +
    readFileSync(new URL('../src/ui-core/adapters/mobile-web.js', import.meta.url), 'utf8'), context)
  const bridge = context.WeftUiCore.createMobileWebBridge()
  const first = await bridge.call('auth.me')
  assert.equal(first.connectionVerified, true)
  assert.equal(first.owner, 'owner-A')
  assert.equal(first.deviceId, 'device-owner-A')
  owner = 'owner-B'
  assert.equal((await bridge.call('auth.me')).owner, 'owner-B', 'account changes are rechecked against the current cookie')
  authorized = false
  await assert.rejects(bridge.call('auth.me'), { message: 'UNAUTHORIZED', status: 401 })
  assert.deepEqual(requests, Array.from({ length: 3 }, () => ({ path: '/personal/v1/auth/me', credentials: 'same-origin' })))
})
