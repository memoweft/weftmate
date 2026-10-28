import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/ui-core/goals.js',import.meta.url),'utf8');
test('desktop goals joins paginated existing command provenance and keeps cancellation on the task API',async()=>{
  const sandbox:any={WeftUiCore:{factories:{}}};runInNewContext(source,sandbox);
  const calls:any[]=[],core:any={state:{identityGeneration:1,ownerId:'owner',personalCapabilities:{taskOverview:1,scheduleEditing:1,goals:1}},
    failureMessage:()=> '读取失败',accessApi:async(path,options)=>{calls.push([path,options]);
      if(path==='/tasks')return {items:[{taskId:'phone-task',status:'queued'}],recent:[]};
      if(path==='/commands?limit=100')return {commands:[{commandId:'other'}],nextBefore:'other',hasMore:true};
      if(path==='/commands?limit=100&before=other')return {commands:[{commandId:'phone-task',offlineSource:{id:'offline-1',submittedAt:'2026-10-27T00:00:00Z'}}],hasMore:false};
      return {items:[]};}};
  Object.assign(core,sandbox.WeftUiCore.factories.goals(core,{}, {desktop:true,crypto:{randomUUID:()=> 'cancel-1'}}));
  await core.readGoals();assert.equal(core.goalsPage.tasks[0].offlineSource.id,'offline-1');
  await core.stopOverviewTask(core.goalsPage.tasks[0]);
  const write=calls.find(([path])=>path==='/tasks/phone-task/stop');
  assert.equal(write[1].body.requestId,'cancel-1');assert.equal(write[1].protectedWrite,true);
  assert.equal(calls.filter(([path])=>path.startsWith('/commands?')).length,2,'immutable source metadata is retained across overview refreshes');
});
