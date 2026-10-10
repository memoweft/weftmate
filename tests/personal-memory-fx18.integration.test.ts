import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'
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

for (const exit of ['shutdown', 'forced']) test(`FX-18 ${exit} resumes a real Core job without expiry or duplicates`, {skip}, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-fx18-integration-')))
  // Windows venv python.exe is a launcher; kill the actual interpreter, with
  // the same installed dependencies, so this really tests abrupt Core death.
  const runtime = JSON.parse(execFileSync(python!, ['-c', 'import sys,json; print(json.dumps([sys._base_executable,sys.path]))'], {encoding:'utf8'}))
  const source = [pythonPath!, ...runtime[1]].join(path.delimiter)
  const rpcs: MemoWeftRpc[] = []
  const calls: number[] = [], errors: unknown[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const server = createServer(async (req,res) => {
    try {
      let text = ''; for await(const b of req) text += b
      const payload = JSON.parse(text).messages.map((m:any)=>{try{return JSON.parse(m.content)}catch{return null}}).find((m:any)=>m?.evidence)
      const e = payload.evidence[0]; calls.push(Date.now()); await gate
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{
        action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,
        supports:[{evidence_id:e.id,sentence_id:'t0'}]}]})}}]}))
    } catch(e) {errors.push(e); res.writeHead(500).end('{}')}
  })
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`
  const route = () => ({profileId:'synthetic',baseUrl,model:'synthetic',credential:'synthetic',routeFingerprint:null,modelTier:'cloud'})
  const create = () => createPersonalMemoryManager({root,enabled:true,python:runtime[0],pythonPath:source,baseUrl,model:'@current',
    credential:()=> 'synthetic',processingRoute:route,defaultProcessingRoute:route,
    rpcFactory:options=>{const rpc=new MemoWeftRpc(options);rpcs.push(rpc);return rpc}})
  const wait = async (predicate:()=>Promise<any>|any, ms=10000) => {
    const end=Date.now()+ms; while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,50))}
    throw Error('FX18_WAIT_TIMEOUT')
  }
  let manager=create()
  const input=boundary('我喝第918种合成茶时偏好加两片柠檬。','fx18-restart')
  try {
    await manager.ingest(owner,input);await wait(()=>calls.length===1)
    const oldJobs=(await manager.query(owner,'query_jobs',{operation:'list'})).jobs
    assert.equal(oldJobs.length,1);assert.equal(oldJobs[0].worker.state,'processing')
    if(exit==='forced') {const child=rpcs.at(-1)!.child!;const closed=once(child,'close');child.kill('SIGKILL');await closed}
    const closing=Date.now();await manager.close();assert.ok(Date.now()-closing<3000)
    const restarted=Date.now();manager=create()
    await wait(()=>calls.length===2)
    assert.ok(calls[1]-restarted<10000)
    const recovering=await manager.status(owner)
    assert.equal(recovering.state,'recovering');assert.equal(recovering.reasonCode,'MEMORY_FORMATION_RECOVERING')
    assert.equal(recovering.pendingBoundaryCount,0);assert.equal(recovering.recoveringFormationCount,1)
    // Re-delivery of the same source and late completion of the first model
    // call cannot create another job or overwrite the newly fenced result.
    await manager.ingest(owner,input);release();await waitForFormation(manager)
    const status=await manager.status(owner);assert.equal(status.state,'ready');assert.equal(status.recoveringFormationCount,0)
    const jobs=(await manager.query(owner,'query_jobs',{operation:'list'})).jobs
    assert.equal(jobs.length,1);assert.equal(jobs[0].job_id,oldJobs[0].job_id)
    assert.equal(jobs[0].worker.attempts,1);assert.equal(jobs[0].worker.state,'applied')
    const items=(await manager.query(owner,'query_world',{operation:'list',object_kind:'cognition',include_history:true})).items
    assert.equal(items.length,1)
    assert.equal((await manager.status(owner)).worldRevision,1)
    assert.deepEqual(errors,[])
  } finally {
    release();await manager.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true})
  }
})
