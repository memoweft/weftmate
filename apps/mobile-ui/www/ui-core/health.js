/* Health presentation model. Scores, baselines and interpretations belong to /personal/v1. */
(() => {
  const metrics = {
    recovery:['恢复','分','health'],sleep:['睡眠','分','moon'],load:['负荷','分','chart'],
    stress:['压力','分','pulse'],energy:['电能','分','battery'],fitnessAge:['体能年龄','岁','health'],activity:['活动','分钟','chart'],
    hrvSdnnMs:['心率变异性','毫秒','variability'],restingHeartRateBpm:['静息心率','次/分','pulse'],
    respiratoryRateBrpm:['呼吸频率','次/分','lungs'],spo2Pct:['血氧','%','oxygen'],wristTempC:['手腕温度','℃','thermometer'],
    sleepMinutes:['睡眠时长','分钟','moon'],deepMinutes:['深睡','分钟','moon'],remMinutes:['快速眼动','分钟','moon'],awakeMinutes:['清醒时长','分钟','moon'],
    steps:['步数','步','chart'],activeEnergyKcal:['活动能量','千卡','chart'],exerciseMinutes:['运动时长','分钟','chart'],
    usageLateNightMinutes:['深夜使用时长','分钟','desktop'],usageActiveMinutes:['电脑使用时长','分钟','desktop'],vo2Max:['最大摄氧量','毫升/千克/分','health']
  };
  // Change this one constant to keep health in the drawer but return to four bottom tabs.
  const SHOW_HEALTH_BOTTOM_TAB=true;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const value = (n,id='') => finite(n) ? new Intl.NumberFormat('zh-CN',{minimumFractionDigits:['wristTempC','respiratoryRateBrpm','vo2Max'].includes(id)?1:0,maximumFractionDigits:['wristTempC','respiratoryRateBrpm','vo2Max'].includes(id)?1:0}).format(n) : '—';
  const analysisScope = id => ['recovery','sleep','load','stress','energy','fitnessAge','activity'].includes(id)?id:['steps','activeEnergyKcal','exerciseMinutes'].includes(id)?'activity':['hrvSdnnMs','restingHeartRateBpm','respiratoryRateBrpm','spo2Pct','wristTempC'].includes(id)?`vital:${id}`:null;
  const duration = globalThis.WeftHumanFormat.formatDuration;
  const dayShift = (day,offset) => new Date(Date.parse(`${day}T12:00:00Z`)+offset*86400000).toISOString().slice(0,10);
  function chart(points = [], average = null) {
    const valid = points.flatMap(p => [p.value,p.low,p.high]).filter(finite);if(finite(average))valid.push(average);
    let min=valid.length?Math.min(...valid):0,max=valid.length?Math.max(...valid):1;
    const margin=(max-min||Math.abs(max)*.1||1)*.15;min-=margin;max+=margin;
    const x = i => points.length < 2 ? 160 : 16+i*288/(points.length-1), y = n => 154-(n-min)*132/(max-min);
    let path='',band='';const ranges=[];
    points.forEach((p,i)=>{if(finite(p.value))path+=`${i===0||!finite(points[i-1].value)?'M':'L'}${x(i)},${y(p.value)} `;
      if(finite(p.low)&&finite(p.high))ranges.push(i);else if(ranges.length){addBand();}});addBand();
    function addBand(){if(!ranges.length)return;const ids=ranges.splice(0);band+=`M${ids.map(i=>`${x(i)},${y(points[i].high)}`).join(' L')} L${ids.reverse().map(i=>`${x(i)},${y(points[i].low)}`).join(' L')} Z `;}
    return {min,max,x,y,path,band,empty:!points.some(p=>finite(p.value))};
  }
  const vital = (overview,id) => Array.isArray(overview?.vitals)?overview.vitals.find(item=>item.id===id):overview?.vitals?.[id];
  const clockMinutes = time => typeof time==='string'&&/^\d{2}:\d{2}$/.test(time)?Number(time.slice(0,2))*60+Number(time.slice(3)):null;
  const profileHint = data => {const missing=data?.missing??[],fields=[...(missing.includes('birthYear')?['出生年份']:[]),...(missing.includes('sex')?['性别']:[])];return fields.length?`在 iPhone 的健康页里补一下${fields.join('和')}就能算`:'最近还没有足够的最大摄氧量记录，继续戴着手表记录活动';};
  globalThis.WeftHealth = {showHealthBottomTab:SHOW_HEALTH_BOTTOM_TAB,metrics,finite,value,vital,clockMinutes,profileHint,analysisScope,duration,dayShift,chart,vitals:['hrvSdnnMs','restingHeartRateBpm','respiratoryRateBrpm','spo2Pct','wristTempC']};
  globalThis.WeftUiCore.factories.health = (core,effects,env) => {
    const priorSaveHealthSettings=core.persistHealthSettings??core.saveHealthSettings;
    const model={overview:null,day:'',today:'',metric:'recovery',days:30,view:'today',overlay:false,trend:null,usage:null,weekSleep:null,weekUsage:null,recoveryWeek:null,calendar:null,month:'',loading:false,trendLoading:false,error:'',trendError:'',calendarError:'',calendarLoading:false,sleepStages:{},scoreAverages:{},supplementLoading:false,stageError:'',dimensionMetrics:{},dimensionLoading:false,settings:null,settingsLoading:false,settingsError:'',analyses:new Map(),analysisOpen:new Set(),analysisBusy:new Set(),analysisErrors:new Map(),generation:0,reminders:new Map(),busy:new Set()};
    let identity,healthRead,readId=0,trendId=0,calendarId=0,dimensionId=0;const requests=new Map();
    const scope=()=>`${core.state.identityGeneration}:${core.state.account?.ownerId??core.state.ownerId}`;
    const emit=()=>effects.renderHealth?.();
    function resetHealth(){healthRead=null;readId++;trendId++;calendarId++;dimensionId++;model.generation++;requests.clear();model.reminders.clear();model.busy.clear();model.analyses.clear();model.analysisOpen.clear();model.analysisBusy.clear();model.analysisErrors.clear();Object.assign(model,{overview:null,settings:null,settingsLoading:false,settingsError:'',day:'',today:'',metric:'recovery',days:30,view:'today',overlay:false,trend:null,usage:null,calendar:null,month:'',weekSleep:null,weekUsage:null,recoveryWeek:null,loading:false,trendLoading:false,error:'',trendError:'',calendarError:'',calendarLoading:false,sleepStages:{},scoreAverages:{},supplementLoading:false,stageError:'',dimensionMetrics:{},dimensionLoading:false});emit();}
    function sync(){core.syncMobileIdentity?.();if(identity!==scope()){identity=scope();resetHealth();}}
    async function series(id,days){const supportsTo=model.overview?.capabilities?.record>=3,query=new URLSearchParams({days:String(!supportsTo&&model.day&&model.today&&model.day<model.today?90:days)});if(supportsTo&&model.day)query.set('to',model.day);const result=await core.accessApi(`/health/metrics/${encodeURIComponent(id)}?${query}`);
      const points=(result.points??[]).filter(p=>!model.day||p.day<=model.day).slice(-days),values=points.map(p=>p.value).filter(finite);
      return {...result,points,outsideRange:!!model.day&&(result.points??[]).length>0&&model.day<result.points[0].day,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};}
    function readHealth(day){sync();day??=model.day;const token=scope(),requestedDay=day===model.today?'':day;
      // Share the complete read, including supplements: polling/timeline refreshes
      // must not invalidate successful stages before they can reach the view.
      if(healthRead?.token===token&&healthRead.day===requestedDay)return healthRead.promise;
      let resolve,reject;const promise=new Promise((done,failed)=>{resolve=done;reject=failed;});
      const pending={token,day:requestedDay,promise};healthRead=pending;
      readHealthData(requestedDay,token).finally(()=>{if(healthRead===pending)healthRead=null;}).then(resolve,reject);
      return pending.promise;
    }
    async function readHealthData(requestedDay,token){const id=++readId;model.loading=true;model.error='';emit();
      try{const overview=await core.accessApi(`/health/overview${requestedDay?`?day=${encodeURIComponent(requestedDay)}`:''}`);if(token!==scope()||id!==readId)return;
        const dayChanged=model.day!==overview.day;if(dayChanged){model.analyses.clear();model.analysisOpen.clear();model.analysisBusy.clear();model.analysisErrors.clear();}model.overview=overview;model.day=overview.day;Object.assign(model,{...(dayChanged?{sleepStages:{},scoreAverages:{},dimensionMetrics:{},dimensionLoading:false,recoveryWeek:null,weekSleep:null,weekUsage:null}:{}),supplementLoading:overview.connected,stageError:''});if(!requestedDay||!model.today)model.today=overview.day;
        model.loading=false;emit();await readHealthSettings();if(token!==scope()||id!==readId)return;if(overview.connected){await Promise.all([readHealthAnalyses(),readHealthTrend(),readWeek(token,id),readHealthCalendar(model.day.slice(0,7)),...(model.view==='detail'&&model.metric==='load'?[readDimensions()]:[])]);}
      }catch(error){if(token===scope()&&id===readId){model.error=core.failureMessage(error);}}
      finally{if(token===scope()&&id===readId){model.loading=false;emit();}}
    }
    async function readWeek(token,id){
      const specs=[['weekSleep','sleepMinutes',7],['weekUsage','usageLateNightMinutes',7],['average:recovery','recovery',14],['average:sleep','sleep',14],['average:load','load',14],...['stress','energy','fitnessAge'].filter(id=>model.overview?.[id]).map(id=>[`average:${id}`,id,14]),...['deepMinutes','remMinutes','awakeMinutes','inBedMinutes'].map(metric=>[`stage:${metric}`,metric,7]),...['steps','activeEnergyKcal','exerciseMinutes'].map(metric=>[`dimension:${metric}`,metric,7])];
      const results=await Promise.allSettled(specs.map(([,metric,days])=>series(metric,days)));
      if(token!==scope()||id!==readId)return;
      for(const [i,[key]]of specs.entries()){const result=results[i],data=result.status==='fulfilled'?result.value:null;
        if(key.startsWith('average:')){const metric=key.slice(8);model.scoreAverages[metric]=data?.average??null;if(metric==='recovery')model.recoveryWeek=data?{...data,points:data.points.slice(-7),average:null}:null;}
        else if(key.startsWith('stage:')){const point=data?.points.find(p=>p.day===model.day);model.sleepStages[key.slice(6)]=point?.value??null;model.dimensionMetrics[key.slice(6)]=point??null;if(result.status==='rejected')model.stageError=core.failureMessage(result.reason);}
        else if(key.startsWith('dimension:'))model.dimensionMetrics[key.slice(10)]=data?.points.find(p=>p.day===model.day)??null;
        else {model[key]=data;if(key==='weekSleep')model.dimensionMetrics.sleepMinutes=data?.points.find(p=>p.day===model.day)??null;}
      }model.supplementLoading=false;emit();
    }
    async function readDimensions(){const token=scope(),day=model.day,id=++dimensionId;model.dimensionLoading=true;emit();
      const metrics=['exerciseMinutes','activeEnergyKcal','steps'],results=await Promise.allSettled(metrics.map(metric=>series(metric,7)));
      if(token!==scope()||day!==model.day||id!==dimensionId)return;
      for(const [i,metric]of metrics.entries())model.dimensionMetrics[metric]=results[i].status==='fulfilled'?results[i].value.points.find(p=>p.day===day)??null:null;
      model.dimensionLoading=false;emit();
    }
    async function readHealthTrend(metric=model.metric,days=model.days){sync();if(!metrics[metric]||![7,14,30,60].includes(days))return;const token=scope(),id=++trendId;
      Object.assign(model,{metric,days,trendLoading:true,trendError:'',trend:null,usage:null});emit();
      try{const [trend,usage]=await Promise.all([series(metric==='fitnessAge'?'vo2Max':metric==='activity'?'exerciseMinutes':metric,days),model.overlay?series('usageLateNightMinutes',days):Promise.resolve(null)]);if(token===scope()&&id===trendId)Object.assign(model,{trend,usage});}
      catch(error){if(token===scope()&&id===trendId)model.trendError=core.failureMessage(error);}
      finally{if(token===scope()&&id===trendId){model.trendLoading=false;emit();}}
    }
    async function readHealthCalendar(month=model.day.slice(0,7)){sync();const token=scope(),id=++calendarId;Object.assign(model,{month,calendarLoading:true,calendarError:'',calendar:null});emit();
      try{const result=await core.accessApi(`/health/calendar?month=${month}`);if(token===scope()&&id===calendarId)model.calendar=result;}
      catch(error){if(token===scope()&&id===calendarId)model.calendarError=core.failureMessage(error);}
      finally{if(token===scope()&&id===calendarId){model.calendarLoading=false;emit();}}
    }
    async function openHealthMetric(metric,view='trend'){model.view=view;await Promise.all([readHealthTrend(metric),...(view==='detail'&&metric==='load'?[readDimensions()]:[])]);}
    async function healthOverlay(enabled){model.overlay=enabled;await readHealthTrend();}
    async function remindHealth(suggestion){sync();if(model.busy.has(suggestion.id)||model.reminders.has(suggestion.id)||!suggestion.reminder)return;
      const token=scope();model.busy.add(suggestion.id);emit();
      try{const sessionId=core.state.mainChat?.activeSessionId??core.state.selectedSessionId??core.state.sessions?.find(s=>s.taskAvailable!==false&&!s.archived)?.sessionId;
        if(!sessionId){effects.healthNotice?.('先开始一个对话，再把这条建议设为提醒。');return;}
        const body=requests.get(suggestion.id)??{sessionId,requestId:env.crypto.randomUUID()};requests.set(suggestion.id,body);
        const result=await core.accessApi(`/health/suggestions/${encodeURIComponent(suggestion.id)}/remind`,{method:'POST',protectedWrite:true,body});
        if(token===scope()){model.reminders.set(suggestion.id,result.item);effects.healthNotice?.('已设提醒');}return result;
      }finally{if(token===scope()){model.busy.delete(suggestion.id);emit();}}
    }
    async function readHealthSettings(){sync();const token=scope();model.settingsLoading=true;model.settingsError='';emit();
      try{const result=await core.accessApi('/settings/health');if(token===scope())model.settings=result.settings;return result;}
      catch(error){if(token===scope()){model.settings=null;model.settingsError=core.failureMessage(error);}return null;}
      finally{if(token===scope()){model.settingsLoading=false;emit();}}
    }
    async function saveHealthViewSettings(patch){sync();const token=scope();const result=await (priorSaveHealthSettings?priorSaveHealthSettings(patch):core.accessApi('/settings/health',{method:'PATCH',protectedWrite:true,body:patch}));
      if(token===scope()){model.settings=result.settings;emit();}return result;
    }
    async function readHealthAnalyses(){if(!Object.hasOwn(model.settings??{},'itemAnalysisEnabled'))return;const token=scope(),day=model.day;
      try{const result=await core.accessApi(`/health/analysis?day=${day}`);if(token!==scope()||day!==model.day)return;
        if(result.day!==day)return;for(const item of result.items??[])if(item.day===day&&analysisScope(item.scope.replace(/^vital:/,'')))model.analyses.set(item.scope,item);emit();
      }catch{/* Cache availability never blocks the daily numbers. */}
    }
    function analysisFailure(error){const code=error.code??error.error?.code??error.message??'';
      if(code==='AI_ANALYSIS_OFF')return 'off';if(error.status===429||/LIMIT|RATE|QUOTA/.test(code))return 'limit';
      if(/OFFLINE|UNAVAILABLE|HOST_NOT/.test(code)||error.status===503)return 'offline';return 'failed';
    }
    async function generateHealthAnalysis(itemScope){sync();if(!analysisScope(itemScope.replace(/^vital:/,''))||model.analysisBusy.has(itemScope))return;
      const token=scope(),day=model.day;model.analysisBusy.add(itemScope);model.analysisErrors.delete(itemScope);emit();
      try{const result=await core.accessApi('/health/analysis',{method:'POST',protectedWrite:true,body:{scope:itemScope,day}});
        if(token===scope()&&day===model.day)model.analyses.set(itemScope,result);return result;
      }catch(error){if(token===scope()&&day===model.day){const kind=analysisFailure(error);model.analysisErrors.set(itemScope,kind);if(kind==='off'&&model.settings)model.settings.itemAnalysisEnabled=false;}}
      finally{if(token===scope()&&day===model.day){model.analysisBusy.delete(itemScope);emit();}}
    }
    async function toggleHealthAnalysis(itemScope){sync();if(!Object.hasOwn(model.settings??{},'itemAnalysisEnabled'))return;
      if(model.analysisOpen.has(itemScope)){model.analysisOpen.delete(itemScope);emit();return;}model.analysisOpen.add(itemScope);emit();
      if(model.settings.itemAnalysisEnabled&&!model.analyses.has(itemScope))await generateHealthAnalysis(itemScope);
    }
    async function enableHealthAnalysis(itemScope){const token=scope(),day=model.day;await saveHealthViewSettings({itemAnalysisEnabled:true});
      if(token===scope()&&day===model.day){model.analysisOpen.add(itemScope);if(!model.analyses.has(itemScope))await generateHealthAnalysis(itemScope);}
    }
    async function askHealthAnalysis(itemScope){const token=scope(),item=model.analyses.get(itemScope);if(!item)return;await core.selectMainChat();if(token!==scope())return;
      effects.quoteHealth?.(`> ${item.day} · ${metrics[itemScope.replace(/^vital:/,'')]?.[0]??'健康'} AI 分析\n> ${item.text.replace(/\n/g,'\n> ')}\n\n`);
    }
    async function askHealth(){const token=scope(),insight=model.overview?.insight;if(!insight)return;await core.selectMainChat();if(token!==scope())return;
      const quote=`> ${model.day} · ${insight.headline}\n> ${insight.text.replace(/\n/g,'\n> ')}\n\n`;
      effects.quoteHealth?.(quote);}
    return {health:model,resetHealth,readHealth,readHealthTrend,readHealthCalendar,openHealthMetric,healthOverlay,remindHealth,askHealth,readHealthSettings,saveHealthViewSettings,readHealthAnalyses,toggleHealthAnalysis,enableHealthAnalysis,generateHealthAnalysis,askHealthAnalysis};
  };
})();
