import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function load(name: string, core: any) {
  const context: any={WeftUiCore:{factories:{}},URLSearchParams,Date};
  vm.runInNewContext(await readFile(new URL(`../src/ui-core/${name}.js`,import.meta.url),'utf8'),context);
  Object.assign(core,context.WeftUiCore.factories[name](core,{renderGoals(){},renderLibrary(){},renderActivity(){}},{crypto:{randomUUID:()=> 'synthetic-request'}}));
  return core;
}
test('a failed goals refresh retains the last readable result with an error',async()=>{
  let fail=false;
  const core=await load('goals',{state:{identityGeneration:1,ownerId:'synthetic',personalCapabilities:{taskOverview:1,scheduleEditing:1,goals:1}},failureMessage:()=> '暂时无法连接',accessApi:async(path:string)=>{if(fail)throw Error('synthetic offline');return {items:path==='/tasks'?[{taskId:'task',title:'整理计划'}]:[],recent:[],timeZone:'Asia/Shanghai'};}});
  await core.readGoals();fail=true;await core.readGoals();
  assert.equal(core.goalsPage.tasks[0]?.title,'整理计划');assert.equal(core.goalsPage.errors.tasks,'暂时无法连接');assert.equal(core.goalsPage.loading,false);
});
test('library filtering retains the previous files until the new response is ready',async()=>{
  let pending:((value:any)=>void)|undefined;
  const core=await load('library',{state:{identityGeneration:1,ownerId:'synthetic',personalCapabilities:{library:1}},failureMessage:()=> '读取失败',accessApi:async()=>pending?new Promise(resolve=>{pending=resolve;}):{items:[{id:'old'}],projects:[],total:1,nextCursor:null}});
  await core.readLibrary();pending=()=>{};const changing=core.setLibraryFilter('type','document');
  assert.equal(core.library.items[0]?.id,'old');assert.equal(core.library.loading,true);
  pending!({items:[{id:'new'}],projects:[],total:1,nextCursor:null});await changing;
  assert.equal(core.library.items[0].id,'new');assert.equal(core.library.loading,false);
});
