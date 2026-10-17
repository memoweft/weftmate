import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { recallDateCases } from './fixtures/recall-date-contract.ts'

const ownerA = 'owner-00000000-0000-4000-8000-000000000001'
const ownerB = 'owner-00000000-0000-4000-8000-000000000002'
const required = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup', 'query_jobs']

for (const lang of ['en', 'zh'] as const) for (const dated of [false, true]) for (const pending of [false, true]) {
  test(`G9 manager preserves ${lang} IDs, dates and bodies (${dated ? 'dated' : 'undated'}, ${pending ? 'pending correction' : 'current snapshot'})`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-recall-format-'))
    const headers = lang === 'en' ? ['Memory:', 'Memory (past):'] : ['记忆：', '记忆（过往）：']
    const bodies = recallDateCases.map(item => `${dated ? `[${item.date}] ` : ''}${item[lang]}\n${lang === 'en' ? 'Exact continuation.' : '逐字保留的下一行。'}`)
    const claims = bodies.map((body, index) => `${headers[index % 2]}${body}`)
    const pairs = [['cognition', 'pet'], ['event', 'games'], ['cognition', 'travel']]
    let ambiguous = false
    const manager = createPersonalMemoryManager({ root, enabled: true,
      python: join(root, 'python.exe'), pythonPath: join(root, 'py'),
      baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'synthetic',
      recallMaxItems: 5, recallMaxChars: 1200,
      rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods: required }
        if (method === 'initialize') return {
          runtime: { subject_id: ownerA, db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
          capabilities: { subject_id: ownerA, methods: required, services: { command: { operations: [] } } } }
        if (method === 'health') return { runtime: { subject_id: ownerA, route_ready: true } }
        if (method === 'query_world') { assert.equal(params.operation, 'revision'); return { world_revision: 8 } }
        if (method === 'preview_recall') return { world_revision: 8, preview: {
          selected_item_ids: pairs,
          rendered_recall: ambiguous ? `${claims[0]}\nMemory: unescaped literal line\n${claims.slice(1).join('\n')}` : claims.join('\n'),
          // This synthetic source exceeds the separate recent-evidence budget;
          // the formal claims must still carry their pending-correction warning.
          pending_corrections: pending ? [{ evidence_id: 'synthetic-correction',
            text: 'Synthetic correction. '.repeat(80), created_at: '2026-10-17T00:00:00Z' }] : [],
        } }
        if (method === 'query_interactions') return { rendered_context: '' }
        return {}
      } }) })
    t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }) })
    const result = await manager.recall(ownerA, { query: 'What changed?', sessionId: 'format-contract', modelTier: 'cloud' })
    const warning = lang === 'en'
      ? 'Already corrected by the user; pending update. The following old content must not be used as a current fact. '
      : '已被用户纠正，待更新；以下旧内容不能作为当前事实。'
    const expectedClaims = pending ? bodies.map((body, index) => `${lang === 'en' ? headers[index % 2] : '记忆：'}${warning}${body}`) : claims
    assert.equal(result.sourceCount, 3, 'all original IDs must survive the new English format')
    assert.deepEqual(result.memories, pairs.map(([kind, id], index) => ({ kind, id,
      summary: `${pending ? warning : ''}${bodies[index]}`.trim().slice(0, 240) })))
    assert.equal(result.contextText, expectedClaims.join('\n\n'), 'no fact, date or source wording may be invented or rewritten')
    if (lang === 'en') assert.doesNotMatch(result.contextText, /记忆[：（]/)
    assert.ok(result.contextText.length <= 1200)
    ambiguous = true
    const withheld = await manager.recall(ownerA, { query: 'What changed?', sessionId: 'format-contract', modelTier: 'cloud' })
    assert.equal(withheld.sourceCount, 0, 'ambiguous headers cannot associate literal text with a different Core ID')
    assert.equal(withheld.contextText, '')
  })
}

test('fixed cold initialization alone can consume the old recall assertion while formation never blocks', async t => {
  let clock = 0
  t.mock.method(Date, 'now', () => clock)
  for (const prepareFirst of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-cold-proof-'))
    let jobReads = 0
    const manager = createPersonalMemoryManager({ root, enabled: true,
      python: join(root, 'python.exe'), pythonPath: join(root, 'py'),
      baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'synthetic',
      rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods: required }
        if (method === 'initialize') { clock += 2100; return {
          runtime: { subject_id: ownerA, db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
          capabilities: { subject_id: ownerA, methods: required, services: { command: { operations: [] } } } } }
        if (method === 'health') return { runtime: { subject_id: ownerA, route_ready: true } }
        if (method === 'query_jobs') { jobReads++; return { jobs: [{ job_id: 'stalled', worker: { state: 'retry' } }] } }
        if (method === 'preview_recall') return { world_revision: 2, preview: { selected_item_ids: [['cognition', 'existing']], rendered_recall: '记忆：已有的表达偏好' } }
        if (method === 'query_interactions') return { rendered_context: '' }
        return {}
      } }) })
    try {
      if (prepareFirst) await manager.query(ownerA, 'query_world', { operation: 'revision' })
      const started = Date.now()
      const result = await manager.recall(ownerA, { query: 'cache', sessionId: 'new-session' })
      assert.equal(result.state, 'ready'); assert.equal(result.sourceCount, 1); assert.equal(jobReads, 0)
      assert.equal(Date.now() - started, prepareFirst ? 0 : 2100)
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
  }
})

test('compound recall merges both cloud-permitted facts in one Core snapshot without unrestricted world reads',async t=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-memory-compound-')),methods=[...required,'preview_recall_batch'];let batches=0;
  const manager=createPersonalMemoryManager({root,enabled:true,python:join(root,'python.exe'),pythonPath:join(root,'py'),
    baseUrl:'http://127.0.0.1:8081/v1',model:'@current',credential:()=> 'synthetic',rpcFactory:()=>({child:{},async close(){},async request(method,params={}){
      if(method==='capabilities')return{protocol:'memoweft.dsh_rpc',protocol_version:2,schema_version:1,methods};
      if(method==='initialize')return{runtime:{subject_id:ownerA,db_path:join(params.dsh_home,'memoweft','memoweft.sqlite3')},capabilities:{subject_id:ownerA,methods,services:{command:{operations:[]}}}};
      if(method==='health')return{runtime:{subject_id:ownerA,route_ready:true}};
      if(method==='query_world'){assert.equal(params.operation,'revision','recall must never retrieve unfiltered world facts');return{world_revision:5};}
      if(method==='preview_recall_batch'){
        batches++;assert.equal(params.model_tier,'cloud');assert.equal(params.queries.length,5);
        assert.ok(params.queries.includes('我的鹦鹉叫什么'));assert.ok(params.queries.includes('喜欢什么零食'));
        return{snapshots:params.queries.map(query=>{const name=query==='我的鹦鹉叫什么',food=query.includes('喜欢什么零食');return{world_revision:5,preview:{
          selected_item_ids:name||food?[['cognition',name?'name':'food']]:[],rendered_recall:name?'记忆：用户的鹦鹉叫青瓷。':food?'记忆：用户的鹦鹉喜欢荞麦饼干。':''}};})};
      }
      if(method==='query_interactions'){assert.equal(params.model_tier,'cloud');return{rendered_context:''};}
      return{};
    }})});
  t.after(async()=>{await manager.close();rmSync(root,{recursive:true,force:true});});
  const result=await manager.recall(ownerA,{query:'根据我的记忆，我的鹦鹉叫什么，喜欢什么零食？只回答已知内容，不调用工具。',sessionId:'synthetic-main',modelTier:'cloud'});
  assert.equal(batches,1);assert.equal(result.sourceCount,2);assert.match(result.contextText,/青瓷/);assert.match(result.contextText,/荞麦/);
  assert.deepEqual(result.memories.map(m=>m.id),['food','name']);
});

for (const formationWaitMs of [undefined, 30]) test(`recall ${formationWaitMs === undefined ? 'does not wait by default' : 'honors an explicit formation deadline'} while a stuck job remains durable`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-stalled-'))
  let jobReads = 0, home = ''
  const manager = createPersonalMemoryManager({ root, enabled: true,
    python: join(root, 'python.exe'), pythonPath: join(root, 'py'),
    baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'synthetic',
    ...(formationWaitMs === undefined ? {} : { formationWaitMs }),
    rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
        schema_version: 1, methods: required }
      if (method === 'initialize') { home = params.dsh_home; return {
        runtime: { subject_id: ownerA, db_path: join(home, 'memoweft', 'memoweft.sqlite3') },
        capabilities: { subject_id: ownerA, methods: required, services: { command: { operations: [] } } } } }
      if (method === 'health') return { runtime: { subject_id: ownerA, route_ready: true } }
      if (method === 'query_jobs') { jobReads++; return { jobs: [{ job_id: 'stalled', worker: { state: 'retry' } }] } }
      if (method === 'preview_recall') return { world_revision: 2, preview: {
        selected_item_ids: [['cognition', 'existing']], rendered_recall: '记忆：已有的表达偏好',
      } }
      if (method === 'query_interactions') return { rendered_context: '' }
      return {}
    } }) })
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }) })
  // Private store creation and worker initialization are preparation, not the
  // time spent waiting for a stuck formation job on an already ready worker.
  const preparedAt = Date.now()
  await manager.query(ownerA, 'query_world', { operation: 'revision' })
  assert.equal(jobReads, 0)
  const started = Date.now()
  const recalled = await manager.recall(ownerA, { query: 'cache', sessionId: 'new-session' })
  assert.equal(recalled.state, 'ready')
  assert.equal(recalled.sourceCount, 1)
  assert.match(recalled.contextText, /已有的表达偏好/)
  if (formationWaitMs === undefined) assert.equal(jobReads, 0, 'ordinary chat recalls the current World without polling formation jobs')
  else assert.ok(jobReads > 0)
  assert.ok(Date.now() - started < 2000, 'stalled formation does not hold the foreground indefinitely')
  t.diagnostic(JSON.stringify({ preparationMs: started - preparedAt, recallMs: Date.now() - started, jobReads }))
})

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
    formationWaitMs: 1000,
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
  const recallQueries: string[] = []
  rpc.request = async (method: string, params: any) => {
    if (method === 'query_jobs') return { jobs: [{ worker: { state: ++jobReads === 1 ? 'processing' : 'done' } }] }
    if (method === 'preview_recall') { recallQueries.push(params.query); return { world_revision: 4, preview: {
      selected_item_ids: [['cognition', 'cog-1'], ['entity', 'entity-2']],
      rendered_recall: '记忆：安全的偏好摘要\n记忆：安全的人物名',
    } } }
    if (method === 'query_interactions') return { rendered_context: '' }
    return request(method, params)
  }
  const recalled = await manager.recall(ownerA, { query: 'ready after formation', sessionId: 'background-session', modelTier: 'cloud' })
  assert.equal(jobReads, 2, 'recall waits for Core accepted background jobs')
  assert.ok(recallQueries.includes('“语言”“例子”“术语”的表达偏好？'),
    'standing style recall probes source vocabulary through Core, without rewriting facts')
  assert.ok(recallQueries.includes('用户叫什么？'), 'identity remains a separate permission-filtered Core recall using its source vocabulary')
  assert.deepEqual(recalled.memories, [{ id: 'cog-1', kind: 'cognition', summary: '安全的偏好摘要' },
    { id: 'entity-2', kind: 'entity', summary: '安全的人物名' }])

  jobReads = 0
  rpc.request = async (method: string, params: any) => {
    if (method === 'query_jobs') return { jobs: ++jobReads === 1
      ? [{ job_id: 'accepted', worker: { state: 'processing' } }]
      : [{ job_id: 'accepted', worker: { state: 'applied' } },
        { job_id: 'later', worker: { state: 'processing' } }] }
    return method === 'preview_recall' ? { world_revision: 4, preview: {
      selected_item_ids: [['cognition', 'cog-1']], rendered_recall: '记忆：已经形成的偏好',
    } } : method === 'query_interactions' ? { rendered_context: '' } : request(method, params)
  }
  assert.equal((await manager.recall(ownerA, { query: 'later jobs cannot extend this wait',
    sessionId: 'background-session' })).sourceCount, 1)
  assert.equal(jobReads, 2)

  rpc.request = async (method: string, params: any) => {
    if (method === 'query_jobs') throw Object.assign(new Error('MEMORY_TIMEOUT'), { code: 'MEMORY_TIMEOUT' })
    return method === 'preview_recall' ? { world_revision: 4, preview: {
      selected_item_ids: [['cognition', 'cog-1']], rendered_recall: '记忆：已经形成的偏好',
    } } : method === 'query_interactions' ? { rendered_context: '' } : request(method, params)
  }
  assert.equal((await manager.recall(ownerA, { query: 'timed out job query keeps current memories',
    sessionId: 'background-session' })).state, 'ready')

})
