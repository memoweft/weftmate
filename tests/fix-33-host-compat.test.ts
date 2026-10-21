import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,webcrypto} from 'node:crypto';
import {createPersonalAccessService} from '../src/personal-access/index.mjs';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('a saved native login initializes the cloud client and reconnects after restoring cache; failure retains that cache',async()=>{
 const context:any=vm.createContext({WeftUiCore:{}});vm.runInContext(await readFile('src/ui-core/adapters/android-bridge.js','utf8'),context);
 for(const unavailable of [false,true]) {
  const calls:string[]=[];let cache=false;
  await context.WeftUiCore.resumeCachedMobileCloudSession({configure:async()=>calls.push('configure'),restore:async()=>{cache=true;calls.push('restore');},reconnect:async()=>{calls.push('reconnect');if(unavailable)throw {code:'NETWORK'};},failed:()=>calls.push('visible failure')});
  assert.equal(cache,true);assert.deepEqual(calls,unavailable?['configure','restore','reconnect','visible failure']:['configure','restore','reconnect']);
 }
 const calls:string[]=[];
 await context.WeftUiCore.resumeCachedMobileCloudSession({configure:async()=>calls.push('configure'),restore:async()=>calls.push('restore'),verify:async()=>{calls.push('verify content session');return true;},reconnect:async()=>{throw Error('valid legacy content session must not wait on cloud token refresh');},failed:()=>{throw Error('unexpected failure');}});
 assert.deepEqual(calls,['configure','restore','verify content session']);
});

test('new phone model sync uses the declared computer protocol and never sends phoneFirst to the legacy host',async()=>{
 const context:any=vm.createContext({TextEncoder});vm.runInContext(await readFile('src/ui-core/offline.js','utf8'),context);
 for(const capabilities of [{},{offlinePhoneFirst:1}]){
  const requests:any[]=[];
  const engine=await context.WeftOffline.create({identity:{hostId:'synthetic'},phoneModel:()=>({modelId:'synthetic'}),hostCapabilities:()=>capabilities,
   vault:{load:async()=>({snapshot:null,turns:[],conversations:[],tasks:[]}),key:async()=>({}),save:async()=>{},close:()=>{},open:async()=>({items:[],remove:[],hashes:{},generation:1,model:null,control:{accountId:'synthetic'}})},
   host:async(path:string,body:any)=>{requests.push({path,body});if(!capabilities.offlinePhoneFirst&&body.phoneFirst)throw {code:'INVALID_REQUEST',status:400};return {};},});
  await engine.sync();assert.equal(requests.length,1);assert.equal(requests[0].path,'/offline/sync');assert.equal(requests[0].body.phoneFirst,capabilities.offlinePhoneFirst?true:undefined);engine.close();
 }
});

test('a legacy computer without source qualification keeps the original phone turn pending instead of downgrading',async()=>{
 const context:any=vm.createContext({TextEncoder,crypto:webcrypto});vm.runInContext(await readFile('src/ui-core/phone-memory.js','utf8'),context);vm.runInContext(await readFile('src/ui-core/offline.js','utf8'),context);
 const turn={id:'synthetic-turn',conversationId:'synthetic-conversation',timestamp:1,messages:[{role:'user',text:'你好'},{role:'assistant',text:'合成回复'}]};
 const requests:any[]=[];
 const engine=await context.WeftOffline.create({identity:{hostId:'synthetic'},phoneModel:()=>({modelId:'synthetic'}),hostCapabilities:()=>({}),
  vault:{load:async()=>({snapshot:null,turns:[turn],conversations:[],tasks:[]}),key:async()=>({}),save:async()=>{},close:()=>{},open:async()=>({items:[],remove:[],hashes:{},generation:1,model:null,control:{accountId:'synthetic'}})},
  host:async(path:string,body:any)=>{requests.push({path,body});assert.equal(body.phoneFirst,undefined);assert.equal(body.handover,undefined);assert.equal(body.turnFragments,undefined);return path==='/offline/turns'?{generation:1,receipts:[{id:turn.id,state:'synced'}]}:{};},});
 await assert.rejects(engine.sync(),{code:'COMPUTER_UPDATE_REQUIRED'});assert.deepEqual(requests.map(r=>r.path),['/offline/sync']);assert.equal(engine.view().turns.length,1);assert.equal(engine.view().turns[0].id,turn.id);assert.equal(engine.view().phoneMemory.transferred,false);engine.close();
});

test('phone sync commit wakes the existing chat wait; duplicate upload does not wake idle clients',async t=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-fix33-sync-'));
 const host=await createPersonalAccessService({root,port:0,backend:{getStatus:async()=>({}),listModels:async()=>[],preflight:async()=>({}),createSession:async()=>({}),sendMessage:async()=>({}),cancelSession:async()=>({}),describeSession:async()=>null,readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),waitForEvents:async()=>({})}});
 t.after(async()=>{await host.close();await rm(root,{recursive:true,force:true});});
 const {origin}=await host.start(),grant=await host.issueSetupGrant();
 const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'synthetic',password:'synthetic password 20 characters',deviceName:'synthetic-host'})});
 const auth=await setup.json(),cookie=setup.headers.get('set-cookie')!.split(';')[0];
 const api=async(path:string,body?:unknown)=>{const r=await fetch(origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,'x-weftmate-csrf':auth.csrfToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
 const chat=(await api('/chats/main')).chat,page=await api(`/chats/${chat.chatId}/events?limit=100`);
 const event={eventId:'event-'+randomUUID(),conversationId:'conversation-'+randomUUID(),clientSeq:1,kind:'message.created',occurredAt:new Date().toISOString(),payload:{messageId:'message-'+randomUUID(),role:'user',text:'合成手机消息'}};
 const waiting=api(`/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=3000&accountRevision=${page.accountChanges.revision}`);
 await new Promise(r=>setTimeout(r,100));await api('/sync/events',{events:[event]});const begin=performance.now();const changed=await waiting;
 assert.ok(['changed','snapshot'].includes(changed.waitOutcome),'the wait must report content invalidation, never merely finish its timer');
 assert.ok(performance.now()-begin<1000,'new phone content must wake the existing wait instead of waiting for the timeout');
 assert.notEqual(changed.accountChanges.phoneSync,page.accountChanges.phoneSync);
 const duplicateWait=api(`/chats/${chat.chatId}/changes?cursor=${changed.nextCursor}&liveRevision=${changed.liveRevision}&waitMs=300&accountRevision=${changed.accountChanges.revision}`);
 await new Promise(r=>setTimeout(r,50));await api('/sync/events',{events:[event]});const duplicate=await duplicateWait;
 assert.equal(duplicate.waitOutcome,'timeout');assert.equal(duplicate.accountChanges.phoneSync,changed.accountChanges.phoneSync);
});
