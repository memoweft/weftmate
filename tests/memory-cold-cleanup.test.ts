// 保护：旧会话的模型/预设无法启动时，删除、安排与目标清理仍须按存储记录完成。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,lstat,unlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {phoneRuntime} from '../services/cloud/test/relay-phone-runtime.mjs';
import {createPersonalAccessService} from './helpers/personal-access-test-service.mjs';
import {createNativeGoalManager} from '../src/personal-access/goals-native.mjs';
import {createNativeScheduleManager} from '../src/personal-access/schedules-native.mjs';
async function links(dir){for(const item of await readdir(dir,{withFileTypes:true})){const p=join(dir,item.name);if((await lstat(p)).isSymbolicLink())await unlink(p);else if(item.isDirectory())await links(p);}}
test('cold cleanup and deletion work with an unloadable agent preset and without inference', {timeout:60000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'cold-cleanup-')),logs=[];let runtime,host;
 try {
  runtime=await phoneRuntime(root,logs,{respond:()=>({content:'synthetic reply'})});
  host=await createPersonalAccessService({root:join(root,'account'),port:0,backend:runtime.backend});runtime.setHost(host);
  const origin=await runtime.start();await host.start();
  const id='session-'+randomUUID();await runtime.backend.createSession({sessionId:id,modelProfileId:'synthetic',ownerId:host.ownerId});
  await runtime.backend.cleanupMemoryCopies({sessionId:id,sourceTexts:[],deleteConversationSnippets:false});
  const preset=join(root,'dsh-home/.agent-presets/personal-remote/agent.cordis.yml');
  await writeFile(preset,'- name: missing-cleanup-test-module\n');
  const failed=await fetch(origin+'/weftmate/api/v1/sessions/'+id+'/models');assert.notEqual(failed.status,200);
  const calls=runtime.requests.length;
  await runtime.backend.schedules({sessionId:id,ownerId:host.ownerId,action:'forget',sourceTexts:['synthetic'],receiptIds:[]});
  await runtime.backend.goals({sessionId:id,ownerId:host.ownerId,action:'forget',sourceTexts:['synthetic'],receiptIds:[]});
  await runtime.backend.cleanupMemoryCopies({sessionId:id,sourceTexts:['synthetic'],deleteConversationSnippets:true});
  assert.equal((await runtime.backend.deleteSession({sessionId:id,ownerId:host.ownerId})).deleted,true);
  assert.equal(runtime.requests.length,calls);
 } catch(error){console.error(logs.slice(-12).join('\n'));throw error;}
 finally {await runtime?.close();await host?.close();await links(root);await rm(root,{recursive:true,force:true});}
});
test('storage-only cleanup writes valid native goal and schedule tombstones without agent services',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cold-domain-cleanup-'));
 const goalNative=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-goal/lib/index.js');
 const scheduleNative=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-schedule/lib/index.js');
 const now=Date.parse('2026-10-31T00:00:00Z'),events:any[]=[];
 const session={header:{seedLength:0},events,append(type,data){events.push({seq:events.length,type,data,time:now});}};
 const agent={id:'session-cold',session};let modelAccess=0;
 const ctx={get(){modelAccess++;throw Error('model-scoped service unavailable');},sessions:{flush:async()=>true},tools:{get(){modelAccess++;throw Error('tool unavailable');}}};
 try {
  session.append('goal/change',{kind:'goal/change',version:1,operation:'create',goal:{id:'goal-synthetic',revision:1,objective:'synthetic fact',phase:'active',maxGoalRounds:1},roundsStarted:0,createdAt:now,updatedAt:now});
  const goals=await createNativeGoalManager({ctx,foldGoal:goalNative.foldGoal,file:join(root,'goals.json')});
  await goals.manage(agent,{action:'forget',sourceTexts:['synthetic fact']},{storageOnly:true});
  assert.equal(goalNative.foldGoal(events).goal,undefined);
  const record=scheduleNative.createAtScheduleRecord('schedule-synthetic','synthetic fact',{date:'2026-10-31',time:'00:01:00',time_zone:'UTC'},now);
  session.append('schedule/change',{version:1,operation:'create',schedule:record});
  const schedules=await createNativeScheduleManager({ctx,native:scheduleNative,file:join(root,'schedules.json'),request:async()=>({timeZone:'UTC'})});
  await schedules.register(agent,record,'source');
  await schedules.manage(agent,'forget',null,{sourceTexts:['synthetic fact']},{storageOnly:true});
  assert.equal(scheduleNative.foldScheduleEvents(events).active.length,0);assert.equal(modelAccess,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
