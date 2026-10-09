import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs';
const item = (id, content) => ({ item_id:id, object_kind:'cognition', value:{content}, current_state:'current', provenance:[] });
function fixture() {
  let revision = 1, forgotten = false;
  const manager = { status: async () => ({state:'ready',capabilities:{list:true}}),
    query: async (owner, method, params) => {
      assert.equal(owner,'owner-test');
      if(method==='query_world' && params.operation==='revision') return {world_revision:revision};
      if(method==='query_world') return {world_revision:revision,items:params.object_kind==='cognition'?[item('kept','保留的理解'),...forgotten?[]:[item('forgotten','FGPrivateMemory')]]:[]};
      assert.equal(method,'query_provenance');
      return {world_revision:revision,provenance:[{evidence_id:'e-'+params.item_id,currentness_state:'current',evidence:{content_available:true,summary:params.item_id==='forgotten'?'FGPrivateMemory来源':'保留的来源摘要'}}]};
    } };
  return {manager, forget(){forgotten=true;revision++;},changeRevision(){revision++;}};
}
const exported = (f,format) => handlePersonalMemoryHttp({manager:f.manager,ownerId:'owner-test',request:{method:'GET'},pathname:'/personal/v1/memory/export',url:new URL('http://fixture/personal/v1/memory/export?format='+format)});
test('memory exports include sources and exclude forgotten items in JSON and Markdown',async()=>{
  const f=fixture();assert.match((await exported(f,'json')).body.content,/FGPrivateMemory/);
  f.forget();
  for(const format of ['json','markdown']) {const result=await exported(f,format);assert.equal(result.status,200);assert.match(result.body.content,/保留的来源摘要/);assert.doesNotMatch(result.body.content,/FGPrivateMemory/);assert.equal(result.body.worldRevision,2);}
});
test('memory export rejects mixed revisions without returning a partial file',async()=>{
  const f=fixture(),query=f.manager.query;
  f.manager.query=async(...args)=>{const result=await query(...args);if(args[1]==='query_provenance')f.changeRevision();return result;};
  await assert.rejects(exported(f,'json'),{code:'MEMORY_REVISION_CHANGED'});
});
