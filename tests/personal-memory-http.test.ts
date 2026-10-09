import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { canonicalMemoryPathname } from '../src/personal-memory/http.mjs'

const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [{ id: 'formal-local', name: 'Synthetic local', model: 'synthetic-model',
    configured: true, source: 'host', sourceKind: 'local' }],
  modelCompletion: async () => new Response(JSON.stringify({ choices: [
    { message: { role: 'assistant', content: 'synthetic response' }, finish_reason: 'stop' },
  ] }), { headers: { 'content-type': 'application/json' } }),
  preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }: { sessionId: string }) => ({ sessionId }),
  sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null,
}
async function api(origin: string, method: string, path: string, body?: object, auth?: any) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { origin } : {}), ...(auth ? { cookie: auth.cookie,
        'x-weftmate-csrf': auth.csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
}

test('account memory routes keep health, list, source, search cursor and Trust receipts within owner', async () => {
  assert.equal(canonicalMemoryPathname('/personal/v1/memory/items/cognition/c%3Aowner%3Aone'),
    '/personal/v1/memory/items/cognition/c:owner:one')
  const root = mkdtempSync(join(tmpdir(), 'personal-memory-http-'))
  let aOwner = '', bOwner = ''
  let statusUnavailable = false, submitThrows = false, bStatusReady = false
  let cleanupRetried = false
  const calls: Array<{ ownerId: string, method: string, params: any }> = []
  const item = (ownerId: string, id: string, text: string) => ({ item_id: id, object_kind: 'cognition',
    current_state: 'current', value: { content: text }, created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z', lifecycle: { invalid_at: null, archived_at: null, muted_at: null },
    provenance: [{ evidence_id: `e-${ownerId}` }] })
  const memory = {
    peek: (ownerId: string) => ownerId === aOwner ? 'connected' : 'unknown',
    status: async (ownerId: string) => (ownerId === aOwner && !statusUnavailable) ||
      (ownerId === bOwner && bStatusReady)
      ? { state: 'ready', worldRevision: 3, capabilities: {
        list: true, source: true, correct: true, mute: true, deleteEvidence: true, deleteWorldItem: true,
      } }
      : { state: 'unavailable', worldRevision: null, capabilities: {
        list: false, source: false, correct: false, mute: false, deleteEvidence: false, deleteWorldItem: false,
      }, reasonCode: 'MEMORY_UNAVAILABLE' },
    query: async (ownerId: string, method: string, params: any) => {
      calls.push({ ownerId, method, params })
      if (method === 'preview_forget') {
        if (params.target_id.includes('owner-') && !params.target_id.includes(ownerId)) throw Object.assign(new Error('not found'), { code: 'world_item_not_found' });
        return { world_revision: 3, item_count: 2, evidence_count: 1, evidence_ids: [`e-${ownerId}`], items: [
          { object_kind: 'entity', item_id: 'person', name: '王小明', item_type: 'person' },
          { object_kind: 'relationship', item_id: 'rel', name: '好兄弟', item_type: 'relationship' },
        ] };
      }
      if (method === 'query_world' && params.operation === 'list') return { world_revision: 3,
        items: [item(ownerId, `c-${ownerId}-one`, '合成短记忆'),
          item(ownerId, `c-${ownerId}-two`, '合成另一记忆'),
          item(ownerId, `c-${ownerId}-long`, `${'x'.repeat(4200)}尾命中`)] }
      if (method === 'query_world' && params.operation === 'get') {
        if (params.item_id.startsWith('c-owner-') && !params.item_id.includes(ownerId)) {
          throw Object.assign(new Error('not found'), { code: 'world_item_not_found' })
        }
        return { world_revision: 3, item: item(ownerId, params.item_id, '合成短记忆') }
      }
      if (method === 'query_evidence' && params.operation === 'get') return {
        world_revision: 3, evidence: { evidence_id: params.evidence_id } }
      if (method === 'query_provenance') return { world_revision: 3, provenance: [{
        evidence_id: `e-${ownerId}`, relation: 'support', currentness_state: 'current',
        permissions: { allow_local_read: true, allow_cloud_read: false, allow_inference: true },
        evidence: { summary: '合成来源', raw_content: '合成原文', content_available: true,
          recorded_at: '2026-09-27T00:00:00.000Z' },
        assistant_sources: [{ message_id: 'assistant-proposal', conversation_id: 'source-session',
          content: '以后组队时提醒你找这位朋友？', recorded_at: '2026-09-27T00:00:00.000Z' }],
      }] }
      throw new Error('unexpected memory method')
    },
    submitCommand: async (ownerId: string, proposal: any) => {
      if (submitThrows) throw Object.assign(new Error('uncertain dispatch'), { code: 'MEMORY_UNAVAILABLE' })
      const command = { ...proposal, subject_id: ownerId, command_id: `memory-${proposal.requestId}` }
      calls.push({ ownerId, method: 'submit_command', params: command })
      if (proposal.operation === 'delete_world_item' && proposal.targetId === 'c-shared') {
        return { receipt: { command_id: command.command_id, result_state: 'rejected',
          rejection_code: 'shared_source', after_revision: 4 } }
      }
      if (proposal.operation === 'delete_world_item' && ['c-dependent', 'c-no-source'].includes(proposal.targetId)) {
        return { receipt: { command_id: command.command_id, result_state: 'rejected',
          rejection_code: proposal.targetId === 'c-dependent' ? 'world_item_has_dependents'
            : 'source_provenance_missing', after_revision: 4 } }
      }
      if (proposal.operation === 'correct_world_item' && proposal.targetId === 'c-reject') {
        return { receipt: { command_id: command.command_id, result_state: 'rejected',
          rejection_code: 'source_evidence_shared', after_revision: 4 } }
      }
      return { receipt: { command_id: command.command_id, result_state: 'applied', after_revision: 4,
        storage_cleanup: proposal.operation === 'delete_evidence'
          ? { state: 'pending', detail_code: 'checkpoint_pending', path: 'never exposed' }
          : { state: 'complete', detail_code: 'current_wal_truncated', path: 'never exposed' } } }
    },
    receiptByRequest: async (ownerId: string, requestId: string) => ({
      operation: requestId === 'delete-one' ? 'delete_evidence' : 'correct_world_item',
      receipt: { command_id: `memory-${requestId}`, result_state: 'applied', after_revision: 4,
        ...(requestId === 'delete-one' ? { storage_cleanup: { state: cleanupRetried ? 'complete' : 'pending',
          detail_code: cleanupRetried ? 'current_wal_truncated' : 'wal_reader_busy' } } : {}) },
    }),
    retryCleanupByRequest: async (ownerId: string, requestId: string) => {
      assert.equal(ownerId, aOwner)
      if (requestId !== 'delete-one') throw Object.assign(new Error('not deletion'),
        { code: 'MEMORY_ACTION_UNSUPPORTED' })
      cleanupRetried = true
      return { operation: 'delete_evidence', receipt: { command_id: `memory-${requestId}`,
        result_state: 'applied', after_revision: 4,
        storage_cleanup: { state: 'complete', detail_code: 'current_wal_truncated' } } }
    },
  }
  const service = await createPersonalAccessService({ root, port: 0, backend, memoryManager: memory,
    sharedProfileIsFormal: (value: { id: string }) => value.id === 'formal-local' })
  try {
    const { origin } = await service.start()
    const register = async (username: string) => {
      const response = await api(origin, 'POST', '/personal/v1/auth/register',
        { username, password: 'synthetic owner password 123', deviceName: 'Fixture' })
      assert.equal(response.status, 201)
      return { ownerId: response.body.account.ownerId,
        cookie: response.cookie!.split(';')[0], csrf: response.body.csrfToken }
    }
    const a = await register('MemoryOwnerA'), b = await register('MemoryOwnerB')
    aOwner = a.ownerId; bOwner = b.ownerId
    const preview = await api(origin, 'GET', `/personal/v1/memory/items/cognition/c-${aOwner}-one/forget-preview`, undefined, a);
    assert.equal(preview.status, 200); assert.equal(preview.body.itemCount, 2);
    assert.deepEqual(preview.body.items.map((item: any) => item.text), ['王小明', '好兄弟']);
    assert.equal(preview.body.worldRevision, 3);
    assert.equal((await api(origin, 'GET', `/personal/v1/memory/items/cognition/c-${aOwner}-one/forget-preview`, undefined, b)).status, 404);
    const sourcePreview = await api(origin, 'GET', `/personal/v1/memory/evidence/e-${aOwner}/forget-preview`, undefined, a);
    assert.equal(sourcePreview.status, 200); assert.equal(calls.at(-1).params.target_kind, 'evidence');
    await service.setSharedModelProfiles([{ id: 'formal-local', model: 'synthetic-model',
      baseUrl: 'http://127.0.0.1:8081/v1', provider: 'openai-compatible',
      source: 'formal-host-catalog',
      credentialHash: createHash('sha256').update('synthetic').digest('hex') }])
    for (const account of [a, b]) {
      const direct = await api(origin, 'POST', '/personal/v1/models/formal-local/chat/completions',
        { model: 'synthetic-model', messages: [{ role: 'user', content: '合成手机直连消息' }], stream: false }, account)
      assert.equal(direct.status, 200)
      assert.equal(direct.body.choices[0].message.content, 'synthetic response')
    }
    assert.equal(calls.some((call) => ['preview_recall', 'query_interactions'].includes(call.method)), false,
      'stateless phone completion must not claim DSH owner-session memory injection')
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, a)).body.backend.modules.memory, 'connected')
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, b)).body.backend.modules.memory, 'unknown')
    assert.equal((await api(origin, 'GET', '/personal/v1/status')).status, 401)
    assert.equal((await api(origin, 'GET', '/personal/v1/memory/status', undefined, a)).body.capabilities.deleteEvidence, true)
    assert.equal((await api(origin, 'GET', '/personal/v1/memory/status', undefined, b)).body.state, 'unavailable')
    const first = await api(origin, 'GET', '/personal/v1/memory/items?kind=cognition&query=合成&limit=1', undefined, a)
    assert.equal(first.status, 200)
    assert.equal(first.body.items.length, 1)
    assert.equal(first.body.searchScope, 'account_snapshot')
    assert.equal(first.body.hasMore, true)
    const next = await api(origin, 'GET', `/personal/v1/memory/items?kind=cognition&query=合成&limit=1&after=${first.body.nextCursor}`, undefined, a)
    assert.equal(next.body.items.length, 1)
    assert.equal(next.body.hasMore, false)
    const tailMatch = await api(origin, 'GET', '/personal/v1/memory/items?kind=cognition&query=尾命中', undefined, a)
    assert.equal(tailMatch.body.items.length, 1)
    assert.equal(tailMatch.body.items[0].truncated, true)
    assert.equal((await api(origin, 'GET', `/personal/v1/memory/items?kind=cognition&query=合成&after=${first.body.nextCursor}`, undefined, b)).status, 400)
    const detail = await api(origin, 'GET', `/personal/v1/memory/items/cognition/c-${aOwner}-one`, undefined, a)
    assert.equal(detail.body.availableActions.correct.available, true)
    assert.equal(detail.body.availableActions.delete.available, true)
    const encodedId = `c%3A${aOwner}%3Aone`
    const encodedDetail = await api(origin, 'GET', `/personal/v1/memory/items/cognition/${encodedId}`, undefined, a)
    assert.equal(encodedDetail.status, 200, JSON.stringify(encodedDetail.body))
    assert.equal(encodedDetail.body.item.id, `c:${aOwner}:one`)
    assert.equal((await api(origin, 'GET', `/personal/v1/memory/items/cognition/${encodedId}/sources`, undefined, a)).status, 200)
    for (const unsafe of ['c%2Fother', 'c%5Cother', 'c%253Aother', 'c%ZZother', '%2E%2E']) {
      const result = await api(origin, 'GET', `/personal/v1/memory/items/cognition/${unsafe}`, undefined, a)
      assert.ok([400, 404].includes(result.status), unsafe)
    }
    assert.equal((await api(origin, 'GET', `/personal/v1/memory/items/cognition/c-${aOwner}-one`,
      undefined, b)).status, 404)
    const beforeCrossDelete = calls.filter((call) => call.method === 'submit_command').length
    bStatusReady = true
    assert.equal((await api(origin, 'DELETE', `/personal/v1/memory/items/cognition/c-${aOwner}-one`,
      { requestId: 'cross-owner-delete', expectedWorldRevision: 3 }, b)).status, 404)
    bStatusReady = false
    assert.equal(calls.filter((call) => call.method === 'submit_command').length, beforeCrossDelete)
    const source = await api(origin, 'GET', `/personal/v1/memory/items/cognition/c-${aOwner}-one/sources`, undefined, a)
    assert.equal(source.body.sources[0].permissions.allowCloudRead, false)
    assert.equal(source.body.sources[0].rawContent, '合成原文')
    assert.equal(source.body.sources[0].contentAvailable, true)
    assert.equal(source.body.sources[0].rawContentTruncated, false)
    assert.equal(source.body.sources[1].role, 'assistant')
    assert.equal(source.body.sources[1].messageId, 'assistant-proposal')
    assert.equal(source.body.sources[1].rawContent, '以后组队时提醒你找这位朋友？')
    assert.equal(source.body.sources[1].permissions.allowCloudRead, false)
    const command = await api(origin, 'POST', `/personal/v1/memory/items/cognition/c-${aOwner}-one/correct`,
      { requestId: 'fix-one', expectedWorldRevision: 3, text: '改正后的合成记忆' }, a)
    assert.equal(command.status, 200)
    assert.equal(command.body.receipt.storageCleanup.state, 'complete')
    assert.equal(JSON.stringify(command.body).includes('never exposed'), false)
    const deleted = await api(origin, 'DELETE', `/personal/v1/memory/evidence/e-${aOwner}`,
      { requestId: 'delete-one', expectedWorldRevision: 3 }, a)
    assert.equal(deleted.status, 200)
    assert.equal(calls.at(-1)?.params.operation, 'delete_evidence')
    assert.equal(calls.at(-1)?.params.subject_id, aOwner)
    assert.equal(deleted.body.receipt.storageCleanup.state, 'pending')
    const worldDelete = await api(origin, 'DELETE', `/personal/v1/memory/items/cognition/c-${aOwner}-one`,
      { requestId: 'world-delete-one', expectedWorldRevision: 3 }, a)
    assert.equal(worldDelete.status, 200)
    assert.equal(calls.at(-1)?.params.operation, 'delete_world_item')
    const sharedDelete = await api(origin, 'DELETE', '/personal/v1/memory/items/cognition/c-shared',
      { requestId: 'shared-delete', expectedWorldRevision: 3 }, a)
    assert.equal(sharedDelete.status, 409)
    assert.equal(sharedDelete.body.receipt.reasonCode, 'MEMORY_DELETE_CONFLICT')
    const dependentDelete = await api(origin, 'DELETE', '/personal/v1/memory/items/cognition/c-dependent',
      { requestId: 'dependent-delete', expectedWorldRevision: 3 }, a)
    assert.equal(dependentDelete.body.receipt.reasonCode, 'MEMORY_DELETE_CONFLICT')
    const unknownSource = await api(origin, 'DELETE', '/personal/v1/memory/items/cognition/c-no-source',
      { requestId: 'unknown-source', expectedWorldRevision: 3 }, a)
    assert.equal(unknownSource.body.receipt.reasonCode, 'MEMORY_DELETE_SOURCE_UNKNOWN')
    const ordinaryReject = await api(origin, 'POST', '/personal/v1/memory/items/cognition/c-reject/correct',
      { requestId: 'ordinary-reject', expectedWorldRevision: 3, text: '合成' }, a)
    assert.equal(ordinaryReject.body.receipt.reasonCode, 'MEMORY_COMMAND_REJECTED')
    const beforeRefusal = calls.filter((call) => call.method === 'submit_command').length
    statusUnavailable = true
    const preDispatch = await api(origin, 'POST', `/personal/v1/memory/items/cognition/c-${aOwner}-one/correct`,
      { requestId: 'pre-dispatch-unavailable', expectedWorldRevision: 3, text: '合成' }, a)
    assert.equal(preDispatch.status, 503)
    assert.equal(preDispatch.body.error.code, 'MEMORY_UNAVAILABLE')
    assert.equal(calls.filter((call) => call.method === 'submit_command').length, beforeRefusal)
    statusUnavailable = false
    submitThrows = true
    const uncertain = await api(origin, 'POST', `/personal/v1/memory/items/cognition/c-${aOwner}-one/correct`,
      { requestId: 'uncertain-dispatch', expectedWorldRevision: 3, text: '合成' }, a)
    assert.equal(uncertain.status, 503)
    assert.equal(uncertain.body.error.code, 'SERVICE_UNAVAILABLE',
      'a failure after dispatch entry cannot reuse a certain pre-dispatch code')
    submitThrows = false
    assert.equal((await api(origin, 'GET', '/personal/v1/memory/commands/by-request/fix-one', undefined, a)).status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/memory/commands/by-request/fix%3Aone', undefined, a)).status, 200)
    const pendingCleanup = await api(origin, 'GET',
      '/personal/v1/memory/commands/by-request/delete-one', undefined, a)
    assert.equal(pendingCleanup.body.receipt.storageCleanup.state, 'pending')
    const retriedCleanup = await api(origin, 'POST',
      '/personal/v1/memory/commands/by-request/delete-one/retry-cleanup', {}, a)
    assert.equal(retriedCleanup.body.receipt.storageCleanup.state, 'complete')
    assert.equal((await api(origin, 'GET', '/personal/v1/memory/commands/by-request/delete-one',
      undefined, a)).body.receipt.storageCleanup.state, 'complete')
    assert.equal((await api(origin, 'POST',
      '/personal/v1/memory/commands/by-request/fix-one/retry-cleanup', {}, a)).body.error.code,
    'MEMORY_ACTION_UNSUPPORTED')
    assert.equal(calls.some((call) => call.ownerId === bOwner && call.method === 'submit_command'), false)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
