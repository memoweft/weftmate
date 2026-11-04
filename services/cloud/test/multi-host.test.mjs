import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './identity-helpers.mjs';
import {registration,appDevice,control,refresh,hostFixture} from './app-helpers.mjs';
import { createAccountKeys } from '../../../src/personal-cloud/account-keys.mjs';
import {taskRecipient} from '../../../src/personal-offline/crypto.mjs';

test('two computers share one account: identity, addressing, rename, removal and local access',async t=>{
  const f=await fixture(t);await registration(f);
  const a=await appDevice(f,'desktop'),b=await appDevice(f,'laptop'),phone=await appDevice(f,'phone');
  const desk=await hostFixture(f,t),laptop=await hostFixture(f,t);
  assert.equal((await desk.exchange(a,'/auth/cloud-desktop')).status,200);
  assert.equal((await laptop.exchange(b,'/auth/cloud-desktop')).status,200);
  await desk.host.syncCloudRevocations();await laptop.host.syncCloudRevocations();
  const aid=desk.started.hostId,bid=laptop.started.hostId;
  assert.notEqual(aid,bid);
  let directory=(await control(phone,'/devices')).data;
  assert.equal(directory.hosts.length,2);assert.equal(directory.capabilities.multiHost,1);
  await control(phone,'/hosts/rename',{hostId:aid,name:'synthetic-computer'});
  await control(phone,'/hosts/rename',{hostId:bid,name:'synthetic-computer'});
  await desk.host.syncCloudRevocations();await laptop.host.syncCloudRevocations();
  directory=(await control(phone,'/devices')).data;
  assert.equal(new Set(directory.hosts.map(h=>h.displayName || h.name)).size,2);
  assert.ok(directory.hosts.every(h=>h.name==='synthetic-computer'),'later computer heartbeat keeps the name chosen in settings');
  assert.deepEqual(new Set(directory.devices.filter(d=>d.hostId).map(d=>d.hostId)),new Set([aid,bid]));
  await control(phone,'/hosts/connect',{hostId:aid});await refresh(phone,`${f.config.audience}/hosts/${aid}`);
  const wrong=await laptop.exchange(phone,'/auth/cloud-channel');assert.equal(wrong.status,401);
  const right=await desk.exchange(phone,'/auth/cloud-channel');assert.equal(right.status,200);assert.ok(right.token);
  const result=await desk.hostApi('/status',undefined,undefined,{authorization:'Bearer '+right.token});
  assert.equal(result.status,200);assert.equal(result.hostId,aid);
  const replica=await desk.hostApi('/offline/sync',{publicJwk:taskRecipient().publicJwk,generation:0,taskSupport:1},undefined,{authorization:'Bearer '+right.token});
  assert.equal(replica.status,200,JSON.stringify(replica));
  await refresh(phone,f.config.audience);
  await control(phone,'/hosts/remove',{hostId:bid});
  directory=(await control(phone,'/devices')).data;
  assert.equal(directory.hosts.length,1);assert.equal(directory.hosts[0].hostId,aid);
  assert.equal(directory.removedHosts[0].hostId,bid);
  await control(phone,'/hosts/connect',{hostId:bid},404);
  await refresh(b,undefined,400);
  await laptop.host.syncCloudRevocations();
  assert.equal((await laptop.nativeDesktop()).status,200,'cloud removal preserves native local use');
});

test('single computer directory keeps its existing item fields',async t=>{
  const f=await fixture(t);await registration(f);const a=await appDevice(f,'desktop');const desk=await hostFixture(f,t);
  await desk.exchange(a,'/auth/cloud-desktop');
  const data=(await control(a,'/devices')).data;
  assert.equal(data.hosts.length,1);
  assert.deepEqual(Object.keys(data.hosts[0]).sort(),['hostId','id','isCurrent','lastUsedAt','name','online','type']);
  assert.equal(Object.hasOwn(data.devices[0],'hostId'),false);
});

test('two bound computers racing to establish an account converge on the holder key after explicit adoption', async t => {
  const cloud = await fixture(t);
  const {account} = await registration(cloud);
  const scope = {issuer:cloud.config.issuer, sub:account.cloudAccountId};
  async function computer(name) {
    const records = new Map();
    const keys = createAccountKeys({read:s=>records.get(s), write:(s,v)=>records.set(s,v), remove:s=>records.delete(s)});
    const f = await hostFixture(cloud, t, keys);
    const device = await appDevice(cloud, name);
    const session = await f.exchange(device, '/auth/cloud-desktop');
    assert.equal(session.status, 200);
    const ownerId = session.account.ownerId;
    const auth = await f.nativeDesktop(ownerId);
    return {f,keys,records,ownerId,create:()=>f.hostApi('/cloud/account-key/create',scope,auth,{'x-weftmate-desktop':f.host.libraryDesktopToken})};
  }
  const left=await computer('first-computer'), right=await computer('second-computer');
  await Promise.all([left.f.host.syncCloudRevocations(),right.f.host.syncCloudRevocations()]);
  const replies=await Promise.all([left.create(),right.create()]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  const winner=replies[0].status===200?left:right, other=winner===left?right:left;
  const keyId=winner.keys.status(scope.issuer,scope.sub);
  assert.equal(other.keys.status(scope.issuer,scope.sub),null);
  assert.equal(other.records.size,0);
  const secret=[...winner.records.values()][0].secret;
  const incoming={...scope,keyId,secret};
  await assert.rejects(other.f.host.importAccountKey(other.ownerId,{...incoming,sub:'unrelated'}), e=>e.code==='CLOUD_NOT_BOUND');
  await assert.rejects(other.f.host.importAccountKey(other.ownerId,{...incoming,secret:'A'.repeat(43)}), e=>e.code==='ACCOUNT_KEY_INVALID');
  assert.equal(await other.f.host.importAccountKey(other.ownerId,incoming),keyId);
  assert.equal(other.keys.status(scope.issuer,scope.sub),keyId);
});
