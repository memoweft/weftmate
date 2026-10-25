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

test('#659 discovers scoped DSH commands and skills, and executes on the same resumed agent',async()=>{
  const calls:any[]=[],agent={session:{id:'s-one'}};
  const commands={list:(target:any)=>{assert.equal(target,agent);return [{name:'compact',description:'Compact history'},{name:'goal',description:'Set goal',input:{hint:'Goal'}}]},
    execute:async(target:any,line:string,signal:AbortSignal)=>{assert.equal(target,agent);assert.equal(signal.aborted,false);calls.push(line);return {commandId:'native-one',result:{kind:'success',text:'完成'}}}};
  const api=createNativeCommands({lifecycle:{resume:async id=>calls.push(id)},getAgent:()=>agent,getCommands:()=>commands,
    client:{skills:{list:async value=>{assert.deepEqual(value,{sessionId:'s-one'});return {result:{ok:true,value:{skills:[{name:'review',description:'Review changes',modelInvocable:false}]}}}}}}});
  const catalog=await api.list('s-one');
  assert.deepEqual(catalog.items.map(row=>[row.name,row.kind]),[['compact','command'],['goal','command'],['review','skill']]);
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
  const previous=process.env.WEFTMATE_MANAGED_TEMP_ROOT;process.env.WEFTMATE_MANAGED_TEMP_ROOT=temp;
  const fixture=await startFixture();
  try {
    fixture.backend.listSlashCommands=async input=>({items:[{name:'compact',description:input.sessionId,kind:'command'}]});
    fixture.backend.executeSlashCommand=async input=>{calls.push(input.line);return {result:{kind:'success'}}};
    const path=`/sessions/${fixture.source}/slash-commands`;
    assert.equal((await fixture.request(path)).items[0].description,fixture.source);
    await fixture.request(path,{line:'/goal finish'});assert.equal(calls.at(-1),'/goal finish');
    await assert.rejects(fixture.request(path,{line:'ordinary text'}),{status:400});
    await assert.rejects(fixture.request(path+'?ownerId=other'),{status:400});
    await assert.rejects(fixture.request('/sessions/not-owned/slash-commands'),{status:404});
    await fixture.request(`/sessions/${fixture.source}/archive`,{});
    await assert.rejects(fixture.request(path,{line:'/compact'}),{status:404});
  }finally{await fixture.close();await rm(temp,{recursive:true,force:true});if(previous===undefined)delete process.env.WEFTMATE_MANAGED_TEMP_ROOT;else process.env.WEFTMATE_MANAGED_TEMP_ROOT=previous;}
});
