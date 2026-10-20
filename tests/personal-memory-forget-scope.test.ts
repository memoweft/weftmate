import assert from 'node:assert/strict';
import test from 'node:test';
import { forgetPreviewView, handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs';
import { checkForgetCompletion } from '../src/personal-memory/forget-model.mjs';

const scope = 'forget-scope-v1:' + 'a'.repeat(64);
test('Core forget preview preserves its scope and distinguishes derived copies from source deletion', () => {
  const result = forgetPreviewView({ world_revision: 1, forget_scope: scope, evidence_count: 1, evidence_ids: ['source'],
    item_count: 2, items: [{ object_kind: 'interaction_context', item_id: 'copy', name: 'You like tea.', item_type: 'interaction_context' },
      { object_kind: 'evidence_context', item_id: 'independent', name: 'You like tea.', item_type: 'preceding_ai_context' }] });
  assert.equal(result.forgetScope, scope);
  assert.deepEqual(result.evidenceIds, ['source']);
  assert.equal(result.items[1].kind, 'evidence_context');
});

test('a correction committed after preview requests fresh confirmation without any deletion', async () => {
  let writes = 0;
  const manager: any = {
    status: async () => ({ state: 'ready', capabilities: { deleteWorldItem: true } }),
    query: async (_owner: string, method: string) => method === 'preview_forget'
      ? { world_revision: 2, items: [], evidence_ids: [] } : { world_revision: 2 },
    checkForgetCompletion: (owner: string, proposal: any) => checkForgetCompletion(manager, owner, proposal, {}),
    submitCommand: async () => { writes++; throw Error('stale confirmation must not submit'); },
  };
  const url = new URL('http://memory/personal/v1/memory/items/cognition/target');
  const result = await handlePersonalMemoryHttp({ manager, ownerId: 'owner', pathname: url.pathname, url,
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'stale', expectedWorldRevision: 1, forgetScope: scope }) });
  assert.equal(result.status, 409);
  assert.equal(result.body.state, 'withheld');
  assert.equal(result.body.error.code, 'MEMORY_REVISION_CHANGED');
  assert.equal(writes, 0);
});

test('page deletion forwards the confirmed scope unchanged and exposes stale-scope rejection', async () => {
  const writes: any[] = [];
  const manager: any = { status: async () => ({ state: 'ready', capabilities: { deleteWorldItem: true } }),
    query: async () => ({}), checkForgetCompletion: async () => ({ state: 'complete', worldRevision: 1 }),
    submitCommand: async (_owner: string, value: any) => { writes.push(value); return { receipt: {
      command_id: 'command', result_state: 'rejected', rejection_code: 'forget_scope_changed', after_revision: 1 } }; } };
  const url = new URL('http://memory/personal/v1/memory/items/cognition/target');
  const result = await handlePersonalMemoryHttp({ manager, ownerId: 'owner', pathname: url.pathname, url,
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'request', expectedWorldRevision: 1, forgetScope: scope }) });
  assert.deepEqual(writes[0].payload, { forget_scope: scope });
  assert.equal(result.body.receipt.reasonCode, 'MEMORY_REVISION_CHANGED');
  assert.equal(writes.length, 1);
});

for (const revision of [1,2,null]) test(`uncertain completion checks the current revision (${revision}) before choosing its explanation`,async()=>{
 const manager:any={query:async(_owner:string,method:string,params:any)=>{
  if(method==='preview_forget')throw Object.assign(Error('projection changed during read'),{code:'world_item_not_found'});
  assert.equal(method,'query_world');assert.equal(params.operation,'revision');
  if(revision===null)throw Error('unavailable');return {world_revision:revision};
 }};
 const result=await checkForgetCompletion(manager,'owner',{targetKind:'cognition',targetId:'target',expectedWorldRevision:1},{});
 assert.equal(result.state,'withheld');
 if(revision===2)assert.equal(result.reasonCode,'MEMORY_REVISION_CHANGED');
 else assert.equal(result.reasonCode,undefined,'uncertainty is not proof of a changed or completed deletion');
});

test('in-flight Core formation prevents preview with a retryable human-readable boundary',async()=>{
 const manager:any={query:async()=>{throw Object.assign(Error('formation_in_progress'),{code:'formation_in_progress'});}};
 const url=new URL('http://memory/personal/v1/memory/items/cognition/target/forget-preview');
 await assert.rejects(handlePersonalMemoryHttp({manager,ownerId:'owner',pathname:url.pathname,url,request:{method:'GET'},readJson:async()=>({})}),{code:'MEMORY_FORMATION_PENDING',status:409});
});

test('in-flight formation completion check never dispatches deletion',async()=>{
 let writes=0;
 const manager:any={status:async()=>({state:'ready',capabilities:{deleteWorldItem:true}}),query:async()=>({}),
  checkForgetCompletion:async()=>({state:'withheld',reasonCode:'MEMORY_FORMATION_PENDING',worldRevision:1}),submitCommand:async()=>{writes++;}};
 const url=new URL('http://memory/personal/v1/memory/items/cognition/target');
 const result=await handlePersonalMemoryHttp({manager,ownerId:'owner',pathname:url.pathname,url,request:{method:'DELETE'},readJson:async()=>({requestId:'pending',expectedWorldRevision:1,forgetScope:scope})});
 assert.equal(result.status,409);assert.equal(result.body.state,'withheld');assert.equal(result.body.error.code,'MEMORY_FORMATION_PENDING');assert.equal(writes,0);
});

for (const orphan of ['我其实更喜欢绿茶','我喜欢散步']) test(`page completion checks unformed source: ${orphan}`,async()=>{
 const permissions={allow_local_read:true,allow_cloud_read:true,allow_inference:true};
 const ev=(text:string)=>({raw_content:text,summary:text,permissions,content_available:true,currentness_state:'current'});
 const red=ev('我喜欢喝红茶'),pending=ev(orphan);let observed:any[]=[];
 const row={object_kind:'cognition',item_id:'red',value:{content:'用户喜欢喝红茶'},transition_history:[],provenance:[{evidence_id:'red-source',evidence:red,permissions}]};
 const manager:any={query:async(_owner:string,method:string,p:any)=>{
  if(method==='preview_forget')return{world_revision:1,items:[{object_kind:'cognition',item_id:'red',name:'用户喜欢喝红茶',item_type:'preference'}],evidence_ids:['red-source']};
  if(method==='query_jobs')return{world_revision:1,jobs:[{acceptance:{evidence_ids:['orphan']},worker:{state:'no_change'}}]};
  if(method==='query_world')return{world_revision:1,items:p.object_kind==='cognition'?[row]:[]};
  if(method==='query_evidence')return{world_revision:1,evidence:p.evidence_id==='red-source'?red:pending};
  throw Error(method);
 }};
 const original=globalThis.fetch;
 globalThis.fetch=async(_url:any,init:any)=>{const body=JSON.parse(init.body),input=JSON.parse(body.messages.at(-1).content);observed.push(...input.candidates);
  const items=input.candidates.map((c:any)=>({key:c.key,matchesTopic:!c.text.includes('散步'),subjects:['self'],targetSubjects:c.text.includes('散步')?[]:['self'],hasTargetFact:!c.text.includes('散步'),sourceFullyAuthorized:true}));
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'classify_forget_candidates',arguments:JSON.stringify({items})}}]}}]}));};
 try{const result=await checkForgetCompletion(manager,'owner',{targetKind:'cognition',targetId:'red',expectedWorldRevision:1},{baseUrl:'https://synthetic.invalid',model:'synthetic',credential:'synthetic',modelTier:'local'});
  assert.equal(result.state,orphan.includes('绿茶')?'withheld':'complete');assert.ok(observed.some(c=>c.text.includes(orphan)),'the unformed original must reach the completeness check');
 }finally{globalThis.fetch=original;}
});
