import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { conversationResources } from '../src/personal-access/resources.mjs'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

test('conversation resources project files, webpages and tools without returning raw output or other sessions', async () => {
  const step = { taskId: 'turn-1', stepId: 'read-1', toolName: 'read', summary: '读取 2 个文件', detailRef: { seq: 1 } }
  const events = [{ seq: 1, type: 'step.started', data: step }, { seq: 2, type: 'step.completed', data: { ...step, detailRef: { seq: 2 } } },
    { seq: 3, type: 'step.started', data: { ...step, stepId: 'web-1', toolName: 'web_fetch', detailRef: { seq: 3 } } }]
  const calls: any[] = []
  const context = { callBackend: async (read: any) => read(), backend: {
    readEvents: async (input: any) => { calls.push(input); return { events, nextSeq: 3, hasMore: false } },
    readEventDetail: async ({ seq }: any) => ({ text: JSON.stringify({ arguments: seq === 3 ? { url: 'https://example.com/reference' } :
      JSON.stringify({ paths: ['README.md', 'docs/PLAN.md', 'README.md'] }), output: 'private output omitted from list' }) }),
  } }
  const account = { commands: {
    output: { kind: 'artifact.save', sessionId: 'session-test', artifactId: 'artifact-test', fileName: 'report.md' },
    unrelated: { kind: 'artifact.save', sessionId: 'session-other', artifactId: 'artifact-other' },
  }, projectSources: { other: { ownerId: 'other', sessionId: 'session-test' } } }
  // Use the production artifact kind, rather than a parallel client-side convention.
  const { INTERNAL_ARTIFACT_KIND } = await import('../src/personal-access/constants.mjs')
  account.commands.output.kind = account.commands.unrelated.kind = INTERNAL_ARTIFACT_KIND
  const result = await conversationResources(context, account, 'session-test', 'owner-test', -1)
  assert.equal(result.outputs.length, 1); assert.equal(result.outputs[0].artifactId, 'artifact-test')
  assert.deepEqual(calls, [{ sessionId: 'session-test', ownerId: 'owner-test', afterSeq: -1, limit: 200 }])
  assert.ok(result.sources.some(row => row.key === 'file:README.md'))
  assert.ok(result.sources.some(row => row.key === 'file:docs/PLAN.md'))
  assert.ok(result.sources.some(row => row.key === 'webpage:https://example.com/reference'))
  const reads = result.sources.filter(row => row.key === 'file:README.md')
  assert.equal(new Set(reads.flatMap(row => row.uses.map(use => use.id))).size, 1, 'start and completion are one use')
  assert.equal(reads.at(-1)!.uses[0].path, '/sessions/session-test/events/2/detail')
  assert.doesNotMatch(JSON.stringify(result), /private output|artifact-other|"ownerId"/)
})

test('resource projection keeps a tool record when detail is unavailable and rejects a stalled page', async () => {
  const context = { callBackend: async (read: any) => read(), backend: {
    readEvents: async () => ({ events: [{ seq: 1, type: 'step.started', data: { taskId: 'turn-1', stepId: 'call-1', toolName: 'connector.search', detailRef: { seq: 1 } } }], nextSeq: 1, hasMore: false }),
    readEventDetail: async () => { throw new Error('unavailable') },
  } }
  const result = await conversationResources(context, { commands: {} }, 'session-test', 'owner-test', -1)
  assert.equal(result.sources[0].key, 'tool:connector.search')
  context.backend.readEvents = async () => ({ events: [], nextSeq: 1, hasMore: true })
  await assert.rejects(conversationResources(context, { commands: {} }, 'session-test', 'owner-test', 1), { code: 'BACKEND_UNAVAILABLE' })
})

test('resources HTTP API requires account session ownership, validates cursors and preserves incremental pagination', async () => {
  const sessions = new Set<string>(), inputs: any[] = []
  const backend = {
    getStatus: async () => ({}), listModels: async () => [{ id: 'local', configured: true }], preflight: async () => ({}),
    createSession: async ({ sessionId }: any) => { sessions.add(sessionId); return { sessionId } }, sendMessage: async () => ({}), cancelSession: async () => ({}),
    describeSession: async (sessionId: string) => sessions.has(sessionId) ? { sessionId, agentPreset: 'personal-remote' } : null,
    readEvents: async (input: any) => { inputs.push(input); return { events: [], nextSeq: input.afterSeq, hasMore: false } },
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'weftmate-resource-test-')))
  const service = await createPersonalAccessService({ root, port: 0, backend })
  try {
    const { origin, hostId } = await service.start(), setup = await service.issueSetupGrant()
    const request = async (path: string, cookie = '', body?: any) => fetch(origin + '/personal/v1' + path, {
      method: body ? 'POST' : 'GET', headers: { origin, cookie, 'content-type': 'application/json', ...(csrf ? { 'x-weftmate-csrf': csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    let csrf = ''
    const registered = await request('/auth/setup', '', { grant: setup.grant, username: 'ResourceFixture', password: `synthetic-${randomUUID()}`, deviceName: 'Resource Fixture' })
    assert.equal(registered.status, 201); const cookie = registered.headers.get('set-cookie')!.split(';')[0]; csrf = (await registered.json()).csrfToken
    const created = await request('/commands', cookie, { requestId: 'resource-create', kind: 'session.create', modelProfileId: 'local', targetDeviceId: hostId })
    assert.equal(created.status, 202); const command = (await created.json()).command
    for (let i = 0; i < 100; i++) { const row = await (await request(`/commands/${command.commandId}`, cookie)).json();
      if (row.command.state === 'accepted_by_dsh') break; await new Promise(done => setTimeout(done, 10)) }
    const sessionId = [...sessions][0]; assert.ok(sessionId)
    const empty = await request(`/sessions/${sessionId}/resources`, cookie)
    assert.equal(empty.status, 200); assert.deepEqual(await empty.json(), { outputs: [], sources: [], nextSeq: -1, hasMore: false })
    assert.equal(inputs.length, 0, 'fresh personal conversations have no native log yet')
    assert.equal((await request(`/sessions/${sessionId}/resources`)).status, 401)
    assert.equal((await request('/sessions/session-other/resources', cookie)).status, 404)
    for (const cursor of ['-2', 'x', '9007199254740992', '1&afterSeq=2', '1&extra=x']) assert.equal((await request(`/sessions/${sessionId}/resources?afterSeq=${cursor}`, cookie)).status, 400)
    const response = await request(`/sessions/${sessionId}/resources?afterSeq=12`, cookie)
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { outputs: [], sources: [], nextSeq: 12, hasMore: false })
    assert.equal(inputs.at(-1).afterSeq, 12); assert.ok(inputs.at(-1).ownerId)
    assert.ok(command.commandId)
  } finally { await service.close() }
})
