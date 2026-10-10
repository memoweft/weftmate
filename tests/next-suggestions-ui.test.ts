import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function fixture() {
  let serial=0, draft='', paints=0;const timers=new Map<number,()=>void>(),requests:any[]=[];
  const global:any={WeftUiCore:{factories:{}},AbortController,setTimeout,clearTimeout};
  runInNewContext(readFileSync(new URL('../src/ui-core/next-suggestions.js',import.meta.url),'utf8'),global);
  const core:any={state:{ownerId:'a',identityGeneration:1,selectedSessionId:'s',online:true,personalCapabilities:{nextSuggestions:1},personalization:{nextSuggestionsEnabled:true},historyEvents:new Map()},conversationRunning:()=>false,
    accessApi:async(path:string,options:any)=>{requests.push({path,options});return {requestId:options.body?.requestId,suggestions:['继续说第二点'],completion:'保存成文件'}}};
  Object.assign(core,global.WeftUiCore.factories.nextSuggestions(core,{readMessageDraft:()=>draft,paintNextSuggestions:()=>paints++},
    {crypto:{randomUUID:()=>`r${++serial}`},setTimeout:(fn:()=>void,ms:number)=>{assert.equal(ms,350);const id=++serial;timers.set(id,()=>{timers.delete(id);fn()});return id},clearTimeout:(id:number)=>timers.delete(id)}));
  return {global,core,timers,requests,set draft(value:string){draft=value},get paints(){return paints}};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
test('UX-7 above composer priority is singular for every combination; no-model suppresses suggestions',()=>{
  const f=fixture(),names=['approval','question','connection','subtasks','suggestions'];
  for(let mask=0;mask<32;mask++) {
    const value=Object.fromEntries(names.map((key,i)=>[key,!!(mask&(1<<i))]));
    assert.equal(f.global.WeftUiCore.composerAbovePriority(value),names.find(key=>value[key])??'none');
    assert.notEqual(f.global.WeftUiCore.composerAbovePriority({...value,noModel:true}),'suggestions');
  }
});
test('UX-7 only a new completed boundary generates once, drafts suppress post-reply chips and dismissed reply never reappears',async()=>{
  const f=fixture();f.core.syncNextSuggestions();
  f.core.state.historyEvents.set(1,{seq:1,type:'turn.started'});f.core.syncNextSuggestions();
  f.core.state.historyEvents.set(2,{seq:2,type:'turn.ended',data:{reason:'completed'}});f.core.syncNextSuggestions();await settle();
  assert.equal(f.requests.length,1);assert.equal(f.core.nextSuggestionsView().suggestions.length,1);
  f.core.syncNextSuggestions();f.core.dismissNextSuggestions();f.core.syncNextSuggestions();await settle();assert.equal(f.requests.length,1);assert.equal(f.core.nextSuggestionsView().suggestions.length,0);
  f.draft='草稿';f.core.state.historyEvents.set(3,{seq:3,type:'turn.ended',data:{reason:'completed'}});f.core.syncNextSuggestions();await settle();assert.equal(f.requests.length,1);
});
test('UX-7 completion debounces, replacing draft aborts pending fetch with captured cancellation id; Esc suppresses current draft',async()=>{
  const f=fixture();f.core.syncNextSuggestions();f.draft='帮';f.core.nextSuggestionsInput('帮');f.draft='帮我';f.core.nextSuggestionsInput('帮我');
  assert.equal(f.timers.size,1);assert.equal(f.requests.length,0);[...f.timers.values()][0]();await settle();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.body.draft,'帮我');assert.equal(f.core.nextSuggestionsView().completion,'保存成文件');
  f.core.dismissNextSuggestions();f.core.nextSuggestionsInput('帮我再');assert.equal(f.timers.size,0);assert.equal(f.core.nextSuggestionsView().completion,'');
  f.core.nextSuggestionsInput('');f.draft='帮我';f.core.nextSuggestionsInput('帮我');assert.equal(f.timers.size,1);
  let pending:any;f.core.accessApi=(path:string,options:any)=>{f.requests.push({path,options});return options.method==='DELETE'?Promise.resolve({}):new Promise(resolve=>pending=resolve)};
  [...f.timers.values()][0]();await settle();const request=f.requests.at(-1);f.draft='新';f.core.nextSuggestionsInput('新');
  assert.equal(request.options.signal.aborted,true);assert.ok(f.requests.at(-1).path.endsWith(`?requestId=${request.options.body.requestId}`));
  pending({requestId:request.options.body.requestId,completion:'OLD'});await settle();assert.equal(f.core.nextSuggestionsView().completion,'');
});
test('UX-7 account/session switches reject late response, IME composing and setting off prevent completion requests',async()=>{
  const f=fixture();f.core.syncNextSuggestions();let done:any;
  f.core.accessApi=(_path:string,options:any)=>options.method==='DELETE'?Promise.resolve({}):new Promise(resolve=>done=resolve);
  f.draft='草稿';f.core.nextSuggestionsInput('草稿');const request=f.core.requestNextSuggestions('completion','草稿');f.core.state.ownerId='b';f.core.state.identityGeneration++;f.core.state.selectedSessionId='new';f.core.syncNextSuggestions();done({requestId:'r2',completion:'OLD'});await request;
  assert.equal(f.core.nextSuggestionsView().suggestions.length,0);f.core.setSuggestionsComposing(true);f.core.nextSuggestionsInput('输入');assert.equal(f.timers.size,0);
  f.core.setSuggestionsComposing(false);f.core.state.personalization.nextSuggestionsEnabled=false;f.core.syncNextSuggestions();f.core.nextSuggestionsInput('输入');assert.equal(f.timers.size,0);
});
