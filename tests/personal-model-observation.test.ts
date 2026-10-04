import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { createObservationRecorder } from '../src/personal-model-observation/record.mjs'
import { createPersonalModelObservationProxy } from '../src/personal-model-observation/proxy.mjs'
import { createSemanticObserver } from '../src/personal-model-observation/semantic.mjs'
import { stage14R2ObservationProfile } from '../src/personal-model-observation/policy.mjs'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('opaque relay preserves bytes, distinguishes slow first byte from upload close, and bounds metadata', async () => {
  const body = Buffer.from('synthetic-private-prompt')
  const secret = 'synthetic-private-key'
  const upstream = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`)
    let received = Buffer.alloc(0)
    for await (const part of req) received = Buffer.concat([received, part])
    assert.deepEqual(received, body)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'identity' })
    res.flushHeaders()
    await pause(70)
    res.end('data: synthetic-private-answer\n\n')
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const root = mkdtempSync(join(tmpdir(), 'weftmate-observation-unit-'))
  const file = join(root, 'wire.jsonl')
  const recorder = createObservationRecorder(file, { maxBytes: 4096 })
  const proxy = await createPersonalModelObservationProxy({
    targetOrigin: `http://127.0.0.1:${(upstream.address() as any).port}`,
    recorder, runId: 'run-synthetic',
  })
  try {
    const response = await new Promise<{ status: number, headers: any, body: Buffer }>((resolve, reject) => {
      const client = httpRequest(`${proxy.baseUrl}/chat/completions`, { method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json',
          'content-length': body.length } }, (res) => {
        const parts: Buffer[] = []
        res.on('data', (part) => parts.push(part))
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers,
          body: Buffer.concat(parts) }))
      })
      client.on('error', reject)
      client.end(body)
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers['content-encoding'], 'identity')
    assert.equal(response.body.toString(), 'data: synthetic-private-answer\n\n')
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(rows.map((row) => row.event), ['wire-arrival', 'wire-request-flushed',
      'wire-headers', 'wire-first-byte', 'wire-end'])
    assert.ok(Date.parse(rows[3].at) - Date.parse(rows[2].at) >= 40)
    assert.equal(rows[2].status, 200)
    assert.equal(rows[4].bytes, response.body.length)
    assert.equal(readFileSync(file, 'utf8').includes(secret), false)
    assert.equal(readFileSync(file, 'utf8').includes('synthetic-private-prompt'), false)
    assert.equal(readFileSync(file, 'utf8').includes('synthetic-private-answer'), false)
    recorder.record({ event: 'semantic-finish', secret, body: 'private', headers: { authorization: secret } })
    assert.equal(readFileSync(file, 'utf8').includes(secret), false)
  } finally {
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('relay cancellation destroys the upstream, records no false finish and closes its sockets', async () => {
  let upstreamClosed = false
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* consume request */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: first-byte\n\n')
    res.once('close', () => { upstreamClosed = true })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const rows: any[] = []
  const proxy = await createPersonalModelObservationProxy({
    targetOrigin: `http://127.0.0.1:${(upstream.address() as any).port}`,
    recorder: { record: (row: any) => rows.push(row) }, runId: 'run-synthetic',
  })
  try {
    const controller = new AbortController()
    const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: 'POST', body: 'x', signal: controller.signal,
    })
    assert.equal(response.status, 200)
    assert.ok((await response.body!.getReader().read()).value!.length > 0)
    controller.abort()
    for (let count = 0; count < 50 && !upstreamClosed; count++) await pause(10)
    assert.equal(upstreamClosed, true)
    assert.ok(rows.some((row) => row.event === 'wire-cancel'))
    assert.equal(rows.some((row) => row.event === 'wire-end'), false)
  } finally {
    await proxy.close()
    assert.equal(proxy.status().clients, 0)
    assert.equal(proxy.status().upstreams, 0)
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

test('closing one proxy frees its port without closing a recorder reused by the next proxy', async () => {
  const upstream = createServer(async (request, response) => {
    for await (const _ of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: done\n\n')
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const root = mkdtempSync(join(tmpdir(), 'weftmate-observation-retry-'))
  const file = join(root, 'wire.jsonl')
  const recorder = createObservationRecorder(file)
  const make = () => createPersonalModelObservationProxy({
    targetOrigin: `http://127.0.0.1:${(upstream.address() as any).port}`,
    recorder, runId: 'run-synthetic',
  })
  try {
    const first = await make()
    const oldUrl = `${first.baseUrl}/chat/completions`
    assert.equal((await fetch(oldUrl, { method: 'POST', body: 'one' })).status, 200)
    await first.close()
    assert.deepEqual(first.status(), { closed: true, active: 0, clients: 0, upstreams: 0 })
    await assert.rejects(fetch(oldUrl, { method: 'POST', body: 'late',
      signal: AbortSignal.timeout(1_000) }))
    assert.equal(recorder.record({ event: 'proxy-retry' }), true)
    const second = await make()
    assert.equal((await fetch(`${second.baseUrl}/chat/completions`, {
      method: 'POST', body: 'two',
    })).status, 200)
    await second.close()
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(rows.filter((row) => row.event === 'wire-arrival').length, 2)
    assert.equal(rows.some((row) => row.event === 'proxy-retry'), true)
  } finally {
    recorder.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('semantic hook binds only marked personal loop requests to exact signal and never records text', async () => {
  const rows: any[] = []
  const observer = createSemanticObserver({ record: (row: any) => rows.push(row),
    isAgentLoopRequest: (options: any) => options.marked === true })
  const signal = new AbortController().signal
  const agent = { session: { id: 'session-a', header: { agentPreset: 'personal-remote' } } }
  assert.deepEqual(await observer.request({ agent, turn: 3, step: 2, signal }, async () => ({ provider: 'x' })),
    { provider: 'x' })
  const options = { marked: true, signal, sessionId: 'session-a', provider: 'x', model: 'y',
    messages: [{ content: 'private prompt' }] }
  const chunks = async function* () {
    yield { type: 'reasoning-delta', text: 'private thought' }
    yield { type: 'tool-call-delta', argumentsDelta: '{"private":"value"}' }
    yield { type: 'text-delta', text: 'private answer' }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 5, secret: 'private' } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
  const observed = []
  for await (const chunk of observer.stream(options, chunks)) observed.push(chunk)
  assert.equal(observed.length, 5)
  assert.deepEqual(rows.map((row) => row.event), ['semantic-start', 'semantic-first-chunk',
    'semantic-first-reasoning', 'semantic-first-tool', 'semantic-first-text',
    'semantic-usage', 'semantic-finish'])
  assert.ok(rows.every((row) => row.sessionId === 'session-a' && row.turn === 3 && row.step === 2))
  assert.equal(rows.at(-2).inputTokens, 12)
  assert.equal(JSON.stringify(rows).includes('private'), false)
  for await (const _ of observer.stream({ ...options, purpose: 'session-title' }, chunks)) { /* ignored */ }
  assert.equal(rows.length, 7)
  const directBlock = async function* () {
    yield { type: 'block-end', block: { type: 'tool-call',
      name: 'private-tool-name', arguments: '{"private":"argument"}' } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
  for await (const _ of observer.stream(options, directBlock)) { /* exact next attempt */ }
  assert.equal(rows.filter((row) => row.event === 'semantic-first-tool').length, 2)
  assert.equal(JSON.stringify(rows).includes('private-tool-name'), false)
})

test('opt-in observation accepts only an isolated fixture profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage11-'))
  const ordinary = mkdtempSync(join(tmpdir(), 'ordinary-profile-'))
  try {
    if (process.platform === 'win32') assert.notEqual(parse(ordinary).root.toLowerCase(),
      parse(process.cwd()).root.toLowerCase(), 'this Windows fixture must exercise C: versus D:')
    assert.equal(stage14R2ObservationProfile({ enabled: '0', profile: ordinary,
      repository: ordinary, runId: 'a'.repeat(36) }), null)
    assert.equal(stage14R2ObservationProfile({ enabled: '1', profile: root,
      repository: ordinary, runId: 'a'.repeat(36) }).profile, root)
    assert.throws(() => stage14R2ObservationProfile({ enabled: '1', profile: ordinary,
      repository: ordinary, runId: 'a'.repeat(36) }), /isolated profile/)
    assert.throws(() => stage14R2ObservationProfile({ enabled: '1', profile: ordinary,
      repository: process.cwd(), runId: 'a'.repeat(36) }), /isolated profile/,
    'the real temporary profile cannot be treated as below the repository acceptance root')
    assert.throws(() => stage14R2ObservationProfile({ enabled: '1', profile: process.cwd(),
      repository: process.cwd(), runId: 'a'.repeat(36) }), /isolated profile/,
    'a same-drive ordinary repository path is not an acceptance profile')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(ordinary, { recursive: true, force: true })
  }
})
