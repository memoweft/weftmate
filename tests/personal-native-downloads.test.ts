import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [], preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }: { sessionId: string }) => ({ sessionId }),
  sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }: { afterSeq: number }) =>
    ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null,
}

test('authenticated macOS manifest and DMG use only verified published bytes', async () => {
  const base = mkdtempSync(join(tmpdir(), 'personal-native-downloads-'))
  const root = join(base, 'profile')
  const androidBytes = Buffer.from('synthetic Android package')
  const androidPath = join(base, 'android-candidate.apk')
  writeFileSync(androidPath, androidBytes)
  const service = await createPersonalAccessService({ root, port: 0, backend,
    androidPackagePath: androidPath })
  try {
    const { origin } = await service.start()
    const manifestPath = '/personal/v1/native/manifest'
    const response = await fetch(`${origin}${manifestPath}`)
    assert.equal(response.status, 401)
    const grant = await service.issueSetupGrant()
    const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'NativeTester',
        password: 'synthetic native package password', deviceName: 'Mac test' }) })
    assert.equal(setup.status, 201)
    const account = await setup.json()
    const auth = { cookie: setup.headers.get('set-cookie')!.split(';')[0] }
    const get = (route: string) => fetch(`${origin}${route}`, { headers: auth })
    assert.deepEqual(await (await get(manifestPath)).json(), { schemaVersion: 1, macos: null })
    assert.equal((await get(`/personal/v1/downloads/native/macos/${'0'.repeat(64)}`)).status, 404)

    const directory = join(root, 'native-downloads')
    mkdirSync(directory)
    const bytes = Buffer.from('synthetic macOS disk image with verifiable package bytes')
    const hash = sha256(bytes)
    const release = { version: '0.1.0', build: '1', bytes: bytes.length, sha256: hash,
      architecture: 'universal', channel: 'trial', notes: 'Mac trial build',
      fileName: `WeftMate-${hash}.dmg` }
    const writeManifest = (item: object) => writeFileSync(join(directory, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, macos: item }))
    writeFileSync(join(directory, release.fileName), bytes)
    writeManifest(release)
    const published = await (await get(manifestPath)).json()
    assert.deepEqual(published, { schemaVersion: 1, macos: { ...release,
      downloadUrl: `/personal/v1/downloads/native/macos/${hash}` } })
    assert.equal(JSON.stringify(published).includes(base), false, 'manifest does not expose local paths')
    const anonymous = await fetch(`${origin}${published.macos.downloadUrl}`)
    assert.equal(anonymous.status, 401)
    const downloaded = await get(published.macos.downloadUrl)
    assert.equal(downloaded.status, 200)
    assert.equal(downloaded.headers.get('content-length'), String(bytes.length))
    assert.equal(downloaded.headers.get('content-type'), 'application/x-apple-diskimage')
    assert.equal(downloaded.headers.get('content-disposition'),
      'attachment; filename="WeftMate-Mac-0.1.0-build1.dmg"')
    assert.equal(sha256(Buffer.from(await downloaded.arrayBuffer())), hash)
    assert.equal((await get(`/personal/v1/downloads/native/macos/${'f'.repeat(64)}`)).status, 404)
    writeFileSync(join(directory, `${'f'.repeat(64)}.dmg`), Buffer.from('not published'))
    assert.equal((await get(`/personal/v1/downloads/native/macos/${'f'.repeat(64)}`)).status, 404)
    assert.equal((await get('/personal/v1/downloads/native/macos/../manifest.json')).status, 404)

    const oldAndroid = await get('/personal/v1/downloads/android')
    assert.equal(oldAndroid.status, 200)
    assert.deepEqual(Buffer.from(await oldAndroid.arrayBuffer()), androidBytes)

    writeFileSync(join(directory, release.fileName), Buffer.from('x'.repeat(bytes.length)))
    assert.deepEqual(await (await get(manifestPath)).json(), { schemaVersion: 1, macos: null })
    assert.equal((await get(published.macos.downloadUrl)).status, 404)
    rmSync(join(directory, release.fileName))
    assert.deepEqual(await (await get(manifestPath)).json(), { schemaVersion: 1, macos: null })
    writeManifest({ ...release, fileName: '../outside.dmg' })
    writeFileSync(join(root, 'outside.dmg'), bytes)
    assert.deepEqual(await (await get(manifestPath)).json(), { schemaVersion: 1, macos: null })
    assert.equal((await get(published.macos.downloadUrl)).status, 404)
    writeManifest({ ...release, fileName: 'WeftMate-unhashed.dmg' })
    assert.deepEqual(await (await get(manifestPath)).json(), { schemaVersion: 1, macos: null })

    const secondBytes = Buffer.from('second synthetic macOS package')
    const secondHash = sha256(secondBytes)
    const second = { ...release, build: '2', bytes: secondBytes.length, sha256: secondHash,
      fileName: `WeftMate-${secondHash}.dmg` }
    writeFileSync(join(directory, second.fileName), secondBytes)
    writeManifest(second)
    assert.equal((await get(published.macos.downloadUrl)).status, 404,
      'an older hash cannot silently resolve to a replacement package')
    assert.equal(sha256(Buffer.from(await (await get(`/personal/v1/downloads/native/macos/${secondHash}`))
      .arrayBuffer())), secondHash)

    const revoke = await fetch(`${origin}/personal/v1/auth/devices/${account.device.id}`,
      { method: 'DELETE', headers: { ...auth, origin,
        'x-weftmate-csrf': account.csrfToken } })
    assert.equal(revoke.status, 200)
    assert.equal((await get(manifestPath)).status, 401)
    assert.equal((await get(`/personal/v1/downloads/native/macos/${secondHash}`)).status, 401)
  } finally { await service.close(); rmSync(base, { recursive: true, force: true }) }
})
