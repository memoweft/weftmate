import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { parseWebUrlLine, redactWebToken, writeWebProfile } from '../src/dsh-web-runtime.ts'

test('keeps the alpha web token for the browser origin', () => {
  assert.equal(
    parseWebUrlLine('dsh web: http://127.0.0.1:40123/?token=ephemeral-token'),
    'http://127.0.0.1:40123/?token=ephemeral-token',
  )
})

test('alpha candidate declares only official session API and stable Weave slots', async () => {
  const host = await readFile(join(process.cwd(), 'src', 'plugins', 'weftmate-alpha2-host.mjs'), 'utf8')
  const client = await readFile(join(process.cwd(), 'src', 'plugins', 'weftmate-alpha2-client', 'client.js'), 'utf8')
  assert.match(host, /api: '\/api'/)
  assert.match(host, /official-sessionController/)
  assert.match(host, /typertGateway/)
  assert.match(host, /sessionController/)
  assert.match(host, /permissionPresets/)
  assert.match(host, /connection\.fetch\.register/)
  assert.match(host, /path: '\/api\/weftmate\/status'/)
  assert.doesNotMatch(host, /webServer\.register/)
  assert.match(host, /weftmateAlpha2Runtime/)
  assert.match(client, /data-weftmate-alpha2-weave-view/)
  assert.match(client, /conversation\.input\.dock/)
  assert.match(client, /shell\.overlay/)
  assert.doesNotMatch(client, /conversation\.details\.supplement/)
})

test('redacts a browser token only for user-visible diagnostics', () => {
  const origin = 'http://127.0.0.1:40123/?token=ephemeral-token&view=chat'
  assert.equal(redactWebToken(origin), 'http://127.0.0.1:40123/?token=[redacted]&view=chat')
  assert.match(origin, /token=ephemeral-token/, 'the caller retains the actual URL for the authenticated request')
})

test('alpha candidate profile writes only V4-compatible WeftMate seams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha-profile-'))
  try {
    const result = await writeWebProfile(join(root, 'dsh-home'), 'weftmate-alpha2', undefined, 'alpha2')
    assert.equal(result, 'created')
    const profile = join(root, 'dsh-home', 'profiles', 'weftmate-alpha2')
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /weftmate-alpha2-host/)
    assert.match(patch, /weftmate-alpha2-safe-credentials/)
    assert.match(patch, /- id: credentials\n  disabled: true/)
    assert.match(patch, /@weftmate\/alpha2-client/)
    assert.equal(existsSync(join(profile, 'plugins', 'weftmate-alpha2-host.mjs')), true)
    assert.equal(existsSync(join(profile, 'plugins', 'weftmate-alpha2-session-bridge.mjs')), true)
    assert.equal(existsSync(join(profile, 'plugins', 'weftmate-credentials.mjs')), true)
    assert.equal(existsSync(join(profile, 'node_modules', '@weftmate', 'alpha2-client', 'client.js')), true)
    const client = await readFile(join(profile, 'node_modules', '@weftmate', 'alpha2-client', 'client.js'), 'utf8')
    assert.match(client, /data-weftmate-alpha2-weave-view/)
    assert.match(client, /shell\.overlay/)
    assert.equal(existsSync(join(root, 'dsh-home', '.agent-presets')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
