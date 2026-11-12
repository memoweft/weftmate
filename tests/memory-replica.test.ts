import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import * as jose from 'jose';
import {accountDataCodec} from '../src/personal-cloud/directory-wire.mjs';
import {createMemoryExchange} from '../src/personal-cloud/memory-replica.mjs';
import {openMemoryReplica} from '../src/ui-core/memory-replica.mjs';

function fixture() {
  const key=randomBytes(32), scope=['issuer','sub','kid','host'];
  const codec=accountDataCodec(jose,key,scope,'wm-memory-replica+jwe');
  const permissions={allow_local_read:true,allow_cloud_read:true,allow_inference:true};
  const ids=['a','b','private'];
  const state={revision:1, failList:false, allowed:true, rejectWrite:false, loseReply:false, commits:0,
    suffix:'',plan:'forget-scope-v1:'+'1'.repeat(64),cache:undefined as string|undefined};
  const receipts=new Map<string,any>();
  const account={sessions:{'private-session':{temporary:true}},activity:{memoryDigest:{changes:[] as any[]}}};
  const manager={enabled:true,async query(_owner:string,method:string,input:any) {
    if(method==='query_jobs')return {world_revision:state.revision,evidence_ids:input.session_id==='private-session'&&input.projection==='evidence_ids'?['e-private']:[]};
    if(method==='preview_forget')return {world_revision:state.revision,forget_scope:state.plan,evidence_ids:['e-'+input.target_id],evidence_count:1,item_count:1,
      items:[{object_kind:'cognition',item_id:input.target_id,name:'synthetic '+input.target_id}]};
    if(input.operation==='revision')return {world_revision:state.revision};
    if(state.failList && input.object_kind==='entity')throw Error('source unavailable');
    return {world_revision:state.revision,items:input.object_kind!=='cognition'?[]:ids.map(id=>({item_id:id,object_kind:'cognition',current_state:'current',
      value:{content:'synthetic '+id+(id==='a'?state.suffix:'')},updated_at:'2026-01-01',permissions:[permissions],
      provenance:[{evidence_id:'e-'+id,currentness_state:'current',permissions,evidence:{content_available:true,raw_content:'original excluded'}}]}))};
  }};
  const context={memoryManager:manager,accountState:()=>account,
    async syncedMemoryCommand(_owner:string,action:string,_kind:string,id:string,requestId:string,_body:any,check:any) {
      if(action==='receipt'&&!receipts.has(requestId))throw Object.assign(Error(),{code:'NOT_FOUND'});
      if(action==='delete'){
        check();state.commits++;state.revision++;
        ids.splice(ids.indexOf(id),1);account.activity.memoryDigest.changes.push({operation:'delete',keys:['cognition:'+id]});
        receipts.set(requestId,{state:'applied',storageCleanup:{state:'complete'}});
      }
      return {body:{receipt:receipts.get(requestId)}};
    }};
  const authorize=(_request:any,required='sessions:read')=>{
    if(required==='account:manage'&&!state.allowed)throw Object.assign(Error(),{code:'DEVICE_NOT_TRUSTED'});
    return {issuer:'issuer',sub:'sub',ownerId:'owner',deviceId:'device',keyId:'kid'};
  };
  const exchange=createMemoryExchange(context,'host',authorize,(_i:any,_s:any,_h:any,fn:any)=>fn(codec));
  const open=(deviceId='device')=>openMemoryReplica({codec,read:async()=>state.cache,write:async(old:string,next:string)=>{
    if (state.rejectWrite || state.cache!==old) throw Error('write failed');
    state.cache=next;
  },current:()=>{},deviceId,random:randomUUID,exchange:async({box}:any)=>{
    const response=await exchange({},box);
    if(state.loseReply && state.commits){state.loseReply=false;throw Error('connection dropped');}
    return response;
  }});
  return {open,state,ids,scope,key,codec};
}

test('local forgetting survives reload and a lost reply without repeating the source deletion',async()=>{
  const f=fixture(),browser=await f.open();
  const initial=await browser.sync();
  assert.deepEqual(initial.items.map((r:any)=>r.text),['synthetic a','synthetic b']);
  assert.ok(!JSON.stringify(initial).includes('original excluded'));
  const local=await browser.forget('cognition:a',initial.items[0].plan);
  assert.deepEqual(local.items.map((r:any)=>r.key),['cognition:b']);
  assert.equal(f.state.commits,0);
  assert.ok(!f.state.cache?.includes('synthetic'));
  f.state.loseReply=true;
  await assert.rejects(browser.sync(),/connection dropped/);
  const reopened=await f.open();
  assert.equal((await reopened.read()).pending.length,1);
  const final=await reopened.sync();
  assert.equal(f.state.commits,1);assert.deepEqual(final.pending,[]);
  assert.ok(final.forgotten.includes('cognition:a'));
  f.ids.push('a');f.state.revision++;
  assert.deepEqual((await reopened.sync()).items.map((r:any)=>r.key),['cognition:b']);
});

test('failed persistence, incomplete reads, changed impact and revoked write scope preserve the last safe state',async()=>{
  const f=fixture(),browser=await f.open();
  const initial=await browser.sync();const old=f.state.cache;
  f.state.rejectWrite=true;
  await assert.rejects(browser.forget('cognition:a',initial.items[0].plan),/write failed/);
  assert.equal(f.state.cache,old);f.state.rejectWrite=false;
  f.state.failList=true;await assert.rejects(browser.sync());assert.equal(f.state.cache,old);
  f.state.failList=false;await browser.forget('cognition:a',initial.items[0].plan);
  f.state.allowed=false;await assert.rejects(browser.sync(),{code:'DEVICE_NOT_TRUSTED'});assert.equal(f.state.commits,0);
  f.state.allowed=true;f.state.plan='forget-scope-v1:'+'2'.repeat(64);
  const cache=await browser.sync();assert.equal(cache.pending[0].review,true);
  assert.deepEqual(cache.items.map((r:any)=>r.key),['cognition:b']);assert.equal(f.state.commits,0);
  const intentId=cache.pending[0].intentId,reviewed=await browser.review(intentId);
  await browser.forget(reviewed.key,reviewed.plan,{intentId,item:reviewed});
  assert.equal((await browser.sync()).pending.length,0);assert.equal(f.state.commits,1);
});

test('another device or wire format cannot open the memory exchange',async()=>{
  const f=fixture(),wrong=await f.open('other');
  await assert.rejects(wrong.sync(),{code:'MEMORY_SYNC_INVALID'});
  const bytes=await f.codec.seal('memory-cache',{private:true});
  await assert.rejects(accountDataCodec(jose,f.key,f.scope,'wm-chat-directory+jwe').open('memory-cache',bytes));
  await assert.rejects(accountDataCodec(jose,f.key,['issuer','else','kid','host'],'wm-memory-replica+jwe').open('memory-cache',bytes));
});

test('the same item IDs with a changed statement require fresh consent',async()=>{
  const f=fixture(), browser=await f.open(), before=await browser.sync();
  await browser.forget('cognition:a',before.items[0].plan);
  f.state.suffix=' corrected';f.state.revision++;
  const after=await browser.sync();
  assert.equal(f.state.commits,0);assert.equal(after.pending[0].review,true);
  assert.ok(after.items.every((item:any)=>item.key!=='cognition:a'));
});
