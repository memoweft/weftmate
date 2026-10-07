import assert from 'node:assert/strict'
import test from 'node:test'
import { personalWebFetchProvider } from '../src/plugins/personal-web-fetch.mjs'

test('native web fetch reads every segment with one source identity and preserves HTTP/truncation facts', async () => {
  const exec = { agent: { session: { header: { agentPreset: 'personal-remote' } } } }
  const signal = new AbortController().signal
  const frames: any[] = []
  const provider = personalWebFetchProvider({ request: async (frame: any, actualSignal: any) => {
    assert.equal(actualSignal, signal)
    frames.push(frame)
    return frame.browserAction === 'open'
      ? { snapshotId: 'capture-one', segmentCount: 3, text: 'A', url: 'https://example.org/final',
          httpStatus: 206, captureTruncated: false, truncated: true }
      : { text: frame.segmentIndex === 1 ? 'B' : 'C' }
  } }, () => exec, (actual: any) => {
    assert.equal(actual, exec)
    return { sessionId: 'session-one', receiptId: 'receipt-one', callId: 'call-one' }
  })
  assert.equal(provider.available(), true)
  assert.deepEqual(await provider.fetch({ url: 'https://example.org/source' }, signal), {
    url: 'https://example.org/final', statusCode: 206, body: { kind: 'text', content: 'ABC' }, truncated: false,
  })
  assert.equal(frames.length, 3)
  assert.ok(frames.every(frame => frame.sessionId === 'session-one' && frame.callId === 'call-one'))
  assert.deepEqual(frames.slice(1).map(frame => [frame.snapshotId, frame.segmentIndex]), [['capture-one', 1], ['capture-one', 2]])
})

test('native web fetch does not supply other presets or delegated sessions and propagates cancellation', async () => {
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
  assert.equal(provider.available(), false)
  exec.agent.session.header = { agentPreset: 'personal-remote' }
  assert.equal(provider.available(), true)
  controller.abort()
  await assert.rejects(provider.fetch({ url: 'https://example.org' }, controller.signal), { name: 'AbortError' })
})
