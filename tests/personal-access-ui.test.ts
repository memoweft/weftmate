import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { servePersonalAccessUi } from '../src/personal-access-ui/index.mjs'

const repository = fileURLToPath(new URL('../', import.meta.url))

function response() {
  const result: { status?: number; headers?: Record<string, string>; body?: Buffer } = {}
  return { result,
    writeHead(status: number, headers: Record<string, string>) { result.status = status; result.headers = headers },
    end(body: Buffer) { result.body = body },
  }
}

test('account UI serves only its fixed public GET assets with restrictive headers', async () => {
  for (const path of ['/personal/v1/ui', '/personal/v1/ui/', '/personal/v1/ui/index.html',
    '/personal/v1/ui/app.js', '/personal/v1/ui/timeline.js', '/personal/v1/ui/styles.css', '/personal/v1/ui/tokens.css']) {
    const res = response()
    assert.equal(await servePersonalAccessUi({ method: 'GET', url: path }, res), true)
    assert.equal(res.result.status, 200)
    assert.match(res.result.headers!['content-security-policy'], /script-src 'self'/)
    assert.match(res.result.headers!['content-security-policy'], /frame-ancestors 'none'/)
    assert.equal(res.result.headers!['referrer-policy'], 'no-referrer')
    assert.equal(res.result.headers!['cache-control'], 'no-store')
    assert.ok(res.result.body?.length)
  }
  for (const [method, path] of [['POST', '/personal/v1/ui'], ['GET', '/personal/v1/ui/private'],
    ['GET', '/personal/v1/ui/app.js?x=1'], ['GET', '/personal/v1/ui/%61pp.js']]) {
    const res = response()
    assert.equal(await servePersonalAccessUi({ method, url: path }, res), false)
    assert.equal(res.result.status, undefined)
  }
})

test('public account shell keeps secrets out of markup and code-generated HTML', () => {
  const html = readFileSync(join(repository, 'src', 'personal-access-ui', 'index.html'), 'utf8')
  const app = readFileSync(join(repository, 'src', 'personal-access-ui', 'app.js'), 'utf8')
  assert.match(html, /autocomplete="new-password"/)
  assert.match(html, /autocomplete="current-password"/)
  assert.doesNotMatch(html, /<script(?![^>]*src=)/i)
  assert.match(app, /localStorage\.setItem\(key, JSON\.stringify\(rows\.slice/)
  assert.doesNotMatch(app, /sessionStorage|innerHTML|console\./)
  // Match secret/content identifiers, not the "text" suffix in markerKey(context).
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*\b(?:password|csrfToken|setupGrant|apiKey|token|text)\b/)
  assert.match(app, /history\.replaceState/)
  assert.match(app, /textContent/)
})
