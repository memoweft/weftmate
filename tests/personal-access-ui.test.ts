import { desktopFeatureSource, desktopHtml } from './helpers/desktop-ui-source.mjs'
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

test('terminal grid styles receive a fresh response nonce while the script policy stays self-only', async () => {
  const nonces: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = response(); await servePersonalAccessUi({ method: 'GET', url: '/personal/v1/ui/' }, res);
    const nonce = res.result.body!.toString().match(/name="weft-style-nonce" content="([^"]+)"/)![1];
    assert.equal(res.result.body!.toString().match(/src="\/personal\/v1\/ui\/panels\/terminal\.js"/g)?.length, 1);
    assert.match(nonce, /^[A-Za-z0-9+/]{24}$/);
    const policy = res.result.headers!['content-security-policy'];
    assert.ok(policy.includes(`style-src 'self' 'nonce-${nonce}'`));
    assert.match(policy, /script-src 'self';/); nonces.push(nonce);
  }
  assert.notEqual(nonces[0], nonces[1]);
});

test('public account shell keeps secrets out of markup and code-generated HTML', () => {
  const html = desktopHtml()
  const app = desktopFeatureSource()
  assert.match(html, /autocomplete="new-password"/)
  assert.match(html, /autocomplete="current-password"/)
  assert.doesNotMatch(html, /<script(?![^>]*src=)/i)
  assert.match(app, /(?:localStorage|environment\.storage)\.setItem\(key, JSON\.stringify\(rows\.slice/)
  assert.doesNotMatch(app, /sessionStorage|console\./)
  // Cloud forms use fixed templates; account values and legal content use textContent/value.
  assert.doesNotMatch(app, /innerHTML\s*=\s*(?:value\.|payload\.|result\.|await\b)/)
  // Match secret/content identifiers, not the "text" suffix in markerKey(context).
  assert.doesNotMatch(app, /(?:localStorage|environment\.storage)\.setItem\([^\n]*\b(?:password|csrfToken|setupGrant|apiKey|token|text)\b/)

  assert.match(app, /history\.replaceState/)
  assert.match(app, /textContent/)
})
