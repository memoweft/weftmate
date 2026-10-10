import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTimelineCandidate } from './integration/timeline-ui-candidate.mjs';
import { noPush, pushPayload, pushRegistration } from '../src/push/provider.mjs';
import { sendHostPush } from '../src/personal-access/push.mjs';

test('host forwarding uses only eligible account/device bindings and only event identity/type', async()=>{
  const sent:any[]=[];const provider={id:'synthetic',send:async(device:any,payload:any)=>{sent.push({device,payload});return {accepted:true};}};
  const push={platform:'android',provider:'synthetic',token:'synthetic'};
  const account:any={account:{authEpoch:2},activity:{items:{'activity-a':{type:'task.completed',read:false,notification:{notify:true},title:'private',summary:'private'}}},
    devices:{good:{push,revoked:false,authEpoch:2},revoked:{push,revoked:true},expired:{push,expiresAt:'2000-01-01T00:00:00Z'},oldEpoch:{push,authEpoch:1}}};
  const context={accountState:()=>account,timestamp:()=>Date.now()};
  assert.equal((await sendHostPush(context,'owner-a','activity-a',provider)).accepted,true);
  assert.equal(sent.length,1);assert.equal(sent[0].device.deviceId,'good');assert.deepEqual(sent[0].payload,{eventId:'activity-a',type:'task.completed'});
  assert.equal((await sendHostPush(context,'owner-a','activity-a')).reason,'PUSH_NOT_CONFIGURED');
  account.activity.items['activity-a'].notification.notify=false;await sendHostPush(context,'owner-a','activity-a',provider);assert.equal(sent.length,1);
  account.activity.items['activity-a'].notification.notify=true;account.activity.items['activity-a'].read=true;await sendHostPush(context,'owner-a','activity-a',provider);assert.equal(sent.length,1);
});

test('provider is explicitly unconfigured and accepts only event identity/type without content', async()=>{
  assert.deepEqual(await noPush.send({}, {eventId:'activity-synthetic',type:'task.completed'}), {configured:false,accepted:false,reason:'PUSH_NOT_CONFIGURED'});
  for(const value of [{eventId:'a',type:'task.completed',body:'private'}, {eventId:'../a',type:'task.completed'}, {eventId:'a',type:'secret'}]) assert.throws(()=>pushPayload(value));
  assert.deepEqual(pushRegistration({platform:'android',provider:'none',token:null}), {platform:'android',provider:'none',token:null});
  for(const value of [{platform:'android',provider:'none',token:'secret'}, {platform:'android',provider:'fcm',token:null}, {platform:'android',provider:'fcm',token:'secret',ownerId:'other'}]) assert.throws(()=>pushRegistration(value));
});
test('host registration binds authenticated account/device, never echoes token, rotates and clears on device revocation', async t=>{
  const f=await startTimelineCandidate({interactive:true,historyCount:0});t.after(()=>f.close());
  assert.equal((await fetch(f.origin+'/personal/v1/push/registration')).status,401);
  const initial=await f.request('/push/registration');assert.equal(initial.registered,false);
  const value=await f.request('/push/registration',{platform:'android',provider:'fcm',token:'SYNTHETIC-PUSH-TOKEN'},'PUT');
  assert.equal(value.configured,false);assert.equal(value.tokenPresent,true);assert.equal(value.provider,'fcm');assert.equal(JSON.stringify(value).includes('SYNTHETIC-PUSH-TOKEN'),false);
  await f.request('/push/registration',{platform:'android',provider:'none',token:null},'PUT');assert.equal((await f.request('/push/registration')).tokenPresent,false);
  await f.request('/push/registration',undefined,'DELETE');assert.equal((await f.request('/push/registration')).registered,false);
  await assert.rejects(()=>f.request('/push/registration',{platform:'android',provider:'fcm',token:'x',deviceId:'someone-else'},'PUT'),/INVALID_REQUEST/);
  await f.request('/push/registration',{platform:'android',provider:'fcm',token:'SYNTHETIC-REVOKE-ME'},'PUT');
  const auth=await f.request('/auth/me');await f.request('/auth/devices/'+auth.device.id,undefined,'DELETE');
  assert.equal((await readFile(join(f.root,'store.json'),'utf8')).includes('SYNTHETIC-REVOKE-ME'),false);
});
