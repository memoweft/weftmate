import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { preparePublicDownloads } from '../scripts/prepare-public-downloads.mjs'

const home = 'https://home.weftmate.com:8443/personal/v1/ui'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'public-downloads-'))
  const siteSource = join(root, 'website')
  mkdirSync(siteSource)
  writeFileSync(join(siteSource, 'index.html'), '<!doctype html><title>Downloads</title>')
  writeFileSync(join(siteSource, 'styles.css'), 'body{color:black}')
  writeFileSync(join(siteSource, 'app.js'), 'document.title="Downloads"')
  writeFileSync(join(siteSource, 'private-config.json'), '{"secret":"must-not-copy"}')
  const android = Buffer.from('synthetic verified Android installer')
  const macos = Buffer.from('synthetic verified macOS disk image')
  const androidPath = join(root, 'android-candidate.apk')
  const macosPath = join(root, 'WeftMate-Mac-0.1.0-build4.dmg')
  writeFileSync(androidPath, android)
  writeFileSync(macosPath, macos)
  const configPath = join(root, 'publish.json')
  const config = { schemaVersion: 1, siteUrl: 'https://www.weftmate.com/downloads/', platforms: [
    { id: 'android', status: 'available', source: androidPath, expectedBytes: android.length,
      expectedSha256: hash(android), version: '0.7.0', build: '12', architecture: 'universal', notes: 'Android trial' },
    { id: 'macos', status: 'available', source: macosPath, expectedBytes: macos.length,
      expectedSha256: hash(macos), version: '0.1.0', build: '4', architecture: 'x86_64', notes: 'Mac trial' },
    { id: 'windows', status: 'web', webUrl: home, notes: 'Use the web app' },
    { id: 'ios', status: 'unavailable', notes: 'Coming later' },
    { id: 'watchos', status: 'unavailable', notes: 'Coming later' },
  ] }
  const save = () => writeFileSync(configPath, JSON.stringify(config))
  save()
  return { root, siteSource, configPath, config, save, android, macos }
}

test('publisher emits only verified installers, scoped website files and stable landing QR codes', async () => {
  const f = fixture()
  try {
    const first = join(f.root, 'first-downloads')
    const manifest = await preparePublicDownloads({ configPath: f.configPath, output: first,
      siteSource: f.siteSource, allowWebUrl: home })
    assert.deepEqual(readdirSync(first).sort(),
      ['app.js', 'files', 'index.html', 'qr', 'releases.json', 'styles.css'])
    assert.equal(JSON.stringify(manifest).includes(f.root), false, 'no private source path is published')
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.platforms.length, 5)
    assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)))
    for (const [id, source] of [['android', f.android], ['macos', f.macos]] as const) {
      const item = manifest.platforms.find((entry: any) => entry.id === id)!
      assert.equal(item.status, 'available')
      assert.equal(item.bytes, source.length)
      assert.equal(item.sha256, hash(source))
      assert.match(item.downloadUrl, new RegExp(`^files/${item.sha256}-`))
      assert.equal(hash(readFileSync(join(first, item.downloadUrl))), item.sha256)
    }
    assert.equal(readdirSync(join(first, 'files')).length, 2)
    assert.equal(readdirSync(join(first, 'qr')).length, 5)
    for (const item of manifest.platforms) {
      assert.equal(item.landingUrl, `https://www.weftmate.com/downloads/?platform=${item.id}`)
      const svg = readFileSync(join(first, item.qrUrl), 'utf8')
      assert.ok(svg.includes(`<desc>${item.landingUrl}</desc>`))
      assert.match(svg, /viewBox="0 0 \d+ \d+"/)
      assert.match(svg, /<path fill="#111" d="M/)
      if (item.id === 'windows') {
        assert.equal(item.webUrl, home)
        assert.equal(item.downloadUrl, undefined)
      } else if (item.status === 'unavailable') {
        assert.equal(item.version, undefined)
        assert.equal(item.sha256, undefined)
        assert.equal(item.downloadUrl, undefined)
      }
    }
    const second = join(f.root, 'second-downloads')
    await preparePublicDownloads({ configPath: f.configPath, output: second,
      siteSource: f.siteSource, allowWebUrl: home })
    assert.equal(readFileSync(join(first, 'qr/android.svg'), 'utf8'),
      readFileSync(join(second, 'qr/android.svg'), 'utf8'), 'QR payload and pixels stay stable')
    assert.deepEqual(JSON.parse(readFileSync(join(first, 'releases.json'), 'utf8')), manifest)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('publisher refuses wrong or missing expected installer facts before creating output', async () => {
  const f = fixture()
  try {
    const output = join(f.root, 'refused-downloads')
    f.config.platforms[0].expectedSha256 = '0'.repeat(64)
    f.save()
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource, allowWebUrl: home }), /SHA-256 differs/)
    assert.equal(existsSync(output), false)
    delete (f.config.platforms[0] as any).expectedSha256
    f.save()
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource, allowWebUrl: home }), /invalid available release/)
    assert.equal(existsSync(output), false)
    f.config.platforms[0].expectedSha256 = hash(f.android)
    f.config.platforms[0].expectedBytes++
    f.save()
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource, allowWebUrl: home }), /byte count differs/)
    assert.equal(existsSync(output), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('publisher refuses unapproved web targets and fake availability', async () => {
  const f = fixture()
  try {
    const output = join(f.root, 'refused-downloads')
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource }), /not explicitly allowed/)
    f.config.siteUrl = 'https://example.test/downloads/'
    f.save()
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource, allowWebUrl: home }), /official HTTPS downloads URL/)
    f.config.siteUrl = 'https://www.weftmate.com/downloads/'
    f.config.platforms[2].webUrl = 'https://example.test/private'
    f.save()
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource, allowWebUrl: home }), /not explicitly allowed/)
    f.config.platforms[2].webUrl = home
    f.config.platforms[3] = { id: 'ios', status: 'available', notes: 'fake release' } as any
    f.save()
    await assert.rejects(preparePublicDownloads({ configPath: f.configPath, output,
      siteSource: f.siteSource, allowWebUrl: home }), /invalid available release/)
    assert.equal(existsSync(output), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
