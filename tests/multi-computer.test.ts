import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function setup(extra:any={}){
  const ctx=vm.createContext({Date,Map,Set,Promise,URL,JSON,console,globalThis:null});ctx.globalThis=ctx;
  ctx.WeftUiCore={factories:{}};vm.runInContext(await readFile('src/ui-core/computers.js','utf8'),ctx);
  const calls:any[]=[],prefs=new Map();const core:any={state:{cloudAuth:{sub:'synthetic'},hostId:'a',sessions:[]},
    accessApi:async(path:string,options:any={})=>{calls.push({host:'a',path,options});return path.startsWith('/sessions')?{sessions:extra.localSessions||[{sessionId:'a-session',title:'A'}]}:{projects:[]};},
    selectSession:async()=>{},startNewConversation:()=>{},clearSession:()=>{},cloudCurrentComputer:()=> 'a',
    cloudConnect:async(id:string)=>({hostId:id,status:'online',baseUrl:'https://'+id+'.example.com'}),
    cloudComputerCapabilities:async()=>({cloudChannel:1}),
    cloudComputerChannel:async()=>({token:'synthetic-token',account:{ownerId:'b-owner'},device:{id:'phone'},csrfToken:'csrf'}),
    acceptSession:()=>{},refreshStatus:async()=>{},refreshModels:async()=>{},refreshSessions:extra.refreshSessions||(async()=>{}),api:async()=>({})};
  const effects={paintComputers:()=>{},toast:()=>{},openComputerChannel:async(c:any)=>({close:()=>{},request:async(path:string,options:any)=>{calls.push({host:c.hostId,path,options});return {sessions:[{sessionId:'b-session',title:'B'}]};}})};
  core.accessBase='/personal/v1';core.authBase='/personal/v1/auth';core.requestJson=(url:string,options:any)=>coreOriginal(url.replace('/personal/v1',''),options);
  const coreOriginal=core.accessApi;
  ctx.WeftUiCore.factories.computers(core,effects,{...extra,storage:{getItem:(k:string)=>prefs.get(k),setItem:(k:string,v:string)=>prefs.set(k,v)}});
  return {ctx,core,calls,effects};
}
test('execution defaults inherit sources, prefer last online computer, and choose the only online computer',async()=>{
  const {ctx}=await setup(),choose=ctx.WeftUiCore.chooseComputer;
  const rows=[{hostId:'a',online:true},{hostId:'b',online:true}];
  assert.equal(choose(rows,{lastHostId:'b'}),'b');assert.equal(choose(rows,{sourceHostId:'a',lastHostId:'b'}),'a');
  rows[1].online=false;assert.equal(choose(rows,{lastHostId:'b'}),'a');
  assert.equal(choose(rows,{sourceHostId:'b'}),'b','offline source is not silently reassigned');
  rows[0].online=false;assert.equal(choose(rows,{}),null);
});
test('old cloud and single computer do not open new channels or alter list responses',async()=>{
  for(const capabilities of [undefined,{multiHost:1}]){
    const {core,calls}=await setup();core.updateComputerDirectory({hosts:[{hostId:'a',online:true}],capabilities});
    const result=await core.accessApi('/sessions?archived=all');
    assert.equal(core.hasMultipleComputers(),false);assert.equal(calls.length,1);assert.equal(calls[0].host,'a');
    assert.deepEqual(result,{sessions:[{sessionId:'a-session',title:'A'}]});
  }
});
test('a new conversation refreshes authoritative send availability before the first message',async()=>{
  const {core}=await setup();let reads=0;
  core.updateComputerDirectory({hosts:[{hostId:'a',online:true},{hostId:'b',online:true}],capabilities:{multiHost:1}});
  core.refreshSessions=async()=>{reads++;core.state.sessions=[{sessionId:'new',hostId:'a',sendAvailable:true}];};
  await core.startNewConversation();assert.equal(reads,1);assert.equal(core.state.sessions[0].sendAvailable,true);
});
test('the desktop program keeps local conversations while showing the account computer directory',async()=>{
  const {core,calls}=await setup({desktop:true});core.updateComputerDirectory({hosts:[{hostId:'a',online:true},{hostId:'b',online:true}],capabilities:{multiHost:1}});
  assert.equal(core.hasMultipleComputers(),true);assert.equal(core.canChooseExecutionComputer(),false);
  const listed=await core.accessApi('/sessions?archived=all');assert.equal(listed.sessions.length,1);assert.equal(calls.length,1);assert.equal(calls[0].host,'a');
  await core.selectExecutionComputer('b');assert.equal(calls.length,1);
});

test('cloud login keeps the desktop local sidebar and send availability when its relay is offline',async()=>{
  const localSessions=[{sessionId:'a-session',title:'A',running:true,sendAvailable:true}];
  let refreshes=0;
  const {core,calls}=await setup({desktop:true,localSessions,refreshSessions:async()=>{refreshes++;}});
  core.state.personalCapabilities={workAndChat:1};
  core.updateComputerDirectory({hosts:[{hostId:'a',online:false},{hostId:'b',online:false}],capabilities:{multiHost:1}});
  assert.equal(core.canChooseExecutionComputer(),true);
  const listed=await core.accessApi('/sessions?archived=all');
  assert.equal(listed.sessions.length,1);
  assert.equal(listed.sessions[0].sessionId,'a-session');
  assert.equal(listed.sessions[0].computerOffline,undefined);
  assert.equal(listed.sessions[0].running,true);
  localSessions[0].running=false;
  const completed=await core.accessApi('/sessions?archived=all');
  assert.equal(completed.sessions[0].running,false);
  assert.equal(completed.sessions[0].sendAvailable,true);
  assert.equal(calls.filter(row=>row.host==='a').length,2);
  assert.equal(calls.filter(row=>row.host!=='a').length,0);
  await core.refreshSessions();
  assert.equal(refreshes,1,'local relay status must not bypass logical history refresh');
  await assert.rejects(core.selectExecutionComputer('b'),error=>error.code==='COMPUTER_OFFLINE');
});
test('list merges by computer; sending and retries address only the selected computer; offline lists retain ownership',async()=>{
  const {core,calls}=await setup();const hosts=[{hostId:'a',name:'synthetic-desk',online:true},{hostId:'b',name:'synthetic-laptop',online:true}];
  core.updateComputerDirectory({hosts,capabilities:{multiHost:1}});
  const merged=await core.accessApi('/sessions?archived=all');assert.equal(JSON.stringify(merged.sessions.map((s:any)=>s.hostId)),JSON.stringify(['a','b']));
  await core.selectExecutionComputer('b');calls.length=0;
  const options={method:'POST',body:{requestId:'same-message',targetDeviceId:'b',kind:'session.message'}};
  await core.accessApi('/commands',options);await core.accessApi('/commands',options);
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.host==='b'));assert.equal(calls[0].options.body,calls[1].options.body);
  hosts[0].online=false;const offline=await core.accessApi('/sessions?archived=all');
  assert.equal(offline.sessions.find((s:any)=>s.hostId==='a').computerOffline,true);
});

test('MODE-1 selecting another computer restores receipt observation before an empty work draft sends',async()=>{
  const {core,effects}=await setup();let restarts=0;(effects as any).startAssistantRefresh=()=>restarts++;
  core.updateComputerDirectory({hosts:[{hostId:'a',online:true},{hostId:'b',online:true}],capabilities:{multiHost:1}});
  await core.selectExecutionComputer('b');assert.equal(restarts,1);
});

test('new cloud cannot enable a token channel on a computer that did not declare it',async()=>{
  const {core,calls}=await setup();let opened=0,legacy=0;
  core.cloudComputerCapabilities=async()=>({});
  core.cloudComputerChannel=async()=>{opened++;throw Error('legacy host has no token channel');};
  core.cloudConnectTrusted=async()=>{legacy++;core.cloudCurrentComputer=()=> 'b';};
  core.updateComputerDirectory({hosts:[{hostId:'a',online:true},{hostId:'b',online:true}],capabilities:{multiHost:1}});
  await core.selectExecutionComputer('b');
  assert.equal(legacy,1);assert.equal(opened,0);
  assert.ok(!calls.some(c=>c.path==='/personal/v1/auth/cloud-channel'));
});
