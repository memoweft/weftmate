import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { servePersonalAccessUi } from '../src/personal-access-ui/index.mjs'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n')
const approved = ['compose','search','sidebar','settings','account','archive','back','chevron','more',
  'send','stop','attach','mic','model','approval','allow','deny','plan','queue','terminal','tool',
  'outputs','memory','source','file','folder','web','download','open','copy','edit','trash','expand',
  'desktop','phone','cloud','offline','sync','bell','info','warn','moon','sun','pet','health']

test('approved icon sources stay themeable and published mobile assets match their sources', () => {
  const sprite = read('src/personal-access-ui/icons.svg')
  const names = readdirSync(new URL('design/icons/ui/', root)).filter(n => n.endsWith('.svg'))
  assert.ok(approved.every(id => names.includes(`${id}.svg`)))
  for (const name of names) {
    const source = read(`design/icons/ui/${name}`)
    assert.match(source, /viewBox="0 0 24 24"/)
    assert.match(source, /stroke="currentColor" stroke-width="1\.75"/)
    assert.match(source, /stroke-linecap="round" stroke-linejoin="round"/)
    assert.doesNotMatch(source, /#[a-f\d]{3,8}|<script|href=/i)
    assert.equal(read(`apps/mobile-ui/www/icons/${name}`), source, name)
    assert.equal(read(`apps/mobile-ui/www/icons/16/${name}`), source.replace('stroke-width="1.75"', 'stroke-width="1.5"'))
    assert.ok(sprite.includes(source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/g, '')), name)
  }
  assert.equal(read('apps/mobile-ui/www/icons/memory.svg'), read('design/icons/ui/memory.svg'))
  assert.equal(read('apps/mobile-ui/www/icons/arrow.svg'), read('design/icons/ui/send.svg'))
})

test('C4 keeps its over-under masks and Windows ICO containers cover 16 through 256 pixels', () => {
  const light = read('design/icons/app/color-light.svg'), mono = read('design/icons/app/monochrome.svg')
  assert.match(light, /cx="25" cy="32" r="13"/)
  assert.match(light, /cx="39" cy="32" r="13"/)
  assert.match(light, /r="2\.6" fill="#0A7AFF"/)
  assert.equal((light.match(/<mask /g) || []).length, 2)
  assert.equal((mono.match(/opacity="\.55"/g) || []).length, 2)
  const vector = read('apps/android/app/src/main/res/drawable/weftmate_foreground.xml')
  assert.equal((vector.match(/<clip-path /g) || []).length, 2)
  assert.match(vector, /android:fillType="evenOdd"/)
  assert.match(read('apps/android/app/src/main/res/drawable/ic_stat_weftmate.xml'), /android:strokeAlpha="\.55"/)
  for (const path of ['build/icon.ico', 'src/assets/icons/window-light.ico', 'src/assets/icons/window-dark.ico']) {
    const bytes = readFileSync(new URL(path, root))
    assert.equal(bytes.readUInt16LE(2), 1)
    const count = bytes.readUInt16LE(4), sizes: number[] = []
    for (let n = 0; n < count; n++) {
      const at = 6 + n * 16, size = bytes[at] || 256, length = bytes.readUInt32LE(at + 8), offset = bytes.readUInt32LE(at + 12)
      sizes.push(size); assert.equal(bytes[at + 1] || 256, size)
      assert.equal(bytes.readUInt16LE(at + 6), 32)
      assert.ok(offset + length <= bytes.length)
      assert.equal(bytes.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(bytes.readUInt32BE(offset + 16), size)
    }
    assert.deepEqual(sizes, [16,20,24,32,40,48,64,128,256])
  }
})

test('new desktop icon assets are public static assets with correct MIME and existing security headers', async () => {
  const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession']
    .map(method => [method, async () => method === 'listModels' ? [] : {}]))
  const service = await createPersonalAccessService({root: mkdtempSync(join(tmpdir(), 'weftmate-icons-')),port:0,backend,uiHandler:servePersonalAccessUi})
  const {origin} = await service.start()
  try {
    for (const [name, mime] of [['icons.js','text/javascript'],['icons.svg','image/svg+xml'],['favicon.svg','image/svg+xml'],
      ['brand/color-light.svg','image/svg+xml'],['brand/color-dark.svg','image/svg+xml']]) {
      const response = await fetch(`${origin}/personal/v1/ui/${name}`)
      assert.equal(response.status, 200, name)
      assert.ok(response.headers.get('content-type')?.startsWith(mime), name)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  } finally { await service.close() }
})
