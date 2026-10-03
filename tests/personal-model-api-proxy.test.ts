import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'
import { routeForProfile, writeModelRoutesPatch } from '../src/harness-model-routes.ts'
import { restoreInternalSessionRoute } from '../src/session-model-route-restore.ts'

async function rpc(origin: string, method: string, payload: object = {}) {
  const rpcId = randomUUID()
  const response = await fetch(new URL(`/api/${method}`, origin), { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }) })
  assert.equal(response.ok, true, `DSH carrier ${method}`)
  const frame = await response.json()
  assert.equal(frame.rpcId, rpcId)
  assert.equal(frame.result?.ok, true, `DSH ${method}: ${frame.result?.error?.code ?? 'unknown'}`)
  return frame.result.value
}

test('personal host has one ApiProxy: selecting B leaves default A through failure and cold restore',
  { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-personal-proxy-'))
  const home = join(root, 'dsh-home')
  await mkdir(home, { recursive: true })
  const key = randomBytes(24).toString('hex')
  const upstream = createServer((request, response) => {
    if (request.url !== '/v1/chat/completions' || request.headers.authorization !== `Bearer ${key}`) {
      response.writeHead(401).end(); return
    }
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('fixture port unavailable')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const profiles = [
    { id: 'fixture-a', name: 'A', provider: 'openai-compatible' as const,
      baseUrl, model: 'model-a' },
    { id: 'fixture-b', name: 'B', provider: 'openai-compatible' as const,
      baseUrl, model: 'model-b' },
  ]
  const routeA = routeForProfile('fixture-a').provider
  const routeB = routeForProfile('fixture-b').provider
  const routes = join(home, 'routes.patch.yml')
  writeModelRoutesPatch(routes, profiles)
  await appendFile(routes, `- id: agent-default-model\n  config:\n    provider: ${routeA}\n    model: model-a\n`, 'utf8')
  const security = join(home, 'security.patch.yml')
  await writeFile(security, [
    '- id: credentials', '  disabled: true',
    '- id: weftmate-credentials', '  disabled: true',
    '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs',
    '- id: api-gateway', '  disabled: true',
    '- insert:', '    - id: weftmate-personal-api-gateway',
    '      name: ./plugins/weftmate-personal-api-proxy.mjs', '',
    '- insert:', '    - id: weftmate-personal-model-idle',
    '      name: ./plugins/weftmate-personal-model-idle.mjs', '',
  ].join('\n'), 'utf8')
  const options = { homeDir: home, workspaceDir: join(root, 'workspace'),
    runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'), patchFiles: [routes, security],
    personalHostApiProxy: true, noOpen: true, readyTimeoutMs: 45_000,
    credentialRequestHandler: async ({ operation }: { operation: string }) =>
      operation === 'resolve' ? { value: key, source: 'fixture-vault' }
        : { configured: true, writable: true, source: 'fixture-vault' },
  }
  let runtime = new DshWebRuntime(options)
  try {
    let origin = await runtime.start()
    assert.deepEqual(((await rpc(origin, 'host.describe')) as any).provider, routeA)
    const sessionId = `session-${randomUUID()}`
    assert.equal(((await rpc(origin, 'session.create', { sessionId,
      agentPreset: 'personal-shared-chat' })) as any).sessionId, sessionId)
    const selected = await rpc(origin, 'session.selectModel', { sessionId,
      provider: routeB, model: 'model-b' })
    assert.equal((selected as any).selected.provider, routeB)
    assert.equal(((await rpc(origin, 'host.describe')) as any).provider, routeA)
    assert.equal(((await rpc(origin, 'session.models', { sessionId })) as any).current.provider, routeB)
    const failed = await fetch(new URL('/api/session.selectModel', origin), { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(),
        method: 'session.selectModel', payload: { sessionId, provider: 'missing-provider', model: 'no-model' } }) })
    assert.equal(failed.ok, true)
    assert.equal((await failed.json()).result.ok, false)
    assert.equal(((await rpc(origin, 'host.describe')) as any).provider, routeA)
    await rpc(origin, 'session.prompt', { sessionId, mode: 'queue',
      content: [{ type: 'text', text: 'synthetic persistence probe' }] })
    let completed = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const history = await rpc(origin, 'session.history', { sessionId }) as any
      if (history.events?.some((entry: any) => entry.event?.type === 'turn/end')) {
        completed = true; break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(completed, true, 'synthetic turn must durably finish before cold restart')
    await runtime.close()
    runtime = new DshWebRuntime(options)
    origin = await runtime.start()
    assert.equal(((await rpc(origin, 'host.describe')) as any).provider, routeA)
    assert.equal(((await rpc(origin, 'session.list')) as any).items.some((item: any) => item.sessionId === sessionId), true)
    await restoreInternalSessionRoute({ sessionId, profile: profiles[1], provider: routeB,
      needsRestore: true,
      current: () => rpc(origin, 'session.models', { sessionId }),
      select: (value) => rpc(origin, 'session.selectModel', { sessionId, ...value }),
    })
    assert.equal(((await rpc(origin, 'session.models', { sessionId })) as any).current.provider, routeB)
    assert.equal(((await rpc(origin, 'host.describe')) as any).provider, routeA)
  } finally {
    await runtime.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
