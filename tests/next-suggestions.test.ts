import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNextSuggestions, parseSuggestions, suggestionContext } from '../src/personal-access/next-suggestions.mjs';
import { createUsageStore } from '../src/personal-access/usage.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { suggestionReasoning } from '../src/personal-access-backend.mjs';

function fixture(options:any = {}) {
  const events:any[] = [{seq:1,type:'user.message',data:{text:'帮我列一个报告提纲'}},
    {seq:2,type:'assistant.message',data:{text:'提纲：背景、方法、结果。'}},{seq:3,type:'turn.ended',data:{reason:'completed'}}];
  const account:any = {sessions:{s:{origin:'personal-remote',modelProfileId:'m',...options.session}},commands:{},personalization:{nextSuggestionsEnabled:true}};
  let calls = 0, aborted = false;
  const tickets:any[] = [], finishes:any[] = [];
  const context:any = {accountState:()=>account, authenticate:()=>({deviceId:'d'}),messageModelUsable:()=>true,
    readJson:async(request:any)=>request.body,json:(_response:any,_status:any,value:any)=>value,
    backend:{describeSession:async()=>({running:false}),readEvents:async()=>({events}),listModels:async()=>[{id:'m',model:'synthetic'}],
      modelCompletion:async(input:any)=>{calls++;await input.onStart();return Response.json({choices:[{message:{content:'{"suggestions":["继续写方法部分","把提纲保存成文件"]}'}}],usage:{prompt_tokens:120,completion_tokens:20}})}},
    usage:{begin:async(_owner:any,value:any)=>{tickets.push(value);return 'ticket'},finish:async(...value:any[])=>finishes.push(value)}};
  const service = createNextSuggestions(context,{timeoutMs:options.timeoutMs??1000,watchMs:10});
  const run=(body:any,owner='o',response:any=new EventEmitter())=>service.handle({body},response,new URL('http://unit/personal/v1/sessions/s/suggestions'),owner,'s');
  const hold=()=>{context.backend.modelCompletion=async(input:any)=>{calls++;await input.onStart();return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>{aborted=true;reject(input.signal.reason)},{once:true}))};};
  return {context,service,account,events,run,hold,tickets,finishes,get calls(){return calls},get aborted(){return aborted}};
}
const body={kind:'replies',requestId:'r'};
const delay=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));

test('UX-7 short context includes visible recent rounds, excludes tools, hidden thinking and forgotten originals',()=>{
  const f=fixture();f.events.unshift({seq:0,type:'assistant.message',data:{text:'FORGOTTEN'}});
  f.events.push({seq:4,type:'step.completed',data:{text:'TOOL_SENTINEL'}},{seq:5,type:'assistant.chunk',data:{text:'THINKING_SENTINEL'}});
  const context=suggestionContext(f.events,[0]);assert.equal(context.length,2);assert.doesNotMatch(JSON.stringify(context),/SENTINEL|FORGOTTEN/);
  assert.equal(suggestionContext([{seq:1,type:'assistant.message',data:{text:'字'.repeat(5000)}}])[0].content.length,1000);
});
test('UX-7 uncertain or generic suggestions are empty, short relevant chips deduplicate, completion only returns suffix',()=>{
  assert.deepEqual(parseSuggestions('bad','replies').suggestions,[]);
  assert.deepEqual(parseSuggestions('{"suggestions":["还有什么可以帮你","好\\n的","字字字字字字字字字字字字字字字字字字字字字字字字字","继续说第二点","继续说第二点"]}','replies').suggestions,['继续说第二点']);
  assert.equal(parseSuggestions('{"completion":"帮我保存成文件"}','completion','帮我').completion,'保存成文件');
  assert.equal(parseSuggestions('{"completion":""}','completion').completion,'');
});
test('UX-7 speculative requests use existing provider declarations at the lightest mode without changing conversation settings',()=>{
  assert.deepEqual(suggestionReasoning({baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.6-flash'}),{thinking:{type:'disabled'}});
  assert.deepEqual(suggestionReasoning({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3-max'}),{enable_thinking:false});
  assert.deepEqual(suggestionReasoning({baseUrl:'https://api.openai.com/v1',model:'gpt-5'}),{reasoning_effort:'low'});
  assert.deepEqual(suggestionReasoning({baseUrl:'http://127.0.0.1:1/v1',model:'synthetic'}),{});
});
test('UX-7 completed reply generates at most three, temporary conversations work, no state/history/evidence/export writes',async()=>{
  const f=fixture({session:{temporary:true}}),before=JSON.stringify(f.account),history=JSON.stringify(f.events);
  const result=await f.run(body);assert.deepEqual(result.suggestions,['继续写方法部分','把提纲保存成文件']);assert.equal(result.requestId,'r');
  assert.equal(f.calls,1);assert.equal(f.tickets[0].category,'next-suggestions');assert.equal(f.finishes.length,1);
  assert.equal(JSON.stringify(f.account),before);assert.equal(JSON.stringify(f.events),history);
});
test('UX-7 off, draft, running, aborted/blocked reply and unavailable model do not generate or charge',async()=>{
  for(const scenario of ['off','draft','running','aborted','blocked','unavailable','native-model-change']) {
    const f=fixture();if(scenario==='off')f.account.personalization.nextSuggestionsEnabled=false;
    if(scenario==='running')f.context.backend.describeSession=async()=>({running:true});
    if(scenario==='native-model-change')f.context.backend.describeSession=async()=>({running:false,modelProfileId:'other'});
    if(['aborted','blocked'].includes(scenario))f.events.at(-1).data.reason=scenario;
    if(scenario==='unavailable')f.context.messageModelUsable=()=>false;
    assert.deepEqual((await f.run({...body,...(scenario==='draft'?{draft:'草稿'}:{})})).suggestions,[]);assert.equal(f.calls,0,scenario);assert.equal(f.tickets.length,0);
  }
});
test('UX-7 cancel really aborts provider signal, stale requestId and another device cannot cancel new request',async()=>{
  const f=fixture();f.hold();const work=f.run(body);await delay();
  await f.service.handle({method:'DELETE'},new EventEmitter(),new URL('http://unit/?requestId=old'),'o','s');assert.equal(f.aborted,false);
  f.context.authenticate=()=>({deviceId:'other'});await f.service.handle({method:'DELETE'},new EventEmitter(),new URL('http://unit/?requestId=r'),'o','s');assert.equal(f.aborted,false);
  f.context.authenticate=()=>({deviceId:'d'});await f.service.handle({method:'DELETE'},new EventEmitter(),new URL('http://unit/?requestId=r'),'o','s');
  assert.deepEqual((await work).suggestions,[]);assert.equal(f.aborted,true);assert.equal(f.calls,1);assert.equal(f.finishes.length,1);
});
test('UX-7 typing, send, switch, toggle off, model change and disconnected client abandon in-flight inference without retry',async()=>{
  for(const scenario of ['typing','send','switch','off','model-change','disconnect','native-running']) {
    const f=fixture(),response=new EventEmitter();f.hold();const work=f.run(body,'o',response);await delay();
    if(['typing','switch'].includes(scenario))f.service.cancel('o','s');
    if(scenario==='send')f.account.commands.new={kind:'session.message',state:'pending'};
    if(scenario==='off')f.account.personalization.nextSuggestionsEnabled=false;
    if(scenario==='model-change')f.account.sessions.s.modelProfileId='other';
    if(scenario==='disconnect')response.emit('close');
    if(scenario==='native-running')f.context.backend.describeSession=async()=>({running:true});
    f.service.reconcile('o');assert.deepEqual((await work).suggestions,[],scenario);assert.equal(f.aborted,true);assert.equal(f.calls,1);
  }
});
test('UX-7 timeout quietly aborts, busy admission has no usage ticket',async()=>{
  const f=fixture({timeoutMs:30});f.hold();assert.deepEqual((await f.run(body)).suggestions,[]);assert.equal(f.aborted,true);
  const busy=fixture();busy.context.backend.modelCompletion=async()=>{throw new Error('MODEL_SUGGESTION_BUSY')};
  assert.deepEqual((await busy.run(body)).suggestions,[]);assert.equal(busy.tickets.length,0);
});
test('UX-7 numeric usage ledger separately aggregates suggestion category and persists no text',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-ux7-ledger-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=await createUsageStore({root});const model={model:'mimo-v2.6-flash',sourceKind:'cloud'};
  const id=await store.begin('o',{model,profileId:'m',sessionId:'s',category:'next-suggestions'});
  await store.finish('o',id,{prompt_tokens:120,completion_tokens:20});
  assert.equal(store.summary('o').categories[0].category,'next-suggestions');assert.equal(store.summary('o').categories[0].outputTokens,20);
  assert.doesNotMatch(await readFile(join(root,'usage.json'),'utf8'),/继续写|提纲|completion"/);await store.close();
});
test('UX-7 authenticated HTTP route uses owner binding and capability version; cancellation route is exact',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-ux7-http-')),f=fixture();
  const backend:any={...f.context.backend,getStatus:async()=>({runtime:'ready'}),preflight:async()=>({ok:true}),createSession:async({sessionId}:any)=>({sessionId}),sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true})};
  const service=await createPersonalAccessService({root,port:0,backend});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})});
  const {origin,hostId}=await service.start(),device=await service.enrollDevice({name:'synthetic'});
  const api=async(path:string,method='GET',input?:any,token=device.token)=>{
    const reply=await fetch(origin+'/personal/v1'+path,{method,headers:{authorization:'Bearer '+token,...(input?{'content-type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});return {status:reply.status,value:await reply.json()};};
  const created=await api('/commands','POST',{requestId:'create',kind:'session.create',targetDeviceId:hostId,modelProfileId:'m'});
  assert.equal(created.status,202);let sessionId;for(let n=0;n<100;n++){const current=(await api('/commands/'+created.value.command.commandId)).value.command;sessionId=current.sessionId;if(current.state==='accepted_by_dsh')break;await delay(20);}assert.ok(sessionId);
  const route=`/sessions/${sessionId}/suggestions`;
  assert.equal((await api('/status')).value.personalCapabilities.nextSuggestions,1);
  assert.equal((await api(route,'POST',body)).status,200);
  assert.equal((await api('/sessions/other/suggestions','POST',body)).status,404);
  assert.equal((await api(route,'POST',body,'bad')).status,401);
  assert.equal((await api(route+'?requestId=r','DELETE')).status,200);
  assert.equal((await api(route+'?extra=x','DELETE')).status,400);
});
test('UX-7 account switch synchronizes across devices, isolates another account, and PATCH off truly aborts active provider',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-ux7-setting-')),f=fixture();f.hold();
  const backend:any={...f.context.backend,getStatus:async()=>({runtime:'ready'}),preflight:async()=>({ok:true}),createSession:async({sessionId}:any)=>({sessionId}),sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true})};
  const service=await createPersonalAccessService({root,port:0,backend});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})});
  const {origin,hostId}=await service.start(),grant=await service.issueSetupGrant();
  async function api(path:string,session:any,input?:any,method=input?'POST':'GET') {
    const r=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,...(session?{cookie:session.cookie,'x-weftmate-csrf':session.csrf}:{}),...(input?{'content-type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});
    return {status:r.status,value:await r.json(),cookie:r.headers.getSetCookie()[0]?.split(';')[0]};
  }
  const setup=await api('/auth/setup',null,{grant:grant.grant,username:'Ux7SyntheticA',password:'UX7-synthetic-password-2026!',deviceName:'one'});assert.equal(setup.status,201);
  const a={cookie:setup.cookie,csrf:setup.value.csrfToken},created=await api('/commands',a,{requestId:'create',kind:'session.create',targetDeviceId:hostId,modelProfileId:'m'});
  let sessionId;for(let i=0;i<100;i++){const current=(await api('/commands/'+created.value.command.commandId,a)).value.command;sessionId=current.sessionId;if(current.state==='accepted_by_dsh')break;await delay(20)}
  const pending=api(`/sessions/${sessionId}/suggestions`,a,body);
  for(let i=0;i<100&&!f.calls;i++)await delay(20);assert.equal(f.calls,1);
  assert.equal((await api('/settings/personalization',a,{nextSuggestionsEnabled:false},'PATCH')).status,200);
  assert.equal(f.aborted,true);assert.deepEqual((await pending).value.suggestions,[]);
  const login=await api('/auth/login',null,{username:'Ux7SyntheticA',password:'UX7-synthetic-password-2026!',deviceName:'two'}),second={cookie:login.cookie,csrf:login.value.csrfToken};
  assert.equal((await api('/settings/personalization',second)).value.settings.nextSuggestionsEnabled,false);
  const register=await api('/auth/register',null,{username:'Ux7SyntheticB',password:'UX7-synthetic-password-2026!',deviceName:'other'}),b={cookie:register.cookie,csrf:register.value.csrfToken};
  assert.equal((await api('/settings/personalization',b)).value.settings.nextSuggestionsEnabled,true);
  assert.equal((await api(`/sessions/${sessionId}/suggestions`,b,body)).status,404);
});
