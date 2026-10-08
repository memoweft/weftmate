import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryCommandJournal } from '../src/personal-memory/journal.mjs';
test('source snippet cleanup survives restart, keeps its switch identity, and erases its own copy',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fg-journal-')),ownerId='owner-00000000-0000-4000-8000-000000000001';
  const proposal={ownerId,requestId:'erase-1',operation:'delete_evidence',targetKind:'evidence',targetId:'e-1',expectedWorldRevision:1,payload:{delete_conversation_snippets:true},deleteConversationSnippets:true};
  try{
    let journal=createMemoryCommandJournal({root});
    const marker=await journal.reserve({...proposal,cleanup:{sourceTexts:['FGPrivateOriginal'],deleteConversationSnippets:true}});await journal.close();
    journal=createMemoryCommandJournal({root});
    assert.deepEqual((await journal.reserve(proposal)).cleanup,marker.cleanup);
    await assert.rejects(journal.reserve({...proposal,deleteConversationSnippets:false}),{code:'MEMORY_REQUEST_CONFLICT'});
    await journal.clearCleanup(ownerId,proposal.requestId);await journal.close();
    assert.doesNotMatch(await readFile(join(root,'accounts',ownerId,'memory-home','command-journal.json'),'utf8'),/FGPrivateOriginal/);
  }finally{await rm(root,{recursive:true,force:true})}
});


import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
test('entity snippet opt-in follows related provenance when its direct source list is empty',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fg-entity-')),owner='owner-00000000-0000-4000-8000-000000000001';
  const methods=['initialize','capabilities','health','shutdown','ingest_boundary','preview_recall','query_interactions','query_world','query_evidence','query_provenance','submit_command','query_command_receipt','retry_delete_storage_cleanup'];
  const rpc:any={child:{},request:async(method:string,params:any={})=>{
    if(method==='capabilities')return {protocol:'memoweft.dsh_rpc',protocol_version:2,schema_version:1,methods};
    if(method==='initialize')return {runtime:{subject_id:owner,db_path:join(params.dsh_home,'memoweft','memoweft.sqlite3')},capabilities:{subject_id:owner,services:{command:{operations:['delete_world_item']}}}};
    if(method==='health')return {runtime:{subject_id:owner,route_ready:true}};
    if(method==='query_command_receipt')throw Object.assign(new Error('missing'),{code:'command_receipt_not_found'});
    if(method==='query_world')return {world_revision:1,items:params.object_kind==='relationship'?[{item_id:'rel',value:{target_entity_id:'person'}}]:[]};
    if(method==='query_provenance')return {provenance:params.object_kind==='entity'?[]:[{evidence:{raw_content:'FGEntityOriginal'}}]};
    if(method==='submit_command')return {receipt:{result_state:'applied',command_id:params.command.command_id,after_revision:2,affected_ids:['person','rel','evidence'],storage_cleanup:{state:'complete'}}};
    return {};
  },close:async()=>{rpc.child=null}};
  const cleaned:any[]=[];
  const manager=createPersonalMemoryManager({root,enabled:true,python:join(root,'python.exe'),pythonPath:root,baseUrl:'http://127.0.0.1:1/v1',model:'@current',credential:()=> 'synthetic',rpcFactory:()=>rpc,cleanupDeletedMemory:async(_owner:string,options:any)=>cleaned.push(options)});
  try{await manager.submitCommand(owner,{requestId:'forget-person',operation:'delete_world_item',targetKind:'entity',targetId:'person',expectedWorldRevision:1,payload:{delete_conversation_snippets:true},deleteConversationSnippets:true});
    assert.deepEqual(cleaned[0].sourceTexts,['FGEntityOriginal']);assert.equal(cleaned[0].deleteConversationSnippets,true);
    assert.doesNotMatch(await readFile(join(root,'accounts',owner,'memory-home','command-journal.json'),'utf8'),/FGEntityOriginal/);
  }finally{await manager.close();await rm(root,{recursive:true,force:true})}
});
