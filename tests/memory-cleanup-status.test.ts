// 保护：状态读取与遗忘清理交错时，不能在聊天副本尚未清完就显示就绪并允许召回。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalMemoryManager} from '../src/personal-memory/index.mjs';

test('a status read started before cleanup still reports the active cleanup at completion',{timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-status-race-')),owner='owner-00000000-0000-4000-8000-000000000001';
  const healthStarted=Promise.withResolvers<void>(),healthRelease=Promise.withResolvers<void>();
  const cleanupStarted=Promise.withResolvers<void>(),cleanupRelease=Promise.withResolvers<void>();
  let holdHealth=false,receipt:any,deleted:Promise<any>|undefined;
  const methods=['initialize','capabilities','health','shutdown','ingest_boundary','preview_recall','query_interactions',
    'query_world','query_evidence','query_provenance','submit_command','query_command_receipt','retry_delete_storage_cleanup'];
  const manager=createPersonalMemoryManager({root,enabled:true,python:join(root,'python'),pythonPath:root,
    baseUrl:'http://127.0.0.1:1/v1',model:'@current',credential:()=> 'synthetic',
    cleanupDeletedMemory:async()=>{cleanupStarted.resolve();await cleanupRelease.promise;return {snippetsVerified:true};},
    rpcFactory:()=>({child:{},async close(){},async request(method,params={}){
      if(method==='capabilities')return {protocol:'memoweft.dsh_rpc',protocol_version:2,schema_version:1,methods};
      if(method==='initialize')return {runtime:{subject_id:owner,db_path:join(params.dsh_home,'memoweft/memoweft.sqlite3')},capabilities:{subject_id:owner,methods,services:{command:{operations:['delete_world_item']}}}};
      if(method==='health'){if(holdHealth){holdHealth=false;healthStarted.resolve();await healthRelease.promise;}return {runtime:{subject_id:owner,route_ready:true}};}
      if(method==='query_world')return {world_revision:1,items:[]};
      if(method==='query_provenance')return {provenance:[{evidence:{evidence_id:'tea-source',raw_content:'synthetic tea'}}]};
      if(method==='submit_command')receipt={command_id:params.command.command_id,result_state:'applied',after_revision:2,affected_ids:['tea'],storage_cleanup:{state:'complete'}};
      if(method==='query_command_receipt'&&!receipt)throw Object.assign(Error('missing'),{code:'command_receipt_not_found'});
      return {receipt};
    }})});
  try{
    await manager.status(owner);holdHealth=true;const status=manager.status(owner);await healthStarted.promise;
    deleted=manager.submitCommand(owner,{requestId:'delete-tea',operation:'delete_world_item',targetKind:'cognition',targetId:'tea',expectedWorldRevision:1,payload:{}});
    await cleanupStarted.promise;healthRelease.resolve();const during=await status;
    assert.equal(during.state,'degraded');assert.equal(during.capabilities.inject,false);assert.equal(during.pendingCleanup[0].requestId,'delete-tea');
  }finally{healthRelease.resolve();cleanupRelease.resolve();await deleted;await manager.close();await rm(root,{recursive:true,force:true});}
});
