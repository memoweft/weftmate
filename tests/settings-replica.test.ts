import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import * as jose from 'jose';
import {accountDataCodec} from '../src/personal-cloud/directory-wire.mjs';
import {settingsSnapshot,changedSettings,mergeSettings,openSettingsReplica} from '../src/ui-core/settings-replica.mjs';
import {createSettingsExchange} from '../src/personal-cloud/settings-replica.mjs';
import {savePersonalizationRows} from '../src/personal-access/personalization.mjs';

function fixture() {
  const codec=accountDataCodec(jose,randomBytes(32),['issuer','sub','kid','host'],'wm-settings-replica+jwe');
  const account:any={personalization:{preferredName:'baseline'},personalizationUpdatedAt:'2026-01-01T00:00:00.000Z'};
  let clock=Date.parse(account.personalizationUpdatedAt), stored:string|undefined, lose=false, reject=false, gate:Promise<void>|undefined;
  const context={accountState:()=>account,serial:(fn:any)=>fn(),mutate:(_o:any,fn:any)=>fn(account),nextSuggestions:{drain:async()=>{}}};
  const exchange=createSettingsExchange(context,'host',(_r:any)=>({issuer:'issuer',sub:'sub',keyId:'kid',ownerId:'owner',deviceId:'device'}),
    (_i:any,_s:any,_h:any,fn:any)=>fn(codec));
  const browser=openSettingsReplica({codec,deviceId:'device',random:randomUUID,now:()=>++clock,current:()=>{},
    read:async()=>stored,write:async(old:string,next:string)=>{if(reject || stored!==old)throw Error('write failed');stored=next;},
    exchange:async({box}:any)=>{const response=await exchange({},box);if(gate)await gate;if(lose){lose=false;throw Error('lost reply');}return response;}});
  return {account,browser,clock:()=>clock,stored:()=>stored,setLose:()=>{lose=true;},hold:(promise:Promise<void>|undefined)=>{gate=promise;},reject:(value:boolean)=>{reject=value;},
    desktop(patch:any,at:number){const rows=settingsSnapshot(account);savePersonalizationRows(account,mergeSettings(rows,changedSettings(rows,patch,at,randomUUID())));}};
}
test('field timestamps retain old settings and converge after offline edits and a lost reply',async()=>{
  const f=fixture();await f.browser.sync();
  await f.browser.edit({preferredName:'offline',bio:'new bio'});
  f.desktop({preferredName:'later on desktop'},f.clock()+100);
  assert.equal((await f.browser.sync()).settings.preferredName,'later on desktop');
  assert.equal(f.account.personalization.bio,'new bio');
  await f.browser.edit({preferredName:''});
  f.setLose();await assert.rejects(f.browser.sync(),/lost reply/);
  assert.equal((await f.browser.read()).synced,false);
  assert.equal((await f.browser.sync()).synced,true);
  assert.equal(f.account.personalization.preferredName,'');
  assert.ok(!f.stored()?.includes('new bio'));
});
test('replay, equal-time tie breaking and failed local writes cannot roll back newer values',async()=>{
  const f=fixture();await f.browser.sync();const before=f.stored();
  f.reject(true);await assert.rejects(f.browser.edit({bio:'failed'}),/write failed/);assert.equal(f.stored(),before);f.reject(false);
  const a={bio:{value:'a',at:3,id:'a'}},b={bio:{value:'b',at:3,id:'b'}};
  assert.deepEqual(mergeSettings(a,b),mergeSettings(b,a));assert.deepEqual(mergeSettings(b,a),b);
  assert.throws(()=>mergeSettings(a,{bio:{value:'bad',at:3,id:'a'}}));
  assert.throws(()=>mergeSettings(a,{apiKey:{value:'secret',at:3,id:'b'}}));
});

test('a reply already in flight cannot acknowledge or replace a more recent local edit',async()=>{
  const f=fixture();await f.browser.sync();await f.browser.edit({bio:'first'});
  let release:()=>void;
  f.hold(new Promise<void>(done=>{release=done;}));
  const syncing=f.browser.sync();
  // The local edit is independent of the paused transport.
  await new Promise(done=>setTimeout(done,10));
  await f.browser.edit({bio:'second'});
  release!();f.hold(undefined);
  const value=await syncing;
  assert.equal(value.settings.bio,'second');assert.equal(value.synced,false);
  assert.equal((await f.browser.sync()).synced,true);
  assert.equal(f.account.personalization.bio,'second');
});
