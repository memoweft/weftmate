import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { apply, PROTOCOL } from '../src/plugins/weftmate-personal-model-idle.mjs'

test('route reload fence treats a queued or running DSH agent as busy without reading message text', () => {
  const originalSend = process.send
  const replies: any[] = []
  let cleanup = () => {}
  let agents: any[] = []
  ;(process as any).send = (value: unknown) => { replies.push(value) }
  try {
    apply({ agents: { list: () => agents }, effect: (dispose: () => () => void) => { cleanup = dispose() } })
    const ask = () => {
      const id = `model-idle-${randomUUID()}`
      process.emit('message', { protocol: PROTOCOL, id })
      return replies.at(-1)
    }
    assert.equal(ask().idle, true)
    agents = [{ status: 'idle', inbox: { hasPending: true,
      nextTurn: [{ content: [{ type: 'text', text: 'synthetic private goal' }] }] } }]
    assert.equal(ask().idle, false)
    agents = [{ status: 'running', inbox: { hasPending: false } }]
    assert.equal(ask().idle, false)
    agents = [{ status: 'idle', inbox: { hasPending: false } }]
    assert.equal(ask().idle, true)
    assert.equal(JSON.stringify(replies).includes('synthetic private goal'), false)
  } finally { cleanup(); (process as any).send = originalSend }
})
