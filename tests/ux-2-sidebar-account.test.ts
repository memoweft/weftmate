import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createSessionMetadata} from '../src/personal-access/session-metadata.mjs';
function factory(name:string){const context:any={WeftUiCore:{factories:{}},URLSearchParams,Intl,Date};runInNewContext(readFileSync(new URL(`../src/ui-core/${name}.js`,import.meta.url),'utf8'),context);return context.WeftUiCore.factories[name];}
test('project expansion is per project and account, survives recreation and storage refusal is harmless',()=>{
  const storage=new Map(),environment={storage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)}};
  const core:any={state:{ownerId:'a'},sessionList:()=>[]};const create=factory('sessions'),actions=create(core,{},environment);
  assert.equal(actions.projectExpanded('one'),false);actions.setProjectExpanded('one',true);
  assert.equal(actions.projectExpanded('two'),false);assert.equal(create(core,{},environment).projectExpanded('one'),true);
  core.state.ownerId='b';assert.equal(actions.projectExpanded('one'),false);core.state.ownerId='a';actions.setProjectExpanded('one',false);assert.equal(actions.projectExpanded('one'),false);
  const blocked=create(core,{}, {storage:{getItem(){throw Error()},setItem(){throw Error()}}});assert.equal(blocked.projectExpanded('one'),false);assert.doesNotThrow(()=>blocked.setProjectExpanded('one',true));assert.equal(blocked.projectExpanded('one'),true);
});
test('projects show newest activity first, include fallback times and exclude archived or other projects',()=>{
  const core:any={state:{},sessionList:()=>[]},actions=factory('sessions')(core,{},{});
  const rows=[{sessionId:'old',projectId:'p',updatedAt:'2026-10-01'}, {sessionId:'new',projectId:'p',lastMessageAt:'2026-10-10'}, {sessionId:'created',projectId:'p',createdAt:'2026-10-05'}, {sessionId:'archived',projectId:'p',archived:true,updatedAt:'2026-10-11'}, {sessionId:'other',projectId:'q'}, {sessionId:'unknown',projectId:'p'}];
  assert.deepEqual(Array.from(actions.projectConversations('p',rows),(row:any)=>row.sessionId),['new','created','old','unknown']);
});
test('usage strip honors effective temporary limit, zero / exceeded limits and unknown pricing',()=>{
  const actions=factory('usage')({},{}),text=(cost:number,limit:number|null,unknown=0)=>actions.usageStripText({total:{cost,requests:7,unpricedRequests:unknown},budget:{effectiveLimit:limit}});
  assert.equal(text(3.2,10),'本月 ¥3.20 · 上限剩余 68%');assert.equal(text(3.2,null),'本月 ¥3.20 · 7 次请求');
  assert.equal(text(12,10),'本月 ¥12.00 · 上限剩余 0%');assert.equal(text(0,0),'本月 ¥0.00 · 上限剩余 0%');assert.match(text(0,null,1),/部分请求未计价/);
});
test('usage strip discards a late response when account identity changes',async()=>{
  let ownerId='a',finish:any;const core:any={accountToken:()=>({ownerId,generation:1}),accessApi:()=>new Promise(resolve=>finish=resolve)};
  const actions=factory('usage')(core,{}),pending=actions.loadUsageStrip();ownerId='b';finish({total:{cost:99,requests:1},budget:{effectiveLimit:null}});assert.equal(await pending,null);
});
test('usage strip reads the budget time zone and rejects account changes during its summary request',async()=>{
  let ownerId='a',finish:any;const routes:string[]=[];
  const core:any={accountToken:()=>({ownerId,generation:1}),accessApi:(route:string)=>{routes.push(route);return route==='/settings/usage'?Promise.resolve({timeZone:'America/New_York'}):new Promise(resolve=>finish=resolve)}};
  const actions=factory('usage')(core,{}),pending=actions.loadUsageStrip();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(routes,['/settings/usage','/usage?timeZone=America%2FNew_York']);ownerId='b';finish({total:{cost:99,requests:1},budget:{effectiveLimit:null}});assert.equal(await pending,null);
});
test('session activity is latest actual history time, falls back to attachment and ignores malformed event dates',async()=>{
  const metadata:any={ownerId:'a',attachedAt:'2026-10-01T00:00:00.000Z'},events:any[]=[{seq:1,at:'2026-10-05T00:00:00.000Z'},{seq:2,at:'invalid'}];
  const context:any={accountState:()=>({sessions:{s:metadata}}),callBackend:(fn:any)=>fn(),backend:{readEvents:async()=>({events})}};
  const operations=createSessionMetadata(context);await operations.initialize('a');assert.equal((await operations.summary('a','s')).updatedAt,'2026-10-05T00:00:00.000Z');events.length=0;operations.invalidate('a','s');assert.equal((await operations.summary('a','s')).updatedAt,metadata.attachedAt);
});
