import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHostRelay} from '../src/personal-relay/index.mjs';
import {createBackgroundRouteRecorder,backgroundModelReady} from '../src/background-model-selection.mjs';
import {createBackgroundModels} from '../src/personal-access/background-model.mjs';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
const timeline:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync(new URL('../src/ui-core/timeline-model.js',import.meta.url),'utf8'),timeline);

function modelsFixture(){
 const accounts:any={o:{backgroundModelProfileId:'background',lastChatModelProfileId:'chat',sessions:{},commands:{}},other:{backgroundModelProfileId:'background',lastChatModelProfileId:'other-chat',sessions:{},commands:{}}};
 const models=[{id:'background',model:'deleted',configured:true},{id:'chat',model:'chat-model',configured:true},{id:'other-chat',model:'other-model',configured:true}];
 let commits=0;
 const context:any={accountState:(owner:string)=>accounts[owner],modelSelectable:()=>true,timestamp:()=>Date.parse('2026-10-12T00:00:00Z'),serial:async(fn:any)=>fn(),mutate:async(owner:string,fn:any)=>{fn(accounts[owner]);commits++;},callBackend:async(fn:any)=>fn(),backend:{listModels:async()=>models}};
 return {accounts,models,context,service:createBackgroundModels(context),get commits(){return commits}};
}
test('FIX-24 absent cloud login performs zero requests; login wakes connection; same failure backs off and logs once',async t=>{
 const root=await mkdtemp(join(tmpdir(),'wm-fix24-relay-'));let loggedIn=false,now=0,calls=0;const errors:any[]=[];
 const relay=await createHostRelay({root,identity:{relayReady:()=>loggedIn,relayRequest:async()=>{calls++;throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});}},options:{binary:'synthetic',transportCaFile:'synthetic',developmentTls:true,diagnostic:(e:any)=>errors.push(e)},setPublicOrigin:()=>{},executeCommand:async()=>({stdout:'0.71.0'}),clock:()=>now});
 t.after(async()=>{await relay.close();await rm(root,{recursive:true,force:true});});
 for(let n=0;n<300;n++){now+=2000;await relay.reconnect();}assert.equal(calls,0);assert.equal(errors.length,0);assert.equal(relay.status().state,'stopped');
 loggedIn=true;await relay.reconnect();assert.equal(calls,1);assert.equal(errors.length,1);
 // Normal timer respects retryAt; manual reconnect remains an explicit immediate retry.
 await relay.reconnect();assert.equal(calls,2);assert.equal(errors.length,1);
 loggedIn=false;await relay.reconnect();assert.equal(relay.status().state,'stopped');assert.equal(errors.length,1);
});
test('FIX-24 route decisions log changes and one hourly summary, account decisions remain independent',()=>{
 let now=0;const rows:any[]=[];const recorder=createBackgroundRouteRecorder((event:string,data:any)=>rows.push({event,...data}),{clock:()=>now});
 try{for(let n=0;n<7692;n++)recorder.record('o',{profileId:'chat',configured:true});assert.equal(rows.length,1);now=3600000;recorder.record('o',{profileId:'chat',configured:true});assert.equal(rows.length,2);assert.equal(rows[1].phase,'summary');assert.equal(rows[1].ahead,7692);recorder.record('o',{profileId:'next',configured:true});recorder.record('other',{profileId:'chat',configured:true});assert.equal(rows.length,4);}finally{recorder.close();}
});
test('FIX-24 removed profile falls back durably, preserves restore choice, and never returns automatically',async()=>{
 const f=modelsFixture();f.models.shift();assert.equal(await f.service.resolve('o',f.models),'chat');assert.equal(f.accounts.o.backgroundModelProfileId,null);assert.equal(f.accounts.o.backgroundModelFallback.profileId,'background');assert.equal(f.accounts.other.backgroundModelProfileId,'background');f.models.push({id:'background',model:'restored',configured:true});assert.equal(await f.service.resolve('o',f.models),'chat');assert.equal(f.commits,1);
});
test('FIX-24 three consecutive background failures retry with chat; success resets count; cancellation never changes setting',async()=>{
 const f=modelsFixture();const calls:any[]=[];let fail=true;
 const native=async(input:any)=>{calls.push(input);return Response.json({}, {status:input.profileId==='background'&&fail?503:200});};
 const input={ownerId:'o',profileId:'background',priority:'background',body:{model:'deleted'},signal:new AbortController().signal};
 await f.service.completion(native,input);fail=false;await f.service.completion(native,input);fail=true;
 await f.service.completion(native,input);await f.service.completion(native,input);assert.equal(f.accounts.o.backgroundModelProfileId,'background');assert.equal((await f.service.completion(native,input)).status,200);assert.equal(calls.at(-1).profileId,'chat');assert.equal(calls.at(-1).body.model,'chat-model');assert.equal(f.accounts.o.backgroundModelProfileId,null);
 const other=modelsFixture();await other.service.report('o','background',{failed:true,aborted:true});assert.equal(other.commits,0);
});
test('FIX-24 missing provider model falls back on first 404; deleted local catalog triggers fallback without inference',async()=>{
 const f=modelsFixture();let requests=0;const response=await f.service.completion(async(input:any)=>{requests++;return Response.json({}, {status:input.profileId==='background'?404:200});},{ownerId:'o',profileId:'background',body:{model:'deleted'}});assert.equal(response.status,200);assert.equal(requests,2);
 const signals:any[]=[];assert.equal(await backgroundModelReady({baseUrl:'http://127.0.0.1:1234/v1',model:'deleted'},{credentialFor:()=> 'synthetic',fetchImpl:async(url:any)=>Response.json(String(url).endsWith('/props')?{total_slots:1}:String(url).endsWith('/models')?{data:[{id:'chat-model'}]}:{switching:false,current_model:'chat-model'}),onUnavailable:async(value:any)=>{signals.push(value);}}),false);assert.deepEqual(signals,[{unavailable:true}]);
});
test('FIX-24 known tools speak in human terms while an unknown extension keeps generic wording',()=>{
 const core:any=timeline.WeftUiCore;
 for(const [name,label]of [['health_query','查了健康数据'],['calendar_query','查了日历'],['recall_memory','查询或更新了 1 次记忆'],['unknown_extension','用了一个扩展工具']]){
  assert.equal(core.progressText([{toolName:name,state:'completed'}],{state:'completed',terminal:true}).text,label);
 }
});



import {generateKeyPairSync} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {syntheticCertificate} from './helpers/r0-2-certificates.mjs';
import {tlsSpki} from '../src/personal-relay/tls.mjs';
test('FIX-24 normal reconnect timer backs off 2/4 seconds, logs one error and one recovery',async t=>{
 const root=await mkdtemp(join(tmpdir(),'wm-fix24-relay-recover-')),certFile=join(root,'cert.pem'),privateKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;
 const cert=syntheticCertificate(false,privateKey);await writeFile(certFile,cert);
 const local=createServer((_req,res)=>res.end('synthetic'));await new Promise<void>(r=>local.listen(0,'127.0.0.1',r));
 let now=0,calls=0,offline=true,recoveries=0;const errors:any[]=[];
 const relay=await createHostRelay({root,identity:{relayReady:()=>true,tls:()=>({privateJwk:privateKey.export({format:'jwk'}),spki:tlsSpki(cert)}),relayRequest:async()=>{calls++;if(offline)throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});return {hostId:'synthetic-host',baseUrl:'https://r0-2.invalid',serverAddr:'r0-2.invalid',serverPort:443,serverName:'r0-2.invalid',credential:'synthetic'};}},options:{binary:process.execPath,transportCaFile:certFile,certFile,diagnostic:(e:any)=>errors.push(e),onRecovery:()=>recoveries++},setPublicOrigin:()=>{},executeCommand:async()=>({stdout:'0.71.0'}),clock:()=>now,pollMs:10,fetchImpl:async()=>Response.json({https:[{status:'running'}]})});
 t.after(async()=>{await relay.close();await new Promise<void>(r=>local.close(()=>r()));await rm(root,{recursive:true,force:true});});
 const wait=()=>new Promise(r=>setTimeout(r,30));relay.start('http://127.0.0.1:'+(local.address() as any).port);await wait();assert.equal(calls,1);
 now=1999;await wait();assert.equal(calls,1);now=2000;await wait();assert.equal(calls,2);now=5999;await wait();assert.equal(calls,2);assert.equal(errors.length,1);
 offline=false;now=6000;for(let n=0;n<100&&recoveries===0;n++)await wait();assert.equal(relay.status().state,'online');assert.equal(recoveries,1);assert.equal(errors.length,1);await wait();assert.equal(recoveries,1);
});
test('FIX-24 fallback admission reports the actual chat profile to usage callbacks',async()=>{
 const f=modelsFixture(),admissions:any[]=[];
 const native=async(input:any)=>{await input.onStart();return Response.json({}, {status:input.profileId==='background'?503:200});};
 const input={ownerId:'o',profileId:'background',body:{model:'deleted'},onStart:async(value:any)=>admissions.push({profileId:value.profileId,model:value.model.model})};
 await f.service.completion(native,input);await f.service.completion(native,input);const result=await f.service.completion(native,input);
 assert.equal(result.status,200);assert.deepEqual(admissions.map(row=>row.profileId),['background','background','background','chat']);assert.equal(admissions.at(-1).model,'chat-model');
});
test('FIX-24 hourly timer followed by a route poll produces only one summary at the boundary',()=>{
 let now=0;const rows:any[]=[];const recorder=createBackgroundRouteRecorder((_event:string,data:any)=>rows.push(data),{clock:()=>now});
 try{recorder.record('o',{profileId:'chat',configured:true});recorder.record('o',{profileId:'chat',configured:true});now=3600000;recorder.flush();now++;recorder.record('o',{profileId:'chat',configured:true});assert.equal(rows.filter(row=>row.phase==='summary').length,1);now+=3600000;recorder.record('o',{profileId:'chat',configured:true});assert.equal(rows.filter(row=>row.phase==='summary').length,2);}finally{recorder.close();}
});
