import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './identity-helpers.mjs';
import {registration,appDevice,control,refresh,hostFixture} from './app-helpers.mjs';
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
  directory=(await control(phone,'/devices')).data;
  assert.equal(new Set(directory.hosts.map(h=>h.displayName || h.name)).size,2);
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
