import assert from 'node:assert/strict'
import test from 'node:test'
import { personalWebFetchProvider } from '../src/plugins/personal-web-fetch.mjs'

test('native web fetch returns the first segment and a continuation without eagerly reading unrelated sections', async () => {
  const exec = { agent: { session: { header: { agentPreset: 'personal-remote' } } } }
  const signal = new AbortController().signal
  const frames: any[] = []
  const provider = personalWebFetchProvider({ request: async (frame: any, actualSignal: any) => {
    assert.equal(actualSignal, signal)
    frames.push(frame)
    return frame.browserAction === 'open'
      ? { snapshotId: 'capture-one', segmentCount: 3, text: 'A', url: 'https://example.org/final',
          httpStatus: 206, captureTruncated: false, truncated: true, outline: 'Release notes\nDependencies' }
      : { text: frame.segmentIndex === 1 ? 'B' : 'C' }
  } }, () => exec, (actual: any) => {
    assert.equal(actual, exec)
    return { sessionId: 'session-one', receiptId: 'receipt-one', callId: 'call-one' }
  })
  assert.equal(provider.available(), true)
  const result = await provider.fetch({ url: 'https://example.org/source' }, signal)
  assert.equal(result.url, 'https://example.org/final')
  assert.equal(result.statusCode, 206)
  assert.equal(result.truncated, true)
  assert.ok(result.body.content.startsWith('A\n\n[Partial page:'))
  assert.match(result.body.content, /snapshotId="capture-one", segmentIndex=1\.\.2/)
  assert.match(result.body.content, /Release notes\nDependencies/)
  assert.equal(frames.length, 1)
  assert.ok(frames.every(frame => frame.sessionId === 'session-one' && frame.callId === 'call-one'))
})

test('a complete short page and a capture limit preserve their distinct truncation facts', async () => {
  let captureTruncated = false
  const provider = personalWebFetchProvider({ request: async () => ({ text: 'complete page',
    url: 'https://example.org', segmentCount: 1, httpStatus: 200, captureTruncated }) }, () => ({}), () => ({}))
  assert.deepEqual(await provider.fetch({ url: 'https://example.org' }), {
    url: 'https://example.org', statusCode: 200, body: { kind: 'text', content: 'complete page' }, truncated: false,
  })
  captureTruncated = true
  assert.equal((await provider.fetch({ url: 'https://example.org' })).truncated, true)
})

test('native web fetch supplies delegated personal sessions, excludes other presets and propagates cancellation', async () => {
  let exec: any
  const controller = new AbortController()
  const provider = personalWebFetchProvider({ request: async (_frame: any, signal: AbortSignal) => {
    signal.throwIfAborted()
    throw new Error('should not reach a page read')
  } }, () => exec, () => ({ sessionId: 'session-one' }))
  assert.equal(provider.available(), false)
  exec = { agent: { session: { header: { agentPreset: 'standard' } } } }
  assert.equal(provider.available(), false)
  exec.agent.session.header = { agentPreset: 'personal-remote', origin: 'subagent' }
  assert.equal(provider.available(), true)
  exec.agent.session.header = { agentPreset: 'personal-remote' }
  assert.equal(provider.available(), true)
  controller.abort()
  await assert.rejects(provider.fetch({ url: 'https://example.org' }, controller.signal), { name: 'AbortError' })
})
