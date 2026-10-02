import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { createAlpha2ModelSettings, prepareAlpha2OfflineSettings, alpha2OfflineSettingsPatch } from '../src/plugins/weftmate-alpha2-model-settings.mjs'

const execFile = promisify(execFileCallback)

function harness() {
  let revision = 0
  const value: { providers: Record<string, unknown> } = { providers: {} }
  const calls: Array<{ ns: string, patch: unknown, expected: number | undefined }> = []
  const settingsController = {
    async describe() {
      return { namespaces: [{ ns: 'llm-pi-ai', revision, value: structuredClone(value) }] }
    },
    async update(ns: string, patch: { providers: Record<string, unknown> }, expected: number | undefined) {
      calls.push({ ns, patch: structuredClone(patch), expected })
      assert.equal(ns, 'llm-pi-ai')
      assert.equal(expected, revision)
      Object.assign(value.providers, patch.providers)
      revision += 1
      return { ns, revision, value: structuredClone(value) }
    },
  }
  const credentials = {
    describeCalls: [] as string[], resolveCalls: [] as string[],
    async describe(ref: string) { this.describeCalls.push(ref); return { configured: true, writable: true } },
    async resolve(ref: string) { this.resolveCalls.push(ref); return { value: 'synthetic-key-only-in-test', source: 'fake-safe-storage' } },
  }
  const sessionController = {
    async modelCatalog() { return { default: { provider: 'fake-loopback', model: 'test-model' }, routableProviders: ['fake-loopback'], groups: [{ id: 'fake-loopback', name: 'Fake loopback', models: [{ id: 'test-model', name: 'Test model' }] }], failures: [] } },
  }
  const accountController = { async getState() { return { status: 'signed-out', loginVisible: true, onboarding: false, secret: 'must-not-leak' } } }
  return { settingsController, credentials, sessionController, accountController, calls }
}

test('alpha2 model settings persists only official provider fields and reads them back through the V4 settings controller', async () => {
  const fake = harness()
  const service = createAlpha2ModelSettings(fake)
  const saved = await service.saveProvider({
    provider: 'fake-loopback', displayName: 'Fake loopback', api: 'openai-completions', baseURL: 'http://127.0.0.1:43123/v1/',
    models: [{ id: 'test-model', name: 'Test model', contextWindow: 4096, maxTokens: 256, input: ['text'] }],
    apiKey: 'this-field-is-not-a-persistence-route',
  })
  assert.deepEqual(saved.route, {
    provider: 'fake-loopback', displayName: 'Fake loopback', api: 'openai-completions',
    baseURL: 'http://127.0.0.1:43123/v1', apiKeyRef: 'WEFTMATE_ALPHA2_FAKE_LOOPBACK_API_KEY',
  })
  assert.equal(fake.calls.length, 1)
  assert.deepEqual(fake.calls[0]?.patch, {
    providers: {
      'fake-loopback': {
        displayName: 'Fake loopback', api: 'openai-completions', baseURL: 'http://127.0.0.1:43123/v1',
        apiKeyEnv: 'WEFTMATE_ALPHA2_FAKE_LOOPBACK_API_KEY',
        models: [{ id: 'test-model', name: 'Test model', contextWindow: 4096, maxTokens: 256, input: ['text'] }],
      },
    },
  })
  assert.deepEqual(await service.routeFor('fake-loopback'), saved.route)
  assert.equal(await service.routeFor('Fake Loopback'), undefined)
  const snapshot = await service.snapshot()
  assert.equal(snapshot.credentialWrite.remote, 'credentials.set')
  assert.equal(snapshot.credentialWrite.valueTransport, 'official-typert-remote')
  assert.equal(snapshot.account.available, true)
  assert.equal('secret' in snapshot.account, false)
})

test('alpha2 model settings diagnoses only a fake loopback OpenAI-compatible catalog without generating a model turn', async () => {
  let requestUrl = ''
  let authorization = ''
  const server = createServer((request, response) => {
    requestUrl = request.url ?? ''
    authorization = String(request.headers.authorization ?? '')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'test-model' }, { id: 'vision-model' }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.notEqual(typeof address, 'string')
    const fake = harness()
    const service = createAlpha2ModelSettings(fake)
    await service.saveProvider({
      provider: 'fake-loopback', baseURL: `http://127.0.0.1:${address.port}/v1`,
      models: [{ id: 'test-model' }],
    })
    assert.deepEqual(await service.diagnose('fake-loopback'), {
      status: 'reachable', provider: 'fake-loopback', httpStatus: 200, credentialConfigured: true, discoveredModels: 2,
    })
    assert.equal(requestUrl, '/v1/models')
    assert.equal(authorization, 'Bearer synthetic-key-only-in-test')
    assert.deepEqual(fake.credentials.resolveCalls, ['WEFTMATE_ALPHA2_FAKE_LOOPBACK_API_KEY'])
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('alpha2 model settings fails closed for remote and missing provider routes', async () => {
  const fake = harness()
  const service = createAlpha2ModelSettings(fake)
  await service.saveProvider({ provider: 'remote-test', baseURL: 'https://example.invalid/v1', models: [{ id: 'remote-model' }] })
  assert.deepEqual(await service.diagnose('remote-test'), { status: 'blocked_non_loopback', provider: 'remote-test' })
  assert.deepEqual(fake.credentials.resolveCalls, [])
  assert.deepEqual(await service.diagnose('not-configured'), { status: 'not_configured', provider: 'not-configured' })
  await assert.rejects(service.saveProvider({ provider: 'Not Valid', baseURL: 'http://127.0.0.1/v1', models: [{ id: 'model' }] }), /provider_invalid/)
})

test('alpha2 profile installs the model settings seam and never exposes a separate key-writing web route', async () => {
  const runtime = await readFile(join(process.cwd(), 'src', 'dsh-web-runtime.ts'), 'utf8')
  const source = await readFile(join(process.cwd(), 'src', 'plugins', 'weftmate-alpha2-model-settings.mjs'), 'utf8')
  assert.match(runtime, /id: weftmate-alpha2-model-settings/)
  assert.match(runtime, /weftmate-alpha2-model-settings\.mjs'\), join\(dir, 'plugins', 'weftmate-alpha2-model-settings\.mjs'\)/)
  assert.match(source, /credentialWrite: \{ remote: 'credentials\.set'/)
  assert.doesNotMatch(source, /credentials\.set\(/)
  assert.doesNotMatch(source, /apiKey\s*:/)
})

test('offline alpha2 settings preparation validates non-secret routes and renders only the official llm-pi-ai overlay', () => {
  const prepared = prepareAlpha2OfflineSettings({
    provider: 'prepared-loopback', apiKeyRef: 'WEFTMATE_ALPHA2_PREPARED_LOOPBACK_API_KEY', baseURL: 'http://127.0.0.1:1/v1/',
    models: [{ id: 'prepared-model', contextWindow: 4096, maxTokens: 256, input: ['text'] }],
  })
  assert.equal(prepared.providers['prepared-loopback']?.baseURL, 'http://127.0.0.1:1/v1')
  const patch = alpha2OfflineSettingsPatch(prepared)
  assert.match(patch, /"id": "llm-pi-ai"/)
  assert.match(patch, /WEFTMATE_ALPHA2_PREPARED_LOOPBACK_API_KEY/)
  assert.doesNotMatch(patch, /apiKey\s*:/)
  assert.throws(() => prepareAlpha2OfflineSettings({ provider: 'bad route', baseURL: 'http://127.0.0.1/v1', models: [{ id: 'x' }] }), /provider_invalid/)
})

test('offline preparation atomically preserves the prior candidate document when new input is invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-offline-settings-'))
  const input = join(root, 'provider.json')
  const script = join(process.cwd(), 'scripts', 'prepare-dsh-alpha2-model-settings.mjs')
  try {
    await writeFile(input, JSON.stringify({ provider: 'prepared-loopback', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'prepared-model' }] }), 'utf8')
    const first = await execFile(process.execPath, [script, '--home', root, '--provider-json', input], { cwd: process.cwd() })
    assert.match(first.stdout, /"prepared":true/)
    const documentPath = join(root, 'profiles', 'weftmate-alpha2', 'weftmate-alpha2-model-settings.json')
    const document = await readFile(documentPath)
    await writeFile(input, JSON.stringify({ provider: 'Not valid', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'bad' }] }), 'utf8')
    await assert.rejects(execFile(process.execPath, [script, '--home', root, '--provider-json', input], { cwd: process.cwd() }))
    assert.deepEqual(await readFile(documentPath), document)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prepared offline settings enter the next secure alpha2 snapshot and model catalog without a model request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-prepared-start-'))
  const input = join(root, 'provider.json')
  const prepare = join(process.cwd(), 'scripts', 'prepare-dsh-alpha2-model-settings.mjs')
  const runner = join(process.cwd(), 'scripts', 'run-dsh-alpha2-candidate.mjs')
  try {
    await writeFile(input, JSON.stringify({
      provider: 'prepared-loopback', apiKeyRef: 'WEFTMATE_ALPHA2_PREPARED_LOOPBACK_API_KEY',
      baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'prepared-model', contextWindow: 4096, maxTokens: 256, input: ['text'] }],
    }), 'utf8')
    await execFile(process.execPath, [prepare, '--home', root, '--provider-json', input], { cwd: process.cwd() })
    const started = await execFile(process.execPath, [runner, '--smoke', '--credential-smoke', '--prepared-settings-smoke'], {
      cwd: process.cwd(), timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, WEFTMATE_DSH_ALPHA2_HOME: root, WEFTMATE_DSH_ALPHA2_WORKSPACE: join(root, 'workspace') },
    })
    assert.match(`${started.stdout}\n${started.stderr}`, /prepared settings smoke passed/)
    const document = JSON.parse(await readFile(join(root, 'profiles', 'weftmate-alpha2', 'weftmate-alpha2-model-settings.json'), 'utf8'))
    assert.equal(document.providers['prepared-loopback'].apiKeyEnv, 'WEFTMATE_ALPHA2_PREPARED_LOOPBACK_API_KEY')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a hand-edited offline document with a secret field is rejected before secure preflight and cannot replace the last generated overlay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-prepared-reject-'))
  const input = join(root, 'provider.json')
  const prepare = join(process.cwd(), 'scripts', 'prepare-dsh-alpha2-model-settings.mjs')
  const runner = join(process.cwd(), 'scripts', 'run-dsh-alpha2-candidate.mjs')
  const environment = { ...process.env, WEFTMATE_DSH_ALPHA2_HOME: root, WEFTMATE_DSH_ALPHA2_WORKSPACE: join(root, 'workspace') }
  try {
    await writeFile(input, JSON.stringify({ provider: 'prepared-loopback', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'prepared-model' }] }), 'utf8')
    await execFile(process.execPath, [prepare, '--home', root, '--provider-json', input], { cwd: process.cwd() })
    await execFile(process.execPath, [runner, '--smoke', '--credential-smoke', '--prepared-settings-smoke'], { cwd: process.cwd(), timeout: 120_000, env: environment })
    const profile = join(root, 'profiles', 'weftmate-alpha2')
    const documentPath = join(profile, 'weftmate-alpha2-model-settings.json')
    const overlayPath = join(profile, 'weftmate-alpha2-model-settings.patch.yml')
    const previousOverlay = await readFile(overlayPath)
    await writeFile(documentPath, JSON.stringify({ schemaVersion: 1, providers: {
      'prepared-loopback': { baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'prepared-model' }], apiKey: 'must-never-enter-snapshot' },
    } }), 'utf8')
    await assert.rejects(execFile(process.execPath, [runner, '--smoke', '--credential-smoke'], { cwd: process.cwd(), timeout: 120_000, env: environment }))
    assert.deepEqual(await readFile(overlayPath), previousOverlay)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
