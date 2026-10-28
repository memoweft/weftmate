import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCommands} from '../src/runtime/dsh-adapter/commands.mjs';
import {createGatewayV1} from '../src/runtime/gateway/routes/v1.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFixture} from './integration/ux-4-fixture.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('#659 opening commands in a new work conversation preserves the current draft and attachments',async()=>{
  const env:any={setTimeout,WeftUiCore:{factories:{}}};runInNewContext(readFileSync('src/ui-core/slash-commands.js','utf8'),env);
  let draft='/comp',creations=0;const file={attachmentId:'synthetic-file'},state:any={ownerId:'owner',identityGeneration:1,newConversationId:'draft-one',newConversationMode:'work',activeChatSource:'desktop',newConversation:true,selectedSessionId:null,attachmentDrafts:new Map([['owner|new',[file]]])};
  const core:any={state,attachmentDraftKey:()=>`owner|${state.selectedSessionId||'new'}`,submitCommand:async()=>{creations++;assert.equal(core.creatingOptimisticSession,true);return {state:'pending'}},refreshSessions:async()=>{},selectSession:async id=>{state.selectedSessionId=id;state.newConversation=false;draft=''},accessApi:async path=>path.startsWith('/commands/by-request/')?{command:{state:'accepted_by_dsh',sessionId:'created-session'}}:{items:[]},updateFromCommand:()=>{if(!core.creatingOptimisticSession){state.selectedSessionId='created-session';draft=''}}};
  const api=env.WeftUiCore.factories.slashCommands(core,{readMessageDraft:()=>draft,restoreMainChatDraft:text=>{draft=text}}, {crypto:{randomUUID:()=> 'request-one'}});
  await api.listSlashCommands();assert.equal(draft,'/comp');
  assert.equal(state.attachmentDrafts.get('owner|created-session')[0],file);assert.equal(state.attachmentDrafts.has('owner|new'),false);
  assert.equal(creations,1);assert.equal(core.creatingOptimisticSession,false);
});
test('#659 temporary command discovery keeps the native temporary-session flag',async()=>{
  const env:any={setTimeout,WeftUiCore:{factories:{}}};runInNewContext(readFileSync('src/ui-core/slash-commands.js','utf8'),env);
  const state:any={ownerId:'owner',identityGeneration:1,activeChatSource:'desktop',newConversationId:'temporary-draft',newConversationTemporary:true,newConversationMode:'chat',mainChat:{chatId:'main'},selectedSessionId:null,attachmentDrafts:new Map()};
  let fields:any;
  const core:any={state,supportsChat:()=>true,openSideChat:async()=>{throw Error('side create does not accept temporary')},submitCommand:async(_kind,input)=>{fields=input;return {state:'accepted_by_dsh',sessionId:'temporary-session'}},refreshSessions:async()=>{},selectSession:async id=>{state.selectedSessionId=id},attachmentDraftKey:()=> 'empty',accessApi:async()=>({items:[]})};
  await env.WeftUiCore.factories.slashCommands(core,{readMessageDraft:()=> '/compact',restoreMainChatDraft:()=>{}},{crypto:{randomUUID:()=> 'temporary-request'}}).listSlashCommands();
  assert.equal(fields.temporary,true);assert.equal(state.selectedSessionId,'temporary-session');
});

test('#659 discovers scoped DSH commands and skills, and executes on the same resumed agent',async()=>{
  const calls:any[]=[],agent={session:{id:'s-one'}};
  const commands={list:(target:any)=>{assert.equal(target,agent);return [{name:'compact',description:'Compact history'},{name:'goal',description:'Set goal',input:{hint:'Goal'}}]},
    execute:async(target:any,line:string,signal:AbortSignal)=>{assert.equal(target,agent);assert.equal(signal.aborted,false);calls.push(line);return {commandId:'native-one',result:{kind:'success',text:'完成'}}}};
  const api=createNativeCommands({lifecycle:{resume:async id=>calls.push(id)},getAgent:()=>agent,getCommands:()=>commands,getTools:async target=>{assert.equal(target,agent);return [{name:'read_file',description:'Read a file',parameters:{privateSchema:'not exposed'}}]},
    client:{skills:{list:async value=>{assert.deepEqual(value,{sessionId:'s-one'});return {result:{ok:true,value:{skills:[{name:'review',description:'Review changes',modelInvocable:false}]}}}}}}});
  const catalog=await api.list('s-one');
  assert.deepEqual(catalog.items.map(row=>[row.name,row.kind]),[['compact','command'],['goal','command'],['review','skill']]);
  assert.deepEqual(catalog.tools,[{name:'read_file',description:'Read a file'}]);
  const result=await api.execute('s-one','/compact');assert.equal(result.result.kind,'success');
  assert.deepEqual(calls,['s-one','s-one','/compact']);
  await assert.rejects(api.execute('s-one','ordinary message'));
});

test('#659 Gateway and authenticated personal routes forward native command admission',async()=>{
  const ok=value=>({result:{ok:true,value}}),calls:any[]=[];
  const client={events:{},llm:{},settings:{},workspace:{},sessions:{list:async()=>ok({items:[{sessionId:'s-one'}]}),history:async()=>ok({events:[]})}};
  const gateway=createGatewayV1({client,nativeCommands:{list:async id=>({items:[{name:'compact',description:id,kind:'command'}]}),execute:async(id,line)=>{calls.push([id,line]);return {commandId:'native-one',result:{kind:'success'}}}}});
  const server=createServer((req,res)=>void gateway.handle(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const url=`http://127.0.0.1:${(server.address() as any).port}/weftmate/api/v1/sessions/s-one/slash-commands`;
    assert.equal((await (await fetch(url)).json()).items[0].name,'compact');
    assert.equal((await fetch(url,{method:'POST',body:JSON.stringify({line:'/compact'})})).status,200);
    assert.deepEqual(calls,[['s-one','/compact']]);
  }finally{await gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
  const temp=await mkdtemp(join(tmpdir(),'weftmate-slash-test-'));
  const previous=process.env.WEFTMATE_MANAGED_TEMP_ROOT;if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=temp;
  const fixture=await startFixture();
  try {
    fixture.backend.listSlashCommands=async input=>({items:[{name:'compact',description:input.sessionId,kind:'command'}]});
    fixture.backend.executeSlashCommand=async input=>{calls.push(input.line);return {result:{kind:'success'}}};
    const path=`/sessions/${fixture.source}/slash-commands`;
    assert.equal((await fixture.request(path)).items[0].description,fixture.source);
    await fixture.request(path,{line:'/goal finish'});assert.equal(calls.at(-1),'/goal finish');
    fixture.backend.executeSlashCommand=async()=>{await new Promise(resolve=>setTimeout(resolve,31000));return {result:{kind:'success',text:'压缩完成'}}};
    assert.equal((await fixture.request(path,{line:'/compact'})).result.kind,'success','native compaction may outlast the ordinary 30-second backend dispatch');
    await assert.rejects(fixture.request(path,{line:'ordinary text'}),{status:400});
    await assert.rejects(fixture.request(path+'?ownerId=other'),{status:400});
    await assert.rejects(fixture.request('/sessions/not-owned/slash-commands'),{status:404});
    await fixture.request(`/sessions/${fixture.source}/archive`,{});
    await assert.rejects(fixture.request(path,{line:'/compact'}),{status:404});
  }finally{await fixture.close();await rm(temp,{recursive:true,force:true});if(previous===undefined)delete process.env.WEFTMATE_MANAGED_TEMP_ROOT;else process.env.WEFTMATE_MANAGED_TEMP_ROOT=previous;}
});
