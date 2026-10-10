import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const skip = !python || !pythonPath ? 'CI runs this test with the pinned MemoWeft Core' : false

async function waitForFormation(manager: ReturnType<typeof createPersonalMemoryManager>) {
  // Ingest accepts a durable background job. Ordinary recall no longer waits
  // for it; this semantic test reads only after the real worker has settled.
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const result = await manager.query(owner, 'query_jobs', { operation: 'list' })
    if (!result.jobs?.some((job: any) => ['pending', 'processing', 'retry'].includes(job.worker?.state))) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Synthetic formation worker did not settle')
}

function boundary(text: string, sessionId: string) {
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: `${sessionId}-user`, source: { kind: 'user' },
      content: [{ type: 'text', text }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: `${sessionId}-assistant`,
      content: [{ type: 'text', text: '收到' }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ]
  return assertOwnerBoundBoundary(sessionId, boundaryForCompletedTurn({ id: sessionId,
    header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)))
}

test('FX-17 failed correction survives restart, annotates recall and retries one successor for two objects', { skip }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-fx17-test-')))
  let reject = true
  const correction = '纠正一下，第903种花茶不加肉桂粉，改为加一片柠檬。'
  const errors: unknown[] = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk
      const payload = JSON.parse(body).messages.map((m: any) => { try { return JSON.parse(m.content) } catch { return null } }).find((v: any) => v?.evidence)
      const e = payload.evidence[0], correcting = e.text === correction
      const result = correcting && reject ? {schema_version:8,result:'cognitions',cognitions:[{invalid:true}]} : {
        schema_version:8,result:'cognitions',cognitions:correcting ? payload.current_cognitions.map((old: any) => ({
          action:'correct',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,
          supports:[{evidence_id:e.id,sentence_id:'t0'}],corrects_cognition_id:old.id,
          entity:{canonical_name:'喝第903种花茶',kind:'topic',aliases:['第903种花茶']}
        })) : [{action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,
          supports:[{evidence_id:e.id,sentence_id:'t0'}],entity:{canonical_name:'喝第903种花茶',kind:'topic',aliases:['第903种花茶']}}]
      }
      res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}],model:'synthetic',usage:{total_tokens:0}}))
    } catch(error) {errors.push(error);res.writeHead(500);res.end('{}')}
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address() as {port:number}
  const route=()=>({profileId:'synthetic',baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'synthetic',credential:'synthetic',routeFingerprint:null,modelTier:'cloud'})
  const create=()=>createPersonalMemoryManager({root,enabled:true,python,pythonPath,baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'@current',credential:()=> 'synthetic',processingRoute:route,defaultProcessingRoute:route})
  let manager=create()
  try {
    for (const [i,text] of ['我喝第903种花茶时偏好加一小撮肉桂粉。','以后我喝第903种花茶时，请提醒我加一小撮肉桂粉。',correction].entries()) {
      await manager.ingest(owner,boundary(text,`fx17-${i}`)); await waitForFormation(manager)
    }
    const status=await manager.status(owner)
    assert.equal(status.failedCorrectionCount,1);assert.equal(status.state,'degraded')
    assert.equal(status.formationIssues[0].text,correction)
    for (let i=0;i<34;i++) await manager.ingest(owner,boundary('你好',`unrelated-${i}`))
    await waitForFormation(manager)
    await manager.close();manager=create()
    const recall=await manager.recall(owner,{query:'我喝第903种花茶加什么？',sessionId:'new-session'})
    assert.match(recall.contextText,/已被用户纠正，待更新/)
    assert.match(recall.contextText,/柠檬/)
    const firstRetry=await manager.retryFormation(owner,status.formationIssues[0].jobId,'still-rejected')
    await waitForFormation(manager)
    const again=await manager.status(owner)
    assert.equal(again.failedCorrectionCount,1)
    assert.equal(again.formationIssues[0].jobId,firstRetry.job_id)
    reject=false
    const job=again.formationIssues[0].jobId
    const receipt=await manager.retryFormation(owner,job,'fx17-retry')
    assert.ok(receipt.job_id)
    await waitForFormation(manager)
    assert.equal((await manager.status(owner)).failedCorrectionCount,0)
    const items=(await manager.query(owner,'query_world',{operation:'list',object_kind:'cognition',include_history:true})).items
    assert.equal(items.filter((i:any)=>i.current_state==='current').length,1)
    assert.equal(items.filter((i:any)=>i.current_state==='not_current').length,2)
    for (const old of items.filter((i:any)=>i.current_state==='not_current')) {
      const sources=await manager.query(owner,'query_provenance',{object_kind:'cognition',item_id:old.item_id,projection:'history'})
      assert.ok(sources.successor_provenance.some((s:any)=>s.evidence.raw_content===correction))
    }
    const after=await manager.recall(owner,{query:'我喝第903种花茶加什么？',sessionId:'after-retry'})
    assert.equal(after.memories.length,1);assert.match(after.memories[0].summary,/柠檬/)
    assert.deepEqual(errors,[])
  } finally {await manager.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
})
