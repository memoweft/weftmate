import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { keyId, sha256, signManifest } from '../src/personal-update/manifest.mjs'
import { UpdateStore } from '../src/personal-update/store.mjs'
import { packageRelease } from '../scripts/release/package.mjs'
import { verifyRelease } from '../scripts/release/verify.mjs'
import { verifyDownloadedApp } from '../src/personal-update/app-package.mjs'
import { publishMobileUi, validateMobileManifest } from '../src/personal-access/mobile-ui-release.mjs'

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'upd-1-unit-'))
  const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
  const trustedKeys = { [keyId(publicKey)]: publicKey }
  const content = new Map([['personal-access-ui/index.html', Buffer.from('<body>v1</body>')], ['personal-access-ui/app.js', Buffer.from('v1')]])
  let manifest: any, corrupt = false; let transferred = 0; const requests: string[] = []
  const server = createServer((req, res) => {
    if (req.url === '/manifest-ui.json') { res.end(JSON.stringify(manifest)); return }
    const name = req.url!.replace('/files/ui/current/', '')
    requests.push(name)
    const bytes = corrupt ? Buffer.from('bad') : content.get(name)
    if (!bytes) { res.writeHead(404); res.end(); return }
    transferred += bytes.length; res.end(bytes)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as any).port}/manifest-ui.json`
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }) })
  const options = { root: join(root, 'store'), trustedKeys, versions: { app: '0.1.0', host: '0.1.0', bridge: 1 } }
  const publish = (version: string) => { manifest = signManifest({ schemaVersion: 1, layer: 'ui', version, channel: 'stable',
    publishedAt: new Date().toISOString(), minAppVersion: '0.1.0', assetBase: './files/ui/current/',
    files: [...content].map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) })) }, privateKey); return manifest }
  return { root, privateKey, trustedKeys, publicKey, content, options, publish, url, requests, bytes: () => transferred,
    corrupt: () => { corrupt = true }, setManifest: (value: any) => { manifest = value } }
}
test('only changed files download; active version waits for idle, persists and rolls back a failed trial', async t => {
  const f = await fixture(t); const store = await new UpdateStore(f.options).init()
  f.publish('0.2.0'); await store.check(f.url)
  assert.equal(store.state.status, 'ready'); assert.equal(store.pointer.active, null)
  assert.equal(await store.activate({ idle: false }), false)
  await store.activate({ idle: true }); await store.healthy()
  const before = f.bytes(); f.requests.length = 0
  f.content.set('personal-access-ui/index.html', Buffer.from('<body>v2</body>'))
  f.publish('0.3.0'); await store.check(f.url)
  assert.deepEqual(f.requests, ['personal-access-ui/index.html'])
  assert.equal(f.bytes() - before, f.content.get('personal-access-ui/index.html')!.length)
  assert.equal(store.state.reusedBytes, 2)
  assert.equal((await store.resource('personal-access-ui/index.html')).toString(), '<body>v1</body>')
  await store.activate({ idle: true }); await store.healthy()
  f.content.set('personal-access-ui/app.js', Buffer.from('throw new Error("failed startup")'))
  f.publish('0.4.0'); await store.check(f.url); await store.activate({ idle: true })
  const restarted = await new UpdateStore(f.options).init()
  assert.equal(restarted.state.currentVersion, '0.3.0')
  assert.equal((await restarted.resource('personal-access-ui/index.html')).toString(), '<body>v2</body>')
  assert.equal(restarted.pointer.rejected.length, 1)
  await restarted.check(f.url); assert.equal(restarted.state.status, 'failed')
})
test('wrong signature, bad download and tampered installed files keep or restore the previous version', async t => {
  const f = await fixture(t); const store = await new UpdateStore(f.options).init()
  f.publish('0.2.0'); await store.check(f.url); await store.activate({ idle: true }); await store.healthy()
  const active = store.pointer.active
  f.content.set('personal-access-ui/app.js', Buffer.from('new app'))
  f.setManifest({ ...f.publish('0.3.0'), version: '0.4.0' }); await store.check(f.url)
  assert.equal(store.pointer.active, active); assert.equal(store.pointer.staged, null)
  f.publish('0.3.0'); f.corrupt(); await store.check(f.url)
  assert.equal(store.state.status, 'failed'); assert.equal(store.pointer.active, active)
  await writeFile(join(store.directory(active), 'personal-access-ui/app.js'), 'tampered')
  const restarted = await new UpdateStore(f.options).init()
  assert.equal(restarted.pointer.active, null)
})
test('built-in bytes are reused; strict resource allowlist refuses new routes before download', async t => {
  const f = await fixture(t); const builtin = join(f.root, 'built-in.js'); await writeFile(builtin, 'v1')
  const store = await new UpdateStore({ ...f.options, allowedPaths: new Set(f.content.keys()),
    builtInFile: (name: string) => name.endsWith('app.js') ? builtin : null }).init()
  f.publish('0.2.0'); await store.check(f.url)
  assert.deepEqual(f.requests, ['personal-access-ui/index.html'])
  f.content.set('unexpected.js', Buffer.from('bad')); f.publish('0.3.0'); f.requests.length = 0
  await store.check(f.url); assert.equal(store.state.status, 'failed'); assert.equal(f.requests.length, 0)
})
test('release scripts verify all three layers, generate changed files and preserve legacy mobile fields', async t => {
  const f = await fixture(t); const sourceDir = join(f.root, 'source'); await mkdir(sourceDir)
  const appFile = join(sourceDir, 'app.js'); const htmlFile = join(sourceDir, 'index.html')
  await writeFile(appFile, 'v1'); await writeFile(htmlFile, '<body>mobile v1</body>')
  const outputDir = join(f.root, 'feed')
  const resources = new Map([['personal-access-ui/index.html', htmlFile], ['personal-access-ui/app.js', appFile]])
  const a = await packageRelease({ layer: 'ui', version: '1.0.0', outputDir, privateKey: f.privateKey, resources })
  await verifyRelease({ manifest: a, trustedKeys: f.trustedKeys, directory: join(outputDir, 'files/ui/1.0.0') })
  await writeFile(htmlFile, '<body>v2</body>')
  const b = await packageRelease({ layer: 'ui', version: '1.1.0', outputDir, privateKey: f.privateKey, resources, previousManifest: a })
  const delta = JSON.parse(await readFile(join(outputDir, 'delta-ui.json'), 'utf8'))
  assert.equal(delta.changedFiles.length, 1); assert.equal(delta.fromVersion, '1.0.0')
  await assert.rejects(packageRelease({ layer: 'ui', version: b.version, outputDir, privateKey: f.privateKey, resources }), /already published/)
  const mobile = await publishMobileUi({ sourceDir, outputDir: join(f.root, 'mobile'), uiVersion: '1.1.0', privateKey: f.privateKey })
  assert.equal(validateMobileManifest(mobile).manifest.version, '1.1.0')
  for (const key of ['schemaVersion', 'uiVersion', 'bridgeVersion', 'minNativeVersionCode', 'assetBase', 'entry', 'assets', 'releaseNotes', 'publishedAt']) assert.ok(Object.hasOwn(mobile, key))
  const legacy = Object.fromEntries(['schemaVersion', 'uiVersion', 'bridgeVersion', 'minNativeVersionCode', 'assetBase', 'entry', 'assets', 'releaseNotes', 'publishedAt'].map(key => [key, mobile[key]]))
  assert.equal(validateMobileManifest(legacy).manifest.uiVersion, mobile.version)
  const largeAssets = [{ path: 'index.html', size: 1, sha256: sha256('x') },
    ...Array.from({ length: 250 }, (_, i) => ({ path: `file-${i}.js`, size: 1, sha256: sha256('x') }))].sort((a, b) => a.path.localeCompare(b.path))
  const largeManifest = signManifest({ ...mobile, files: largeAssets, assets: largeAssets,
    assetBase: `/personal/v1/app/assets/${sha256(JSON.stringify(largeAssets))}/`, minNativeVersionCode: 21 }, f.privateKey)
  assert.throws(() => validateMobileManifest(largeManifest), /code22/)
  assert.equal(validateMobileManifest(signManifest({ ...largeManifest, minNativeVersionCode: 22 }, f.privateKey)).assets.length, 251)
  const installerDir = join(f.root, 'installer'); await mkdir(installerDir)
  const installer = join(installerDir, 'WeftMate-Setup-1.1.0.exe')
  await writeFile(installer, 'synthetic installer'); await writeFile(installer + '.blockmap', 'synthetic blockmap')
  const app = await packageRelease({ layer: 'app', version: '1.1.0', outputDir, sourceDir: installerDir, privateKey: f.privateKey })
  await verifyDownloadedApp(app, installer)
  await writeFile(installer, 'tampered'); await assert.rejects(verifyDownloadedApp(app, installer), /hash/)
})
