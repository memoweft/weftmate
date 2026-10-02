import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

test('account-authenticated host model uses its stored key for catalog, JSON and SSE, and aborts a disconnected stream',
  { timeout: 35_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'personal-host-model-'))
    const upstreamCalls: Array<{ path: string; authorization: string | undefined; model?: string }> = []
    let streamClosed: (() => void) | undefined
    const streamClosedPromise = new Promise<void>((resolve) => { streamClosed = resolve })
    const upstream = createServer(async (request, response) => {
      const path = request.url ?? ''
      if (path === '/v1/models') {
        upstreamCalls.push({ path, authorization: request.headers.authorization })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ data: [{ id: 'synthetic-local-model' }] }))
        return
      }
      if (path !== '/v1/chat/completions') { response.writeHead(404).end(); return }
      const parts: Buffer[] = []
      for await (const chunk of request) parts.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
      upstreamCalls.push({ path, authorization: request.headers.authorization, model: body.model })
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"content":"synthetic"}}]}\n\n')
        if (body.messages[0]?.content === 'hold-stream') response.on('close', () => streamClosed?.())
        else if (body.messages[0]?.content === 'truncated-stream') response.end()
        else response.end('data: [DONE]\n\n')
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'synthetic answer' },
        ...(body.messages[0]?.content === 'limited-json' ? { finish_reason: 'length' } : {}) }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }))
    })
    let service: Awaited<ReturnType<typeof createPersonalAccessService>> | undefined
    try {
      const modelOrigin = await listen(upstream)
      const profile = { id: 'profile-qwen3.8', name: 'Dotted profile fixture', model: 'synthetic-local-model',
        baseUrl: `${modelOrigin}/v1` }
      const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://127.0.0.1:59999',
        referenceScan: () => ({ state: 'ready' }), profiles: () => [profile], hasCredential: () => true,
        credentialForProfile: () => 'server-only-synthetic-key',
        routeForProfile: () => ({ provider: 'fixture-provider' }),
        listSessions: async () => ({ items: [] }), resolveSession: async () => null,
        ensureKnownSession: async () => {}, gateway: async () => ({ groups: [] }),
        queue: async (work: () => Promise<unknown>) => work(), bindSession: () => {},
      })
      service = await createPersonalAccessService({ root, port: 0, backend,
        sharedProfileIsFormal: (marker: { id: string }) => marker.id === profile.id })
      await service.setSharedModelProfiles([{ id: profile.id, model: profile.model,
        baseUrl: profile.baseUrl, provider: 'openai-compatible', source: 'formal-host-catalog',
        credentialHash: createHash('sha256').update('server-only-synthetic-key').digest('hex') }])
      const { origin } = await service.start()
      const registered = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'synthetic-owner', password: 'synthetic owner password 123', deviceName: 'Phone' }) })
      assert.equal(registered.status, 201)
      const auth = await registered.json()
      const cookie = registered.headers.get('set-cookie')!.split(';')[0]
      const headers = { cookie, origin, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' }
      const models = await fetch(`${origin}/personal/v1/models`, { headers: { cookie } })
      assert.deepEqual((await models.json()).models[0].sourceKind, 'local')
      const verified = await fetch(`${origin}/personal/v1/models/profile-qwen3.8/verify`, { method: 'POST',
        headers, body: '{}' })
      assert.deepEqual(await verified.json(), { configured: true, reachable: true,
        modelListed: true, inferenceVerified: false })
      const body = { model: 'synthetic-local-model', messages: [{ role: 'user', content: 'hello' }], stream: false }
      assert.equal((await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers: { ...headers, origin: 'https://wrong.example' }, body: JSON.stringify(body) })).status, 403)
      assert.equal((await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify({ ...body, model: 'another-model' }) })).status, 422)
      const completed = await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(body) })
      assert.equal(completed.status, 200)
      assert.equal((await completed.json()).choices[0].message.content, 'synthetic answer')
      const limited = await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify({ ...body,
          messages: [{ role: 'user', content: 'limited-json' }] }) })
      assert.equal((await limited.json()).choices[0].finish_reason, 'length')
      const streamed = await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) })
      assert.equal(streamed.status, 200)
      assert.match(streamed.headers.get('content-type')!, /^text\/event-stream/)
      assert.match(await streamed.text(), /data: \[DONE\]/)
      const truncated = await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify({ ...body,
          messages: [{ role: 'user', content: 'truncated-stream' }], stream: true }) })
      await assert.rejects(truncated.text(), 'an upstream SSE without [DONE] must not look completed')
      const stop = new AbortController()
      const held = await fetch(`${origin}/personal/v1/models/profile-qwen3.8/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify({ ...body, messages: [{ role: 'user', content: 'hold-stream' }], stream: true }),
        signal: stop.signal })
      assert.equal(held.status, 200)
      await held.body!.getReader().read()
      stop.abort()
      await Promise.race([streamClosedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream remained open')), 3000))])
      assert.equal(upstreamCalls.every((call) => call.authorization === 'Bearer server-only-synthetic-key'), true)
      assert.equal(upstreamCalls.filter((call) => call.path === '/v1/chat/completions').length, 5)
    } finally {
      await service?.close()
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  })
