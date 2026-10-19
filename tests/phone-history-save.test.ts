import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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
