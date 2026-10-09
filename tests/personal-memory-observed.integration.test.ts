import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const summary = (cloudModelAllowed = false, version = '2026-10-02T00:00:00Z', metrics: any = {
  sleep: { value: 340, unit: 'min', baselineDays: 0 }, hrv: { value: 20, unit: 'ms', baselineDays: 0 } }) => ({
  schemaVersion: 1, date: '2026-10-01', timeZone: 'UTC', sourceDeviceId: 'test-device',
  sourceDevices: ['Test Watch'], summarizedAt: version, cloudModelAllowed,
  readStates: { sleep: 'dataAvailable', hrv: 'dataAvailable' }, metrics,
})
const canonical = (value: any): any => value === null || typeof value !== 'object' ? value : Array.isArray(value)
  ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
function boundary() {
  const payload = { schema_version: 1, provider_name: 'memoweft', parent_session_id: 'seed-session',
    result_session_id: 'seed-session', mode: 'turn', source_messages: [
      { role: 'user', content: '我喜欢睡眠前读书', source_ref: 'source:0', message_id: 'ordinary-preference' }] }
  const text = JSON.stringify(canonical(payload)).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const hash = createHash('sha256').update(text).digest('hex')
  return { ...payload, payload_hash: hash, event_id: `weftmate-turn-boundary-v1:${randomUUID().replaceAll('-', '')}:${hash}` }
}

test('real MemoWeft observed health: local/cloud consent, ordinary memory, overwrite, delete/export, restart',
  { skip: !python || !pythonPath ? 'Set WEFTMATE_TEST_MEMOWEFT_PYTHON and WEFTMATE_TEST_MEMOWEFT_SOURCE; CI runs the pinned Core job' : false }, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mw2-real-core-')))
    const calls: string[] = []
    const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
      baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'test-credential',
      processingRoute: (_owner: string, session: string) => ({ profileId: session === 'local-session' ? 'local-test' : 'cloud-test',
        baseUrl: session === 'local-session' ? 'http://127.0.0.1:8081/v1' : 'https://model-test.invalid/v1',
        model: 'test-model', modelTier: session === 'local-session' ? 'local' : 'cloud',
        credential: 'test-credential', routeFingerprint: 'a'.repeat(64) }),
      rpcFactory: (options: any) => {
        const rpc = new MemoWeftRpc({ ...options, env: { ...options.env,
          MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' } })
        const request = rpc.request.bind(rpc)
        rpc.request = (method: string, ...args: any[]) => { calls.push(method); return request(method, ...args) }
        return rpc
      } })
    let manager = create()
    const recall = (tier: string) => manager.recall(owner, { query: '睡眠', sessionId: `${tier}-session` })
    try {
      await manager.ingest(owner, boundary())
      for (let attempt = 0; attempt < 200; attempt++) {
        // Immediate recall can contain an accepted quote before formal
        // formation finishes. Forget preview requires the formal item.
        const sources = await manager.query(owner, 'query_evidence', { operation: 'list' })
        const source = sources.evidence.find((row: any) => row.raw_content === '我喜欢睡眠前读书')
        if (source) {
          const preview = await manager.query(owner, 'preview_forget', { target_kind: 'evidence', target_id: source.evidence_id })
          if (preview.item_count > 0) break
        }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.match((await recall('cloud')).contextText, /读书/)
      const worldBefore = await manager.query(owner, 'query_world', { operation: 'list', object_kind: 'cognition', include_history: true })
      const sourcesBefore = await manager.query(owner, 'query_evidence', { operation: 'list' })
      const ordinary = sourcesBefore.evidence.find((row: any) => row.raw_content === '我喜欢睡眠前读书')
      assert.ok(ordinary)
      const preview = await manager.query(owner, 'preview_forget', { target_kind: 'evidence', target_id: ordinary.evidence_id })
      assert.equal(preview.world_revision, worldBefore.world_revision)
      assert.ok(preview.item_count > 0); assert.deepEqual(preview.evidence_ids, [ordinary.evidence_id])
      const sessionPreview = await manager.query(owner, 'preview_forget', { conversation_id: 'seed-session' })
      assert.deepEqual(sessionPreview.items, preview.items)
      assert.deepEqual(await manager.query(owner, 'query_world', { operation: 'list', object_kind: 'cognition', include_history: true }), worldBefore)
      assert.deepEqual(await manager.query(owner, 'query_evidence', { operation: 'list' }), sourcesBefore)
      const write = await manager.healthStore.upsert(owner, summary())
      assert.equal(write.memory.state, 'delivered')
      assert.equal((await manager.observedOutbox(owner)).items.length, 0)
      assert.match((await recall('local')).contextText, /5 小时 40 分/)
      let cloud = await recall('cloud')
      assert.match(cloud.contextText, /读书/)
      assert.doesNotMatch(cloud.contextText, /5 小时 40 分|HRV/)
      await manager.healthStore.upsert(owner, summary(true, '2026-10-03T00:00:00Z'))
      assert.match((await recall('cloud')).contextText, /5 小时 40 分/)
      // A later account choice updates older daily sources through the permissions RPC.
      await manager.healthStore.upsert(owner, { ...summary(false, '2026-10-04T00:00:00Z'), date: '2026-10-02' })
      cloud = await recall('cloud')
      assert.match(cloud.contextText, /读书/)
      assert.doesNotMatch(cloud.contextText, /HRV|5 小时/)
      assert.ok(calls.includes('update_observed_permissions'))
      await manager.healthStore.upsert(owner, summary(true, '2026-10-05T00:00:00Z', { sleep: { value: 420, unit: 'min', baselineDays: 0 } }))
      const exportedBefore = JSON.stringify(await manager.query(owner, 'portable_export', {}))
      assert.match(exportedBefore, /7 小时/)
      assert.ok(!exportedBefore.includes('2026-10-01 HRV'))
      await manager.close(); manager = create()
      assert.match((await recall('cloud')).contextText, /7 小时/)
      const deleted = await manager.healthStore.delete(owner)
      assert.equal(deleted.memory.state, 'empty')
      for (const tier of ['local', 'cloud']) {
        const result = await recall(tier)
        assert.match(result.contextText, /读书/)
        assert.doesNotMatch(result.contextText, /HRV|7 小时|5 小时/)
      }
      const exported = JSON.stringify(await manager.query(owner, 'portable_export', {}))
      assert.doesNotMatch(exported, /HRV|7 小时|5 小时|Test Watch/)
      const hostFile = await readFile(path.join(root, 'accounts', owner, 'health', 'daily-summaries.json'), 'utf8')
      assert.doesNotMatch(hostFile, /HRV|sleep|hrv|Test Watch|test-device/)
      assert.ok(calls.includes('retract_observed'))
      await manager.close(); manager = create()
      for (const tier of ['local', 'cloud']) assert.doesNotMatch((await recall(tier)).contextText, /HRV|7 小时|5 小时/)
      assert.doesNotMatch(JSON.stringify(await manager.query(owner, 'portable_export', {})), /HRV|7 小时|5 小时/)
    } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
  })
