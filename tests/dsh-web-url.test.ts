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
