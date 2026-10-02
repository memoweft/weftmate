import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { personalPublicOrigin } from '../src/host-mode.mjs'

test('public origin requires an exact HTTPS origin and explicit personal-host proxy trust', () => {
  const accepted = ['--public-origin=https://home.weftmate.com:8443', '--trust-loopback-proxy']
  assert.equal(personalPublicOrigin(accepted, true, 18187), 'https://home.weftmate.com:8443')
  for (const argv of [
    ['--public-origin=http://home.weftmate.com:8443', '--trust-loopback-proxy'],
    ['--public-origin=https://home.weftmate.com:8443/path', '--trust-loopback-proxy'],
    ['--public-origin=https://home.weftmate.com:8443'],
    ['--trust-loopback-proxy'],
  ]) assert.throws(() => personalPublicOrigin(argv, true, 18187))
  assert.throws(() => personalPublicOrigin(accepted, false, 18187))
  assert.throws(() => personalPublicOrigin(accepted, true, null))
})

test('launcher dry-run reports only an explicit public origin without starting Electron', () => {
  const result = spawnSync(process.execPath, ['scripts/run-personal-host.mjs', '--dry-run',
    '--user-data-dir', join(tmpdir(), 'weftmate-public-dry-run-never-created'),
    '--access-port', '18187', '--public-origin', 'https://home.weftmate.com:8443',
    '--trust-loopback-proxy'], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /publicOrigin=https:\/\/home\.weftmate\.com:8443/)
  assert.doesNotMatch(result.stdout, /Bearer|MODEL_SWITCH_UNIFIED_KEY/)
})

test('Android download candidate requires an explicit absolute fixed filename and personal access', () => {
  const base = ['scripts/run-personal-host.mjs', '--dry-run',
    '--user-data-dir', join(tmpdir(), 'weftmate-android-download-dry-run-never-created')]
  const candidate = join(tmpdir(), 'android-candidate.apk')
  const accepted = spawnSync(process.execPath, [...base, '--access-port', '18187',
    '--android-package-path', candidate], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /androidPackage=explicit-candidate/)
  assert.doesNotMatch(accepted.stdout, /android-candidate\.apk/)
  for (const args of [
    ['--access-port', '18187', '--android-package-path', 'android-candidate.apk'],
    ['--access-port', '18187', '--android-package-path', join(tmpdir(), 'unreviewed.apk')],
    ['--android-package-path', candidate],
  ]) {
    const refused = spawnSync(process.execPath, [...base, ...args], { cwd: process.cwd(), encoding: 'utf8' })
    assert.notEqual(refused.status, 0)
  }
})

test('mobile UI release directory is explicit, absolute and requires the personal listener', () => {
  const base = ['scripts/run-personal-host.mjs', '--dry-run',
    '--user-data-dir', join(tmpdir(), 'weftmate-mobile-ui-dry-run-never-created')]
  const releases = join(tmpdir(), 'synthetic-mobile-ui-releases')
  const accepted = spawnSync(process.execPath, [...base, '--access-port', '18187',
    '--mobile-ui-dir', releases], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /mobileUi=explicit-release-directory/)
  assert.doesNotMatch(accepted.stdout, /synthetic-mobile-ui-releases/)
  for (const args of [
    ['--mobile-ui-dir', releases],
    ['--access-port', '18187', '--mobile-ui-dir', 'relative-releases'],
  ]) {
    const refused = spawnSync(process.execPath, [...base, ...args], { cwd: process.cwd(), encoding: 'utf8' })
    assert.notEqual(refused.status, 0)
  }
})
