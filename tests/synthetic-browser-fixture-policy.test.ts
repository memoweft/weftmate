import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { syntheticBrowserFixtureSettings } from '../src/synthetic-browser-fixture-policy.mjs'

test('browser fixture DNS is restricted to one named Temp profile, owned port and two hosts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage11-'))
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const env = { WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', WEFTMATE_DOGFOOD_CONTROL: '1',
    WEFTMATE_SYNTHETIC_BROWSER_PORT: '43129' }
  try {
    assert.deepEqual(syntheticBrowserFixtureSettings({}, profile), {})
    const configured = syntheticBrowserFixtureSettings(env, profile)
    assert.deepEqual(configured.syntheticFixture, { hostnameSuffix: '.weftmate.invalid', allowedPort: 43129 })
    assert.deepEqual(await configured.resolver('page-a.weftmate.invalid'), [{ address: '127.0.0.1', family: 4 }])
    assert.deepEqual(await configured.resolver('page-b.weftmate.invalid'), [{ address: '127.0.0.1', family: 4 }])
    await assert.rejects(configured.resolver('other.weftmate.invalid'))
    await assert.rejects(configured.resolver('localhost'))
    for (const port of ['18186', '18188', '443', '8443', '8080', '8081', '0', '65536']) {
      assert.throws(() => syntheticBrowserFixtureSettings({ ...env,
        WEFTMATE_SYNTHETIC_BROWSER_PORT: port }, profile))
    }
    assert.throws(() => syntheticBrowserFixtureSettings({ ...env, WEFTMATE_DOGFOOD_CONTROL: '0' }, profile))
    assert.throws(() => syntheticBrowserFixtureSettings({ ...env, WEFTMATE_SYNTHETIC_STOP_FIXTURE: '0' }, profile))
    assert.throws(() => syntheticBrowserFixtureSettings(env, tmpdir()))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
