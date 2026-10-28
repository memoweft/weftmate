// Synthetic adapter for the real authenticated memory routes; never forms memory.
export function createPagesMemoryFixture() {
  let revision=1,text='周末喜欢留出不赶时间的空白。',muted=false,deleted=false;
  const receipts=new Map(),at='2026-10-27T08:00:00Z';
  const item=()=>({item_id:'ios-ui-memory',object_kind:'cognition',current_state:'current',created_at:at,updated_at:at,
    lifecycle:muted?{muted_at:at}:{},value:{content:text},provenance:[{evidence_id:'ios-ui-source'}]});
  const missing=()=>{throw Object.assign(new Error('Synthetic source missing'),{code:'world_item_not_found'});};
  return {
    enabled:true,
    status:async()=>({state:'ready',worldRevision:revision,capabilities:{list:true,source:true,correct:true,mute:true,inject:false,deleteEvidence:true,deleteWorldItem:true}}),
    peek:()=> 'connected',
    query:async(_owner,method,input)=>{
      if(method==='query_jobs')return {world_revision:revision,jobs:[]};
      if(method==='query_world') {
        if(input.operation==='revision')return {world_revision:revision};
        if(input.operation==='get')return deleted?missing():{world_revision:revision,item:item()};
        return {world_revision:revision,items:!deleted&&input.object_kind==='cognition'?[item()]:[]};
      }
      if(method==='preview_forget')return {world_revision:revision,item_count:1,evidence_count:1,evidence_ids:['ios-ui-source'],items:[{item_id:'ios-ui-memory',object_kind:'cognition',name:text,item_type:'preference'}]};
      if(method==='query_provenance')return {world_revision:revision,provenance:[{evidence_id:'ios-ui-source',relation:'supports',currentness_state:'current',permissions:{allow_local_read:true,allow_cloud_read:false,allow_inference:true},evidence:{content_available:true,summary:'这周末想少安排一点',raw_content:'留出一个不赶时间的上午。',recorded_at:at}}]};
      throw new Error('Unexpected synthetic memory query');
    },
    checkForgetCompletion:async()=>({state:'complete',worldRevision:revision}),
    submitCommand:async(_owner,command)=>{
      if(receipts.has(command.requestId))return receipts.get(command.requestId);
      if(command.expectedWorldRevision!==revision)return {result_state:'revision_conflict',after_revision:revision,command_id:'synthetic-'+command.requestId};
      if(command.operation==='correct_world_item')text=command.payload.correction_text;
      if(command.operation==='mute_world_item')muted=true;
      if(command.operation.startsWith('delete_'))deleted=true;
      revision++;
      const receipt={result_state:'applied',after_revision:revision,command_id:'synthetic-'+command.requestId,
        ...(command.operation.startsWith('delete_')?{storage_cleanup:{state:'pending',detail_code:'wal_reader_busy'}}:{})};
      receipts.set(command.requestId,receipt);return receipt;
    },
    receiptByRequest:async(_owner,id)=>{if(receipts.has(id))return receipts.get(id);throw Object.assign(new Error('Synthetic receipt missing'),{code:'command_receipt_not_found'});},
    retryCleanupByRequest:async(_owner,id)=>{
      const receipt=receipts.get(id)??missing();receipt.storage_cleanup={state:'complete',detail_code:'current_wal_truncated'};return receipt;
    },
  };
}
