import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs';

test('all-type memory paging keeps owner/revision/filter cursors and links native source evidence to conversations', async () => {
  const calls: any[]=[];
  const manager={query:async(ownerId:string,method:string,params:any)=>{
    calls.push({ownerId,method,params});
    if(method==='query_jobs')return {world_revision:7,jobs:[{acceptance:{evidence_ids:['e1'],parent_session_id:'synthetic-session'}}]};
    return {world_revision:7,items:[{item_id:'shared-id',object_kind:params.object_kind,value:{content:params.object_kind+' synthetic'},current_state:'current',updated_at:'2026-10-10',provenance:[{evidence_id:'e1'}]}]};
  }};
  async function read(query:string){const url=new URL('http://localhost/personal/v1/memory/items?'+query);return handlePersonalMemoryHttp({manager,ownerId:'owner-a',request:{method:'GET'},pathname:url.pathname,url,readJson:async()=>({})} as any)}
  const first=await read('kind=all&limit=2&includeSources=true');
  assert.equal(first.body.totalCount,4);assert.equal(first.body.items.length,2);assert.equal(first.body.hasMore,true);
  assert.deepEqual(first.body.items[0].sourceConversationIds,['synthetic-session']);
  const second=await read('kind=all&limit=2&includeSources=true&after='+first.body.nextCursor);
  assert.equal(second.body.hasMore,false);assert.equal(new Set([...first.body.items,...second.body.items].map((i:any)=>i.kind+':'+i.id)).size,4);
  await assert.rejects(read('kind=entity&after='+first.body.nextCursor),{code:'INVALID_REQUEST'});
  const filtered=await read('kind=all&query=relationship');assert.equal(filtered.body.items.length,1);assert.equal(filtered.body.items[0].kind,'relationship');
  assert.ok(calls.every(call=>call.ownerId==='owner-a'));
});

test('all-type memory snapshot refuses mixed world revisions',async()=>{
  const manager={query:async(_:string,__:string,p:any)=>({world_revision:p.object_kind==='entity'?8:7,items:[]})};
  const url=new URL('http://localhost/personal/v1/memory/items?kind=all');
  await assert.rejects(handlePersonalMemoryHttp({manager,ownerId:'owner-a',request:{method:'GET'},pathname:url.pathname,url,readJson:async()=>({})} as any),{code:'MEMORY_REVISION_CHANGED'});
});
