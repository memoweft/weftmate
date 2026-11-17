import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWebUrlLine, redactWebToken } from '../src/dsh-web-runtime.ts'

test('keeps the alpha web token for the browser origin', () => {
  assert.equal(
    parseWebUrlLine('dsh web: http://127.0.0.1:40123/?token=ephemeral-token'),
    'http://127.0.0.1:40123/?token=ephemeral-token',
  )
})

test('redacts a browser token only for user-visible diagnostics', () => {
  const origin = 'http://127.0.0.1:40123/?token=ephemeral-token&view=chat'
  assert.equal(redactWebToken(origin), 'http://127.0.0.1:40123/?token=[redacted]&view=chat')
  assert.match(origin, /token=ephemeral-token/, 'the caller retains the actual URL for the authenticated request')
})


test('validates the complete launch URL and preserves encoded tokens', () => {
  for (const port of [1, 80, 65535]) {
    const origin = 'http://127.0.0.1:' + port
    assert.equal(parseWebUrlLine('dsh web: ' + origin + '/'), origin)
    assert.equal(parseWebUrlLine('dsh web: ' + origin + '/?token=a%2Bb'), origin + '/?token=a%2Bb')
  }
  for (const value of [
    'http://localhost:8000', 'https://127.0.0.1:8000', 'http://127.1:8000',
    'http://x@127.0.0.1:8000', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
    'http://127.0.0.1:8000/path', 'http://127.0.0.1:8000/../',
    ...['?', '#', '?x=y', '?token=', '?token=a&token=a', '?token=a&x=y', '?token=a#x', '?token=%', '?token=%00', '?token=+'].map(suffix => 'http://127.0.0.1:8000/' + suffix),
  ]) assert.equal(parseWebUrlLine('dsh web: ' + value), null, value)
})
