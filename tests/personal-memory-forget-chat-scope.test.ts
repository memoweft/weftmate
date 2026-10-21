import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { classifyForgetRequest } from '../src/personal-memory/forget-model.mjs'

const fixtures = JSON.parse(await readFile(new URL('./fixtures/forget-intent-chat-scope.json', import.meta.url), 'utf8'))

// Transport/authorization invariants. These scripted responses do not claim
// model understanding; the same fixtures also drive the authorized live judge.
test('chat preservation never strips the full request or overrides the constrained judge', async () => {
  let expected = '', output: any, previous: any
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const request = JSON.parse(raw)
    const input = JSON.parse(request.messages.at(-1).content)
    assert.equal(input.message, expected)
    assert.deepEqual(input.previousScope, previous)
    assert.equal(request.tool_choice, 'required')
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ type: 'function', function: { name: 'classify_forget_request', arguments: JSON.stringify(output) } }],
    } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const route = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: 'synthetic', credential: 'synthetic' }
  try {
    for (const fixture of fixtures) {
      expected = fixture.message
      output = { isForgetRequest: fixture.authorized, subject: 'self', topic: '音乐偏好', conditionsOrQuestions: !fixture.authorized }
      assert.equal((await classifyForgetRequest(route, expected)).authorized, fixture.authorized, fixture.id)
    }
    expected = fixtures[0].message
    // Frozen real pre-fix output: words about preserving chat must never make
    // the host promote a denied/conditional model decision into permission.
    output = { isForgetRequest: false, subject: 'self', topic: '最喜欢的零食是芝麻饼', conditionsOrQuestions: true }
    assert.equal((await classifyForgetRequest(route, expected)).authorized, false)
    output = { isForgetRequest: true, subject: 'self', topic: '零食偏好', conditionsOrQuestions: true }
    assert.equal((await classifyForgetRequest(route, expected)).authorized, false)
    output = { isForgetRequest: true, subject: 'unknown', topic: '零食偏好', conditionsOrQuestions: false }
    assert.equal((await classifyForgetRequest(route, expected)).authorized, false)
    output = { isForgetRequest: true, subject: 'self', topic: '', conditionsOrQuestions: false }
    assert.equal((await classifyForgetRequest(route, expected)).authorized, false)
    previous = { subject: 'self', topic: '音乐偏好' }
    output = { isForgetRequest: true, subject: 'self', topic: '零食偏好', conditionsOrQuestions: false }
    assert.equal((await classifyForgetRequest(route, expected, { authorized: true, ...previous })).authorized, false)
    output.topic = previous.topic
    assert.equal((await classifyForgetRequest(route, expected, { authorized: true, ...previous })).authorized, true)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
