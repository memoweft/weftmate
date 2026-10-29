/* Shared goal-page behavior. Native task receipts and schedule/goal APIs own mutations. */
globalThis.WeftUiCore.factories.goals = (core,effects,environment) => {
    const model={tasks:[],recent:[],schedules:[],goals:[],sessions:[],errors:{},loaded:{},pending:{},loading:false,generation:0,busy:new Set()};
    let flight,identity;const commandSources=new Map();
    const scope=()=>`${core.state.identityGeneration}:${core.state.account?.ownerId ?? core.state.ownerId}`;
    function resetGoals(){model.generation++;Object.assign(model,{tasks:[],recent:[],schedules:[],goals:[],sessions:[],errors:{},loaded:{},pending:{},loading:false});model.busy.clear();commandSources.clear();flight=null;effects.resetGoalsView?.();effects.renderGoals?.();}
    async function readGoals(){
        core.syncMobileIdentity?.();if(identity!==scope()){identity=scope();resetGoals();}if(flight)return flight;
        const token=scope(),generation=model.generation,current=()=>scope()===token&&model.generation===generation;
        const paths=[['tasks','/tasks','taskOverview'],['schedules','/schedules','scheduleEditing'],['goals','/goals','goals'],['sessions','/sessions',null]];
        model.loading=true;model.pending=Object.fromEntries(paths.map(([key])=>[key,true]));effects.renderGoals?.();
        const work=(async()=>{
            // Each section publishes its own result. A slow session list or
            // provenance lookup cannot turn a confirmed empty sibling into loading.
            await Promise.allSettled([core.refreshOfflineTasks?.(),...paths.map(async([key,path,cap])=>{
                try{
                    if(cap&&core.state.personalCapabilities?.[cap]!==1)throw {code:'CAPABILITY_UNAVAILABLE'};
                    const result=await core.accessApi(path);if(!current())return;
                    model[key]=result.items??result.sessions??[];model.loaded[key]=true;
                    if(key==='tasks'){model.recent=result.recent;model.timeZone=result.timeZone;}
                    delete model.errors[key];
                }catch(error){if(!current())return;const unavailable=error?.code==='CAPABILITY_UNAVAILABLE';
                    if(unavailable){model[key]=[];delete model.loaded[key];if(key==='tasks')model.recent=[];}
                    model.errors[key]=unavailable?'更新电脑上的 WeftMate 后可使用这项功能。':core.failureMessage(error);
                }finally{if(current()){model.pending[key]=false;effects.renderGoals?.();}}
            })]);
            if(!current())return;
            if(environment.desktop&&!model.errors.tasks){
                // The command API already exposes offline provenance; task state and
                // cancellation remain owned by the existing task overview/stop API.
                const rows=[...model.tasks,...model.recent],remaining=new Set(rows.filter(row=>!commandSources.has(row.taskId)).map(row=>row.taskId));
                try{
                    let before=null;
                    while(remaining.size){
                        const page=await core.accessApi(`/commands?limit=100${before?`&before=${encodeURIComponent(before)}`:''}`);
                        if(!current())return;
                        for(const command of page.commands){remaining.delete(command.commandId);commandSources.set(command.commandId,command.offlineSource??null);}
                        if(!page.hasMore)break;before=page.nextBefore;
                    }
                    for(const row of rows)row.offlineSource=commandSources.get(row.taskId);
                    const retained=new Set(rows.map(row=>row.taskId));for(const id of commandSources.keys())if(!retained.has(id))commandSources.delete(id);
                    delete model.errors.offlineSources;
                }catch(error){if(!current())return;model.errors.offlineSources='手机任务来源暂时无法读取，请刷新重试。';}
            }
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
