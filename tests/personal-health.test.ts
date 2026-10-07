import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createPersonalHealthStore } from '../src/personal-health/index.mjs'
import { healthSummary, observedHealthEvidence } from '../src/personal-health/summary.mjs'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { memoryRecallModelTier } from '../src/personal-memory/policy.mjs'
import { FORMAL_LOCAL_BASE_URL } from '../src/local-model-config.mjs'

const ownerA = 'owner-00000000-0000-4000-8000-000000000001'
const ownerB = 'owner-00000000-0000-4000-8000-000000000002'
const now = Date.parse('2026-10-07T12:00:00Z')
const summary = (extra: any = {}) => ({ schemaVersion: 1, date: '2026-10-06', timeZone: 'America/Los_Angeles',
  sourceDeviceId: 'device-fixture', sourceDevices: ['Apple Watch', 'iPhone'],
  summarizedAt: '2026-10-07T01:00:00Z', cloudModelAllowed: false, selfAssessmentFrequency: 'low',
  readStates: { sleep: 'dataAvailable', steps: 'dataAvailable', workouts: 'dataAvailable' },
  metrics: { sleep: { value: 340, unit: 'min', baselineMean: 400, baselineDays: 14, deviationPercent: -15 },
    steps: { value: 6400, unit: 'count', baselineDays: 0 } },
  sleep: { totalMinutes: 340, fellAsleepAt: '2026-10-06T05:00:00Z', wokeAt: '2026-10-06T11:00:00Z' },
  workoutCount: 1, workoutMinutes: 30, ...extra })
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
  preflight: async () => ({ ok: true }), createSession: async ({ sessionId }: any) => ({ sessionId }),
  sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }: any) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null,
}
const base = '/personal/v1/health/daily-summaries'
async function temp(t: any) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-health-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function fixture(t: any) {
  const root = await temp(t)
  const service = await createPersonalAccessService({ root, port: 0, backend, clock: () => now })
  t.after(() => service.close())
  const { origin } = await service.start()
  const api = async (method: string, pathname: string, body?: any, auth?: any, overrides: any = {}) => {
    const response = await fetch(`${origin}${pathname}`, { method, headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'GET' ? {} : { origin }),
      ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrf } : {}), ...overrides,
    }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
  }
  const register = async (username: string) => {
    const result = await api('POST', '/personal/v1/auth/register',
      { username, password: 'isolated health test password 123', deviceName: 'Health Fixture' })
    assert.equal(result.status, 201)
    return { cookie: result.cookie!.split(';')[0], csrf: result.body.csrfToken,
      ownerId: result.body.account.ownerId, deviceId: result.body.device.id }
  }
  return { root, service, api, register }
}

test('health HTTP upserts one source/day, removes omitted metrics, isolates accounts and lists recent dates', async t => {
  const f = await fixture(t)
  const a = await f.register('health_owner_a'), b = await f.register('health_owner_b')
  const payload = summary({ sourceDeviceId: a.deviceId })
  assert.equal((await f.api('POST', base, payload, a)).status, 200)
  const duplicate = await f.api('POST', base, payload, a)
  assert.equal(duplicate.body.duplicate, true)
  assert.equal(duplicate.body.memory.pendingObservedCount, 1)
  const replacement = summary({ sourceDeviceId: a.deviceId, summarizedAt: '2026-10-07T02:00:00Z',
    metrics: { sleep: { value: 380, unit: 'min', baselineDays: 0 } }, sleep: { totalMinutes: 380 } })
  assert.equal((await f.api('POST', base, replacement, a)).status, 200)
  assert.equal((await f.api('POST', base, payload, a)).status, 409)
  assert.equal((await f.api('POST', base, { ...replacement, workoutCount: 2 }, a)).status, 409)
  assert.equal((await f.api('POST', base, payload, b)).status, 403, 'cannot claim another account device')
  assert.equal((await f.api('GET', base, undefined, b)).body.summaries.length, 0)
  const anotherDevice = await f.api('POST', '/personal/v1/auth/login',
    { username: 'health_owner_a', password: 'isolated health test password 123', deviceName: 'Other Phone' })
  assert.equal((await f.api('POST', base, summary({ sourceDeviceId: anotherDevice.body.device.id }), a)).status, 200)
  // A revoked source remains a valid historical account device for an offline queue.
  assert.equal((await f.api('DELETE', `/personal/v1/auth/devices/${anotherDevice.body.device.id}`, {}, a)).status, 200)
  assert.equal((await f.api('POST', base, summary({ sourceDeviceId: anotherDevice.body.device.id,
    summarizedAt: '2026-10-07T03:00:00Z' }), a)).status, 200)
  const listing = await f.api('GET', `${base}?days=2&timeZone=America%2FLos_Angeles`, undefined, a)
  assert.equal(listing.body.summaries.length, 2, 'do not add totals across phones')
  assert.equal(listing.body.summaries.find((row: any) => row.sourceDeviceId === a.deviceId).metrics.steps, undefined)
  assert.equal((await f.api('GET', `${base}?days=1`, undefined, a)).body.summaries.length, 0)
  assert.equal((await f.api('GET', `${base}?days=0`, undefined, a)).status, 400)
  assert.equal((await f.api('GET', `${base}?days=366`, undefined, a)).status, 400)
  assert.equal((await f.api('GET', `${base}?days=2&days=3`, undefined, a)).status, 400)
  assert.equal((await f.api('GET', `${base}?timeZone=invalid`, undefined, a)).status, 400)
})

test('health HTTP rejects unauthenticated, CSRF, cross-origin, raw samples and oversized writes/deletes', async t => {
  const f = await fixture(t)
  const a = await f.register('health_security_a')
  const body = summary({ sourceDeviceId: a.deviceId })
  for (const [method, payload] of [['GET', undefined], ['POST', body], ['DELETE', {}]] as const) {
    assert.equal((await f.api(method, base, payload)).status, 401)
  }
  for (const method of ['POST', 'DELETE']) {
    assert.equal((await f.api(method, base, method === 'POST' ? body : {}, { ...a, csrf: 'wrong' })).status, 403)
    assert.equal((await f.api(method, base, method === 'POST' ? body : {}, a,
      { origin: 'https://other.invalid' })).body.error.code, 'ORIGIN_NOT_ALLOWED')
    assert.equal((await f.api(method, base, { padding: 'x'.repeat(13 * 1024) }, a)).status, 413)
  }
  assert.equal((await f.api('POST', base, { ...body, rawSamples: [] }, a)).body.error.code, 'INVALID_HEALTH_SUMMARY')
  assert.equal((await f.api('POST', base, body, a, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await f.api('DELETE', `${base}/2026-02-30`, {}, a)).body.error.code, 'INVALID_DATE')
  assert.equal((await f.api('POST', base, { ...body, ownerId: a.ownerId }, a)).status, 400)
  assert.equal((await f.api('DELETE', base, { date: body.date }, a)).status, 400)
  assert.equal((await f.api('GET', base, undefined, a)).body.summaries.length, 0)
})

test('date/all deletion physically removes summaries and observed outbox, survives restart and fences delayed uploads', async t => {
  const f = await fixture(t)
  const a = await f.register('health_delete_a'), b = await f.register('health_delete_b')
  const first = summary({ sourceDeviceId: a.deviceId })
  const other = summary({ sourceDeviceId: b.deviceId })
  await f.api('POST', base, first, a)
  await f.api('POST', base, summary({ sourceDeviceId: a.deviceId, date: '2026-10-05' }), a)
  await f.api('POST', base, other, b)
  const store = createPersonalHealthStore({ root: f.root, clock: () => now })
  assert.equal((await store.pendingObserved(a.ownerId)).length, 2)
  const deleted = await f.api('DELETE', `${base}/2026-10-06`, {}, a)
  assert.equal(deleted.body.deletedCount, 1)
  assert.equal((await store.pendingObserved(a.ownerId)).length, 1)
  assert.equal((await f.api('POST', base, first, a)).body.error.code, 'STALE_HEALTH_SUMMARY')
  assert.equal((await f.api('DELETE', base, {}, a)).body.deletedCount, 1)
  assert.equal((await store.pendingObserved(a.ownerId)).length, 0)
  const target = path.join(f.root, 'accounts', a.ownerId, 'health', 'daily-summaries.json')
  const persisted = JSON.parse(await readFile(target, 'utf8'))
  assert.deepEqual(persisted.summaries, [])
  const raw = await readFile(target, 'utf8')
  assert.equal(raw.includes('Apple Watch'), false)
  assert.equal(raw.includes('睡眠'), false)
  assert.equal(raw.includes('sourceDeviceId'), false)
  if (process.platform !== 'win32') {
    assert.equal((await stat(target)).mode & 0o777, 0o600)
    assert.equal((await stat(path.dirname(target))).mode & 0o777, 0o700)
  }
  assert.equal((await store.pendingObserved(b.ownerId)).length, 1)
  assert.equal((await f.api('DELETE', base, {}, a)).status, 200)
  const fresh = summary({ sourceDeviceId: a.deviceId, summarizedAt: '2026-10-07T12:00:01Z' })
  assert.equal((await f.api('POST', base, fresh, a)).status, 200, 'a fresh read after delete is allowed')
  const restored = createPersonalHealthStore({ root: f.root, clock: () => now })
  assert.equal((await restored.list(a.ownerId)).summaries.length, 1)
  assert.equal((await restored.pendingObserved(a.ownerId)).length, 1)
})

test('latest health choice updates all evidence; backfills and duplicate retries cannot relax a newer opt-out', async t => {
  const root = await temp(t), store = createPersonalHealthStore({ root, clock: () => now })
  const first = summary({ cloudModelAllowed: true })
  await store.upsert(ownerA, first)
  await store.upsert(ownerA, summary({ date: '2026-10-07', summarizedAt: '2026-10-07T03:00:00Z',
    cloudModelAllowed: false, selfAssessmentFrequency: 'off' }))
  await store.upsert(ownerA, first)
  await store.upsert(ownerA, summary({ date: '2026-10-04', summarizedAt: '2026-10-07T02:00:00Z', cloudModelAllowed: true }))
  assert.equal((await store.pendingObserved(ownerA)).every((row: any) => row.evidence.permissions.allow_cloud_read === false), true)
  assert.equal((await store.list(ownerA)).summaries.every((row: any) => row.selfAssessmentFrequency === 'off'), true)
  await store.upsert(ownerA, summary({ summarizedAt: '2026-10-07T04:00:00Z', cloudModelAllowed: true }))
  assert.equal((await store.pendingObserved(ownerA)).every((row: any) => row.evidence.permissions.allow_cloud_read === true), true)
})

test('observed outbox has stable source identity and Chinese facts, never invents user speech or missing values', () => {
  const evidence = observedHealthEvidence(ownerA, healthSummary(summary()))
  assert.equal(evidence.source_kind, 'observed')
  assert.equal(evidence.subject_id, ownerA)
  assert.match(evidence.content, /2026-10-06 睡眠 5 小时 40 分，低于此前 14 天基线均值 1 小时 0 分/)
  assert.equal(evidence.source.device_id, 'device-fixture')
  assert.equal(evidence.permissions.allow_cloud_read, false)
  assert.equal(evidence.content.includes('HRV'), false)
  const replacement = observedHealthEvidence(ownerA, healthSummary(summary({ summarizedAt: '2026-10-07T02:00:00Z' })))
  assert.equal(replacement.source_id, evidence.source_id)
  assert.notEqual(replacement.payload_hash, evidence.payload_hash)
  assert.notEqual(observedHealthEvidence(ownerB, healthSummary(summary())).source_id, evidence.source_id)
  assert.equal('source_messages' in evidence, false)
  for (const bad of [summary({ date: '2026-02-30' }), summary({ cloudModelAllowed: undefined }),
    summary({ metrics: { sleep: { value: -1, unit: 'min', baselineDays: 0 } } }),
    summary({ metrics: { sleep: { value: 10, unit: 'hours', baselineDays: 0 } } }),
    summary({ summarizedAt: '2026-02-30T01:00:00Z' })]) {
    assert.throws(() => healthSummary(bad))
  }
})

const required = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
  'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command',
  'query_command_receipt', 'retry_delete_storage_cleanup']
test('existing memory bridge withholds cloud recall before RPC, permits local, rechecks opt-out each step and exposes replay queue', async t => {
  const root = await temp(t)
  let modelTier: string | undefined = 'cloud'
  const calls: any[] = []
  const manager = createPersonalMemoryManager({ root, enabled: true, python: path.join(root, 'fixture-python'),
    pythonPath: root, baseUrl: FORMAL_LOCAL_BASE_URL, model: '@current', credential: () => 'fixture-key',
    processingRoute: () => ({ profileId: 'fixture-route', baseUrl: 'https://synthetic.invalid/v1',
      model: 'fixture', credential: 'fixture-key', routeFingerprint: 'a'.repeat(64), modelTier }),
    rpcFactory: () => {
      let initialized: any
      return { child: {}, close: async () => {}, request: async (method: string, params: any = {}) => {
        calls.push({ method, params })
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
          schema_version: 1, methods: required }
        if (method === 'initialize') { initialized = params; return { runtime: { subject_id: params.subject_id,
          db_path: path.join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
        capabilities: { subject_id: params.subject_id, services: { command: { operations: [] } } } } }
        if (method === 'health') return { runtime: { subject_id: initialized.subject_id, route_ready: true } }
        if (method === 'preview_recall') return { world_revision: 1, preview: {
          rendered_recall: '合成混合记忆', selected_item_ids: ['c-fixture'] } }
        if (method === 'query_interactions') return { rendered_context: '合成历史' }
        return {}
      } }
    } })
  t.after(() => manager.close())
  await manager.healthStore.upsert(ownerA, summary())
  assert.deepEqual(await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' }),
    { state: 'withheld', reasonCode: 'MEMORY_HEALTH_CLOUD_BLOCKED' })
  assert.equal(calls.length, 0, 'do not send a private query or start a cloud worker')
  modelTier = undefined
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'withheld')
  modelTier = 'local'
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).contextText, '合成混合记忆\n\n合成历史')
  modelTier = 'cloud'
  await manager.healthStore.upsert(ownerA, summary({ cloudModelAllowed: true, summarizedAt: '2026-10-07T02:00:00Z' }))
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'ready')
  assert.equal(calls.findLast((row: any) => row.method === 'initialize').params.model_tier, 'cloud')
  await manager.healthStore.upsert(ownerA, summary({ cloudModelAllowed: false, summarizedAt: '2026-10-07T03:00:00Z' }))
  const before = calls.length
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'withheld')
  assert.equal(calls.length, before, 'a later step cannot reuse a previously allowed World snapshot')
  assert.equal((await manager.recall(ownerB, { query: 'test', sessionId: 'session-b' })).state, 'ready')
  const replay = await manager.observedOutbox(ownerA)
  assert.equal(replay.state, 'queued')
  assert.equal(replay.items.length, 1)
  assert.equal(replay.items[0].evidence.source_kind, 'observed')
  assert.equal(calls.some((row: any) => row.method === 'ingest_boundary'), false)
  await manager.healthStore.delete(ownerA)
  assert.equal((await manager.observedOutbox(ownerA)).items.length, 0)
})

test('local/cloud classification requires the verified formal host catalog, never a URL label or loopback proxy', () => {
  const access = { isFormalLocalProfile: (id: string) => id === 'formal-local' }
  assert.equal(memoryRecallModelTier({ id: 'formal-local', baseUrl: FORMAL_LOCAL_BASE_URL }, access), 'local')
  for (const profile of [{ id: 'private-model-proxy', baseUrl: FORMAL_LOCAL_BASE_URL },
    { id: 'formal-local', baseUrl: 'https://cloud.invalid/v1' },
    { id: 'private-model-local-name', baseUrl: 'http://127.0.0.1:9000/v1' }, null]) {
    assert.equal(memoryRecallModelTier(profile, access), 'cloud')
  }
})

test('health policy serializes an in-flight recall with opt-out and refuses corrupted stored evidence', async t => {
  const root = await temp(t), store = createPersonalHealthStore({ root, clock: () => now })
  await store.upsert(ownerA, summary({ cloudModelAllowed: true }))
  let release: any, entered: any
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const recall = store.withRecallPolicy(ownerA, 'cloud', async () => { entered(); await gate; return { state: 'ready' } })
  await started
  const optOut = store.upsert(ownerA, summary({ summarizedAt: '2026-10-07T02:00:00Z' }))
  release()
  assert.equal((await recall).state, 'ready', 'already authorized recall finishes before the choice commits')
  await optOut
  let invoked = false
  assert.equal((await store.withRecallPolicy(ownerA, 'cloud', () => { invoked = true })).state, 'withheld')
  assert.equal(invoked, false, 'after opt-out succeeds, the next recall cannot enter RPC')
  const target = path.join(root, 'accounts', ownerA, 'health', 'daily-summaries.json')
  const state = JSON.parse(await readFile(target, 'utf8'))
  state.summaries[0].evidence.permissions.allow_cloud_read = true
  const { writeFile } = await import('node:fs/promises')
  await writeFile(target, JSON.stringify(state))
  await assert.rejects(store.withRecallPolicy(ownerA, 'cloud', () => { invoked = true }),
    { code: 'STORAGE_UNAVAILABLE' })
  assert.equal(invoked, false, 'malformed permissions cannot fail open')
})
