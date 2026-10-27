import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOfflineService} from '../src/personal-offline/index.mjs';
import {taskRecipient,openTask} from '../src/personal-offline/crypto.mjs';
import {createPhoneHistory,phoneTurnKey} from '../src/personal-access/phone-history.mjs';
import {createHistoryImport} from '../src/personal-access/history-import.mjs';
import {reconcileChatIdentity} from '../src/personal-access/chat-identity.mjs';

// Windows executes the actual two computer handlers over HTTP with synthetic identity/data.
// Swift-side capture/retry assertions live in PhoneSyncTests and run separately on macOS.
test('APPLE-2 real computer HTTP accepts and idempotently stores originals with model:null', {timeout:30_000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'apple-2-sync-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const identity={ownerId:'synthetic-owner',hostId:'synthetic-host',deviceId:'synthetic-phone'};
  const account:any={sessions:{},commands:{}};let ready=false,ingests=0;
  const ctx:any={root,rootState:{hostId:identity.hostId},timestamp:Date.now,accountState:()=>account,
    serial:async(fn:any)=>fn(),mutate:async(_id:string,fn:any)=>{fn(account);reconcileChatIdentity(account,identity.hostId,new Date().toISOString());},
    active:new Set(),pendingPreflights:new Set(),
    authenticate:()=>({...identity,via:'cookie',device:{authKind:'cloud',name:'Synthetic iPhone',scopes:['account:manage','sessions:read']}}),
    modelSelectable:()=>true,service:{currentChatModelProfile:()=>null},backend:{listModels:async()=>[],describeSession:async()=>null,readEvents:async()=>({events:[]})},
    usage:{settings:()=>({prices:{}}),assertAllowed(){},exportAccount:()=>({records:[]})},activity:{record:async()=>{}},
    cloudIdentity:{publishOffline:async(_id:string,generation:number)=>({hostId:identity.hostId,accountId:'synthetic-account',generation})},
    memoryManager:{enabled:true,peek:()=>ready?'connected':'starting',query:async()=>({world_revision:1,items:[]}),ingestImport:async()=>{ingests++;}},
    readJson:async(request:any,limit:number)=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);const bytes=Buffer.concat(chunks);assert.ok(bytes.length<=limit);return JSON.parse(bytes.toString());},
    json:(response:any,status:number,body:any)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body));},
  };
  ctx.phoneHistory=createPhoneHistory(ctx,ctx.backend);ctx.backend=ctx.phoneHistory.backend;ctx.historyImport=createHistoryImport(ctx);
  const offline=await createOfflineService(ctx);
  t.after(async()=>{await ctx.historyImport.close();await offline.close();});
  const server=createServer((req,res)=>{Promise.resolve(offline.handle(req,res,new URL(req.url!,'http://127.0.0.1'),identity.ownerId)).catch(error=>{res.writeHead(error.status??500);res.end(JSON.stringify({error:error.code??'FAILED'}));});});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${(server.address() as any).port}`,recipient=taskRecipient();
  const post=async(route:string,body:any)=>{const response=await fetch(origin+'/personal/v1/offline/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
  const sync=async()=>openTask(await post('sync',{publicJwk:recipient.publicJwk,generation:0,hashes:{},phoneFirst:true}),recipient,identity);
  const cold=await sync();assert.equal(cold.memoryAuthority.ready,false);assert.equal(cold.model,null);
  ready=true;const snapshot=await sync();assert.equal(snapshot.memoryAuthority.ready,true);assert.deepEqual(snapshot.items,[]);
  assert.equal(snapshot.control.accountId,'synthetic-account');assert.equal(snapshot.memoryAuthority.hostId,snapshot.control.hostId);
  const original={id:'original-1',conversationId:'phone-chat-1',timestamp:Date.UTC(2025,4,1),messages:[{role:'user',text:'合成原话：我喜欢茉莉花茶。'},{role:'assistant',text:'合成回复。'}],memoryRefs:[],dependencyComplete:true};
  const submission={generation:snapshot.generation,turns:[original],handover:{id:'stable-handover',totalTurns:1,conversationCount:1,bytes:Buffer.byteLength(JSON.stringify([original])),complete:true}};
  const receipt=await post('turns',submission),retry=await post('turns',submission);
  assert.equal(receipt.receipts[0].state,'synced');assert.equal(retry.receipts[0].sessionId,receipt.receipts[0].sessionId);
  const stored=ctx.phoneHistory.read(identity.ownerId,phoneTurnKey(original));
  assert.equal(stored.at,'2025-05-01T00:00:00.000Z');assert.deepEqual(stored.messages.map((m:any)=>m.content),original.messages.map(m=>m.text));
  const imports=ctx.historyImport.list(identity.ownerId).imports;
  assert.equal(imports.length,1);assert.equal(imports[0].handoverId,'stable-handover');assert.equal(imports[0].state,'awaiting_confirmation');
  assert.equal(imports[0].confirmationRequired,false);assert.equal(ingests,0,'receipt is durable receipt, not formed memory');
});
