import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createPersonalHealthStore } from '../src/personal-health/index.mjs'
import { healthSummary, observedHealthEvidence } from '../src/personal-health/summary.mjs'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
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
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-health-')))
  const service = await createPersonalAccessService({ root, port: 0, backend, clock: () => now })
  // Stop and drain the real background writers before removing their directory.
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
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
test('queued health with cloud opt-out preserves non-health recall on every route and exposes replay queue', async t => {
  const root = await temp(t)
  let modelTier: string | undefined = 'cloud'
  let routeBaseUrl = 'https://synthetic.invalid/v1'
  const calls: any[] = []
  const manager = createPersonalMemoryManager({ root, enabled: true, python: path.join(root, 'fixture-python'),
    pythonPath: root, baseUrl: FORMAL_LOCAL_BASE_URL, model: '@current', credential: () => 'fixture-key',
    processingRoute: () => ({ profileId: 'fixture-route', baseUrl: routeBaseUrl,
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
          rendered_recall: '偏好：回答使用中文', selected_item_ids: [['cognition', 'c-fixture']] } }
        if (method === 'query_interactions') return { rendered_context: '合成历史' }
        return {}
      } }
    } })
  t.after(() => manager.close())
  await manager.healthStore.upsert(ownerA, summary())
  const cloudRecall = await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })
  assert.equal(cloudRecall.state, 'ready')
  assert.deepEqual(cloudRecall.memories, [{ id: 'c-fixture', kind: 'cognition', summary: '偏好：回答使用中文' }])
  assert.equal(cloudRecall.contextText, '偏好：回答使用中文\n\n合成历史')
  assert.equal(calls.findLast((row: any) => row.method === 'initialize').params.model_tier, 'cloud')
  assert.equal(calls.some((row: any) => row.method === 'preview_recall'), true)
  modelTier = undefined
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'ready')
  modelTier = 'local'
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).contextText, '偏好：回答使用中文\n\n合成历史')
  modelTier = 'cloud'
  await manager.healthStore.upsert(ownerA, summary({ cloudModelAllowed: true, summarizedAt: '2026-10-07T02:00:00Z' }))
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'ready')
  assert.equal(calls.findLast((row: any) => row.method === 'initialize').params.model_tier, 'cloud')
  await manager.healthStore.upsert(ownerA, summary({ cloudModelAllowed: false, summarizedAt: '2026-10-07T03:00:00Z' }))
  const before = calls.length
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'ready')
  assert.ok(calls.length > before, 'a later step still recalls non-health World content')
  assert.equal(calls.some((row: any) => JSON.stringify(row.params).includes('健康观察')), false)
  routeBaseUrl = 'http://192.168.1.10:18080/v1'
  modelTier = undefined
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'ready')
  assert.equal(calls.findLast((row: any) => row.method === 'initialize').params.model_tier, 'local')
  modelTier = 'cloud'
  assert.equal((await manager.recall(ownerA, { query: 'test', sessionId: 'session-a' })).state, 'ready')
  assert.equal(calls.findLast((row: any) => row.method === 'initialize').params.model_tier, 'cloud')
  assert.equal((await manager.recall(ownerB, { query: 'test', sessionId: 'session-b' })).state, 'ready')
  const replay = await manager.observedOutbox(ownerA)
  assert.equal(replay.state, 'queued')
  assert.equal(replay.items.length, 1)
  assert.equal(replay.items[0].evidence.source_kind, 'observed')
  assert.equal(calls.some((row: any) => row.method === 'ingest_boundary'), false)
  await manager.healthStore.delete(ownerA)
  assert.equal((await manager.observedOutbox(ownerA)).items.length, 0)
})

test('health queue rejects corrupted stored evidence', async t => {
  const root = await temp(t), store = createPersonalHealthStore({ root, clock: () => now })
  await store.upsert(ownerA, summary())
  const target = path.join(root, 'accounts', ownerA, 'health', 'daily-summaries.json')
  const state = JSON.parse(await readFile(target, 'utf8'))
  state.summaries[0].evidence.permissions.allow_cloud_read = true
  const { writeFile } = await import('node:fs/promises')
  await writeFile(target, JSON.stringify(state))
  await assert.rejects(store.pendingObserved(ownerA), { code: 'STORAGE_UNAVAILABLE' })
})

test('H3 daily/hourly estimates persist through real health HTTP and observed without raw samples or cloud usage', async t => {
  const f = await fixture(t), auth = await f.register('h3_estimates')
  const derived = { algorithmVersion: 'weftmate-h3-v1', recovery: { value: 70, inputs: ['sleep'], baselineDays: 14 },
    sleep: { stageMinutes: { core: 340 }, continuityPercent: 94, durationScore: 85, midpointDeviationMinutes: 25, baselineDays: 14 },
    load: { value: 3, inputs: ['workouts'], acuteDays: 7, chronicDays: 28, acute7Mean: 3, chronic28Mean: 2, ratio: 1.5 } }
  const hourly = [{ start: '2026-10-06T18:00:00Z', end: '2026-10-06T19:00:00Z', bodyBattery: 64,
    stress: { lower: 20, upper: 60, sampleCount: 1, latestSampleAt: '2026-10-06T18:15:00Z', confidence: 'sparse' } }]
  const payload = summary({ sourceDeviceId: auth.deviceId, derived, hourly,
    readStates: { sleep: 'dataAvailable', steps: 'dataAvailable', workouts: 'dataAvailable', hrv: 'dataAvailable', heartRate: 'dataAvailable' } })
  const result = await f.api('POST', base, payload, auth)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.summary.derived, derived)
  assert.deepEqual(result.body.summary.hourly, hourly)
  assert.equal((await f.api('POST', base, payload, auth)).body.duplicate, true)
  const evidence = observedHealthEvidence(auth.ownerId, result.body.summary)
  assert.match(evidence.content, /恢复度估算 70/)
  assert.match(evidence.content, /压力估算区间 20–60/)
  assert.equal(evidence.permissions.allow_cloud_read, false)
  assert.equal((await f.api('GET', `${base}?days=2&timeZone=America%2FLos_Angeles`, undefined, auth)).body.summaries[0].hourly.length, 1)
  const legacy = summary({ sourceDeviceId: auth.deviceId, date: '2026-10-05', cloudModelAllowed: true, summarizedAt: '2026-10-07T03:00:00Z' })
  assert.equal((await f.api('POST', base, legacy, auth)).status, 200)
  const afterOptIn = await f.api('GET', `${base}?days=3&timeZone=America%2FLos_Angeles`, undefined, auth)
  assert.equal(afterOptIn.body.summaries.find((s: any) => s.derived).cloudModelAllowed, false,
    'A newer legacy H1 opt-in must not make H3 readable by cloud models')
  const other = await f.register('h3_other_account')
  assert.equal((await f.api('GET', `${base}?days=2`, undefined, other)).body.summaries.length, 0)
  const replacement = { ...payload, summarizedAt: '2026-10-07T02:00:00Z' }
  delete replacement.derived; delete replacement.hourly
  assert.equal((await f.api('POST', base, replacement, auth)).body.summary.derived, undefined)
})

test('H3 rejects invalid estimates, raw appendages, overlap, future/out-of-day hours and cloud consent', () => {
  const payload: any = summary({ derived: { algorithmVersion: 'weftmate-h3-v1' },
    hourly: [{ start: '2026-10-06T18:00:00Z', end: '2026-10-06T19:00:00Z', bodyBattery: 70 }] })
  assert.doesNotThrow(() => healthSummary(payload))
  const invalid = [
    { cloudModelAllowed: true },
    { derived: { ...payload.derived, samples: [] } },
    { derived: { ...payload.derived, recovery: { value: 101, inputs: ['sleep'], baselineDays: 14 } } },
    { derived: { ...payload.derived, recovery: { value: 70, inputs: ['sleep'], baselineDays: 0 } } },
    { derived: { ...payload.derived, sleep: { stageMinutes: { core: 500 }, continuityPercent: 90, baselineDays: 14 } } },
    { derived: { ...payload.derived, load: { value: 3, inputs: ['workouts'], acuteDays: 1, chronicDays: 2, ratio: 2 } } },
    { hourly: [{ ...payload.hourly[0], bodyBattery: -1 }] },
    { hourly: [{ ...payload.hourly[0], stress: { lower: 80, upper: 20, sampleCount: 1, latestSampleAt: '2026-10-06T18:15:00Z', confidence: 'sparse' } }] },
    { hourly: [payload.hourly[0], payload.hourly[0]] },
    { hourly: [{ ...payload.hourly[0], end: '2026-10-06T20:00:00Z' }] },
    { hourly: [{ ...payload.hourly[0], start: '2026-10-07T18:00:00Z', end: '2026-10-07T19:00:00Z' }] },
    { summarizedAt: '2026-10-06T18:30:00Z' },
  ]
  for (const extra of invalid) assert.throws(() => healthSummary({ ...payload, ...extra }), /INVALID_HEALTH_SUMMARY/)
})

test('H3 accepts 23/25-hour local DST days with unique UTC intervals and exact retry bytes', () => {
  for (const [date, start, hours] of [['2026-11-01', '2026-11-01T07:00:00Z', 25], ['2026-03-08', '2026-03-08T08:00:00Z', 23]] as const) {
    const begin = Date.parse(start)
    const hourly = Array.from({ length: hours }, (_, i) => ({ start: new Date(begin + i * 3600000).toISOString(),
      end: new Date(begin + (i + 1) * 3600000).toISOString(), bodyBattery: 70 }))
    const payload = summary({ date, summarizedAt: new Date(begin + hours * 3600000).toISOString(),
      derived: { algorithmVersion: 'weftmate-h3-v1' }, hourly, sleep: undefined })
    assert.equal(healthSummary(payload).hourly.length, hours)
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 12 * 1024)
  }
})
