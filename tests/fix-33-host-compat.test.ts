import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
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
 await new Promise(r=>setTimeout(r,100));const begin=performance.now();await api('/sync/events',{events:[event]});const changed=await waiting;
 assert.ok(performance.now()-begin<1000,'new phone content must wake the existing wait instead of waiting for the timeout');
 assert.notEqual(changed.accountChanges.phoneSync,page.accountChanges.phoneSync);
 const duplicateWait=api(`/chats/${chat.chatId}/changes?cursor=${changed.nextCursor}&liveRevision=${changed.liveRevision}&waitMs=300&accountRevision=${changed.accountChanges.revision}`);
 await new Promise(r=>setTimeout(r,50));await api('/sync/events',{events:[event]});const duplicate=await duplicateWait;
 assert.equal(duplicate.waitOutcome,'timeout');assert.equal(duplicate.accountChanges.phoneSync,changed.accountChanges.phoneSync);
});
