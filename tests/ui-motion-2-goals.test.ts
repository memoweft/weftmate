import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/ui-core/goals.js',import.meta.url),'utf8');
function setup(){
  const sandbox:any={WeftUiCore:{factories:{}}};runInNewContext(source,sandbox);
  const waiting=new Map<string,any>(),frames:any[]=[];
  const core:any={state:{identityGeneration:1,ownerId:'synthetic',personalCapabilities:{taskOverview:1,scheduleEditing:1,goals:1}},failureMessage:error=>error.message,
    accessApi:path=>new Promise((resolve,reject)=>waiting.set(path,{resolve,reject}))};
  Object.assign(core,sandbox.WeftUiCore.factories.goals(core,{renderGoals(){if(core.goalsPage)frames.push(JSON.parse(JSON.stringify(core.goalsPage)));}},{desktop:false}));
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const finish=async()=>{for(const [path,p]of waiting)p.resolve(path==='/tasks'?{items:[],recent:[]}:{items:[]});await flush();};
  return {core,waiting,frames,flush,finish};
}
test('goal sections settle independently; confirmed empty results survive refresh and recover after errors',async()=>{
  const {core,waiting,flush,finish}=setup();const first=core.readGoals();await flush();
  waiting.get('/schedules').resolve({items:[]});await flush();
  assert.equal(core.goalsPage.loaded?.schedules,true,'fast empty schedules must settle while tasks/sessions are pending');
  assert.equal(core.goalsPage.pending.schedules,false);assert.equal(core.goalsPage.pending.tasks,true);
  await finish();await first;
  const refresh=core.readGoals();await flush();
  assert.equal(core.goalsPage.loaded.schedules,true,'refresh must retain the known empty result');
  waiting.get('/schedules').reject(Error('synthetic failure'));await flush();
  assert.equal(core.goalsPage.errors.schedules,'synthetic failure');assert.equal(core.goalsPage.pending.schedules,false);
  await finish();await refresh;
  const recovery=core.readGoals();await flush();waiting.get('/schedules').resolve({items:[{id:'recovered'}]});await flush();
  assert.equal(core.goalsPage.schedules[0].id,'recovered');assert.equal(core.goalsPage.errors.schedules,undefined);
  await finish();await recovery;
});
test('identity reset discards late goal results and leaves the new request in control',async()=>{
  const {core,waiting,flush,finish}=setup();const old=core.readGoals();await flush();const oldRequests=new Map(waiting),stale=waiting.get('/goals');
  core.state.identityGeneration++;const current=core.readGoals();await flush();
  stale.resolve({items:[{id:'old-owner'}]});await flush();
  assert.equal(core.goalsPage.goals.length,0);assert.equal(core.goalsPage.pending?.goals,true);
  await finish();await current;
  for(const [path,p]of oldRequests)p.resolve(path==='/tasks'?{items:[],recent:[]}:{items:[]});await old;
  assert.equal(core.goalsPage.loaded.goals,true);assert.equal(core.goalsPage.loading,false);
});
test('a fast task refresh retains known offline provenance while sibling reads are pending',async()=>{
  const sandbox:any={WeftUiCore:{factories:{}}};runInNewContext(source,sandbox);let hold=false;const releases:Function[]=[];
  const core:any={state:{identityGeneration:1,ownerId:'synthetic',personalCapabilities:{taskOverview:1,scheduleEditing:1,goals:1}},failureMessage:error=>error.message,
    accessApi:async path=>{
      if(path==='/tasks')return {items:[{taskId:'phone-task',title:'合成离线任务'}],recent:[]};
      if(path.startsWith('/commands?'))return {commands:[{commandId:'phone-task',offlineSource:{id:'offline-source'}}],hasMore:false};
      if(hold)return new Promise(resolve=>releases.push(()=>resolve({items:[]})));
      return {items:[]};
    }};
  Object.assign(core,sandbox.WeftUiCore.factories.goals(core,{}, {desktop:true}));await core.readGoals();
  hold=true;const pending=core.readGoals();for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(core.goalsPage.pending.tasks,false);assert.equal(core.goalsPage.loading,true);
  assert.equal(core.goalsPage.tasks[0].offlineSource?.id,'offline-source','known provenance must survive the first independently committed task frame');
  for(const release of releases)release();await pending;
});
