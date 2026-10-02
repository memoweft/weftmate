import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAlpha2Mods } from '../src/plugins/weftmate-alpha2-mods.mjs'
import { readFile } from 'node:fs/promises'

function bridge() {
  const permissions = new Map<string, string>()
  const sessions = new Map<string, string | undefined>()
  return {
    async createWorkspace({ path }: { path: string }) { return { workspace: { workspaceId: `workspace:${path}` } } },
    async list() { return { items: [...sessions.keys()].map(sessionId => ({ sessionId })) } },
    async create({ sessionId, agentPreset }: { sessionId: string, agentPreset?: string }) { sessions.set(sessionId, agentPreset); return { sessionId } },
    async permissionCatalog() { return { options: [{ value: 'workspace-write' }], defaultPreset: 'workspace-write' } },
    async setPermissionPreset(sessionId: string, preset: string) { permissions.set(sessionId, preset); return { accepted: true, preset } },
    permissions,
    async inspectSession(sessionId: string) { return { meta: { agentPreset: sessions.get(sessionId) } } },
  }
}

test('alpha2 Mods use durable project lifecycle, host selfTest evidence, and stopped restart recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-mods-'))
  const firstBridge = bridge()
  try {
    const first = createAlpha2Mods({ bridge: firstBridge, inspectSession: firstBridge.inspectSession, root })
    const created = await first.api.create('Lifecycle counter')
    const projectId = created.projectId
    const sessionId = created.maintainerSessionId
    assert.equal(firstBridge.permissions.get(sessionId), 'workspace-write')

    const modified = await first.api.performForSmoke({ action: 'modify', project_id: projectId, sessionId })
    assert.equal(modified.revision, 'counter-increment-two')
    const candidate = await first.api.performForSmoke({ action: 'candidate', project_id: projectId, sessionId })
    const versionId = candidate.version.versionId
    await assert.rejects(first.api.performForSmoke({ action: 'invoke', project_id: projectId, sessionId, request: { action: 'increment' } }), /Start the Mod before invoking/)
    const validated = await first.api.performForSmoke({ action: 'validate', project_id: projectId, sessionId, version_id: versionId })
    assert.equal(validated.version.status, 'validated')
    assert.equal(validated.version.validationReceipt.host_oracle.kind, 'alpha2-host-isolated-state-observation')
    await first.api.performForSmoke({ action: 'enable', project_id: projectId, sessionId, version_id: versionId })
    const started = await first.api.performForSmoke({ action: 'start', project_id: projectId, sessionId })
    assert.equal(started.run.status, 'running')
    const invoked = await first.api.performForSmoke({ action: 'invoke', project_id: projectId, sessionId, request: { action: 'increment' } })
    assert.equal(invoked.result.count, 2)
    const stopped = await first.api.performForSmoke({ action: 'stop', project_id: projectId, sessionId })
    assert.equal(stopped.run.status, 'stopped')

    const secondBridge = bridge()
    const restarted = createAlpha2Mods({ bridge: secondBridge, inspectSession: secondBridge.inspectSession, root })
    await restarted.api.list()
    const status = await restarted.api.status()
    assert.equal(status.ready, true)
    assert.equal(status.execution.enabled, false)
    assert.deepEqual(status.projects.map(project => ({ projectId: project.projectId, sessionId: project.maintainerSessionId, desiredState: project.desiredState })), [
      { projectId, sessionId, desiredState: 'stopped' },
    ])
    assert.equal(secondBridge.permissions.get(sessionId), 'workspace-write')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alpha2 Mod tool passes the maintenance session identity to the lifecycle gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-mod-tool-'))
  try {
    const testBridge = bridge()
    const mods = createAlpha2Mods({ bridge: testBridge, inspectSession: testBridge.inspectSession, root })
    const project = await mods.api.create()
    const maintainer = { session: { id: project.maintainerSessionId, header: { agentPreset: 'mod-maintainer' } } }
    const status = await mods.tool.execute({ action: 'status', project_id: project.projectId }, { agent: maintainer })
    assert.equal(status.project.projectId, project.projectId)
    const ordinary = { session: { id: project.maintainerSessionId, header: { agentPreset: 'standard' } } }
    await assert.rejects(mods.tool.execute({ action: 'list' }, { agent: ordinary }), /formal mod-maintainer Agent preset/)
    await assert.rejects(mods.tool.execute({ action: 'create' }, { agent: ordinary }), /formal mod-maintainer Agent preset/)
    await assert.rejects(mods.tool.execute({ action: 'status', project_id: project.projectId, sessionId: project.maintainerSessionId }, { agent: { session: { id: 'other-session', header: { agentPreset: 'mod-maintainer' } } } }), /cannot be supplied by the caller/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alpha2 Mod HTTP lifecycle gate uses a non-credential smoke challenge and remains absent by default', async () => {
  const source = await readFile(new URL('../src/plugins/weftmate-alpha2-mods.mjs', import.meta.url), 'utf8')
  assert.match(source, /WEFTMATE_ALPHA2_SMOKE_CHALLENGE/)
  assert.match(source, /WEFTMATE_ALPHA2_MODS_SMOKE === '1'/)
  assert.match(source, /x-weftmate-alpha2-smoke-challenge/)
  assert.doesNotMatch(source, /MODS_SMOKE_TOKEN/)
})
