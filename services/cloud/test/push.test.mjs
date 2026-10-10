import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, P } from './identity-helpers.mjs';
import { registration, appDevice, proof, control } from './app-helpers.mjs';
import { cloudPush } from '../src/push.mjs';

test('cloud push registration uses DPoP current device binding, rotates, isolates, and cascades device/account deletion', async t=>{
  const f=await fixture(t);await registration(f);const a=await appDevice(f,'desktop'),b=await appDevice(f,'phone');
  const route='/auth/push/registration', url=f.origin+P+route;
  const request=async(device,method,body,status=200)=>device.client(url,{method,body,status,headers:{origin:f.origin,'content-type':'application/json',authorization:`DPoP ${device.tokens.access_token}`,dpop:await proof(device,url,device.tokens.access_token,{},method,f.now)}});
  assert.equal((await request(a,'PUT',{platform:'android',provider:'fcm',token:'SYNTHETIC-CLOUD-PUSH'})).data.reason,'PUSH_NOT_CONFIGURED');
  assert.equal((await request(b,'GET')).data.registered,false);
  assert.equal(JSON.stringify((await request(a,'GET')).data).includes('SYNTHETIC-CLOUD-PUSH'),false);
  await request(a,'PUT',{platform:'android',provider:'none',token:null});assert.equal((await request(a,'GET')).data.tokenPresent,false);
  await request(a,'DELETE');assert.equal((await request(a,'GET')).data.registered,false);
  await request(b,'PUT',{platform:'android',provider:'fcm',token:'SYNTHETIC-REVOKED'});
  const row=f.db.prepare('SELECT * FROM push_registrations').get();
  assert.equal((await cloudPush(f.db).send(row.account_id,{eventId:'activity-a',type:'task.completed'}))[0].configured,false);
  await request(a,'PUT',{platform:'android',provider:'none',token:null,accountId:row.account_id},400);
  await control(a,'/auth/devices/revoke',{deviceId:b.deviceId});assert.equal(f.db.prepare('SELECT count(*) AS n FROM push_registrations').get().n,0);
  await request(b,'GET',undefined,401);
  await request(a,'PUT',{platform:'android',provider:'fcm',token:'SYNTHETIC-DELETED'});
  await control(a,'/auth/account/delete',{password:'a test password with 20 chars'});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM push_registrations').get().n,0);
});
