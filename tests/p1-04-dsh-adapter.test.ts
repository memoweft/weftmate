import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createDshSessionAdapter, DshAdapterError } from '../src/runtime/dsh-adapter/sessions.mjs'
import { createDshWorkspaceAdapter } from '../src/runtime/dsh-adapter/workspace.mjs'
import { createDshModelAdapter } from '../src/runtime/dsh-adapter/models.mjs'
import { createDshPermissionAdapter } from '../src/runtime/dsh-adapter/permissions.mjs'

const ok = <T>(value: T) => ({ result: { ok: true as const, value } })
const fail = (code: string, detail: unknown) => ({ result: { ok: false as const, error: { code, detail } } })

const WORKSPACE_VIEW = {
  workspaceId: 'ws-1', path: '/tmp/proj', title: 'proj',
  sessionIds: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

function workspaceClient(calls: Array<{ method: string; value: unknown }>) {
  return {
    workspace: {
      list: async (value: unknown) => { calls.push({ method: 'workspace.list', value }); return ok({ items: [WORKSPACE_VIEW], archivedSessionIds: [] }) },
      create: async (value: unknown) => { calls.push({ method: 'workspace.create', value }); return ok({ workspace: WORKSPACE_VIEW, created: true }) },
      rename: async (value: unknown) => { calls.push({ method: 'workspace.rename', value }); return ok({ workspace: { ...WORKSPACE_VIEW, title: 'renamed' } }) },
      delete: async (value: unknown) => { calls.push({ method: 'workspace.delete', value }); return ok({ deleted: true }) },
    },
  }
}

describe('P1-04 · DSH workspace adapter', () => {
  it('list/create/rename/remove use only the supported client methods and pass views verbatim', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const adapter = createDshWorkspaceAdapter(workspaceClient(calls))
    const listed = await adapter.list()
    assert.equal(listed.items[0].workspaceId, 'ws-1')
    const created = await adapter.create({ path: '/tmp/proj' })
    assert.equal(created.created, true); assert.equal(created.workspace.path, '/tmp/proj')
    await adapter.rename({ workspaceId: 'ws-1', title: 'renamed' })
    await adapter.remove({ workspaceId: 'ws-1' })
    assert.deepEqual(calls.map((call) => call.method), ['workspace.list', 'workspace.create', 'workspace.rename', 'workspace.delete'])
    assert.deepEqual(calls[1].value, { path: '/tmp/proj' })
  })

  it('rejects malformed input locally and maps DSH error codes onto redacted failures', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const client = workspaceClient(calls)
    client.workspace.create = async () => fail('workspace-invalid-path', { secret: 'C:\\private\\x' })
    const adapter = createDshWorkspaceAdapter(client)
    await assert.rejects(adapter.create({ path: '' }), TypeError)
    await assert.rejects(adapter.remove({ workspaceId: '' }), TypeError)
    await assert.rejects(adapter.rename({ workspaceId: 'ws-1', title: '  ' }), TypeError)
    await assert.rejects(adapter.create({ path: '/missing' }), (error: unknown) =>
      error instanceof DshAdapterError && error.code === 'workspace-invalid-path')
    const text = JSON.stringify(await adapter.create({ path: '/missing' }).catch((error) => ({ digest: (error as DshAdapterError).details })))
    assert.equal(text.includes('C:\\private'), false)
    assert.match(((await adapter.create({ path: '/missing' }).catch((error) => error)) as DshAdapterError).details.digest ?? '', /^[a-f0-9]{64}$/)
  })

  it('requires a supported client shape', () => {
    assert.throws(() => createDshWorkspaceAdapter({} as never), TypeError)
  })
})

describe('P1-04 · DSH model adapter', () => {
  function modelClient(calls: Array<{ method: string; value: unknown }>) {
    return {
      llm: {
        models: async (value: unknown) => {
          calls.push({ method: 'llm.models', value })
          return ok({ groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'm-1', name: 'M1' }] }], failures: [] })
        },
      },
      sessions: {
        models: async (value: unknown) => {
          calls.push({ method: 'session.models', value })
          return ok({ current: { provider: 'deepseek-official', model: 'm-1' }, routable: true, groups: [], failures: [] })
        },
        selectModel: async (value: unknown) => {
          calls.push({ method: 'session.selectModel', value })
          return ok({ selected: { provider: (value as any).provider, model: (value as any).model } })
        },
      },
    }
  }

  it('catalog / session view / select round-trip without inventing fields', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const adapter = createDshModelAdapter(modelClient(calls))
    const catalog = await adapter.catalog()
    assert.equal(catalog.groups[0].id, 'deepseek-official')
    const view = await adapter.sessionModels('s-1')
    assert.equal(view.current.model, 'm-1'); assert.equal(view.routable, true)
    const selected = await adapter.selectSessionModel('s-1', { provider: 'p', model: 'm2' })
    assert.deepEqual(selected.selected, { provider: 'p', model: 'm2' })
    // 无 reasoningEffort 时不得把显式 undefined 送上线。
    assert.deepEqual(calls[2].value, { sessionId: 's-1', provider: 'p', model: 'm2' })
    await adapter.selectSessionModel('s-1', { provider: 'p', model: 'm2', reasoningEffort: 'high' })
    assert.deepEqual(calls[3].value, { sessionId: 's-1', provider: 'p', model: 'm2', reasoningEffort: 'high' })
  })

  it('validates inputs and maps rejections to redacted errors', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const client = modelClient(calls)
    client.sessions.models = async () => fail('session-not-found', {})
    const adapter = createDshModelAdapter(client)
    await assert.rejects(adapter.sessionModels(''), TypeError)
    await assert.rejects(adapter.selectSessionModel('s-1', { provider: '', model: 'm' }), TypeError)
    await assert.rejects(adapter.sessionModels('s-x'), (error: unknown) => error instanceof DshAdapterError && error.code === 'session-not-found')
  })
})

describe('P1-04 · DSH permission-preset adapter', () => {
  const PERMISSION_NS = {
    ns: 'permission', schema: {}, value: { preset: 'default' }, applies: 'live',
    secrets: [], revision: 3,
  }

  function settingsClient(calls: Array<{ method: string; value: unknown }>) {
    return {
      settings: {
        describe: async (value: unknown) => {
          calls.push({ method: 'settings.describe', value })
          return ok({ writable: true, hasDocument: true, namespaces: [{ ns: 'ui-theme' }, PERMISSION_NS] })
        },
        update: async (value: unknown) => { calls.push({ method: 'settings.update', value }); return ok({ ...PERMISSION_NS, revision: 4 }) },
        replace: async (value: unknown) => { calls.push({ method: 'settings.replace', value }); return ok({ ...PERMISSION_NS, revision: 5 }) },
      },
    }
  }

  it('describe picks only the permission namespace out of the redacted describe view', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const adapter = createDshPermissionAdapter(settingsClient(calls))
    const namespace = await adapter.describe()
    assert.equal(namespace?.ns, 'permission'); assert.equal(namespace?.revision, 3)
  })

  it('update/replace always address the permission namespace and forward expectedRevision only when present', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const adapter = createDshPermissionAdapter(settingsClient(calls))
    await adapter.update({ patch: { preset: 'danger-full-access' } })
    assert.deepEqual(calls[0].value, { ns: 'permission', patch: { preset: 'danger-full-access' } })
    await adapter.update({ patch: {}, expectedRevision: 3 })
    assert.deepEqual(calls[1].value, { ns: 'permission', patch: {}, expectedRevision: 3 })
    await adapter.replace({ section: {} })
    assert.deepEqual(calls[2].value, { ns: 'permission', section: {} })
    await assert.rejects(adapter.update({ patch: null }), TypeError)
    await assert.rejects(adapter.replace({ section: [] }), TypeError)
  })

  it('maps a settings rejection to a redacted DshAdapterError', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const client = settingsClient(calls)
    client.settings.update = async () => fail('settings-rejected', { reason: 'schema mismatch' })
    const adapter = createDshPermissionAdapter(client)
    await assert.rejects(adapter.update({ patch: {} }), (error: unknown) =>
      error instanceof DshAdapterError && error.code === 'settings-rejected')
  })
})

describe('P1-04 · sessions adapter safe-code table extension', () => {
  it('keeps P1-03 behaviour while accepting the new domain codes', () => {
    void createDshSessionAdapter({
      sessions: {}, events: {},
    } as never).resume('nope').catch(() => undefined)
    assert.equal(new DshAdapterError('workspace-name-conflict', 'op').code, 'workspace-name-conflict')
    assert.equal(new DshAdapterError('settings-rejected', 'op').code, 'settings-rejected')
    assert.equal(new DshAdapterError('vendor-secret-leak', 'op').code, 'dsh-rejected')
  })
})
