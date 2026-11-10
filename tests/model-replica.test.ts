import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import * as jose from 'jose';
import {accountDataCodec} from '../src/personal-cloud/directory-wire.mjs';
import {createModelExchange} from '../src/personal-cloud/model-replica.mjs';
import {openModelReplica} from '../src/ui-core/model-replica.mjs';

function fixture() {
  const codec=accountDataCodec(jose,randomBytes(32),['issuer','sub','kid','host'],'wm-model-replica+jwe');
  const one='model-service-11111111-1111-4111-8111-111111111111',two='model-service-22222222-2222-4222-8222-222222222222';
  const service=(serviceId:string,profileId:string)=>({serviceId,status:'active',name:profileId,updatedAt:'2026-11-01T00:00:00.000Z',revision:1,
    baseUrl:'https://synthetic.example/v1',interfaceType:'openai-compatible',models:[{modelId:'synthetic',name:'model',enabled:true,profileId}],selectedModelId:'synthetic'});
  const account:any={defaultModelProfileId:'cloud-one',modelServices:{[one]:service(one,'cloud-one'),[two]:service(two,'cloud-two'),local:service('local','local-only')}};
  const binding:any={};
  const state={key:'synthetic-key',stored:undefined as string|undefined,lose:false,failWrite:false};
  const context={accountState:()=>account,timestamp:Date.now,serial:(fn:any)=>fn(),backend:{listModels:async()=>[
    {id:'cloud-one',sourceKind:'cloud'},{id:'cloud-two',sourceKind:'cloud'},{id:'local-only',sourceKind:'local',name:'local'}]},
    visibleModels:(_o:any,rows:any)=>rows,modelServices:{
      secretFor:async(_o:any,s:any)=>{assert.notEqual(s.serviceId,'local');return state.key;},
      select:async()=>{},configure:async()=>{},
      remove:async(_o:any,id:any)=>{account.modelServices[id].status='removed';account.modelServices[id].updatedAt=new Date().toISOString();account.defaultModelProfileId='cloud-two';}
    }};
  const source=createModelExchange(context,'host',()=>({issuer:'issuer',sub:'sub',ownerId:'owner',deviceId:'device',keyId:'kid',binding}),
    (_i:any,_s:any,_h:any,fn:any)=>fn(codec),(_key:string,box:string)=>{binding.modelsBox=box;});
  const browser=(deviceId='device')=>openModelReplica({codec,deviceId,current:()=>{},random:randomUUID,
    read:async()=>state.stored,write:async(old:string,next:string)=>{if(state.failWrite||state.stored!==old)throw Error('storage failure');state.stored=next;},
    exchange:async({box}:any)=>{const result=await source({},box);if(state.lose){state.lose=false;throw Error('lost reply');}return result;}});
  return {browser,state,account,one,two,binding};
}
test('all cloud services retain profile identities and local entries never expose credentials',async()=>{
  const f=fixture(),browser=f.browser();const result=await browser.sync();
  assert.equal(result.services.length,2);assert.equal(result.current.profileId,'cloud-one');
  assert.deepEqual(result.local,[{profileId:'local-only',name:'local',requiresOnline:true}]);
  assert.ok(!f.state.stored?.includes(f.state.key));assert.ok(!f.binding.modelsBox.includes(f.state.key));
  const before=f.state.stored;f.account.modelServices[f.one].catalog={checkedAt:Date.now(),status:'available'};
  await browser.sync();assert.equal(f.state.stored,before);
  f.state.key='replacement';assert.equal((await browser.sync()).current.apiKey,'replacement');
});
test('removed service and default fallback survive a lost response and old device authentication is denied',async()=>{
  const f=fixture(),browser=f.browser();await browser.sync();
  f.state.lose=true;await assert.rejects(browser.remove(f.one),/lost reply/);
  const result=await browser.sync();assert.equal(result.services.length,1);assert.equal(result.current.profileId,'cloud-two');
  await assert.rejects(f.browser('other').sync(),{code:'MODEL_SYNC_INVALID'});
  f.state.failWrite=true;f.state.key='another-key';const before=f.state.stored;await assert.rejects(browser.sync(),/storage failure/);assert.equal(f.state.stored,before);
});
