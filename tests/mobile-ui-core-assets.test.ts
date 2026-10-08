import assert from 'node:assert/strict'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { uiCoreAssets } from '../src/ui-core/manifest.mjs'
import { buildUiCoreAssets, checkUiCoreAssets, uiCoreSourceDir } from '../apps/mobile-ui/src/build-ui-core.mjs'
import { checkMobileUi } from '../apps/mobile-ui/src/check.mjs'
import { publishMobileUi } from '../src/personal-access/mobile-ui-release.mjs'
import { generateKeyPairSync } from 'node:crypto'

const execFileAsync = promisify(execFile)
const repository = fileURLToPath(new URL('../', import.meta.url))

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'mobile-ui-core-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceDir = path.join(root, 'source')
  const wwwDir = path.join(root, 'www')
  const targetDir = path.join(wwwDir, 'ui-core')
  for (const name of uiCoreAssets) {
    const file = path.join(sourceDir, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `// synthetic ${name}\n`)
  }
  return { root, sourceDir, wwwDir, targetDir }
}

test('mobile generated assets match every canonical ui-core file byte for byte', async (t) => {
  const html = await readFile(path.join(repository, 'apps/mobile-ui/www/index.html'), 'utf8')
  assert.deepEqual([...html.matchAll(/<script defer src="ui-core\/([^"]+)"/g)].map(match => match[1]), [...uiCoreAssets],
    'phone must load the complete shared manifest in canonical order')
  const { targetDir } = await fixture(t)
  assert.equal(await buildUiCoreAssets({ targetDir }), uiCoreAssets.length)
  assert.equal(await checkUiCoreAssets({ targetDir }), uiCoreAssets.length)
  for (const name of uiCoreAssets) {
    assert.deepEqual(await readFile(path.join(targetDir, name)), await readFile(path.join(uiCoreSourceDir, name)), name)
  }
})

test('check refuses changed, missing and unlisted copies; rebuild follows the source and removes stale files', async (t) => {
  const { sourceDir, targetDir } = await fixture(t)
  await buildUiCoreAssets({ sourceDir, targetDir })
  const first = uiCoreAssets[0]
  await writeFile(path.join(sourceDir, first), '// changed source\n')
  await assert.rejects(checkUiCoreAssets({ sourceDir, targetDir }), /differs/)
  await buildUiCoreAssets({ sourceDir, targetDir })
  assert.equal(await readFile(path.join(targetDir, first), 'utf8'), '// changed source\n')
  await rm(path.join(targetDir, first))
  const stale = path.join(targetDir, 'adapters', 'removed.js')
  await mkdir(path.dirname(stale), { recursive: true })
  await writeFile(stale, '// removed from manifest\n')
  await assert.rejects(checkUiCoreAssets({ sourceDir, targetDir }), /missing .*unexpected adapters\/removed\.js/)
  await buildUiCoreAssets({ sourceDir, targetDir })
  assert.equal(await checkUiCoreAssets({ sourceDir, targetDir }), uiCoreAssets.length)
  await assert.rejects(readFile(stale), { code: 'ENOENT' })
})

test('mobile check validates nested component syntax as well as generated source parity', async (t) => {
  const { sourceDir, wwwDir, targetDir } = await fixture(t)
  await buildUiCoreAssets({ sourceDir, targetDir })
  const component = path.join(wwwDir, 'components', 'composer.js')
  await mkdir(path.dirname(component), { recursive: true })
  await writeFile(component, 'function {\n')
  await assert.rejects(checkMobileUi({ sourceDir, wwwDir }), /mobile UI syntax check failed: .*composer\.js/)
  await writeFile(component, 'globalThis.syntheticComposer = () => {};\n')
  assert.equal(await checkMobileUi({ sourceDir, wwwDir }), uiCoreAssets.length + 1)
})

test('published mobile bundle includes the verified shared assets at their ui-core paths', async (t) => {
  const { root, sourceDir, wwwDir, targetDir } = await fixture(t)
  await buildUiCoreAssets({ sourceDir, targetDir })
  await writeFile(path.join(wwwDir, 'index.html'), '<!doctype html><title>Synthetic mobile UI</title>')
  await checkMobileUi({ sourceDir, wwwDir })
  const outputDir = path.join(root, 'releases')
  const manifest = await publishMobileUi({ sourceDir: wwwDir, outputDir, uiVersion: '0.8.4', minNativeVersionCode: 17,
    privateKey: generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) })
  const bundle = path.join(outputDir, 'bundles', manifest.assetBase.split('/')[5])
  for (const name of uiCoreAssets) {
    assert.ok(manifest.assets.some((asset: { path: string }) => asset.path === `ui-core/${name}`), name)
    assert.deepEqual(await readFile(path.join(bundle, 'ui-core', name)), await readFile(path.join(sourceDir, name)), name)
  }
})

test('publish command refuses stale generated assets before creating a release', async (t) => {
  const { root, sourceDir } = await fixture(t)
  const isolatedRepository = path.join(root, 'repository')
  const copiedSources = path.join(isolatedRepository, 'src', 'ui-core')
  await cp(sourceDir, copiedSources, { recursive: true })
  for (const name of ['src/ui-core/manifest.mjs', 'apps/mobile-ui/src/build-ui-core.mjs',
    'apps/mobile-ui/src/check.mjs', 'scripts/build-mobile-ui.mjs', 'src/personal-access/mobile-ui-release.mjs', 'src/personal-update/manifest.mjs', 'src/personal-access-ui/components/usage.js', 'src/personal-access-ui/usage.css',
    'docs/legal/terms-zh.md', 'docs/legal/privacy-zh.md', 'apps/mobile-ui/www/legal/terms-zh.txt', 'apps/mobile-ui/www/legal/privacy-zh.txt']) {
    const destination = path.join(isolatedRepository, name)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(repository, name), destination)
  }
  const wwwDir = path.join(isolatedRepository, 'apps', 'mobile-ui', 'www')
  const targetDir = path.join(wwwDir, 'ui-core')
  await mkdir(path.join(wwwDir, 'components'), { recursive: true })
  await copyFile(path.join(repository, 'src/personal-access-ui/components/usage.js'), path.join(wwwDir, 'components/usage-view.js'))
  await copyFile(path.join(repository, 'src/personal-access-ui/usage.css'), path.join(wwwDir, 'usage.css'))
  await buildUiCoreAssets({ sourceDir: copiedSources, targetDir })
  await writeFile(path.join(wwwDir, 'index.html'), '<!doctype html><title>Synthetic mobile UI</title>')
  await writeFile(path.join(targetDir, uiCoreAssets[0]), '// stale generated copy\n')
  const outputDir = path.join(root, 'published')
  const args = [path.join(isolatedRepository, 'scripts', 'build-mobile-ui.mjs'), '--output-dir', outputDir]
  await assert.rejects(execFileAsync(process.execPath, args), /ui-core assets: differs/)
  await assert.rejects(readFile(path.join(outputDir, 'current.json')), { code: 'ENOENT' })
  await buildUiCoreAssets({ sourceDir: copiedSources, targetDir })
  const keyFile = path.join(root, 'test-key.pem')
  await writeFile(keyFile, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }))
  await execFileAsync(process.execPath, args, { env: { ...process.env, WEFTMATE_UPDATE_PRIVATE_KEY_PATH: keyFile } })
  const manifest = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'))
  assert.ok(manifest.assets.some((asset: { path: string }) => asset.path === `ui-core/${uiCoreAssets[0]}`))
})
