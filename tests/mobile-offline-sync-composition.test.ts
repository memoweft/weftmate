import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {uiCoreAssets} from '../src/ui-core/manifest.mjs';

const source=uiCoreAssets.map(name=>readFileSync(new URL('../src/ui-core/'+name,import.meta.url),'utf8')).join('\n;\n');
const composition=readFileSync(new URL('../apps/mobile-ui/www/components/cloud-account.js',import.meta.url),'utf8');

test('native offline sync uses the adopted host after switching computers, without opening an unimplemented parallel channel',async()=>{
  const requests:any[]=[],nodes=new Map(),stop=new Error('composition captured');let captured:any;
  const storage={getItem:()=>null,setItem(){},removeItem(){}};
  const context:any={URL,URLSearchParams,AbortSignal,crypto:globalThis.crypto,Map,Set,Promise,setTimeout,clearTimeout,
    location:{origin:'https://appassets.androidplatform.net',hash:''},localStorage:storage,
    state:{},closeDrawer(){},toast(){},updateComposer(){},WeftCloudVendor:{},
    document:{body:{classList:{add(){},remove(){}}},getElementById:(id:string)=>{
      if(!nodes.has(id))nodes.set(id,{classList:{add(){},remove(){}}});return nodes.get(id);
    }},
    androidBridge:{call:async()=>({hostOrigin:'https://first.example',deviceName:'synthetic phone'}),
      fetch:async(url:string,options:any)=>{requests.push({url,options});return{ok:true,status:200,json:async()=>({encrypted:true})};}},
  };
  context.window=context;context.weftNative={};context.call=context.androidBridge.call;
  runInNewContext(source,context);const create=context.WeftUiCore.create;
  context.WeftUiCore.create=(options:any)=>{captured=options;throw stop;};
  runInNewContext(composition,context);
  await assert.rejects(context.WeftMobileCloud.init(),error=>error===stop);
  context.WeftUiCore.create=create;
  const core=create(captured);let selected='first';core.cloudCurrentComputer=()=>selected;
  core.state.csrfToken='native-managed';core.state.cloudAuth.sub='synthetic-account';core.presence.success();
  core.cloudConnect=async(hostId:string)=>({hostId,status:'online',baseUrl:'https://'+hostId+'.example'});
  core.cloudComputerCapabilities=async()=>({cloudChannel:1});
  core.updateComputerDirectory({capabilities:{multiHost:1},hosts:[{hostId:'first',online:true},{hostId:'second',online:true}]});
  // Native cloud adoption replaces the fixed-origin transport; it does not open a desktop iframe channel.
  selected='second';core.accessBase='https://second.example/personal/v1';
  const body={publicJwk:{kty:'RSA',n:'synthetic',e:'AQAB'},generation:0,hashes:{},taskSupport:1};
  const result=await core.accessApi('/offline/sync',{method:'POST',body,protectedWrite:true});
  assert.equal(result.encrypted,true);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://second.example/personal/v1/offline/sync');
  assert.deepEqual(JSON.parse(requests[0].options.body),body);
  assert.equal(requests[0].options.method,'POST');
  assert.equal(core.canUseComputerChannel(),false);
});
