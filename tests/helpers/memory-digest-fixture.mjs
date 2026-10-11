/** Synthetic memory bridge: same World and receipt shapes, no inference or private data. */
export function digestMemoryFixture(){
  let revision=1,ready=true;const receipts=new Map();
  const descriptions=['我周末喜欢去河边骑车。','我喝茶时不加糖。','我正在练习西班牙语。','周五留一小时整理读书笔记。','我习惯在上午处理需要专注的事。','出门时记得带折叠伞。','旅行时我更喜欢坐火车。','每周做两次力量训练。'];
  const rows=descriptions.map((content,i)=>({object_kind:'cognition',item_id:`week-${i}`,created_at:`2026-10-${String(5+i%6).padStart(2,'0')}T02:00:00Z`,updated_at:'2026-10-10T02:00:00Z',current_state:'current',value:{content,topic:i%2?'生活偏好':'学习与安排'},lifecycle:{},provenance:[]}));
  rows.push({object_kind:'cognition',item_id:'previous-week',created_at:'2026-10-02T00:00:00Z',updated_at:'2026-10-02T00:00:00Z',current_state:'current',value:{content:'上周我报名了摄影课。'},lifecycle:{},provenance:[]});
  rows.push({object_kind:'cognition',item_id:'old-bike',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',current_state:'current',value:{content:'我每周三晚上参加骑行小组。'},lifecycle:{},provenance:[]});
  rows.push({object_kind:'cognition',item_id:'old-book',created_at:'2026-01-02T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',current_state:'current',value:{content:'我习惯睡前读半小时纸质书。'},lifecycle:{},provenance:[]});
  rows.push({object_kind:'cognition',item_id:'obsolete',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',current_state:'current',value:{content:'我以前每周五参加线上读书会。'},lifecycle:{},provenance:[]});
  const get=id=>{const row=rows.find(row=>row.item_id===id);if(!row)throw Object.assign(new Error('world_item_not_found'),{code:'world_item_not_found'});return row;};
  const manager={enabled:true,peek:()=>ready?'ready':'degraded',status:async()=>({state:ready?'ready':'degraded',worldRevision:revision,capabilities:{list:true,source:true,correct:true,mute:true,deleteEvidence:true,deleteWorldItem:true,inject:false}}),
    query:async(_owner,method,params)=>{
      if(method==='query_world')return {world_revision:revision,...(params.operation==='list'?{items:rows.filter(row=>row.object_kind===params.object_kind)}:params.operation==='get'?{item:get(params.item_id)}:{})};
      if(method==='query_provenance')return {world_revision:revision,provenance:[]};
      if(method==='query_jobs')return {world_revision:revision,jobs:[]};
      if(method==='preview_forget'){const row=get(params.target_id);return {world_revision:revision,item_count:1,evidence_count:0,evidence_ids:[],items:[{object_kind:row.object_kind,item_id:row.item_id,name:row.value.content,item_type:'preference'}]};}
      throw Error(`Unexpected synthetic query ${method}`);
    },
    submitCommand:async(_owner,proposal)=>{
      if(receipts.has(proposal.requestId))return receipts.get(proposal.requestId);
      const row=get(proposal.targetId);let state='applied';
      if(proposal.expectedWorldRevision!==revision)state='revision_conflict';
      else{if(proposal.operation==='correct_world_item'){
          const created=proposal.requestId==='seed-correction'?'2026-10-11T12:00:00Z':'2026-10-11T14:00:00Z',replacement=`${row.item_id}-corrected-${revision}`;
          const transition={transition_id:`transition-${revision}`,transition_kind:'corrects',object_kind:row.object_kind,prior_item_id:row.item_id,replacement_item_id:replacement,occurred_at:null};
          row.current_state='not_current';row.lifecycle={invalid_at:created};row.transition_history=[...(row.transition_history??[]),transition];
          rows.push({...row,item_id:replacement,created_at:created,updated_at:created,current_state:'current',lifecycle:{},value:{...row.value,content:proposal.payload.correction_text},transition_history:[transition]});
        }
        if(proposal.operation==='delete_world_item')rows.splice(rows.indexOf(row),1);revision++;}
      const result={receipt:{command_id:`memory-${proposal.requestId}`,result_state:state,after_revision:revision,storage_cleanup:{state:'complete',detail_code:'current_wal_truncated'}},operation:proposal.operation};
      receipts.set(proposal.requestId,result);return result;
    },receiptByRequest:async(_owner,id)=>{if(!receipts.has(id))throw Object.assign(Error('missing'),{code:'command_receipt_not_found'});return receipts.get(id);},retryCleanupByRequest:async(_owner,id)=>receipts.get(id)};
  return {manager,rows,setReady:value=>ready=value,get revision(){return revision;}};
}
