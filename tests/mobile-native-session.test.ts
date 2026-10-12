import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';

function fixture() {
  const context:any = {URL,Map,Set,Promise,Error,Date,AbortSignal,AbortController,setTimeout,clearTimeout,setInterval,clearInterval};
  for (const name of uiCoreAssets) runInNewContext(readFileSync(new URL(`../src/ui-core/${name}`,import.meta.url),'utf8'),context);
  context.WeftUiCore.CloudAuthClient = class {
    generation=0; pending=null;
    async authorized(){return {};}
    async resetKey(){}
    async forget(){this.generation++;}
    async access(){throw {code:'CLOUD_TOKEN_INVALID'};}
  };
  let cleared=0,expired=0;
  const effects = new Proxy({clearNativeHostSessions:()=>{cleared++;},nativeSessionExpired:()=>{expired++;}}, {get:(target,key)=>target[key]||(()=>{})});
  const core=context.WeftUiCore.create({effects,retainNativeCache:true,deviceType:'android',hostOrigin:'https://host.example',
    storage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:async()=>({ok:true,json:async()=>({})})});
  core.initializeCloudAccount();
  Object.assign(core.state.cloudAuth,{mode:'authenticated',cachedSession:true,email:'synthetic@example.com'});
  core.state.csrfToken='native-managed'; core.state.account={ownerId:'cached-owner',username:'Synthetic'};
  return {core,counts:()=>({cleared,expired})};
}
test('native background expiry preserves cached scope without opening a login prompt',async()=>{
  const f=fixture(); await f.core.renewCloudSession();
  assert.deepEqual(f.counts(),{cleared:0,expired:1});
  assert.equal(f.core.state.account.ownerId,'cached-owner'); assert.equal(f.core.cloudAuthView().modal,false);
  assert.equal(f.core.cloudAuthView().mode,'offline');
});
test('explicit native logout still clears server credentials and enters the login page',async()=>{
  const f=fixture(); await f.core.cloudLogout();
  assert.equal(f.counts().cleared,1); assert.equal(f.core.state.csrfToken,null);
  assert.equal(f.core.cloudAuthView().cachedSession,false); assert.equal(f.core.cloudAuthView().modal,false);
  assert.equal(f.core.cloudAuthView().mode,'login');
});
