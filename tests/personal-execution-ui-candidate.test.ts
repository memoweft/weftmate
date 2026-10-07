import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { before, after } from 'node:test'

const repository = fileURLToPath(new URL('../', import.meta.url))
const script = join(repository, 'tests/integration/personal-execution-ui-candidate.mjs')
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
type Candidate = { processId: number; serviceOrigin: string; mobileBrowserHarnessUrl: string; controlUrl: string;
  privateLoginFixture: string; runtimeRoot: string; ownerId: string; owner: string; deviceId: string; hostId: string;
  sessionId: string; taskId: string; receiptId: string; artifactId: string;
  artifact: { artifactId: string; taskId: string; sessionId: string; sha256: string; size: number } }
let child: ChildProcess, candidate: Candidate, cookie: string

before(async () => {
  child = fork(script, [], { cwd: repository, silent: true, env: { ...process.env,
    WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE: '1', WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE_SMOKE: '0',
    WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE_ROOT: process.env.WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE_ROOT ??
      join(tmpdir(), 'weftmate-task15-narrow-contracts') } })
  candidate = await new Promise<Candidate>((resolve, reject) => {
    let stdout = '', stderr = ''
    const timer = setTimeout(() => reject(new Error('isolated candidate startup timed out')), 30_000)
    child.stderr!.on('data', (part) => { stderr += String(part) })
    child.stdout!.on('data', (part) => {
      stdout += String(part)
      const line = stdout.split('\n').find((row) => row.startsWith('{'))
      if (!line?.endsWith('}')) return
      try { const value = JSON.parse(line); if (value.publicMetadata && value.processId) {
        clearTimeout(timer); resolve(value)
      } } catch { /* A partial stdout line is not a ready candidate. */ }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`isolated candidate exited before readiness (${code}): ${stderr}`)) })
  })
  assert.equal(candidate.processId, child.pid)
  assert.equal(new URL(candidate.serviceOrigin).hostname, '127.0.0.1')
  assert.equal(new URL(candidate.mobileBrowserHarnessUrl).hostname, '127.0.0.1')
  const fixture = JSON.parse(await readFile(candidate.privateLoginFixture, 'utf8'))
  assert.equal(fixture.server, candidate.serviceOrigin)
  const response = await fetch(`${candidate.serviceOrigin}/personal/v1/auth/login`, { method: 'POST',
    headers: { origin: candidate.serviceOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: fixture.username, password: fixture.password, deviceName: 'Isolated bridge contract reader' }) })
  assert.equal(response.status, 200)
  cookie = response.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await response.json()).account.ownerId, candidate.ownerId)
})

after(async () => {
  if (!child || child.exitCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('isolated candidate did not close after its private IPC request')), 10_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    if (!child.connected) { clearTimeout(timer); reject(new Error('isolated candidate IPC unavailable')); return }
    child.send({ type: 'candidate.close' })
  })
})

async function direct(path: string) {
  const response = await fetch(`${candidate.serviceOrigin}/personal/v1${path}`, { headers: { cookie } })
  assert.equal(response.status, 200)
  return response.json()
}
async function bridge(method: string, params: unknown = {}) {
  const response = await fetch(new URL('/__candidate/mobile-bridge', candidate.mobileBrowserHarnessUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
  return { status: response.status, body: await response.json() }
}
async function control(action: string) {
  const response = await fetch(candidate.controlUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }) })
  assert.equal(response.status, 200)
  return response.json()
}

test('task15-narrow candidate bridge lists real host sessions and binds the native owner scope', async () => {
  const raw = await direct('/sessions'), response = await bridge('shared.sessions.list')
  assert.equal(response.status, 200)
  assert.equal(response.body.result.source, 'host')
  assert.equal(response.body.result.hostAvailable, true)
  assert.deepEqual(response.body.result.sessions, raw.sessions.map((row: object) => ({ ...row, source: 'host' })))
  assert.equal(raw.sessions.length, 1)
  assert.equal(raw.sessions[0].sessionId, candidate.sessionId)
  assert.equal(raw.sessions[0].sendAvailable, true)
  const bootstrap = await bridge('app.bootstrap')
  assert.equal(bootstrap.body.result.owner, sha(`${candidate.serviceOrigin}|${candidate.ownerId}`))
  assert.equal(bootstrap.body.result.owner, candidate.owner)
})

test('task15-narrow candidate bridge retains real history, cursor, receipt and host session identity', async () => {
  const raw = await direct(`/sessions/${candidate.sessionId}/events?afterSeq=-1&limit=100`)
  const response = await bridge('shared.sessions.events', { sessionId: candidate.sessionId, afterSeq: -1,
    source: 'host', owner: candidate.owner, ownerId: candidate.ownerId, hostId: candidate.hostId })
  assert.equal(response.status, 200)
  const result = response.body.result
  assert.equal(result.source, 'host'); assert.equal(result.sessionId, candidate.sessionId)
  assert.equal(result.hostAvailable, true); assert.equal(result.cached, false)
  assert.deepEqual(result.events, raw.events)
  assert.equal(result.nextSeq, raw.nextSeq); assert.equal(result.hasMore, raw.hasMore)
  assert.ok(result.events.some((row: any) => row.type === 'user.message' && row.data.receiptId === candidate.receiptId))
  const tail = await bridge('shared.sessions.events', { sessionId: candidate.sessionId, afterSeq: result.nextSeq })
  assert.equal(tail.status, 200); assert.deepEqual(tail.body.result.events, [])
  assert.equal(tail.body.result.nextSeq, result.nextSeq); assert.equal(tail.body.result.hasMore, false)
})

test('task15-narrow candidate bridge previews service-written bytes with exact artifact and task hashes', async () => {
  const taskResponse = await bridge('shared.tasks.detail', { taskId: candidate.taskId, sessionId: candidate.sessionId })
  assert.equal(taskResponse.status, 200)
  const task = taskResponse.body.result
  assert.equal(task.taskId, candidate.taskId); assert.equal(task.sessionId, candidate.sessionId)
  assert.equal(task.source.receiptId, candidate.receiptId)
  assert.equal(task.executionSteps.length, 4)
  const artifact = task.artifacts.find((row: any) => row.artifactId === candidate.artifactId)
  assert.ok(artifact)
  const raw = await direct(`/artifacts/${candidate.artifactId}/preview`)
  const response = await bridge('shared.artifacts.preview', { artifactId: artifact.artifactId,
    sessionId: candidate.sessionId, taskId: candidate.taskId })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.result, raw)
  const result = response.body.result
  for (const field of ['artifactId', 'taskId', 'sessionId', 'sha256', 'size']) assert.equal(result.artifact[field], artifact[field], field)
  assert.equal(result.artifact.verification.status, 'observed')
  assert.equal(result.artifact.verification.method, 'sha256_readback')
  const stored = await readFile(join(candidate.runtimeRoot, 'artifacts', candidate.ownerId, candidate.taskId, `${candidate.artifactId}.artifact`))
  assert.equal(result.text, stored.toString('utf8'))
  assert.equal(result.text, 'Candidate artifact: observed through the real isolated service.\n')
  assert.equal(result.artifact.sha256, sha(stored)); assert.equal(result.artifact.sha256, sha(result.text))
  assert.equal(result.artifact.size, stored.length); assert.equal(Buffer.byteLength(result.text), stored.length)
  assert.deepEqual(candidate.artifact, Object.fromEntries(['artifactId', 'taskId', 'sessionId', 'sha256', 'size'].map((field) => [field, artifact[field]])))
})

test('task15-narrow candidate bridge rejects invalid and mismatched owner, source, session, task and artifact contexts', async () => {
  for (const params of [null, [], { sessionId: '../wrong' }, { sessionId: candidate.sessionId, afterSeq: -2 },
    { sessionId: candidate.sessionId, afterSeq: '0' }]) {
    const response = await bridge('shared.sessions.events', params)
    assert.equal(response.status, 400); assert.equal(response.body.error.code, 'INVALID_REQUEST')
  }
  for (const params of [{ owner: 'other-owner' }, { ownerId: 'other-owner' }, { deviceId: 'other-device' },
    { hostId: 'other-host' }, { source: 'phone' }]) {
    const response = await bridge('shared.sessions.list', params)
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'CANDIDATE_CONTEXT_MISMATCH')
  }
  for (const [method, params] of [
    ['shared.sessions.events', { sessionId: 'session-other' }],
    ['shared.tasks.detail', { taskId: 'task-other' }],
    ['shared.artifacts.preview', { artifactId: candidate.artifactId, taskId: 'task-other' }],
    ['shared.artifacts.preview', { artifactId: candidate.artifactId, sessionId: 'session-other' }],
  ] as const) {
    const response = await bridge(method, params)
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'CANDIDATE_CONTEXT_MISMATCH')
  }
  const missing = await bridge('shared.artifacts.preview', { artifactId: 'artifact-missing' })
  assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'NOT_FOUND')
})

test('task15-narrow candidate bridge propagates a real history read failure and recovers only after it is readable', async () => {
  await control('history.fail')
  try { const response = await bridge('shared.sessions.events', { sessionId: candidate.sessionId, afterSeq: -1 })
    assert.equal(response.status, 503); assert.equal(response.body.error.code, 'BACKEND_UNAVAILABLE')
    assert.equal(response.body.result, undefined)
  } finally { await control('history.readable') }
  const recovered = await bridge('shared.sessions.events', { sessionId: candidate.sessionId, afterSeq: -1 })
  assert.equal(recovered.status, 200); assert.equal(recovered.body.result.source, 'host')
  assert.equal(recovered.body.result.sessionId, candidate.sessionId)
})

test('task15-narrow candidate bridge rejects same-size artifact tampering through the real readback guard', async () => {
  const path = join(candidate.runtimeRoot, 'artifacts', candidate.ownerId, candidate.taskId, `${candidate.artifactId}.artifact`)
  const original = await readFile(path), changed = Buffer.from(original); changed[0] ^= 1
  await writeFile(path, changed)
  try { const response = await bridge('shared.artifacts.preview', { artifactId: candidate.artifactId })
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'ARTIFACT_UNVERIFIED')
    assert.equal(response.body.result, undefined)
  } finally { await writeFile(path, original) }
})
