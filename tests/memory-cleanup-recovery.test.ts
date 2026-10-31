// 保护：界面删除留下的清理日记必须自行恢复，不能依赖已被门禁阻断的新聊天来唤醒。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMemoryCommandJournal} from '../src/personal-memory/journal.mjs';
import {createPersonalMemoryManager} from '../src/personal-memory/index.mjs';
const owner='owner-00000000-0000-4000-8000-000000000001';
test('redaction of an older rejected request can finish without applying that request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'memory-rejected-redaction-'));let attempts=0;
 const journal=createMemoryCommandJournal({root,prepareCleanup:async()=>({conversationTargets:[]}),eraseSnippets:async()=>{
  if(++attempts===1)throw Error('transient copy failure');return {snippetsVerified:true};}});
 try {
  await journal.reserve({ownerId:owner,requestId:'rejected-request',operation:'delete_evidence',targetKind:'evidence',targetId:'old',expectedWorldRevision:1,payload:{},cleanup:{sourceTexts:['shared source'],deleteConversationSnippets:true}});
  await journal.redactTargets(owner,['old'],{sourceTexts:['shared source']});
  assert.equal((await journal.get(owner,'rejected-request')).cleanup.snippetsPending,true);
  await journal.retryPendingRedaction(owner,'rejected-request');
  const result=await journal.get(owner,'rejected-request');
  assert.equal(result.cleanup.snippetsPending,undefined);assert.equal(result.cleanupCompleted,undefined);
  assert.equal(result.command.target_id,'old');assert.equal(attempts,2);
 }finally{await journal.close();await rm(root,{recursive:true,force:true});}
});
test('startup resumes an applied direct deletion without a new turn or a model request', {timeout:20000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'memory-direct-recovery-'));let manager,cleanups=0,submits=0;
 const journal=createMemoryCommandJournal({root});
 try {
  const marker=await journal.reserve({ownerId:owner,requestId:'direct-delete',operation:'delete_world_item',targetKind:'cognition',targetId:'old',expectedWorldRevision:1,payload:{},cleanup:{sourceTexts:['synthetic old fact'],deleteConversationSnippets:false}});
  await mkdir(join(root,'accounts',owner,'memory-home/memoweft'),{recursive:true});
  await writeFile(join(root,'accounts',owner,'memory-home/memoweft/memoweft.sqlite3'),'synthetic RPC fixture');
  const methods=['initialize','capabilities','health','shutdown','ingest_boundary','preview_recall','query_interactions',
    'query_world','query_evidence','query_provenance','submit_command','query_command_receipt','retry_delete_storage_cleanup'];
  manager=createPersonalMemoryManager({root,enabled:true,python:join(root,'synthetic-python'),pythonPath:root,
    baseUrl:'http://127.0.0.1:1/v1',model:'@current',credential:()=> 'synthetic',
    cleanupDeletedMemory:async()=>{if(++cleanups===1)throw Error('transient cleanup failure');return {snippetsVerified:true};},
    rpcFactory:()=>({child:{},async close(){},async request(method,params:any={}){
      if(method==='capabilities')return {protocol:'memoweft.dsh_rpc',protocol_version:2,schema_version:1,methods};
      if(method==='initialize')return {runtime:{subject_id:owner,db_path:join(params.dsh_home,'memoweft/memoweft.sqlite3')},capabilities:{subject_id:owner,methods,services:{command:{operations:['delete_world_item']}}}};
      if(method==='health')return {runtime:{subject_id:owner,route_ready:false}};
      if(method==='query_world')return {items:[],world_revision:2};
      if(method==='submit_command'){submits++;throw Error('must not delete again');}
      if(method==='query_command_receipt')return {receipt:{command_id:marker.command.command_id,result_state:'applied',after_revision:2,affected_ids:['old'],storage_cleanup:{state:'complete'}}};
      return {};
    }})});
  const end=Date.now()+12000;while(Date.now()<end && !(await journal.get(owner,'direct-delete')).cleanupCompleted)await new Promise(r=>setTimeout(r,50));
  assert.equal((await journal.get(owner,'direct-delete')).cleanupCompleted,true);
  assert.equal(cleanups,2);assert.equal(submits,0);
 } finally {await manager?.close();await journal.close();await rm(root,{recursive:true,force:true});}
});
