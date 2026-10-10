import assert from 'node:assert/strict'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { uiCoreBrowserAssets as uiCoreAssets } from '../src/ui-core/manifest.mjs'
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
  assert.deepEqual([...html.matchAll(/<script defer src="ui-core\/([^"]+)"/g)].map(match => match[1]), uiCoreAssets.filter(name=>name.endsWith('.js')),
    'phone must load the complete shared manifest in canonical order')
  for (const name of uiCoreAssets.filter(name=>name.endsWith('.css'))) assert.ok(html.includes(`<link rel="stylesheet" href="ui-core/${name}">`), `phone loads shared style ${name}`)
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
  assert.equal(await checkMobileUi({ sourceDir, wwwDir }), uiCoreAssets.filter(name=>name.endsWith('.js')).length + 1)
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
    'src/personal-access-ui/system-bars.js', 'apps/mobile-ui/www/system-bars.js',
    'src/personal-access-ui/components/notifications.js', 'apps/mobile-ui/www/components/notifications.js',
    'src/personal-access-ui/components/goals-view.js', 'src/personal-access-ui/goals.css', 'apps/mobile-ui/www/components/goals-view.js', 'apps/mobile-ui/www/goals.css',
    'src/personal-access-ui/components/personalization.js', 'src/personal-access-ui/personalization.css', 'apps/mobile-ui/www/components/personalization.js', 'apps/mobile-ui/www/personalization.css',
    'src/personal-access-ui/components/library-view.js', 'src/personal-access-ui/library.css', 'apps/mobile-ui/www/components/library-view.js', 'apps/mobile-ui/www/library.css',
    'src/personal-access-ui/components/activity-view.js', 'src/personal-access-ui/activity.css', 'apps/mobile-ui/www/components/activity-view.js', 'apps/mobile-ui/www/activity.css',
    'src/personal-access-ui/components/offline.js', 'src/personal-access-ui/offline.css', 'apps/mobile-ui/www/components/offline.js', 'apps/mobile-ui/www/offline.css',
    'apps/mobile-ui/src/check.mjs', 'scripts/build-mobile-ui.mjs', 'src/personal-access/mobile-ui-release.mjs', 'src/personal-update/manifest.mjs', 'src/personal-access-ui/components/question-bar.js', 'src/personal-access-ui/components/usage.js', 'src/personal-access-ui/components/settings-controls.js', 'src/personal-access-ui/components/schedules.js', 'src/personal-access-ui/usage.css', 'src/personal-access-ui/popovers.js', 'apps/mobile-ui/www/popovers.js',
    'src/personal-access-ui/conversation-scroll.js', 'apps/mobile-ui/www/conversation-scroll.js', 'src/personal-access-ui/components/main-chat.js', 'apps/mobile-ui/www/components/main-chat.js',
    'src/personal-access-ui/message-actions.js', 'src/personal-access-ui/message-actions.css', 'apps/mobile-ui/www/message-actions.js', 'apps/mobile-ui/www/message-actions.css',
    'src/personal-access-ui/icons.js', 'apps/mobile-ui/www/icons.js',
    'src/personal-access-ui/components/search-view.js', 'src/personal-access-ui/search.css', 'apps/mobile-ui/www/components/search-view.js', 'apps/mobile-ui/www/search.css',
    'src/personal-access-ui/next-suggestions.js', 'src/personal-access-ui/next-suggestions.css', 'apps/mobile-ui/www/next-suggestions.js', 'apps/mobile-ui/www/next-suggestions.css',
    'src/personal-access-ui/controls.css', 'apps/mobile-ui/www/controls.css',
    'src/personal-access-ui/folder-choice.js','src/personal-access-ui/folder-choice.css','apps/mobile-ui/www/folder-choice.js','apps/mobile-ui/www/folder-choice.css',
    'src/personal-access-ui/rendering.css','apps/mobile-ui/www/rendering.css','src/personal-access-ui/katex.css','apps/mobile-ui/www/katex.css',
    'docs/legal/terms-zh.md', 'docs/legal/privacy-zh.md', 'apps/mobile-ui/www/legal/terms-zh.txt', 'apps/mobile-ui/www/legal/privacy-zh.txt']) {
    const destination = path.join(isolatedRepository, name)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(repository, name), destination)
  }
  const wwwDir = path.join(isolatedRepository, 'apps', 'mobile-ui', 'www')
  await copyFile(path.join(repository,'src/personal-access-ui/render-assets.json'),path.join(isolatedRepository,'src/personal-access-ui/render-assets.json'))
  for(const name of JSON.parse(await readFile(path.join(repository,'src/personal-access-ui/render-assets.json'),'utf8'))){
    for(const prefix of ['src/personal-access-ui','apps/mobile-ui/www']){const target=path.join(isolatedRepository,prefix,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(repository,prefix,name),target);}
  }
  const targetDir = path.join(wwwDir, 'ui-core')
  await mkdir(path.join(wwwDir, 'components'), { recursive: true })
  await copyFile(path.join(repository, 'src/personal-access-ui/components/question-bar.js'), path.join(wwwDir, 'components/question-bar.js'))
  await copyFile(path.join(repository, 'src/personal-access-ui/components/usage.js'), path.join(wwwDir, 'components/usage-view.js'))
  await copyFile(path.join(repository, 'src/personal-access-ui/components/schedules.js'), path.join(wwwDir, 'components/schedules-view.js'))
  await copyFile(path.join(repository, 'src/personal-access-ui/components/settings-controls.js'), path.join(wwwDir, 'components/settings-controls.js'))
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
