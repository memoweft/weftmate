import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { artifactContentType, canonicalArtifact, createPersonalArtifactStore } from '../src/personal-artifacts/index.mjs'

const PASSWORD = 'correct horse battery staple'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

function backend(options: { receipts?: boolean } = {}) {
  const sessions = new Set<string>()
  const calls: string[] = []
  let messageSequence = 0
  return {
    calls, sessions,
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async ({ kind }: { kind: string }) => { calls.push(kind); return { ok: true } },
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => ({ accepted: true,
      ...(options.receipts ? { receiptId: `fixture-receipt-${++messageSequence}` } : {}) }),
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
    contentType: response.headers.get('content-type'), bytes,
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

async function artifactSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'personal-artifact-source-'))
  const b = backend({ receipts: true })
  const workspace = join(root, 'conversation')
  mkdirSync(workspace)
  let service = await createPersonalAccessService({ root, port: 0, backend: b })
  let { origin, hostId } = await service.start()
  const grant = await service.issueSetupGrant()
  await api(origin, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, username: 'SourceOwner', password: PASSWORD, deviceName: 'Fixture' }, { origin })
  const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'SourceOwner', password: PASSWORD, deviceName: 'Fixture caller' }) })
  const auth = { origin, cookie: login.headers.get('set-cookie')!.split(';')[0],
    'x-weftmate-csrf': (await login.json()).csrfToken }
  const opened = await api(origin, 'POST', '/personal/v1/commands',
    { requestId: 'source-fixture-session', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' }, auth)
  await waitCommand(origin, auth, opened.body.command.commandId)
  const sessionId = opened.body.command.sessionId
  return {
    root, get origin() { return origin }, auth, sessionId, workspace,
    registerFile(input: object) { return service.registerNativeFile({ sessionId, turn: 4,
      callId: 'native-write-call', ...input }) },
    async send(requestId: string, text: string) {
      const sent = await api(origin, 'POST', '/personal/v1/commands',
        { requestId, kind: 'session.message', targetDeviceId: hostId, sessionId, text }, auth)
      return waitCommand(origin, auth, sent.body.command.commandId)
    },
    save(input: object) { return service.submitToolArtifact({ sessionId, turn: 4,
      callId: 'source-fixture-call', fileName: 'source-result.csv', content: 'marker\nfixture\n', ...input }) },
    async restart() {
      await service.close()
      service = await createPersonalAccessService({ root, port: 0, backend: b })
      const restarted = await service.start()
      origin = restarted.origin
      auth.origin = origin
    },
    async preparedHash(commandId: string, modelInputHash: string) {
      await service.close()
      const file = join(root, 'store.json')
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      // The isolated record models a trusted prepared-input field, preserving its payload digest.
      const command = stored.accounts[stored.legacyOwnerId].commands[commandId]
      command.payload.modelInputHash = modelInputHash
      command.payloadHash = sha(JSON.stringify(command.payload))
      writeFileSync(file, JSON.stringify(stored))
      service = await createPersonalAccessService({ root, port: 0, backend: b })
      await service.start()
    },
    async close() { await service.close(); rmSync(root, { recursive: true, force: true }) },
  }
}

test('artifact source receipt selects the current accepted root when earlier same text has no turn binding', async () => {
  const f = await artifactSourceFixture()
  try {
    const text = 'Repeated fixture request.'
    const previous = await f.send('source-prior', text)
    const current = await f.send('source-current', text)
    const result = await f.save({ receiptId: current.receiptId, messageHash: sha(text) })
    assert.equal(result.state, 'observed')
    assert.equal(result.taskId, current.commandId)
    assert.notEqual(result.taskId, previous.commandId)
    const stored = JSON.parse(readFileSync(join(f.root, 'store.json'), 'utf8'))
    const commands = stored.accounts[stored.legacyOwnerId].commands
    assert.equal(commands[previous.commandId].dshTurn, undefined)
    assert.equal(commands[current.commandId].dshTurn, 4)
    assert.equal(commands[result.commandId].toolSource.sourceCommandId, current.commandId)
  } finally { await f.close() }
})

test('artifact source rejects a forged receipt even when its text hash has one candidate', async () => {
  const f = await artifactSourceFixture()
  try {
    const text = 'Unique fixture request.'
    await f.send('source-unique', text)
    await assert.rejects(f.save({ receiptId: 'fixture-forged-receipt', messageHash: sha(text) }),
      (error: { code: string }) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
  } finally { await f.close() }
})

test('artifact source uses the trusted prepared model input hash before the original text digest', async () => {
  const f = await artifactSourceFixture()
  try {
    const text = 'Fixture attachment source.'
    const source = await f.send('source-prepared', text)
    const prepared = sha('Canonical fixture model input with prepared attachment text.')
    await f.preparedHash(source.commandId, prepared)
    await assert.rejects(f.save({ receiptId: source.receiptId, messageHash: sha(text) }),
      (error: { code: string }) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
    const result = await f.save({ receiptId: source.receiptId, messageHash: prepared })
    assert.equal(result.state, 'observed')
    assert.equal(result.taskId, source.commandId)
  } finally { await f.close() }
})

test('artifact source retains a unique legacy source without a receipt', async () => {
  const f = await artifactSourceFixture()
  try {
    const text = 'Legacy unique fixture request.'
    const source = await f.send('source-legacy', text)
    const result = await f.save({ messageHash: sha(text) })
    assert.equal(result.state, 'observed')
    assert.equal(result.taskId, source.commandId)
  } finally { await f.close() }
})

test('artifact source refuses ambiguous legacy same text without selecting the latest request', async () => {
  const f = await artifactSourceFixture()
  try {
    const text = 'Legacy repeated fixture request.'
    await f.send('source-legacy-prior', text)
    await f.send('source-legacy-current', text)
    await assert.rejects(f.save({ messageHash: sha(text) }),
      (error: { code: string }) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
  } finally { await f.close() }
})

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
    const preview = await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/preview`,
      undefined, phoneAuth)
    assert.equal(preview.body.text, request.content)
    assert.equal(preview.body.artifact.contentType, 'text/plain; charset=utf-8')
    const downloaded = await api(origin, 'GET', `/personal/v1/artifacts/${result.artifactId}/download`,
      undefined, phoneAuth)
    assert.equal(downloaded.body, request.content)
    assert.equal(downloaded.contentType, 'text/plain; charset=utf-8')
    assert.equal(downloaded.disposition?.includes(`filename*=UTF-8''${encodeURIComponent(request.fileName)}`), true)
    const textSamples = [
      { fileName: '说明.txt', content: 'Plain UTF-8 text.\n', contentType: 'text/plain; charset=utf-8' },
      { fileName: '表格.csv', content: '\uFEFFname,note\r\n示例,"quoted, value"\r\n', contentType: 'text/csv; charset=utf-8' },
      { fileName: 'rows.tsv', content: 'name\tnote\n示例\tTabbed text\n', contentType: 'text/tab-separated-values; charset=utf-8' },
      { fileName: 'state.json', content: '{"name":"示例"}\n', contentType: 'text/plain; charset=utf-8' },
      { fileName: 'notes.pdf', content: 'This artifact contains text.\n', contentType: 'text/plain; charset=utf-8' },
    ]
    const textArtifacts: any[] = []
    for (const [index, sample] of textSamples.entries()) {
      const artifact = await service.submitToolArtifact({ ...request, callId: `text-${index}`,
        fileName: sample.fileName, content: sample.content })
      textArtifacts.push(artifact)
      assert.equal(artifact.state, 'observed')
      assert.equal(artifact.fileName, sample.fileName)
      assert.equal(artifact.contentType, sample.contentType)
      assert.equal(artifact.size, Buffer.byteLength(sample.content, 'utf8'))
      assert.equal(artifact.sha256, sha(sample.content))
      assert.equal(artifact.taskId, taskId)
      const delivered = await api(origin, 'GET', `/personal/v1/artifacts/${artifact.artifactId}/preview`,
        undefined, phoneAuth)
      assert.equal(delivered.body.text, sample.content)
      assert.equal(delivered.body.artifact.contentType, sample.contentType)
      const original = await api(origin, 'GET', `/personal/v1/artifacts/${artifact.artifactId}/download`,
        undefined, phoneAuth)
      assert.equal(original.status, 200)
      assert.deepEqual(original.bytes, Buffer.from(sample.content, 'utf8'))
      assert.equal(original.contentType, sample.contentType)
      assert.equal(original.disposition, `attachment; filename*=UTF-8''${encodeURIComponent(sample.fileName)}`)
    }
    const allArtifacts = (await api(origin, 'GET', `/personal/v1/tasks/${taskId}`, undefined, phoneAuth)).body.artifacts
    assert.deepEqual(allArtifacts.map((artifact: any) => artifact.fileName).sort(),
      [request.fileName, ...textSamples.map(sample => sample.fileName)].sort())
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
    assert.equal(saved.contentType, 'text/plain; charset=utf-8')
    for (const [index, artifact] of textArtifacts.entries()) {
      assert.equal(stored.accounts[stored.legacyOwnerId].commands[artifact.commandId].contentType,
        textSamples[index].contentType)
    }
    saved.state = 'dispatching'
    delete saved.verification
    delete saved.contentType // Legacy text records have no stored media type.
    writeFileSync(stateFile, JSON.stringify(stored))
    const recovered = await createPersonalAccessService({ root, port: 0, backend: b })
    try {
      const nextOrigin = (await recovered.start()).origin
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/commands/${result.commandId}`,
        undefined, { cookie: ownerAuth.cookie })).body.command.state, 'observed')
      assert.equal((await api(nextOrigin, 'GET', `/personal/v1/tasks/${taskId}`,
        undefined, { cookie: ownerAuth.cookie })).body.sourceText, message)
      const legacyPreview = await api(nextOrigin, 'GET', `/personal/v1/artifacts/${result.artifactId}/preview`,
        undefined, { cookie: ownerAuth.cookie })
      assert.equal(legacyPreview.body.text, request.content)
      assert.equal(legacyPreview.body.artifact.contentType, 'text/plain; charset=utf-8')
      const csv = textArtifacts[1], csvSample = textSamples[1]
      const csvOriginal = await api(nextOrigin, 'GET', `/personal/v1/artifacts/${csv.artifactId}/download`,
        undefined, { cookie: ownerAuth.cookie })
      assert.deepEqual(csvOriginal.bytes, Buffer.from(csvSample.content, 'utf8'))
      assert.equal(csvOriginal.contentType, csvSample.contentType)
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
    for (const name of ['../bad.md', 'C:\\bad.md', 'bad.txt/child', 'a..md', 'CON.md', 'notes.', 'name. ext']) {
      assert.throws(() => canonicalArtifact(name, 'text'), { code: 'INVALID_COMMAND' })
    }
    assert.equal(canonicalArtifact('方案记录.md', '内容').fileName, '方案记录.md')
    assert.equal(canonicalArtifact('tables.CSV', 'a,b\n1,2\n').contentType, 'text/csv; charset=utf-8')
    assert.equal(artifactContentType('notes.pdf'), 'text/plain; charset=utf-8')
    assert.throws(() => canonicalArtifact('good.csv', ''), { code: 'INVALID_COMMAND' })
    assert.throws(() => canonicalArtifact('good.csv', 'a\0b'), { code: 'INVALID_COMMAND' })
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


test('native files become verified artifacts without source snapshot arguments and survive restart', async () => {
  const fixture = await artifactSourceFixture()
  try {
    const text = 'Create two deliverables.'
    const command = await fixture.send('native-artifact-source', text)
    const identity = { receiptId: command.receiptId,
      messageHash: createHash('sha256').update(text).digest('hex') }
    const refs = []
    for (const name of ['report.md', 'analyze.py']) {
      const filePath = join(fixture.workspace, name)
      const content = name === 'report.md' ? '# Verified native report\n' : 'print("ready")\n'
      writeFileSync(filePath, content)
      const reference = await fixture.registerFile({ ...identity, filePath,
        sha256: createHash('sha256').update(content).digest('hex') })
      assert.equal(reference.state, 'observed')
      assert.equal(reference.fileName, name)
      assert.equal(reference.taskId, command.commandId)
      const downloaded = await api(fixture.origin, 'GET', `/personal/v1/artifacts/${reference.artifactId}/download`, undefined, fixture.auth)
      assert.equal(downloaded.status, 200)
      assert.equal(downloaded.bytes.toString('utf8'), content)
      const repeated = await fixture.registerFile({ ...identity, filePath,
        sha256: createHash('sha256').update(content).digest('hex') })
      assert.equal(repeated.artifactId, reference.artifactId)
      refs.push(reference)
    }
    assert.notEqual(refs[0].artifactId, refs[1].artifactId, 'one tool call may publish multiple files')
    await fixture.restart()
    assert.equal((await api(fixture.origin, 'GET', `/personal/v1/artifacts/${refs[0].artifactId}/preview`, undefined, fixture.auth)).status, 200)
    await assert.rejects(fixture.registerFile({ ...identity, filePath: join(fixture.workspace, 'report.md'), sha256: 'a'.repeat(64) }),
      (error: any) => error.code === 'ARTIFACT_UNVERIFIED')
  } finally { await fixture.close() }
})
