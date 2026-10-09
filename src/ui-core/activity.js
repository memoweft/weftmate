/* Account-scoped activity model. Native approval/question logic owns replies. */
globalThis.WeftUiCore.factories.activity = (core,effects,environment) => {
    const model={items:[],filter:'all',unreadCount:0,actionableCount:0,nextCursor:null,snapshotCursor:null,syncCursor:null,loading:false,error:'',busy:new Set(),generation:0};
    let identity,flight;
    const filters={all:{},actionable:{filter:'actionable'},task:{type:'task'},reminder:{type:'reminder'},memory:{type:'memory'}};
    const scope=()=>`${core.state.identityGeneration}:${core.state.account?.ownerId??core.state.ownerId}`;
    function resetActivity(){model.generation++;Object.assign(model,{items:[],unreadCount:0,actionableCount:0,nextCursor:null,snapshotCursor:null,syncCursor:null,error:'',loading:false});model.busy.clear();flight=null;effects.renderActivity?.();}
    async function readActivity(more=false){
        effects.syncActivityIdentity?.();if(identity!==scope()){identity=scope();resetActivity();}
        if(!core.state.csrfToken||core.state.personalCapabilities?.activity!==1)return;
        if(flight)return flight;
        const token=scope(),generation=model.generation,params=new URLSearchParams({...filters[model.filter],limit:'50'});
        if(more&&model.nextCursor)params.set('cursor',model.nextCursor);
        model.loading=true;effects.renderActivity?.();
        const work=(async()=>{try{const page=await core.accessApi(`/activity?${params}`);
            if(scope()!==token||model.generation!==generation)return;
            model.items=more?[...new Map([...model.items,...page.items].map(row=>[row.id,row])).values()]:page.items;
            Object.assign(model,{timeZone:page.timeZone,unreadCount:page.unreadCount,actionableCount:page.actionableCount,nextCursor:page.nextCursor,syncCursor:more?model.syncCursor:page.syncCursor,snapshotCursor:more?model.snapshotCursor:page.snapshotCursor,error:''});
        }catch(error){if(scope()===token&&model.generation===generation){if(error.status===409){resetActivity();model.error='动态已更新，请重新读取。';}else model.error=core.failureMessage(error);}}
        finally{if(scope()===token&&model.generation===generation){model.loading=false;effects.renderActivity?.();}if(flight===work)flight=null;}})();flight=work;return work;
    }
    async function refreshActivity(){
        if(flight)return flight;
        effects.syncActivityIdentity?.();if(identity!==scope()){identity=scope();resetActivity();}
        if(!core.state.csrfToken||core.state.personalCapabilities?.activity!==1)return;
        const token=scope(),generation=model.generation;
        try{const count=await core.accessApi('/activity/unread');if(scope()!==token||model.generation!==generation)return;
            Object.assign(model,count);effects.renderActivityBadge?.();
            if(effects.activityVisible?.()){
                if(!model.syncCursor){await readActivity();return;}
                let more=true;
                while(more){const params=new URLSearchParams({...filters[model.filter],cursor:model.syncCursor,limit:'200'});
                    const delta=await core.accessApi(`/activity/changes?${params}`);if(scope()!==token||model.generation!==generation)return;
                    if(delta.removals.length){resetActivity();await readActivity();return;}
                    const rows=new Map(model.items.map(row=>[row.id,row]));for(const id of delta.removals)rows.delete(id);
                    for(const row of delta.upserts){const selected=filters[model.filter];if((!selected.type||row.type.startsWith(`${selected.type}.`))&&(!selected.filter||row.state==='pending'))rows.set(row.id,row);else rows.delete(row.id);}
                    model.items=[...rows.values()].sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
                    Object.assign(model,{syncCursor:delta.nextCursor,snapshotCursor:delta.snapshotCursor,unreadCount:delta.unreadCount,actionableCount:delta.actionableCount,error:''});more=delta.hasMore;
                }effects.renderActivity?.();
            }
        }catch(error){if(error.status===409&&scope()===token){resetActivity();await readActivity();} /* Preserve known counts while reconnecting. */}
    }
    async function setActivityFilter(filter){if(!filters[filter])return;model.filter=filter;model.generation++;model.items=[];model.nextCursor=null;model.snapshotCursor=null;flight=null;await readActivity();}
    async function markActivityRead(row){const token=scope();await core.accessApi(`/activity/${encodeURIComponent(row.id)}/read`,{method:'PATCH',protectedWrite:true,body:{requestId:environment.crypto.randomUUID(),read:true,attentionRevision:row.attentionRevision}});if(scope()===token)await readActivity();}
    async function markAllActivityRead(){if(!model.snapshotCursor)return;const token=scope();await core.accessApi('/activity/read',{method:'POST',protectedWrite:true,body:{requestId:environment.crypto.randomUUID(),through:model.snapshotCursor}});if(scope()===token)await readActivity();}
    async function activityAction(row,action,outcome){
        if(model.busy.has(row.id))return;const token=scope();model.busy.add(row.id);effects.renderActivity?.();
        try{
            if(action.kind==='respond_approval'){
                await effects.prepareActivityApproval?.(action.target);if(scope()!==token)return;
                const context=core.approvalContext();await core.refreshConversationTasks();await core.refreshConversationApprovals(context,true);
                const original=core.conversationApprovals.entries.get(action.target.approvalId)?.row;
                if(!original||original.sessionId!==action.target.sessionId||original.taskId!==action.target.taskId)throw {code:'REQUEST_FAILED'};
                await core.submitApproval(context,original,outcome);
                const current=core.conversationApprovals.entries.get(original.approvalId);
                if(current?.row.status==='pending'||current?.notice)throw {code:'REQUEST_FAILED'};
            }else if(action.kind==='view_memory')await effects.openActivityMemory?.();
            else if(['open_chat','answer_question'].includes(action.kind))await effects.openActivitySource?.(action.target,action.kind);
            else return;
            if(scope()===token){try{await markActivityRead(row);}catch{/* A resolved approval has a new attention revision. */}await readActivity();}
        }finally{model.busy.delete(row.id);effects.activityActionFinished?.();effects.renderActivity?.();}
    }
    return {activity:model,readActivity,refreshActivity,setActivityFilter,markActivityRead,markAllActivityRead,activityAction,resetActivity};
};
