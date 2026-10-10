import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { uiCoreAssets } from '../src/ui-core/manifest.mjs'

const source = uiCoreAssets.map(asset => readFileSync(new URL(`../src/ui-core/${asset}`, import.meta.url), 'utf8')).join('\n;\n')
const conversationId = 'phone-12345678-1234-4234-8234-123456789abc'
const sessionId = 'session-12345678-1234-4234-8234-123456789abc'
const response = (body: object) => ({ ok: true, status: 200, json: async () => body })
const plain = (value: any) => JSON.parse(JSON.stringify(value))

function fixture(fetch: (...args: any[]) => Promise<any>, overrides: Record<string,any> = {}) {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const binding = { sessionId, modelProfileId: 'synthetic-model' }
  const state: any = { page: 'chat', owner: 'owner-a', loggedIn: true, authEpoch: 1, generation: 1, sharedGeneration: 1,
    chatSource: 'phone', conversationId, sharedSessionId: sessionId, deviceId: 'phone-test', sharedHostAvailable: false,
    sharedSessions: [{ sessionId, sendAvailable: false }], sharedEvents: [], linkedEvents: new Map(),
    handoffViews: new Map([[conversationId, { status: 'uncertain', cached: true, hostAvailable: false, binding }]]),
    conversations: [{ id: conversationId, binding }] }
  const environment: any = { AbortSignal, URL, URLSearchParams, setTimeout, clearTimeout }
  runInNewContext(source, environment)
  const effects = new Proxy(overrides, { get: (target,key) => target[key as string] ?? (() => {}) })
  const core = environment.WeftUiCore.create({ mobileState: state, storage, fetch, effects, crypto: { randomUUID: () => 'synthetic-request' } })
  core.syncMobileIdentity()
  return { state, core, values }
}

test('offline cached phone binding keeps its read context and resource cache without enabling sends', async () => {
  const f = fixture(async () => { throw new Error('offline') })
  const cached = { outputs: [{ artifactId: 'cached-report', fileName: '已读取的报告.md' }], sources: [] }
  f.values.set(`weftmate-resources:owner-a:${sessionId}`, JSON.stringify(cached))
  assert.equal(f.core.mobile.selectedBinding().sessionId, sessionId)
  assert.equal(f.core.conversationTaskContext().sessionId, sessionId)
  const context = f.core.mobileDecisions.context()
  assert.equal(f.core.mobileDecisions.current(context), true)
  assert.deepEqual(plain(await f.core.mobileResources(context)), { ...cached, offline: true })
  assert.equal(f.state.handoffViews.get(conversationId).status, 'uncertain')
  assert.equal(f.core.state.phoneBindings.get(conversationId).status, 'uncertain')
  assert.equal(f.state.sharedSessions[0].sendAvailable, false)
  assert.equal(f.core.state.sessions[0].sendAvailable, false)
})

test('UX-6 mobile memory search binds opaque device scope to the raw host owner, refuses mixed owners and late account reads',async()=>{
  let wrong=false,release:any;const f=fixture(async(path:string)=>{
    if(path.endsWith('/status'))return response({ownerId:'raw-account-a',state:'ready',worldRevision:2,capabilities:{list:true}});
    if(release==='wait')await new Promise(done=>release=done);
    return response({ownerId:wrong?'raw-account-b':'raw-account-a',worldRevision:2,items:[{id:'memory-a',text:'合成偏好'}]});
  },{nativeCall:async()=>({owner:'owner-a',connectionVerified:true})});
  assert.equal((await f.core.mobile.searchMemoryPage('偏好')).items[0].id,'memory-a');assert.equal(f.core.state.ownerId,'owner-a');
  wrong=true;await assert.rejects(()=>f.core.mobile.searchMemoryPage('偏好'),{code:'MEMORY_OWNER_MISMATCH'});wrong=false;
  release='wait';const pending=f.core.mobile.searchMemoryPage('偏好');while(typeof release!=='function')await new Promise(done=>setTimeout(done,1));f.state.owner='owner-b';f.state.authEpoch++;release();await assert.rejects(()=>pending,{code:'STALE_CONTEXT'});
})

for (const boundary of ['conversation', 'owner']) test(`late offline-resource reply stays out after a ${boundary} switch`, async () => {
  let resolve!: (value: any) => void
  const pending = new Promise(done => { resolve = done })
  const f = fixture(async () => pending)
  const key = `weftmate-resources:owner-a:${sessionId}`, cached = JSON.stringify({ outputs: [{ artifactId: 'already-cached' }], sources: [] })
  f.values.set(key, cached)
  const context = f.core.mobileDecisions.context(), reading = f.core.mobileResources(context)
  if (boundary === 'owner') { f.state.owner = 'owner-b'; f.state.authEpoch++ }
  else { f.state.conversationId = 'phone-22345678-1234-4234-8234-123456789abc'; f.state.sharedSessionId = 'session-22345678-1234-4234-8234-123456789abc' }
  f.state.generation++
  f.state.conversations = []
  f.state.handoffViews.clear()
  resolve(response({ outputs: [{ artifactId: 'old-late-private', fileName: '迟到旧报告.md' }], sources: [], hasMore: false, nextSeq: 1 }))
  await assert.rejects(reading, (error: any) => error.code === 'STALE_CONTEXT')
  assert.equal(f.core.mobileDecisions.current(context), false)
  assert.equal(f.values.get(key), cached, 'late data cannot replace the cached contents')
  assert.doesNotMatch(JSON.stringify(f.core.resourceCache), /old-late-private/)
})
