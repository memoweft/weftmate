import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { desktopScript, desktopScriptPaths } from './helpers/desktop-ui-source.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalAccessService} from '../src/personal-access/index.mjs';
const source = desktopScriptPaths().filter(p=>p.startsWith('ui-core/')).map(desktopScript).join('\n;\n');
function clock() {
  let time=0,id=0;const tasks=new Map<number,{at:number,fn:Function}>();
  return {now:()=>time,setTimeout(fn:Function,ms:number){tasks.set(++id,{at:time+ms,fn});return id;},clearTimeout(id:number){tasks.delete(id);},
    next:()=>tasks.size ? [...tasks.values()].sort((a,b)=>a.at-b.at)[0].at-time : undefined,
    async advance(ms:number){time+=ms;for(const [id,task]of [...tasks])if(task.at<=time){tasks.delete(id);task.fn();}for(let n=0;n<20;n++)await Promise.resolve();}};
}
function fixture(extra:any={}) {
  const c=clock(),requests:any[]=[],values=new Map();let transport:any=()=>({ok:true,status:200,json:async()=>({presence:{runtime:'ready'},ownerId:'owner',hostId:'host'})});
  const context:any={AbortSignal,URL,URLSearchParams,TextEncoder,Blob,Intl,setTimeout,clearTimeout,setInterval,clearInterval};runInNewContext(source+(extra.mobileState?'\n;'+readFileSync(new URL('../src/ui-core/adapters/mobile.js',import.meta.url),'utf8'):''),context);
  const effects=new Proxy({readMessageDraft:()=> '合成原文'},{get:(o:any,k)=>o[k]||(()=>{})});
  const core=context.WeftUiCore.create({effects,clock:c,now:c.now,random:()=>1,fetch:async(path:any,options:any)=>{requests.push({path,options});return transport(path,options);},crypto:{randomUUID:()=> 'request-original'},storage:{getItem:(k:any)=>values.get(k)||null,setItem:(k:any,v:any)=>values.set(k,v),removeItem:(k:any)=>values.delete(k)},...extra});
  Object.assign(core.state,{identityGeneration:1,ownerId:'owner',account:{ownerId:'owner'},csrfToken:'synthetic',hostId:'host',online:true,selectedSessionId:'session',selectedChatId:'chat',activeChatSource:'desktop',personalCapabilities:{chatSend:1},modelProfileId:'model',models:[{id:'model'}],mainChat:{chatId:'chat',activeSessionId:'session',sendAvailable:true}});
  core.refreshTasks=async()=>{};core.refreshLogicalHistory=async()=>{};
  return {core,c,requests,api:context.WeftUiCore,setTransport:(fn:Function)=>transport=fn};
}
test('M3-1 all six states and independent failures distinguish model, permission and replica errors',()=>{
  const f=fixture(),m=f.core.presence;assert.equal(m.view().kind,'connecting');m.success({runtime:'ready',model:'unavailable'});assert.equal(m.view().kind,'online');
  for(const error of [{code:'MODEL_UNAVAILABLE'},{code:'FORBIDDEN',status:403},{code:'INVALID_REQUEST',status:400},{code:'OFFLINE_MODEL_REQUIRED'},{status:500}]) {m.failure(error);assert.equal(m.view().kind,'online');}
  m.failure({code:'NETWORK'});assert.equal(m.view().kind,'connecting');m.failure({code:'NETWORK'},{independent:true});assert.equal(m.view().kind,'connecting');
  m.network(false);assert.equal(m.view().kind,'network_unavailable');m.network(true);assert.equal(m.view().kind,'connecting');
  m.failure({code:'UNAUTHORIZED',status:401});assert.equal(m.view().kind,'login_required');m.success();
  m.failure({code:'DEVICE_NOT_TRUSTED',status:403});assert.equal(m.view().kind,'approval_required');m.success();assert.equal(m.view().kind,'online');
});
test('M3-1 burst requests count once; only three spaced failures plus independent probe confirm offline',async()=>{
  const f=fixture(),m=f.core.presence;m.success();for(let n=0;n<30;n++)m.failure({code:'NETWORK'},{independent:true});assert.equal(m.view().failures,1);assert.equal(m.view().kind,'connecting');
  await f.c.advance(1000);m.failure({code:'NETWORK'},{independent:true});assert.equal(m.view().kind,'connecting');await f.c.advance(1000);m.failure({code:'NETWORK'});assert.equal(m.view().kind,'connecting');m.failure({code:'NETWORK'},{independent:true});assert.equal(m.view().kind,'host_offline');m.success();assert.equal(m.view().failures,0);
  m.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});assert.equal(m.view().kind,'host_offline');
});
test('M3-1 a reachable relay returning host-listener 503 needs repeated independent status probes; a model 503 stays online',async()=>{
  const f=fixture();f.core.presence.success();f.core.connectionFailed({code:'SERVICE_UNAVAILABLE',status:503});assert.equal(f.core.connectionView().kind,'online');
  f.setTransport(()=>({ok:false,status:503,json:async()=>({error:{code:'MODEL_UNAVAILABLE'}})}));await f.core.retryConnection();assert.equal(f.core.connectionView().kind,'online');
  f.setTransport(()=>({ok:false,status:503,json:async()=>({})}));await f.core.retryConnection();assert.equal(f.core.connectionView().kind,'connecting');await f.c.advance(1000);await f.core.retryConnection();assert.equal(f.core.connectionView().kind,'connecting');await f.c.advance(1000);await f.core.retryConnection();assert.equal(f.core.connectionView().kind,'host_offline');
});
test('M3-1 synthetic clock drives exponential backoff, background cap and immediate foreground/network retries',async()=>{
  const f=fixture();let recoveries=0;f.setTransport(()=>{throw Error('synthetic network');});f.core.startConnection(async()=>{recoveries++;});await f.core.retryConnection();assert.equal(f.c.next(),1000);
  await f.c.advance(1000);assert.equal(f.c.next(),2000);await f.c.advance(2000);assert.equal(f.c.next(),4000);
  for(let n=0;n<12;n++)assert.ok(f.core.presence.delay()<=30000);for(let n=0;n<12;n++)assert.ok(f.core.presence.delay(true)<=120000);
  f.core.connectionVisibility(true);assert.equal(f.c.next(),60000);
  const before=f.requests.length;f.core.connectionVisibility(false);await f.core.retryConnection();assert.equal(f.requests.length,before+1);
  f.setTransport(()=>({ok:true,status:200,json:async()=>({presence:{runtime:'ready'}})}));f.core.connectionNetwork(true);await f.core.retryConnection();assert.equal(f.core.state.online,true);assert.equal(recoveries,1);f.core.stopConnection();assert.equal(f.c.next(),undefined);
});
test('M3-1 late probe from an old account cannot replace the new account connection',async()=>{
  const f=fixture();let release:Function=()=>{};f.setTransport(()=>new Promise(r=>release=r));const pending=f.core.retryConnection();f.core.state.identityGeneration++;f.core.presence.authorization('approval_required');release({ok:true,status:200,json:async()=>({})});await pending;assert.equal(f.core.connectionView().kind,'approval_required');
});
test('M3-1 signing into a new account during an old probe starts a fresh probe after discarding the old one',async()=>{
  const f=fixture();let release:Function=()=>{};f.setTransport(()=>new Promise(r=>release=r));f.core.startConnection(async()=>{});const pending=f.core.retryConnection();f.core.stopConnection();f.core.state.identityGeneration++;f.core.startConnection(async()=>{});
  f.setTransport(()=>({ok:true,status:200,json:async()=>({presence:{runtime:'ready'}})}));release({ok:true,status:200,json:async()=>({presence:{runtime:'unavailable'}})});await pending;assert.equal(f.c.next(),0);await f.c.advance(0);assert.equal(f.core.connectionView().host.runtime,'ready');f.core.stopConnection();
});
test('M3-1 lost accepted response reconciles original ID without another generation',async()=>{
  const f=fixture();let posts=0;const accepted={requestId:'request-original',commandId:'command',kind:'chat.message',state:'accepted_by_dsh',sessionId:'session',receiptId:'receipt'};
  f.setTransport((path:any,options:any)=>{if(options.method==='POST'){posts++;throw Error('receipt lost');}return {ok:true,status:200,json:async()=>({command:accepted})};});
  await f.core.sendMainDraft('合成原文');await f.core.reconcileMainRequests();assert.equal(posts,1);assert.equal(f.core.mainOptimisticMessages()[0].status,'accepted');assert.ok(f.requests.filter(r=>r.path.includes('/commands/by-request/')).every(r=>r.path.endsWith('request-original')));
});
test('M3-1 unaccepted and duplicate concurrent retry preserve exact original message and attachment body',async()=>{
  const f=fixture();let accepted=false,first=true,posts=0;const command={requestId:'request-original',commandId:'command',kind:'chat.message',state:'accepted_by_dsh',sessionId:'session',receiptId:'receipt'};
  f.setTransport((path:any,options:any)=>{if(options.method==='POST'){posts++;if(first){first=false;throw Error('not delivered');}accepted=true;return {ok:true,status:202,json:async()=>({command})};}return accepted?{ok:true,status:200,json:async()=>({command})}:{ok:false,status:404,json:async()=>({error:{code:'NOT_FOUND'}})};});
  await f.core.sendMainDraft('合成原文');assert.equal(f.core.mainOptimisticMessages()[0].status,'undelivered');
  const original=f.core.originalMessageBody('request-original');original.originalAttachments=[{attachmentId:'attachment-stable',sha256:'a'.repeat(64)}];original.attachmentMessageId='message-stable';
  await Promise.all([f.core.retryMainRequest('request-original'),f.core.retryMainRequest('request-original')]);assert.equal(posts,2);const sent=f.requests.filter(r=>r.options.method==='POST').map(r=>JSON.parse(r.options.body));assert.equal(sent[1].requestId,sent[0].requestId);assert.equal(sent[1].text,'合成原文');assert.equal(sent[1].attachmentMessageId,'message-stable');assert.deepEqual(sent[1].originalAttachments,original.originalAttachments);
  await f.core.retryMainRequest('request-original');assert.equal(posts,2);
});
test('M3-1 cursor replay deduplicates chunks/tools/approvals and 409 resets from the existing tail flow',async()=>{
  const f=fixture(),events=[{seq:1,type:'assistant.message',sessionId:'session',data:{text:'第一段'}},{seq:2,type:'step.started',sessionId:'session',data:{callId:'tool'}},{seq:3,type:'approval.requested',sessionId:'session',data:{approvalId:'approval'}}];
  f.core.refreshConversationApprovals=f.core.refreshConversationQuestions=async()=>{};f.core.appendHistory(events);f.core.appendHistory(events);assert.equal(f.core.state.historyEvents.size,3);
  let reset=false;f.core.refreshHistory=async(arg:boolean)=>{reset=arg;};f.setTransport(()=>({ok:false,status:409,json:async()=>({error:{code:'CURSOR_RESET_REQUIRED'}})}));
  const context:any={WeftUiCore:{factories:{}},URLSearchParams};runInNewContext(readFileSync('src/ui-core/messages.js','utf8'),context);const actions=context.WeftUiCore.factories.messages(f.core,new Proxy({},{get:()=>()=>{}}),{});await actions.refreshHistory(false,true);assert.equal(reset,true);
});
test('M3-1 real status and sync distinguish model outage, runtime restart and revoked login across host boots',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-m31-status-'));let service:any,mode='model';
  const backend:any=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]));
  backend.getStatus=async()=>{if(mode==='fault')throw Error('Synthetic runtime stopped');return {runtime:'ready',capabilities:{chat:{available:false,reasonCode:'MODEL_UNAVAILABLE'}}};};
  try {
    service=await createPersonalAccessService({root,port:0,backend});let origin=(await service.start()).origin;
    const grant=await service.issueSetupGrant();const registered=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'m31-synthetic',password:'m31-only-synthetic-password',deviceName:'M3 test'})});assert.equal(registered.status,201);
    const auth:any=await registered.json(),cookie=registered.headers.get('set-cookie')!.split(';')[0];const read=async(path:string)=>{const r=await fetch(origin+'/personal/v1'+path,{headers:{cookie}});return {status:r.status,body:await r.json() as any};};
    const online=await read('/status');assert.equal(online.status,200);assert.equal(online.body.presence.host,'online');assert.equal(online.body.presence.runtime,'ready');assert.equal(online.body.presence.model,'unavailable');
    const sync=await read('/sync/events?afterSeq=0');assert.equal(sync.body.presence.bootId,online.body.presence.bootId);
    mode='fault';const unavailable=await read('/status');assert.equal(unavailable.status,200);assert.equal(unavailable.body.presence.runtime,'unavailable');
    let release:Function=()=>{};const restarting=new Promise<void>(r=>release=r);const restartService:any=service;await service.close();
    service=await createPersonalAccessService({root,port:0,backend,systemManager:{status:async()=>({}),restart:async()=>restarting}});origin=(await service.start()).origin;
    const next=await read('/status');assert.notEqual(next.body.presence.bootId,online.body.presence.bootId);
    const pending=fetch(origin+'/personal/v1/system/host/restart',{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:'{}'});
    for(let n=0;n<30;n++){const current=await read('/status');if(current.body.presence?.runtime==='restarting')break;await new Promise(r=>setTimeout(r,5));}
    assert.equal((await read('/status')).body.presence.runtime,'restarting');release();assert.equal((await pending).status,200);
    const revoked=await fetch(origin+'/personal/v1/auth/devices/'+auth.device.id,{method:'DELETE',headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:'{}'});assert.equal(revoked.status,200);assert.equal((await read('/status')).status,401);
  } finally {await service?.close();await rm(root,{recursive:true,force:true});}
});
test('M3-1 native adoption finishes before shared acceptance can launch authenticated device reads',async()=>{
  const f=fixture();runInNewContext(readFileSync('src/ui-core/adapters/android-bridge.js','utf8'),{WeftUiCore:f.api,URL,setTimeout,clearTimeout});let adopted=false,release:Function=()=>{},accepted=0;
  const pending=f.api.adoptMobileHostSession(async(method:string)=>{assert.equal(method,'cloud.adopt');await new Promise(r=>release=r);adopted=true;return {owner:'native-owner'};},()=>{assert.equal(adopted,true);accepted++;},{});
  assert.equal(accepted,0);release();await pending;assert.equal(accepted,1);
  await assert.rejects(f.api.adoptMobileHostSession(async()=>{throw Error('LOGIN_REQUIRED');},()=>{assert.fail('Failed adoption cannot accept an unauthenticated session');},{}));
});
test('M3-1 native cached offline reads cannot reset independent reconnect failures or claim online',async()=>{
  const f=fixture();f.core.presence.failure({code:'NETWORK'});f.setTransport(()=>({ok:true,status:200,json:async()=>({source:'host',hostAvailable:false,cached:true,sessions:[]})}));
  await f.core.accessApi('/sessions');assert.equal(f.core.connectionView().kind,'connecting');assert.equal(f.core.connectionView().failures,1);
});
test('M3-1 native local activity facts are not connectivity proof and a new failure advances the pending status probe',async()=>{
  const f=fixture({nativeMobile:true});f.core.startConnection(async()=>{});await f.core.retryConnection();assert.equal(f.c.next(),15000);f.core.connectionFailed({code:'NETWORK'});assert.equal(f.c.next(),1000);
  f.setTransport(()=>({ok:true,status:200,json:async()=>({commands:[]})}));await f.core.accessApi('/commands');assert.equal(f.core.connectionView().kind,'connecting');f.core.stopConnection();
});

test('M3-1 disconnected progress stops model elapsed time and resumes only online',()=>{
  const f=fixture();f.core.presence.success();
  const events=[{seq:1,type:'turn.started',at:'2026-10-10T00:00:00Z'}];
  assert.match(f.core.processingStageLabel({phase:'loading'},events,Date.parse('2026-10-10T00:00:09Z')),/9 秒/);
  for(const kind of ['connecting','host_offline','network_unavailable','login_required','approval_required']){
    f.core.presence.authorization(kind);
    const a=f.core.processingStageLabel({phase:'loading'},events,Date.parse('2026-10-10T00:00:09Z'));
    const b=f.core.processingStageLabel({phase:'loading'},events,Date.parse('2026-10-10T00:00:30Z'));
    assert.equal(a,b);assert.match(a,/等待接续/);assert.doesNotMatch(a,/秒|加载模型/);
    assert.match(f.core.processingLabel({phase:'reasoning'}),/等待接续/);
  }
  f.core.presence.success();assert.match(f.core.processingStageLabel({phase:'loading'},events,Date.parse('2026-10-10T00:00:30Z')),/30 秒/);
});

test('M3-1 Android message-level status check reconciles the original pending request without sending',async()=>{
  const calls:string[]=[],notices:string[]=[],pending={requestId:'original-native-request',state:'uncertain',text:'原草稿'};
  const state:any={page:'chat',owner:'owner',loggedIn:true,authEpoch:1,sharedGeneration:1,chatSource:'host',sharedSessionId:'session',sharedSessions:[],sharedEvents:[],sharedPending:pending};
  const effects=new Proxy({status:(text:string)=>notices.push(text),safeError:()=> 'CHECK_FAILED',nativeCall:async(method:string)=>{
    calls.push(method);return {source:'host',commands:[{kind:'session.message',sessionId:'session',requestId:pending.requestId,state:'uncertain'}]};
  }},{get:(o:any,k)=>o[k]||(()=>{})});
  const f=fixture({mobileState:state,effects});await f.core.mobile.checkSharedPending();
  assert.ok(notices.some(text=>text.includes('电脑仍未确认这条请求')));assert.ok(!notices.includes('CHECK_FAILED'));
  assert.equal(state.sharedPending.requestId,pending.requestId);assert.ok(calls.includes('shared.outbox.reconcile'));assert.ok(!calls.includes('shared.send'));
});
