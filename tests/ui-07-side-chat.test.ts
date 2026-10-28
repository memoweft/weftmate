import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';

function fixture(fetch = async (_url: string, _options: any) => ({ok:true,status:200,json:async()=>({})}), timers = {}) {
  const values = new Map(); let counter=0;
  const environment = { fetch, storage:{getItem:(key: string)=>values.get(key)??null,setItem:(key: string,value: string)=>values.set(key,value),removeItem:(key: string)=>values.delete(key)}, crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`} };
  const context:any={AbortController,AbortSignal,URL,URLSearchParams,TextEncoder,Blob,DOMException,Intl,setTimeout,clearTimeout,setInterval,clearInterval,...timers};
  runInNewContext(uiCoreAssets.map(name=>readFileSync(new URL('../src/ui-core/'+name,import.meta.url),'utf8')).join('\n;\n'),context);
  const effects = new Proxy({}, {get:()=>()=>{}});
  const core=context.WeftUiCore.create({...environment,effects});
  Object.assign(core.state,{ownerId:'synthetic-owner',identityGeneration:3,account:{username:'Synthetic'},device:{id:'synthetic-device'},csrfToken:'synthetic-csrf',hostId:'synthetic-host',online:true,selectedSessionId:'main-session',modelProfileId:'model-a',models:[{id:'model-a',name:'A'},{id:'model-b',name:'B'}],sessions:[{sessionId:'main-session',sendAvailable:true}],capabilities:{chat:{available:true}}});
  return {core,effects};
}
test('side model, attachments and stop command belong to the side conversation',async()=>{
  const sent:any[]=[];
  const f=fixture(async (url,options)=>{if(url.endsWith('/commands')&&options.method==='POST')sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>url.includes('/commands?')?{commands:[]}:{command:{commandId:'synthetic-command',requestId:'synthetic-request',state:'accepted_by_dsh'}}};});
  const scope=f.core.createChatScope(f.effects,'side-tab'),side=scope.core;
  side.state.selectedSessionId='side-session';side.state.sessions.push({sessionId:'side-session',sendAvailable:true,running:true});
  side.selectModelProfile('model-b');
  side.state.attachmentDrafts.set('synthetic-owner|side-session',[{attachmentId:'synthetic-side-file'}]);
  await side.stopCurrentTurn();
  assert.equal(sent.length,1);assert.equal(sent[0].kind,'session.cancel');assert.equal(sent[0].sessionId,'side-session');
  assert.equal(f.core.state.selectedSessionId,'main-session');assert.equal(f.core.state.modelProfileId,'model-a');assert.equal(f.core.currentAttachmentDrafts().length,0);
  scope.dispose();assert.equal(f.core.state.csrfToken,'synthetic-csrf');
});
test('closed or replaced identity cannot deliver a late response or issue another request',async()=>{
  let release!:()=>void;let calls=0,signal:any;
  const f=fixture(async (_url,options)=>{calls++;signal=options.signal;await new Promise<void>(resolve=>release=resolve);return {ok:true,status:200,json:async()=>({value:'old'})};});
  const scope=f.core.createChatScope(f.effects,'side-tab');
  const pending=scope.core.requestJson('/synthetic');
  scope.dispose();assert.equal(signal.aborted,true);release();
  await assert.rejects(pending);
  await assert.rejects(scope.core.requestJson('/synthetic'));assert.equal(calls,1);
  const next=f.core.createChatScope(f.effects,'next-tab');f.core.state.identityGeneration++;
  assert.equal(next.sync(),false);await assert.rejects(next.core.requestJson('/synthetic'));assert.equal(calls,1);next.dispose();
});
test('side transport keeps its original computer when the main view changes computer',async()=>{
  const f=fixture(),calls:any[]=[];f.core.canUseComputerChannel=()=>true;
  f.core.computerApi=async(...args:any[])=>{calls.push(args);return {ok:true};};
  const scope=f.core.createChatScope(f.effects,'side-tab','side-computer');
  f.core.state.hostId='different-main-computer';await scope.core.accessApi('/sessions/side-session/events');
  assert.equal(calls[0][0],'side-computer');assert.equal(scope.core.state.hostId,'side-computer');scope.dispose();
});
test('expired side credentials use the owning account login flow',async()=>{
  const f=fixture(async()=>({ok:false,status:401,json:async()=>({error:{code:'UNAUTHORIZED'}})}));let expired=0;
  f.core.sessionExpired=()=>{expired++;};
  const scope=f.core.createChatScope(f.effects,'side-tab');await assert.rejects(scope.core.accessApi('/models'));
  assert.equal(expired,1);scope.dispose();
});
test('reopening a closed panel cannot adopt its old pending creation',()=>{
  const f=fixture(),first=f.core.createChatScope(f.effects,'chat');
  first.core.rememberMarker({requestId:'old-create',kind:'session.create'});first.dispose();
  const second=f.core.createChatScope(f.effects,'chat');assert.equal(second.core.readMarkers().length,0);second.dispose();
});
test('side streaming renews native waits and shares the main read cadence and failure backoff',async()=>{
  const scheduled:any[]=[],cleared:any[]=[];
  let now=0;
  const f=fixture(undefined,{Date:class extends Date {static now(){return now;}},setTimeout:(callback,delay)=>{const timer={callback,delay};scheduled.push(timer);return timer;},clearTimeout:timer=>cleared.push(timer),setInterval:()=>null,clearInterval:()=>{}});
  const scope=f.core.createChatScope(f.effects,'stream-side'),side=scope.core;
  Object.assign(side.state,{personalCapabilities:{replyStreaming:1},turnStatus:'running'});
  const outcomes=[{kind:'changed',cost:0},{kind:'changed',cost:12},{kind:'unchanged',immediateRenew:true,cost:20},{kind:'failed',cost:0}];
  side.refreshLiveConversation=async()=>{const result=outcomes.shift();now+=result.cost;if(result.kind==='failed')side.historyReadResult('failed');return result;};
  // An unrelated slow task read must not hold up streamed text.
  side.refreshConversationFacts=()=>new Promise(()=>{});
  try {
    scope.start();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scheduled.at(-1)?.delay,side.polling.stream);
    await scheduled.at(-1).callback();
    assert.equal(scheduled.at(-1).delay,0);
    await scheduled.at(-1).callback();
    assert.equal(scheduled.at(-1).delay,0);
    await scheduled.at(-1).callback();
    assert.ok(scheduled.at(-1).delay>=side.polling.readRetryBase);
    assert.ok(scheduled.at(-1).delay<=side.polling.readRetryCap);
  } finally {scope.dispose();}
  assert.ok(cleared.includes(scheduled.at(-1)));
});

test('main and side conversations operate together in the Windows Electron shell',{skip:process.platform!=='win32',timeout:180000},()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(process.execPath,['tests/integration/ui-07-side-chat.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:170000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/UI-07 side chat: .* passed/);
});
