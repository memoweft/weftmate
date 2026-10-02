import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { canonicalArtifact, createPersonalArtifactStore } from '../src/personal-artifacts/index.mjs'

const PASSWORD = 'correct horse battery staple'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

function backend() {
  const sessions = new Set<string>()
  const calls: string[] = []
  return {
    calls, sessions,
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async ({ kind }: { kind: string }) => { calls.push(kind); return { ok: true } },
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => ({ accepted: true }),
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'Synthetic', agentPreset: 'personal-remote' } : null,
  }
}

async function api(origin: string, method: string, route: string, body?: object,
  headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, disposition: response.headers.get('content-disposition'),
    body: response.headers.get('content-type')?.includes('json')
      ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8') }
}

async function waitCommand(origin: string, headers: Record<string, string>, commandId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await api(origin, 'GET', `/personal/v1/commands/${commandId}`, undefined, headers)
    if (value.body.command.state !== 'pending' && value.body.command.state !== 'dispatching') return value.body.command
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('command did not settle')
}

test('owner turn writes and verifies one file; retry, conflict, account and revoked reads stay bounded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-artifact-'))
  const b = backend()
  const service = await createPersonalAccessService({ root, port: 0, backend: b })
  try {
    const { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    const setup = await api(origin, 'POST', '/personal/v1/auth/setup',
      { grant: grant.grant, username: 'Owner', password: PASSWORD, deviceName: 'Computer' }, { origin })
    assert.equal(setup.status, 201)
    // A second password device sends the source message.
    const cookie = (await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password: PASSWORD, deviceName: 'Phone' }) }))
    const phone = await cookie.json()
    const phoneAuth = { cookie: cookie.headers.get('set-cookie')!.split(';')[0], origin,
      'x-weftmate-csrf': phone.csrfToken }
    const create = await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'create-artifact-session', kind: 'session.create', targetDeviceId: hostId,
        modelProfileId: 'local' }, phoneAuth)
    assert.equal(create.status, 202)
    const sessionId = create.body.command.sessionId
    await waitCommand(origin, phoneAuth, create.body.command.commandId)
    const message = 'Write a short test document.'
    const sent = await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'source-message', kind: 'session.message', targetDeviceId: hostId,
        sessionId, text: message }, phoneAuth)
    assert.equal(sent.status, 202)
    const taskId = sent.body.command.commandId
    await waitCommand(origin, phoneAuth, taskId)
    const request = { sessionId, turn: 0, callId: 'call-1', messageHash: sha(message),
      fileName: '测试结果.md', content: '# Result\nVerified.\n' }
    const [result, duplicate] = await Promise.all([
      service.submitToolArtifact(request), service.submitToolArtifact(request),
    ])
    assert.equal(result.state, 'observed')
    assert.equal(duplicate.artifactId, result.artifactId)
    assert.equal(result.taskId, taskId)
    assert.equal(result.sha256, sha(request.content))
    assert.equal(result.verification.status, 'observed')
    assert.equal((await service.submitToolArtifact(request)).artifactId, result.artifactId)
    await assert.rejects(service.submitToolArtifact({ ...request, content: 'changed' }),
      (error: { code: string }) => error.code === 'REQUEST_CONFLICT')
    assert.equal((await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'forged', kind: 'desktop.write_artifact', targetDeviceId: hostId,
        sessionId, fileName: 'bad.md', content: 'bad' }, phoneAuth)).status, 400)
    const task = await api(origin, 'GET', `/personal/v1/tasks/${taskId}`, undefined, phoneAuth)
    assert.equal(task.body.sourceText, message)
    assert.equal(task.body.artifacts[0].artifactId, result.artifactId)
    assert.equal('sourceText' in (await api(origin, 'GET', '/personal/v1/commands',
      undefined, phoneAuth)).body.commands[0], false)
    assert.equal((await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/preview`,
      undefined, phoneAuth)).body.text, request.content)
    const downloaded = await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/download`,
      undefined, phoneAuth)
    assert.equal(downloaded.body, request.content)
    assert.equal(downloaded.disposition?.includes(`filename*=UTF-8''${encodeURIComponent(request.fileName)}`), true)
    const artifactPath = join(root, 'artifacts', setup.body.account.ownerId, taskId,
      `${result.artifactId}.artifact`)
    writeFileSync(artifactPath, 'tampered')
    assert.equal((await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/preview`,
      undefined, phoneAuth)).status, 409)
    writeFileSync(artifactPath, request.content)
    const other = await api(origin, 'POST', '/personal/v1/auth/register',
      { username: 'Other', password: PASSWORD, deviceName: 'Other phone' }, { origin })
    assert.equal(other.status, 201)
    const otherLogin = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Other', password: PASSWORD, deviceName: 'Other browser' }) })
    const otherAuth = { cookie: otherLogin.headers.get('set-cookie')!.split(';')[0], origin }
    assert.equal((await api(origin, 'GET', `/personal/v1/tasks/${taskId}`, undefined, otherAuth)).status, 404)
    assert.equal((await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/download`,
      undefined, otherAuth)).status, 404)
    const ownerCookie = (await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password: PASSWORD, deviceName: 'Control' }) }))
    const owner = await ownerCookie.json()
    const ownerAuth = { cookie: ownerCookie.headers.get('set-cookie')!.split(';')[0], origin,
      'x-weftmate-csrf': owner.csrfToken }
    assert.equal((await api(origin, 'DELETE', `/personal/v1/auth/devices/${phone.device.id}`,
      undefined, ownerAuth)).status, 200)
    assert.equal((await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/download`,
      undefined, phoneAuth)).status, 401)
    await assert.rejects(service.submitToolArtifact({ ...request, callId: 'call-2' }),
      (error: { code: string }) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
    assert.equal(b.calls.includes('desktop.write_artifact'), true)
    await service.close()
    const stateFile = join(root, 'store.json')
    const stored = JSON.parse(readFileSync(stateFile, 'utf8'))
    const saved = stored.accounts[stored.legacyOwnerId].commands[result.commandId]
    saved.state = 'dispatching'
    delete saved.verification
    writeFileSync(stateFile, JSON.stringify(stored))
    const recovered = await createPersonalAccessService({ root, port: 0, backend: b })
    try {
      const nextOrigin = (await recovered.start()).origin
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/commands/${result.commandId}`,
        undefined, { cookie: ownerAuth.cookie })).body.command.state, 'observed')
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/tasks/${taskId}`,
        undefined, { cookie: ownerAuth.cookie })).body.sourceText, message)
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/artifacts/${result.artifactId}/preview`,
        undefined, { cookie: ownerAuth.cookie })).body.text, request.content)
    } finally { await recovered.close() }
    const missingFile = join(root, 'artifacts', stored.legacyOwnerId, taskId, `${result.artifactId}.artifact`)
    rmSync(missingFile)
    const uncertainState = JSON.parse(readFileSync(stateFile, 'utf8'))
    uncertainState.accounts[uncertainState.legacyOwnerId].commands[result.commandId].state = 'dispatching'
    delete uncertainState.accounts[uncertainState.legacyOwnerId].commands[result.commandId].verification
    writeFileSync(stateFile, JSON.stringify(uncertainState))
    const uncertain = await createPersonalAccessService({ root, port: 0, backend: b })
    try {
      const nextOrigin = (await uncertain.start()).origin
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/commands/${result.commandId}`,
        undefined, { cookie: ownerAuth.cookie })).body.command.state, 'uncertain')
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/artifacts/${result.artifactId}/download`,
        undefined, { cookie: ownerAuth.cookie })).status, 404)
    } finally { await uncertain.close() }
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('private artifact storage rejects linked files, changed bytes and unsafe names', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-artifact-files-'))
  const store = createPersonalArtifactStore(join(root, 'artifacts'))
  const ownerId = 'owner-test', taskId = 'cmd-test', artifactId = 'artifact-test'
  const artifact = canonicalArtifact('notes.md', 'First line\n')
  const file = join(root, 'artifacts', ownerId, taskId, `${artifactId}.artifact`)
  try {
    for (const name of ['../bad.md', 'C:\\bad.md', 'bad.txt/child', 'a..md', 'CON.md']) {
      assert.throws(() => canonicalArtifact(name, 'text'), { code: 'INVALID_COMMAND' })
    }
    assert.equal(canonicalArtifact('方案记录.md', '内容').fileName, '方案记录.md')
    assert.throws(() => canonicalArtifact('good.md', '\ud800'), { code: 'INVALID_COMMAND' })
    assert.throws(() => canonicalArtifact('good.md', 'x'.repeat(128 * 1024 + 1)), { code: 'INVALID_COMMAND' })
    await store.write(ownerId, taskId, artifactId, artifact)
    assert.equal((await store.inspect(ownerId, taskId, artifactId, artifact)).toString(), 'First line\n')
    writeFileSync(file, 'Changed')
    await assert.rejects(store.inspect(ownerId, taskId, artifactId, artifact))
    rmSync(file)
    const external = join(root, 'external.txt')
    writeFileSync(external, 'First line\n')
    linkSync(external, file)
    await assert.rejects(store.inspect(ownerId, taskId, artifactId, artifact))
    await assert.rejects(store.write(ownerId, taskId, artifactId, artifact))
    assert.equal(readFileSync(external, 'utf8'), 'First line\n')
    rmSync(file)
    try {
      symlinkSync(external, file)
      await assert.rejects(store.inspect(ownerId, taskId, artifactId, artifact))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      // Windows without Developer Mode cannot create this synthetic link.
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
