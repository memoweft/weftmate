import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const repository = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(new URL('../src/personal-access-ui/desktop.js', import.meta.url), 'utf8')
function presentation(saved: object | null = null, dark = false) {
  const root = { dataset: {} as Record<string, string>, style: { setProperty(name: string, value: string) { values.set(name, value) } } }
  const values = new Map<string, string>(), window: Record<string, any> = {}
  const document = { documentElement: root, getElementById: () => null }
  runInNewContext(source, { window, document, localStorage: { getItem: () => JSON.stringify(saved) },
    Date, URL, location: { href: 'http://127.0.0.1/' } })
  window.matchMedia = () => ({ matches: dark })
  return { api: window.WeftDesktop, root, values }
}

test('desktop time groups use real dates, preserve undated sessions, and never mutate server order', () => {
  const { api } = presentation(), now = new Date(2026, 9, 8, 12)
  const stamp = (day: number) => new Date(2026, 9, day, 23).toISOString()
  assert.equal(api.sessionGroup({ updatedAt: stamp(8) }, now), '今天')
  assert.equal(api.sessionGroup({ updatedAt: stamp(7) }, now), '昨天')
  assert.equal(api.sessionGroup({ updatedAt: stamp(2) }, now), '7 天内')
  assert.equal(api.sessionGroup({ updatedAt: stamp(1) }, now), '更早')
  assert.equal(api.sessionGroup({}, now), '会话')
  assert.equal(api.sessionGroup({ updatedAt: 'invalid' }, now), '会话')
  const list = [{ sessionId: 'old', updatedAt: stamp(1) }, { sessionId: 'new', updatedAt: stamp(8) }]
  assert.deepEqual(Array.from(api.sortSessions(list), (s: any) => s.sessionId), ['new', 'old'])
  assert.deepEqual(list.map(s => s.sessionId), ['old', 'new'])
})

test('desktop appearance restores device preferences and artifact labels hide MIME parameters', () => {
  const { api, root, values } = presentation({ theme: 'dark', accent: 'purple', fontSize: '17' })
  assert.equal(root.dataset.theme, 'dark'); assert.equal(root.dataset.accent, 'purple')
  assert.equal(values.get('--text-size'), '17px')
  assert.equal(api.fileLabel({ fileName: '报告.md', contentType: 'text/plain; charset=utf-8', size: 68 }), 'Markdown · 68 字节')
  assert.equal(api.fileLabel({ fileName: 'notes.txt', size: 2048 }), '文本 · 2.0 KB')
  assert.equal(api.fileLabel({ fileName: 'photo.png', size: 1048576 }), '图片 · 1.0 MB')
  assert.equal(api.fileLabel({ fileName: 'unknown.bin' }), '文件')
})

test('desktop UI-1 Chromium verifies navigation, timeline, side panel, appearance and command controls', { timeout: 180000 }, () => {
  const require = createRequire(import.meta.url), electron = require('electron') as string
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electron, ['tests/integration/desktop-ui-1.cjs', '--verify-only'], {
    cwd: repository, env, encoding: 'utf8', timeout: 170000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /UI-1 Chromium interactions passed/, result.stderr)
})
