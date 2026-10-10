import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { rm } from 'node:fs/promises';
import { desktopScript,desktopScriptPaths } from './helpers/desktop-ui-source.mjs';
import { installConversationReasoning } from '../src/plugins/personal-reasoning.mjs';
import { modelReasoning } from '../src/model-reasoning.mjs';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';
import { projectHistoryEvent } from '../src/runtime/dsh-adapter/sessions.mjs';
import { startTimelineCandidate } from './integration/timeline-ui-candidate.mjs';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';
function coreFixture(fetchImpl=async()=>({ok:true,status:200,json:async()=>({enabled:true})})) {
 const context:any={URL,URLSearchParams,Intl,TextEncoder,Blob,AbortSignal,DOMException,setTimeout,clearTimeout,setInterval,clearInterval};
 // Feature tests run the canonical DOM-free factories, not browser presentation assets.
 runInNewContext(desktopScriptPaths().filter(path=>uiCoreAssets.some(name=>path===`ui-core/${name}`)).map(desktopScript).join('\n;\n'),context);
 const effects=new Proxy({}, {get:()=>()=>{}}),core=context.WeftUiCore.create({effects,fetch:fetchImpl,storage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=>crypto.randomUUID()}});
 Object.assign(core.state,{ownerId:'synthetic-owner',identityGeneration:1,csrfToken:'synthetic-csrf',device:{id:'synthetic-device'},currentView:'assistant',activeChatSource:'desktop',selectedSessionId:'session-a',models:[{id:'model-a',deepThinking:{supported:true}}],modelProfileId:'model-a',sessions:[{sessionId:'session-a',modelProfileId:'model-a'},{sessionId:'session-b',modelProfileId:'model-a'}]});
 return {api:context.WeftUiCore,core};
}
test('UX-3 thinking is conversation-local and a late account response cannot set the new identity',async()=>{
 let resolve:any;let response:any={ok:true,status:200,json:async()=>({enabled:true})};
 const {core}=coreFixture(async()=>response);
 await core.setDeepThinking(true);assert.equal(core.thinkingView().enabled,true);
 core.state.selectedSessionId='session-b';assert.equal(core.thinkingView().enabled,false);
 response=new Promise(done=>{resolve=done});const writing=core.setDeepThinking(true);
 core.state.identityGeneration++;core.state.ownerId='other-owner';core.state.sessions=[{sessionId:'session-b',modelProfileId:'model-a'}];
 resolve({ok:true,status:200,json:async()=>({enabled:true})});await writing;assert.equal(core.thinkingView().enabled,false);
 core.state.models=[{id:'model-a',deepThinking:{supported:false}}];assert.equal(core.thinkingView().supported,false);
});
test('UX-3 subtask projection preserves true background lifetime, failures, names and timestamps',()=>{
 const {api}=coreFixture();let seq=0;const at=new Date('2026-10-10T00:00:00Z').toISOString();
 const call:any={seq:seq++,time:Date.parse(at),type:'tool/call',data:{turn:1,callId:'child-a',name:'subagent',arguments:JSON.stringify({description:'合成资料核对',prompt:'private prompt'})}};
 const result:any={seq:seq++,time:Date.parse(at)+1000,type:'tool/result',data:{turn:1,message:{source:{kind:'tool',callId:'child-a'},content:[{type:'tool-result',toolCallId:'child-a',content:[{type:'text',text:'started background subagent task job-a'}]}]}}};
 const events:any[]=[{seq:-1,type:'turn.started',at},projectHistoryEvent(call),projectHistoryEvent(result,call)];
 const rows=api.composerSubtasks(events,Date.parse(at)+10000);assert.equal(rows.length,1);assert.equal(rows[0].status,'进行中');assert.equal(rows[0].name,'合成资料核对');assert.equal(rows[0].duration,'10 秒');assert.doesNotMatch(JSON.stringify(events),/private prompt/);
 const notice=projectHistoryEvent({seq:seq++,time:Date.parse(at)+12000,type:'user/message',data:{source:{kind:'plugin',plugin:'tool-jobs',form:'notice'},content:[{type:'text',text:'background job job-a (subagent: 合成资料核对) finished [status: failed]. Read its output with job_output.'}]}});
 assert.equal(notice?.type,'subtask.updated');events.push(notice);assert.equal(api.composerSubtasks(events).length,0);
 assert.equal(api.runningPlaceholder('queue'),'排队到下一条…');assert.equal(api.runningPlaceholder('steer'),'引导当前回复…');assert.equal(api.runningPlaceholder(),'补充或跟进…');
});
test('UX-3 provider reasoning enables a session override, restores defaults, and leaves unsupported routes alone',async()=>{
 assert.equal(modelReasoning({baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.6-flash'})?.compat.thinkingFormat,'deepseek');
 assert.equal(modelReasoning({baseUrl:'https://api.openai.com/v1',model:'gpt-5'})?.compat.thinkingFormat,'openai');
 assert.equal(modelReasoning({baseUrl:'https://example.invalid/v1',model:'unknown'}),null);
 const profile:any={id:'model-a',name:'synthetic',baseUrl:'https://api.openai.com/v1',model:'gpt-5',reasoningEffort:'low'},selections:any[]=[];
 const backend=createPersonalAccessBackend({currentOrigin:()=> 'http://127.0.0.1:1',profiles:()=>[profile],hasCredential:()=>true,routeForProfile:()=>({provider:'synthetic-provider'}),listSessions:async()=>({items:[{sessionId:'session-a',agentPreset:'personal-remote'}]}),resolveSession:async()=>({profile}),ensureKnownSession:async()=>{},queue:async(action:any)=>action(),gateway:async(path:string,init:any)=>{
  if(path==='/models')return {groups:[{id:'synthetic-provider',models:[{id:profile.model}]}]};if(path==='/sessions/session-a')return {sessionId:'session-a',agentPreset:'personal-remote'};if(path.endsWith('/models'))selections.push(JSON.parse(init.body));return {accepted:true};
 }} as any);
 await backend.sendMessage({sessionId:'session-a',text:'合成',deepThinking:true});assert.equal(selections.length,0,'sending never writes the native session/global selection');
 await backend.sendMessage({sessionId:'session-a',text:'合成',deepThinking:false});assert.equal(selections.length,0);assert.equal(profile.reasoningEffort,'low');
 const count=selections.length;await backend.sendMessage({sessionId:'session-a',text:'合成'});assert.equal(selections.length,count);
 profile.baseUrl='https://example.invalid/v1';profile.model='unknown';delete profile.reasoningEffort;await backend.sendMessage({sessionId:'session-a',text:'合成',deepThinking:true});assert.equal(selections.length,count);
});
test('UX-3 authenticated thinking preference persists and is exposed by sessions without changing model defaults',async(t)=>{
 const f=await startTimelineCandidate({inlineProgress:true,composerMenu:true,historyCount:0});
 t.after(async()=>{await f.close();await rm(f.root,{recursive:true,force:true});});
 const catalog=await f.request('/models');assert.equal(catalog.models[0].deepThinking.supported,true);
 assert.equal((await f.request(`/sessions/${f.sessionId}/thinking`,{enabled:true},'PATCH')).enabled,true);
 assert.equal((await f.request('/sessions')).sessions[0].deepThinking,true);
 assert.equal((await f.request(`/sessions/${f.sessionId}/thinking`)).enabled,true);
 const forbidden=await fetch(f.origin+`/personal/v1/sessions/${f.sessionId}/thinking`,{method:'PATCH',headers:{origin:f.origin,'content-type':'application/json'},body:'{"enabled":false}'});assert.equal(forbidden.status,401);
 assert.equal((await f.request(`/sessions/${f.sessionId}/thinking`)).enabled,true);
});

test('UX-3 native request snapshots thinking per turn and preserves the default config exactly',async()=>{
 let hook:any,enabled=true,reads=0;
 installConversationReasoning({on:(_name:any,handler:any)=>{hook=handler}},async()=>{reads++;return {deepThinking:enabled}});
 const agent={session:{header:{agentPreset:'personal-remote'}}},config={provider:'synthetic',model:'synthetic',reasoningEffort:'low'};
 assert.equal((await hook({agent,turn:1},async()=>config)).reasoningEffort,'high');assert.equal(config.reasoningEffort,'low');
 enabled=false;assert.equal((await hook({agent,turn:1},async()=>config)).reasoningEffort,'high');assert.equal(reads,1);
 assert.equal(await hook({agent,turn:2},async()=>config),config);assert.equal(reads,2);
 const shared={session:{header:{agentPreset:'personal-shared-chat'}}};enabled=true;
 assert.equal((await hook({agent:shared,turn:1},async()=>config)).reasoningEffort,'high');
 const child={session:{header:{agentPreset:'personal-remote',origin:'subagent'}}};
 assert.equal(await hook({agent:child,turn:1},async()=>config),config);
});

test('UX-3 script-wrapped native background results retain the launch step and never invent a task from file text',()=>{
 const {api}=coreFixture(),at='2026-10-10T00:00:00Z';
 const call:any={seq:1,time:Date.parse(at),type:'tool/call',data:{turn:1,callId:'script-child',name:'run_code',arguments:JSON.stringify({description:'合成并行核对'})}};
 const result:any={seq:2,time:Date.parse(at)+2000,type:'tool/result',data:{turn:1,message:{source:{kind:'tool',callId:'script-child'},content:[{type:'tool-result',toolCallId:'script-child',content:[{type:'text',text:'{"kind":"background","jobId":"job-script"}'}]}]}}};
 const projected:any=projectHistoryEvent(result,call);assert.equal(projected.data.subtask.id,'job-script');
 const rows=api.composerSubtasks([projectHistoryEvent(call),projected],Date.parse(at)+10000);assert.equal(rows[0].duration,'10 秒');assert.equal(rows[0].stepId,'script-child');
 const fileCall={...call,data:{...call.data,name:'read'}};assert.equal((projectHistoryEvent(result,fileCall) as any).data.subtask,undefined);
 const empty={...result,data:{...result.data,message:{...result.data.message,content:[{type:'tool-result',toolCallId:'script-child',content:[{type:'text',text:'null'}]}]}}};assert.equal((projectHistoryEvent(empty,call) as any).data.subtask,undefined);
});
