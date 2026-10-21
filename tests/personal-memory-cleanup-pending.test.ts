import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createMemoryActions} from '../src/personal-memory/actions.mjs'

const owner='owner-00000000-0000-4000-8000-000000000001'
async function savedAction(t:any, receipts:Map<string,any>) {
  const root=await mkdtemp(join(tmpdir(),'weftmate-cleanup-pending-'))
  const file=join(root,'accounts',owner,'memory-home','pending-actions.json')
  await mkdir(dirname(file),{recursive:true})
  await writeFile(file,JSON.stringify({records:{saved:{requestId:'saved',name:'memory_forget',arguments:{},
    result:{state:'applied',message:'已忘掉这件事。'},cleanupPending:[...receipts.keys()],
    finished:[...receipts.keys()],commands:Object.fromEntries([...receipts.keys()].map(id=>[id,{requestId:id}]))}}}))
  let replayed=0,scheduled=0
  const attempts:string[]=[]
  const manager={
    planForget(){replayed++;throw Error('A submitted deletion must not be planned again')},
    submitCommand(){replayed++;throw Error('A submitted deletion must not be submitted again')},
    async retryCleanupByRequest(_owner:string,id:string){attempts.push(id);const value=receipts.get(id);if(value instanceof Error)throw value;return value},
  }
  const create=()=>createMemoryActions({root,manager:()=>manager,schedule(){scheduled++}})
  let actions=create()
  t.after(async()=>{await actions.close();assert.equal(dirname(await realpath(root)),await realpath(tmpdir()));await rm(root,{recursive:true,force:true})})
  return {get actions(){return actions},get replayed(){return replayed},get scheduled(){return scheduled},attempts,
    async reopen(){await actions.close();actions=create()},
    async row(){return JSON.parse(await readFile(file,'utf8')).records.saved},
    submit(){return actions.submit(owner,{requestId:'saved',name:'memory_forget',arguments:{}})},
  }
}
const receipt=(state:string,cleanup?:string)=>({receipt:{result_state:state,...(cleanup?{storage_cleanup:{state:cleanup}}:{})}})

test('saved applied plus pending cleanup stays incomplete across restart and reveals completion without replay',async t=>{
  const responses=new Map([['original-delete',receipt('applied','pending')]])
  const f=await savedAction(t,responses)
  const initial=await f.submit(),saved=await f.row(),pending=await f.actions.pending(owner)
  await f.reopen();const restarted=await f.submit()
  responses.set('original-delete',receipt('applied','complete'))
  await f.actions.resume(owner);const completed=await f.submit()
  assert.equal(initial.state,'queued')
  assert.doesNotMatch(initial.message,/已忘掉|已删除.*来源/)
  assert.equal(saved.result.state,'applied','retain the no-replay execution barrier')
  assert.equal(pending,true);assert.equal(restarted.state,'queued')
  assert.equal(completed.state,'applied');assert.deepEqual((await f.row()).cleanupPending,[])
  assert.equal(await f.actions.pending(owner),false);assert.equal(f.replayed,0)
})

for(const [label,value]of [
  ['missing receipt',{}],['rejected receipt',receipt('rejected','complete')],
  ['applied without cleanup proof',receipt('applied')],
  ['missing original receipt',Object.assign(Error('missing'),{code:'command_receipt_not_found'})],
] as const)test(`${label} cannot release cleanup pending or report forgetting complete`,async t=>{
  const f=await savedAction(t,new Map([['original-delete',value]]))
  const result=await f.submit()
  assert.equal(result.state,'queued');assert.deepEqual((await f.row()).cleanupPending,['original-delete'])
  assert.equal(await f.actions.pending(owner),true);assert.equal(f.replayed,0);assert.ok(f.scheduled>0)
})

test('all original cleanup requests must finish; manager-confirmed no_change needs no Core physical cleanup field',async t=>{
  // retryCleanupByRequest already verifies host journal cleanup. Core no_change
  // makes no physical deletion and legitimately omits storage_cleanup.
  const responses=new Map([['first',receipt('applied','complete')],['second',receipt('applied','pending')]])
  const f=await savedAction(t,responses)
  const partial=await f.submit(),before=await f.row()
  responses.set('second',receipt('no_change'))
  await f.actions.resume(owner);const final=await f.submit()
  assert.equal(partial.state,'queued');assert.deepEqual(before.cleanupPending,['second'])
  assert.equal(final.state,'applied');assert.deepEqual((await f.row()).cleanupPending,[]);assert.equal(f.replayed,0)
})
