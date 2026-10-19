import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import '../src/ui-core/offline.js';

async function phoneVault() {
  let attached:any, saves=0, stored:any, scope:any;
  const identity={origin:'https://synthetic.example',accountId:'history-test',localOnly:true};
  const context:any={window:{weftNative:true},state:{},document:{addEventListener(){}},addEventListener(){},clearTimeout,TextEncoder,
    WeftOffline:{...(globalThis as any).WeftOffline,create:async(options:any)=>{attached=options;return {view:()=>({conversations:[]})};}},
    androidBridge:{call:async(method:string,params:any)=>{
      if(method==='phone.identity')return identity;
      if(method==='phone.offline.save'){saves++;scope={accountId:params.accountId,origin:params.origin};stored=structuredClone(params.value);return {saved:true};}
      throw Error('Unexpected method');
    }}};
  runInNewContext(readFileSync(new URL('../apps/mobile-ui/www/components/phone-standalone.js',import.meta.url),'utf8'),context);
  await context.WeftPhone.restoreArchive(identity,{});
  return {vault:attached.vault,saves:()=>saves,stored:()=>stored,scope:()=>scope,context};
}

test('phone vault sends history larger than 128 KiB through its normal save call',async()=>{
  const f=await phoneVault(),value={snapshot:null,conversations:[{id:'long-history',turns:Array.from({length:600},(_,i)=>({id:`turn-${i}`,messages:[{role:'user',text:'合成问题'.repeat(40)},{role:'assistant',text:'合成回复'.repeat(40)}]}))}]};
  assert.ok(JSON.stringify(value).length>128*1024);
  await f.vault.save(value);assert.equal(f.saves(),1);assert.deepEqual(f.stored(),value);
  assert.deepEqual(f.scope(),{accountId:'history-test',origin:'https://synthetic.example'});
});

test('true phone storage limit fails before sending and leaves the previous durable history untouched',async()=>{
  const f=await phoneVault(),previous={conversations:[{id:'keep-me',turns:[{messages:[{role:'user',text:'必须保留的历史'}]}]}]};
  await f.vault.save(previous);
  const tooLarge={conversations:[{text:'汉'.repeat(3*1024*1024)}]};
  assert.ok(JSON.stringify(tooLarge).length<8*1024*1024);
  await assert.rejects(f.vault.save(tooLarge),(error:any)=>error.code==='OFFLINE_STORAGE_TOO_LARGE');
  assert.equal(f.saves(),1);assert.deepEqual(f.stored(),previous);
});


const W=(globalThis as any).WeftOffline;
const until=async(predicate:()=>boolean)=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'queue settled');};

test('rejected history save rolls back the unaccepted input and retry sends it exactly once',async t=>{
 let full=true,stored:any,calls=0;
 const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>({snapshot:null,turns:[],conversations:[]}),close(){},
  save:async(value:any)=>{if(full)throw Object.assign(Error('OFFLINE_STORAGE_TOO_LARGE'),{code:'OFFLINE_STORAGE_TOO_LARGE'});stored=structuredClone(value);},
  complete:async()=>{calls++;return{choices:[{message:{content:'已回复'}}]};}}});
 t.after(()=>engine.close());
 await assert.rejects(engine.enqueue('保留草稿'),{code:'OFFLINE_STORAGE_TOO_LARGE'});
 assert.equal(engine.view().pendingMessages.length,0);assert.equal(engine.view().conversations.length,0);assert.equal(calls,0);
 full=false;await engine.enqueue('保留草稿');await until(()=>!engine.view().running);
 assert.equal(calls,1);assert.equal(stored.conversations[0].turns.length,1);
});

test('native phone send returns the human capacity error and sent=false to preserve the editor draft',async()=>{
 const identity={origin:'https://synthetic.example',accountId:'full-test'};
 const error=Object.assign(Error('OFFLINE_STORAGE_TOO_LARGE'),{code:'OFFLINE_STORAGE_TOO_LARGE'});
 const context:any={window:{weftNative:true},state:{booted:true,loggedIn:true,connection:'phone',model:{modelId:'synthetic'}},
  document:{addEventListener(){}},addEventListener(){},clearTimeout,
  androidBridge:{call:async()=>identity},uiCore:{syncMobileIdentity(){},messageModePreference:()=>'queue'},
  WeftOffline:{...W,create:async()=>({view:()=>({running:false,conversations:[],pendingMessages:[]}),enqueue:async()=>{throw error;}})}};
 runInNewContext(readFileSync(new URL('../apps/mobile-ui/www/components/phone-standalone.js',import.meta.url),'utf8'),context);
 await context.WeftPhone.restoreArchive(identity,{});
 const receipt=await context.WeftPhone.presentation('send',{text:'草稿不能丢'});
 assert.equal(receipt.sent,false);assert.match(receipt.error,/保存上限/);assert.match(receipt.error,/更多.*删除对话/);
});

test('capacity failure while saving a reply pauses later inputs with the capacity recovery instruction',async t=>{
 let release!:()=>void,calls=0,full=false;
 const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>({snapshot:null,turns:[],conversations:[]}),close(){},
  save:async()=>{if(full)throw Object.assign(Error('OFFLINE_STORAGE_TOO_LARGE'),{code:'OFFLINE_STORAGE_TOO_LARGE'});},
  complete:async()=>{calls++;await new Promise<void>(r=>release=r);return{choices:[{message:{content:'完整回复'}}]};}}});
 t.after(()=>engine.close());
 const first=await engine.enqueue('第一条');await until(()=>calls===1);await engine.enqueue('第二条',first.conversationId);
 full=true;release();await until(()=>!!engine.view().queueError&&!engine.view().running);
 assert.equal(calls,1);assert.deepEqual(engine.view().pendingMessages.map((p:any)=>p.text),['第二条']);
 assert.match(engine.view().queueError,/保存上限/);assert.match(engine.view().queueError,/更多.*删除对话/);
});
