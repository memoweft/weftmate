import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { servePersonalAccessUi } from '../src/personal-access-ui/index.mjs'

test('public cloud configuration exposes no account data; binding status requires its own Cookie and direct local session', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-web-config-')))
  const host = await createPersonalAccessService({ root, port: 0, backend: { getStatus: async () => ({}), listModels: async () => [], preflight: async () => ({}),
      createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}),
      readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), describeSession: async () => null }, uiHandler: servePersonalAccessUi,
    cloudIdentity: { issuer: 'http://127.0.0.1:19379/personal/v1/cloud/oidc', allowInsecureLoopback: true, clientId: 'web-fixture' } })
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }) })
  const { origin, hostId } = await host.start()
  const configuration = await fetch(origin + '/personal/v1/cloud/config')
  assert.deepEqual(await configuration.json(), { issuer: 'http://127.0.0.1:19379/personal/v1/cloud/oidc', hostId, clientId: 'web-fixture' })
  assert.equal((await fetch(origin + '/personal/v1/cloud/binding')).status, 401)
  const grant = await host.issueSetupGrant()
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'synthetic-web', password: 'synthetic password 20 characters', deviceName: 'Computer' }) })
  assert.equal(setup.status, 201)
  const cookie = setup.headers.get('set-cookie')!.split(';')[0]
  const binding = await fetch(origin + '/personal/v1/cloud/binding', { headers: { cookie } })
  assert.deepEqual(await binding.json(), { status: 'unbound', canManage: true, hostId })
  const ui = await fetch(origin + '/personal/v1/ui/')
  assert.match(ui.headers.get('content-security-policy')!, /connect-src 'self' http:\/\/127\.0\.0\.1:19379 https: blob:;/)
  for (const asset of ['cloud-login.js', 'cloud-ui.js', 'cloud-vendor.js']) {
    const response = await fetch(origin + '/personal/v1/ui/' + asset)
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /javascript/)
  }
})
