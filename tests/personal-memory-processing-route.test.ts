import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'

const ownerA = 'owner-00000000-0000-4000-8000-000000000001'
const ownerB = 'owner-00000000-0000-4000-8000-000000000002'
const required = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup', 'query_jobs']

test('account memory workers follow only the owner session route and restart without losing the outbox', async t => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-processing-route-'))
  writeFileSync(join(root, 'pyproject.toml'), '[project]\nversion = "2.0.0-synthetic"\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const routes = new Map<string, any>([
    [`${ownerA}\0session-a-old`, { profileId: 'private-model-a-old',
      baseUrl: 'https://cloud-a.invalid/v1', model: 'model-a-old',
      routeFingerprint: 'a'.repeat(64), credential: 'secret-a-old' }],
    [`${ownerB}\0session-b`, { profileId: 'private-model-b',
      baseUrl: 'https://cloud-b.invalid/v1', model: 'model-b',
      routeFingerprint: 'b'.repeat(64), credential: 'secret-b' }],
  ])
  const instances: any[] = []
  const backgroundRoutes = new Map<string, any>()
  const rpcFactory = ({ env }: any) => {
    const rpc: any = { env, child: null, closed: false, initialized: null, ingested: [] as string[],
      async request(method: string, params: any = {}) {
        this.child ??= {}
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
          schema_version: 1, methods: required }
        if (method === 'initialize') { this.initialized = structuredClone(params)
          return { runtime: { subject_id: params.subject_id,
            db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
          capabilities: { methods: required, subject_id: params.subject_id, services: { command: { operations: [] } } } } }
        if (method === 'health') return { runtime: { subject_id: this.initialized.subject_id,
          route_ready: true } }
        if (method === 'query_world') return params.operation === 'revision'
          ? { world_revision: 0 } : { world_revision: 0, items: [] }
        if (method === 'ingest_boundary') { this.ingested.push(params.boundary.event_id)
          return { job_state: 'pending' } }
        if (method === 'preview_recall') { this.lastRecallTier = params.model_tier; return { world_revision: 0, preview: {
          rendered_recall: `context:${this.env.MEMOWEFT_WORLD_MODEL}`, selected_item_ids: [] } }
        }
        if (method === 'query_interactions') { this.lastInteractionTier = params.model_tier; return { rendered_context: '' } }
        if (method === 'shutdown') return { ok: true }
        return {}
      },
      async close() { this.closed = true; this.child = null },
    }
    instances.push(rpc); return rpc
  }
  const manager = createPersonalMemoryManager({ root, enabled: true,
    python: join(root, 'python.exe'), pythonPath: join(root, 'py'),
    baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'formal-key',
    processingRoute: (ownerId: string, sessionId: string) => routes.get(`${ownerId}\0${sessionId}`) ?? null,
    defaultProcessingRoute: ownerId => backgroundRoutes.get(ownerId) ?? null,
    rpcFactory })
  t.after(() => manager.close())
  const boundary = (sessionId: string, event: string) => ({ event_id: event,
    parent_session_id: sessionId, synthetic: true })

  assert.deepEqual(await manager.ingest(ownerA, boundary('session-a-old', 'event-a-1')),
    { state: 'accepted', jobState: 'pending' })
  assert.equal(instances[0].env.MEMOWEFT_BASE_URL, 'https://cloud-a.invalid/v1')
  assert.equal(instances[0].env.MEMOWEFT_WORLD_MODEL, 'model-a-old')
  assert.equal(instances[0].initialized.model_api_key, 'secret-a-old')
  assert.deepEqual(await manager.ingest(ownerB, boundary('session-b', 'event-b-1')),
    { state: 'accepted', jobState: 'pending' })
  assert.equal(instances[1].env.MEMOWEFT_BASE_URL, 'https://cloud-b.invalid/v1')
  assert.equal(instances[1].initialized.model_api_key, 'secret-b')
  assert.notEqual(instances[0].initialized.model_api_key, instances[1].initialized.model_api_key)

  routes.set(`${ownerA}\0session-a-new`, { profileId: 'private-model-a-new',
    baseUrl: 'https://cloud-a.invalid/v2', model: 'model-a-new',
    routeFingerprint: 'c'.repeat(64), credential: 'secret-a-new' })
  const switched = await manager.recall(ownerA, { query: 'route check', sessionId: 'session-a-new' })
  assert.match(switched.contextText, /model-a-new/)
  assert.equal(instances[0].closed, true, 'one owner route change closes only that owner worker')
  assert.equal(instances[1].closed, false, 'owner B worker remains isolated and running')
  assert.equal(instances[2].initialized.model_api_key, 'secret-a-new')

  routes.delete(`${ownerA}\0session-a-new`)
  const queued = await manager.ingest(ownerA, boundary('session-a-new', 'event-a-revoked'))
  assert.deepEqual(queued, { state: 'queued', reasonCode: 'MEMORY_MODEL_UNAVAILABLE' })
  assert.equal(instances[2].closed, true, 'revocation closes the prior processing worker')
  assert.equal(instances.length, 3, 'no unproved replacement route is started')

  routes.set(`${ownerA}\0session-a-new`, { profileId: 'private-model-a-new',
    baseUrl: 'https://cloud-a.invalid/v2', model: 'model-a-new',
    routeFingerprint: 'c'.repeat(64), credential: 'secret-a-new' })
  await manager.recall(ownerA, { query: 'restart queued route', sessionId: 'session-a-new' })
  for (let attempt = 0; attempt < 100 && !instances[3]?.ingested.includes('event-a-revoked'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.deepEqual(instances[3].ingested, ['event-a-revoked'],
    'the durable boundary resumes through the same proved session route')
  assert.equal((await manager.status(ownerA)).pendingBoundaryCount, 0)
  backgroundRoutes.set(ownerA, { profileId: 'private-model-a-background',
    baseUrl: 'http://127.0.0.1:18081/v1', model: 'background-model',
    routeFingerprint: null, credential: 'synthetic-background-key', modelTier: 'local' })
  await manager.invalidateOwnerRoute(ownerA)
  const backgroundStatus = await manager.status(ownerA)
  assert.equal(backgroundStatus.state, 'ready')
  assert.equal(backgroundStatus.version, '2.0.0-synthetic')
  assert.equal(instances.at(-1).env.MEMOWEFT_WORLD_MODEL, 'background-model')
  routes.set(`${ownerA}\0background-session`, backgroundRoutes.get(ownerA))
  await manager.recall(ownerA, { query: 'cloud main with local background', sessionId: 'background-session', modelTier: 'cloud' })
  assert.equal(instances.at(-1).lastRecallTier, 'cloud', 'local formation model cannot grant raw recall to a cloud main model')
  assert.equal(instances.at(-1).lastInteractionTier, 'cloud')
  assert.equal(instances[1].closed, false, 'changing A background model does not restart B memory')
  const rpc = instances.at(-1), request = rpc.request.bind(rpc)
  let jobReads = 0
  rpc.request = async (method: string, params: any) => {
    if (method === 'query_jobs') return { jobs: [{ worker: { state: ++jobReads === 1 ? 'processing' : 'done' } }] }
    if (method === 'preview_recall') return { world_revision: 4, preview: {
      selected_item_ids: [['cognition', 'cog-1'], ['entity', 'entity-2']],
      rendered_recall: '记忆：安全的偏好摘要\n记忆：安全的人物名',
    } }
    if (method === 'query_interactions') return { rendered_context: '' }
    return request(method, params)
  }
  const recalled = await manager.recall(ownerA, { query: 'ready after formation', sessionId: 'background-session', modelTier: 'cloud' })
  assert.equal(jobReads, 2, 'recall waits for Core accepted background jobs')
  assert.deepEqual(recalled.memories, [{ id: 'cog-1', kind: 'cognition', summary: '安全的偏好摘要' },
    { id: 'entity-2', kind: 'entity', summary: '安全的人物名' }])

})
