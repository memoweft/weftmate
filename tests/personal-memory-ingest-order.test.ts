import assert from 'node:assert/strict'
import test from 'node:test'
import { HostMemoryBridge, PERSONAL_MEMORY_PROTOCOL } from '../src/plugins/weftmate-personal-memory.mjs'

function fixture(t: any) {
  const originalSend = process.send, connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const frames: any[] = []
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  process.send = ((frame: any, callback: any) => { frames.push(frame); callback?.(null); return true }) as any
  const bridge = new HostMemoryBridge()
  t.after(() => { bridge.close(); process.send = originalSend
    if (connected) Object.defineProperty(process, 'connected', connected); else delete (process as any).connected })
  const reply = (frame: any, ok = true) => process.emit('message', { protocol: PERSONAL_MEMORY_PROTOCOL, id: frame.id,
    ok, result: { state: 'accepted' } }, undefined)
  return { bridge, frames, reply }
}

for (const action of ['recall', 'tool']) test(`next ${action} waits for an already completed turn's ingest acknowledgement`, async t => {
  const { bridge, frames, reply } = fixture(t)
  const ingest = bridge.request('ingest', { sessionId: 'previous-conversation' }); ingest.catch(() => {})
  const read = bridge.request(action, { sessionId: 'new-conversation', tool: { name: 'memory_forget_request' } }); read.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(frames.map(row => row.action), ['ingest'], 'the new conversation must not overtake delivery')
  reply(frames[0]); await ingest
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(frames[1].action, action)
  reply(frames[1]); await read
})

test('failed delivery cannot silently dispatch recall against the old World', { timeout: 1000 }, async t => {
  const { bridge, frames, reply } = fixture(t)
  const ingest = bridge.request('ingest', {}); ingest.catch(() => {})
  const read = bridge.request('recall', {}); read.catch(() => {})
  reply(frames[0], false)
  await assert.rejects(ingest, /MEMORY_UNAVAILABLE/)
  await assert.rejects(read, /MEMORY_UNAVAILABLE/)
  assert.equal(frames.length, 1)
})

test('cancelling the waiting question does not cancel the earlier memory delivery', { timeout: 1000 }, async t => {
  const { bridge, frames, reply } = fixture(t), controller = new AbortController()
  const ingest = bridge.request('ingest', {}); ingest.catch(() => {})
  const read = bridge.request('recall', {}, controller.signal); read.catch(() => {})
  controller.abort()
  await assert.rejects(read, /MEMORY_CANCELLED|MEMORY_UNAVAILABLE/)
  assert.deepEqual(frames.map(row => row.action), ['ingest'])
  reply(frames[0]); await ingest
})
