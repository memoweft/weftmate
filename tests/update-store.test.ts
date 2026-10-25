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
import { personalAccessUiResources, servePersonalAccessUi, setPersonalAccessUiResourceReader } from '../src/personal-access-ui/index.mjs'

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
test('channel switching preserves an installed signed UI and rejects downloads from the old channel', async t => {
  const f = await fixture(t), store = await new UpdateStore(f.options).init();
  f.publish('0.2.0'); await store.check(f.url); await store.activate({ idle: true }); await store.healthy();
  store.channel = 'preview';
  assert.equal((await store.resource('personal-access-ui/index.html')).toString(), '<body>v1</body>');
  f.publish('0.3.0'); await store.check(f.url); assert.equal(store.state.status, 'failed');
  assert.equal(store.pointer.staged, null);
  const restarted = await new UpdateStore({ ...f.options, channel: 'preview' }).init();
  assert.equal(restarted.state.currentVersion, '0.2.0');
});

test('first boot after a host upgrade retires the old UI trial in favour of the bundled UI', async t => {
  const f = await fixture(t), old = await new UpdateStore(f.options).init();
  f.publish('0.2.0'); await old.check(f.url); await old.activate({ idle: true });
  assert.equal(old.pointer.trial, true);
  // preview.12 did not stamp the bundled host version in current.json.
  delete old.pointer.builtInVersion; await old.persist();
  const upgraded = await new UpdateStore({ ...f.options, builtInVersion: '0.2.0',
    versions: { app: '0.2.0', host: '0.2.0', bridge: 1 } }).init();
  assert.equal(upgraded.pointer.active, null);
  assert.equal(upgraded.pointer.trial, false);
  assert.equal(upgraded.state.currentVersion, '0.2.0');
  assert.equal(upgraded.state.status, 'current');
  assert.equal(await upgraded.resource('personal-access-ui/app.js'), null);
});

test('UI rollback persistence failure leaves bundled resources usable', async t => {
  const f = await fixture(t), store = await new UpdateStore(f.options).init();
  f.publish('0.2.0'); await store.check(f.url); await store.activate({ idle: true });
  store.persist = async () => { throw new Error('disk unavailable'); };
  await assert.doesNotReject(store.rollback());
  assert.equal(store.pointer.active, null);
  assert.equal(store.pointer.trial, false);
  assert.equal(await store.resource('personal-access-ui/app.js'), null);
});

test('an empty UI channel is distinct from a network or asset download failure', async t => {
  const f = await fixture(t);
  const store = await new UpdateStore({ ...f.options, fetcher: async () => new Response('', { status: 404 }) }).init();
  await store.check(f.url);
  assert.equal(store.state.status, 'empty');
  assert.equal(store.state.error, null);
  f.publish('0.2.0');
  const missingAsset = await new UpdateStore({ ...f.options, root: join(f.root, 'missing-asset'),
    fetcher: async (url: URL) => url.pathname.endsWith('manifest-ui.json') ? fetch(url) : new Response('', { status: 404 }) }).init();
  await missingAsset.check(f.url);
  assert.equal(missingAsset.state.status, 'failed');
  assert.equal(missingAsset.pointer.staged, null);
});

test('a signed UI requiring a newer app skips added paths without downloading or reporting failure', async t => {
  const f = await fixture(t);
  const allowedPaths = new Set(f.content.keys());
  const store = await new UpdateStore({ ...f.options, allowedPaths }).init();
  f.content.set('personal-access-ui/new-component.js', Buffer.from('new component'));
  const manifest = f.publish('0.3.0');
  f.setManifest(signManifest({ ...manifest, minAppVersion: '0.3.0' }, f.privateKey));
  await store.check(f.url);
  assert.equal(store.state.status, 'app-update-required');
  assert.equal(store.state.error, null);
  assert.equal(store.state.availableVersion, '0.3.0');
  assert.equal(store.pointer.staged, null);
  assert.equal(await store.activate({ idle: true }), false);
  assert.deepEqual(f.requests, []);
  // A forged compatibility range must still fail signature verification.
  f.setManifest({ ...manifest, minAppVersion: '99.0.0' });
  await store.check(f.url);
  assert.equal(store.state.status, 'failed');
  assert.match(store.state.error!, /签名/);
});

test('Windows UI releases raise the app floor on added files and preserve it on replacement-only releases', async t => {
  const f = await fixture(t), resources = new Map<string, string>();
  const add = async (name: string, text: string) => {
    const file = join(f.root, name); await writeFile(file, text); resources.set(`personal-access-ui/${name}`, file);
  };
  await add('index.html', 'first');
  const publish = (version: string, previousManifest: any = null) => packageRelease({ layer: 'ui', version, appVersion: version,
    outputDir: join(f.root, 'feed'), privateKey: f.privateKey, resources, previousManifest });
  const first = await publish('0.2.0');
  assert.equal(first.minAppVersion, '0.2.0', 'without a baseline, require this app conservatively');
  await add('index.html', 'replacement');
  const replacement = await publish('0.3.0', first);
  assert.equal(replacement.minAppVersion, '0.2.0');
  await add('new.js', 'component');
  const added = await publish('0.4.0', replacement);
  assert.equal(added.minAppVersion, '0.4.0');
  await add('index.html', 'another replacement');
  assert.equal((await publish('0.5.0', added)).minAppVersion, '0.4.0');
});
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

test('shipped UI release keeps catalog browser paths separate from physical source paths', async t => {
  const f = await fixture(t), outputDir = join(f.root, 'catalog-feed')
  const name = 'ui-core/model-service-catalog.mjs'
  const source = personalAccessUiResources.get(name)
  assert.ok(source)
  assert.ok(!personalAccessUiResources.has('ui-core/../model-service-catalog.mjs'))
  const expected = await readFile(source)
  const manifest = await packageRelease({ layer: 'ui', version: '1.0.0', outputDir, privateKey: f.privateKey })
  const directory = join(outputDir, 'files/ui/1.0.0')
  await verifyRelease({ manifest, trustedKeys: f.trustedKeys, directory })
  assert.equal(manifest.files.find((file: { path: string }) => file.path === name)?.sha256, sha256(expected))
  assert.deepEqual(await readFile(join(directory, name)), expected)

  let requested: string | null = null, status: number | null = null, body: Buffer | null = null
  setPersonalAccessUiResourceReader(async (resource: string) => {
    requested = resource
    return readFile(join(directory, resource))
  })
  t.after(() => setPersonalAccessUiResourceReader(null))
  assert.equal(await servePersonalAccessUi({ method: 'GET', url: '/personal/v1/ui/' + name }, {
    writeHead(value: number) { status = value }, end(value: Buffer) { body = value },
  }), true)
  assert.equal(requested, name); assert.equal(status, 200); assert.deepEqual(body, expected)
  await assert.rejects(packageRelease({ layer: 'ui', version: '1.0.1', outputDir, privateKey: f.privateKey,
    resources: new Map([['ui-core/../model-service-catalog.mjs', source]]) }), /invalid release resource/)
})
