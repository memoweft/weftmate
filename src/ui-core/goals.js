/* Shared goal-page behavior. Native task receipts and schedule/goal APIs own mutations. */
globalThis.WeftUiCore.factories.goals = (core,effects,environment) => {
    const model={tasks:[],recent:[],schedules:[],goals:[],sessions:[],errors:{},loading:false,generation:0,busy:new Set()};
    let flight,identity;
    const scope=()=>`${core.state.identityGeneration}:${core.state.account?.ownerId ?? core.state.ownerId}`;
    function resetGoals(){model.generation++;Object.assign(model,{tasks:[],recent:[],schedules:[],goals:[],sessions:[],errors:{},loading:false});model.busy.clear();flight=null;effects.resetGoalsView?.();effects.renderGoals?.();}
    async function readGoals(){
        core.syncMobileIdentity?.();if(identity!==scope()){identity=scope();resetGoals();}if(flight)return flight;
        const token=scope(),generation=model.generation;model.loading=true;effects.renderGoals?.();
        const work=(async()=>{
            const paths=[['tasks','/tasks','taskOverview'],['schedules','/schedules','scheduleEditing'],['goals','/goals','goals'],['sessions','/sessions',null]];
            const results=await Promise.allSettled(paths.map(([,path,cap])=>Promise.resolve().then(()=>{if(cap&&core.state.personalCapabilities?.[cap]!==1)throw {code:'CAPABILITY_UNAVAILABLE'};return core.accessApi(path);})));
            if(scope()!==token||model.generation!==generation)return;
            results.forEach((result,index)=>{const key=paths[index][0];if(result.status==='fulfilled'){model[key]=result.value.items ?? result.value.sessions ?? [];if(key==='tasks'){model.recent=result.value.recent;model.timeZone=result.value.timeZone;}delete model.errors[key];}
                else{model[key]=[];if(key==='tasks')model.recent=[];model.errors[key]=result.reason?.code==='CAPABILITY_UNAVAILABLE'?'更新电脑上的 WeftMate 后可使用这项功能。':core.failureMessage(result.reason);}});
            if(core.state.mainChat?.activeSessionId&&!model.sessions.some(row=>row.sessionId===core.state.mainChat.activeSessionId))model.sessions.unshift({sessionId:core.state.mainChat.activeSessionId,title:'WeftMate 主对话',taskAvailable:true});
            model.loading=false;effects.renderGoals?.();
        })().finally(()=>{if(flight===work)flight=null;});flight=work;return work;
    }
    async function goalWrite(key,path,body,method='POST'){
        const token=scope(),generation=model.generation;if(model.busy.has(key))return;
        model.busy.add(key);effects.renderGoals?.();
        try{const result=await core.accessApi(path,{method,protectedWrite:true,...(body?{body}:{})});if(scope()===token&&model.generation===generation){await readGoals();return result;}}
        finally{if(scope()===token&&model.generation===generation){model.busy.delete(key);effects.renderGoals?.();}}
    }
    return {goalsPage:model,readGoals,resetGoals,goalWrite,
        stopOverviewTask:row=>goalWrite(row.taskId,`/tasks/${encodeURIComponent(row.taskId)}/stop`,{requestId:environment.crypto.randomUUID()}),
        saveGoalSchedule:(body,row)=>goalWrite('schedule-form',row?`/schedules/${encodeURIComponent(row.sessionId)}/${encodeURIComponent(row.id)}`:'/schedules',body,row?'PATCH':'POST'),
        saveLongGoal:body=>goalWrite('goal-form','/goals',body),
        manageLongGoal:(row,action,requestId)=>goalWrite(row.id,`/goals/${encodeURIComponent(row.source.sessionId)}/${action}`,{requestId,ref:{id:row.id,revision:row.revision}}),
    };
};
