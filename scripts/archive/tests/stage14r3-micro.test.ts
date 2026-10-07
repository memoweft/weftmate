import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { runMicroOnce, validateOutputPath, writeMicroResult } from '../stage14r3-ninfer-micro.mjs'

async function fixture(reply: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(reply)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { port: address.port, async close() {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  } }
}
function chunk(choice: object, usage?: object) {
  return `data: ${JSON.stringify({ id: 'synthetic', choices: [choice], ...(usage ? { usage } : {}) })}\n\n`
}

test('split SSE records timing and numeric usage without retaining reasoning, text or tool arguments', async () => {
  const secretReason = 'SYNTHETIC_PRIVATE_REASONING_NEVER_PERSIST'
  const secretText = '合成私密正文_SYNTHETIC_PRIVATE_TEXT_NEVER_PERSIST'
  const secretArgs = 'SYNTHETIC_PRIVATE_ARGS_NEVER_PERSIST'
  let requests = 0
  const fake = await fixture(async (request, response) => {
    requests++
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/v1/chat/completions')
    let body = ''
    for await (const part of request) body += String(part)
    const sent = JSON.parse(body)
    assert.equal(sent.model, 'qwen3.8-27b')
    assert.equal(sent.reasoning_effort, 'low')
    assert.equal(sent.max_tokens, 64)
    assert.equal(sent.stream, true)
    assert.equal(sent.stream_options.include_usage, true)
    assert.equal(sent.tools.length, 7)
    assert.equal(sent.tool_choice, 'auto')
    assert.deepEqual([sent.temperature, sent.top_p, sent.top_k, sent.seed], [1, 0.95, 20, 140314])
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    const stream = [
      chunk({ index: 0, delta: { role: 'assistant' }, finish_reason: null }),
      chunk({ index: 0, delta: { reasoning_content: secretReason }, finish_reason: null }),
      chunk({ index: 0, delta: { content: secretText }, finish_reason: null }),
      chunk({ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: secretArgs } }] }, finish_reason: null }),
      chunk({ index: 0, delta: {}, finish_reason: 'tool_calls' }),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11,
        completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 } } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('')
    const bytes = Buffer.from(stream, 'utf8')
    for (let index = 0; index < bytes.length; index += 3) {
      response.write(bytes.subarray(index, index + 3))
      await pause(1)
    }
    response.end()
  })
  const directory = mkdtempSync(join(tmpdir(), 'weftmate-r3-micro-test-'))
  try {
    const result = await runMicroOnce({ port: fake.port, mode: 'mtp3', timeoutMs: 5_000 })
    assert.equal(requests, 1)
    assert.equal(result.status, 'finished')
    assert.equal(result.scope, 'micro_only')
    assert.equal(result.httpStatus, 200)
    assert.equal(result.finishReason, 'tool_calls')
    for (const key of ['requestAt', 'requestFlushedAt', 'headersAt', 'firstByteAt',
      'firstRoleAt', 'firstReasoningAt', 'firstTextAt', 'firstToolAt', 'finishAt', 'doneAt'])
      assert.equal(typeof result[key], 'string', key)
    assert.deepEqual(result.chunkCounts, { roles: 1, reasoning: 1, text: 1, tool: 1, usage: 1 })
    assert.deepEqual(result.usage, { promptTokens: 11, completionTokens: 7, totalTokens: 18,
      cachedPromptTokens: 3, reasoningTokens: 2 })
    const output = join(directory, 'micro-mtp3.json')
    await writeMicroResult(output, result, directory)
    const saved = readFileSync(output, 'utf8')
    for (const privateValue of [secretReason, secretText, secretArgs])
      assert.equal(saved.includes(privateValue), false)
    assert.equal(saved.includes('authorization'), false)
    assert.equal(saved.includes('apiKey'), false)
    assert.equal(JSON.parse(saved).status, 'finished')
  } finally { await fake.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('duplicate finish and malformed stream fail with closed metadata', async () => {
  for (const [payload, expected] of [
    [chunk({ index: 0, delta: {}, finish_reason: 'stop' }) +
      chunk({ index: 0, delta: {}, finish_reason: 'length' }) + 'data: [DONE]\n\n', 'DUPLICATE_FINISH'],
    ['data: {not-json}\n\n', 'MALFORMED_SSE'],
    [chunk({ index: 0, delta: { role: 'assistant' }, finish_reason: null }), 'INCOMPLETE_STREAM'],
  ] as const) {
    const fake = await fixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(payload)
    })
    try {
      const result = await runMicroOnce({ port: fake.port, mode: 'no-spec', timeoutMs: 2_000 })
      assert.equal(result.status, 'failed')
      assert.equal(result.errorCode, expected)
      assert.doesNotMatch(JSON.stringify(result), /not-json/)
    } finally { await fake.close() }
  }
})

test('non-200, timeout and caller cancellation close only the owned request without retry', async () => {
  let non200Count = 0
  const non200 = await fixture((_request, response) => {
    non200Count++
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{"secret":"SYNTHETIC_SERVER_PRIVATE"}')
  })
  try {
    const result = await runMicroOnce({ port: non200.port, mode: 'mtp3', timeoutMs: 2_000 })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'HTTP_STATUS')
    assert.equal(result.httpStatus, 503)
    assert.equal(non200Count, 1)
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SERVER_PRIVATE/)
  } finally { await non200.close() }
  let heldCount = 0
  const held = await fixture((_request, response) => { heldCount++; response.writeHead(200,
    { 'content-type': 'text/event-stream' }); response.write(': waiting\n\n') })
  try {
    const timed = await runMicroOnce({ port: held.port, mode: 'mtp3', timeoutMs: 80 })
    assert.equal(timed.status, 'timed_out')
    assert.equal(timed.errorCode, 'TIMEOUT')
    assert.equal(typeof timed.abortAt, 'string')
    const controller = new AbortController()
    const pending = runMicroOnce({ port: held.port, mode: 'mtp3', timeoutMs: 2_000,
      signal: controller.signal })
    await pause(30)
    controller.abort()
    const cancelled = await pending
    assert.equal(cancelled.status, 'aborted')
    assert.equal(cancelled.errorCode, 'ABORTED')
    assert.equal(heldCount, 2)
  } finally { await held.close() }
})

test('destination cannot be changed and output stays directly inside the named directory', async () => {
  assert.throws(() => runMicroOnce({ mode: 'mtp3', host: 'example.com' }), /INVALID_MICRO_CONFIGURATION/)
  assert.throws(() => runMicroOnce({ mode: 'mtp3', port: 0 }), /INVALID_MICRO_CONFIGURATION/)
  const refused = spawnSync(process.execPath, ['scripts/archive/stage14r3-ninfer-micro.mjs',
    '--run', '--mode', 'mtp3', '--output', 'micro-mtp3.json'], {
    cwd: new URL('../../../', import.meta.url), encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, WEFTMATE_STAGE14R3_MICRO: '0' },
  })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /EXPLICIT_MICRO_OPT_IN_REQUIRED/)
  const directory = mkdtempSync(join(tmpdir(), 'weftmate-r3-output-test-'))
  try {
    assert.equal(await validateOutputPath(join(directory, 'micro-mtp3.json'), directory),
      join(directory, 'micro-mtp3.json'))
    await assert.rejects(validateOutputPath(join(tmpdir(), 'micro-mtp3.json'), directory),
      /INVALID_OUTPUT_PATH/)
    await assert.rejects(validateOutputPath(join(directory, '..', 'outside.json'), directory),
      /INVALID_OUTPUT_PATH/)
    await assert.rejects(validateOutputPath(join(directory, 'nested', 'micro-mtp3.json'), directory))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
