/* Health presentation model. Scores, baselines and interpretations belong to /personal/v1. */
(() => {
  const metrics = {
    recovery:['恢复','分','health'],sleep:['睡眠','分','moon'],load:['负荷','分','chart'],
    hrvSdnnMs:['心率变异性','毫秒','health'],restingHeartRateBpm:['静息心率','次/分','health'],
    respiratoryRateBrpm:['呼吸频率','次/分','health'],spo2Pct:['血氧','%','health'],wristTempC:['手腕温度','℃','health'],
    sleepMinutes:['睡眠时长','分钟','moon'],deepMinutes:['深睡','分钟','moon'],remMinutes:['快速眼动','分钟','moon'],awakeMinutes:['清醒时长','分钟','moon'],
    steps:['步数','步','chart'],activeEnergyKcal:['活动能量','千卡','chart'],exerciseMinutes:['运动时长','分钟','chart'],
    usageLateNightMinutes:['深夜使用时长','分钟','desktop'],usageActiveMinutes:['电脑使用时长','分钟','desktop'],vo2Max:['最大摄氧量','毫升/千克/分','health']
  };
  // Change this one constant to keep health in the drawer but return to four bottom tabs.
  const SHOW_HEALTH_BOTTOM_TAB=true;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const value = n => finite(n) ? new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(n) : '—';
  const duration = n => finite(n) ? `${Math.floor(n/60)}小时${Math.round(n%60)}分钟` : '—';
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
  globalThis.WeftHealth = {showHealthBottomTab:SHOW_HEALTH_BOTTOM_TAB,metrics,finite,value,duration,dayShift,chart,vitals:['hrvSdnnMs','restingHeartRateBpm','respiratoryRateBrpm','spo2Pct','wristTempC']};
  globalThis.WeftUiCore.factories.health = (core,effects,env) => {
    const model={overview:null,day:'',today:'',metric:'recovery',days:30,view:'today',overlay:false,trend:null,usage:null,weekSleep:null,weekUsage:null,recoveryWeek:null,calendar:null,month:'',loading:false,trendLoading:false,error:'',trendError:'',calendarError:'',calendarLoading:false,generation:0,reminders:new Map(),busy:new Set()};
    let identity,readId=0,trendId=0,calendarId=0;const requests=new Map();
    const scope=()=>`${core.state.identityGeneration}:${core.state.account?.ownerId??core.state.ownerId}`;
    const emit=()=>effects.renderHealth?.();
    function resetHealth(){readId++;trendId++;calendarId++;model.generation++;requests.clear();model.reminders.clear();model.busy.clear();Object.assign(model,{overview:null,day:'',today:'',metric:'recovery',days:30,view:'today',overlay:false,trend:null,usage:null,calendar:null,month:'',weekSleep:null,weekUsage:null,recoveryWeek:null,loading:false,trendLoading:false,error:'',trendError:'',calendarError:'',calendarLoading:false});emit();}
    function sync(){core.syncMobileIdentity?.();if(identity!==scope()){identity=scope();resetHealth();}}
    async function series(id,days){const result=await core.accessApi(`/health/metrics/${encodeURIComponent(id)}?days=${model.day&&model.today&&model.day<model.today?90:days}`);
      const points=(result.points??[]).filter(p=>!model.day||p.day<=model.day).slice(-days),values=points.map(p=>p.value).filter(finite);
      return {...result,points,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};}
    async function readHealth(day=model.day){sync();const token=scope(),id=++readId;model.loading=true;model.error='';emit();
      try{const requestedDay=day===model.today?'':day;const overview=await core.accessApi(`/health/overview${requestedDay?`?day=${encodeURIComponent(requestedDay)}`:''}`);if(token!==scope()||id!==readId)return;
        model.overview=overview;model.day=overview.day;if(!requestedDay||!model.today)model.today=overview.day;
        model.loading=false;emit();if(overview.connected){await Promise.all([readHealthTrend(),readWeek(token,id)]);}
      }catch(error){if(token===scope()&&id===readId){model.error=core.failureMessage(error);}}
      finally{if(token===scope()&&id===readId){model.loading=false;emit();}}
    }
    async function readWeek(token,id){const results=await Promise.allSettled([series('sleepMinutes',7),series('usageLateNightMinutes',7),series('recovery',7)]);
      if(token!==scope()||id!==readId)return;for(const [i,key]of ['weekSleep','weekUsage','recoveryWeek'].entries())model[key]=results[i].status==='fulfilled'?results[i].value:null;emit();}
    async function readHealthTrend(metric=model.metric,days=model.days){sync();if(!metrics[metric]||![7,14,30,60].includes(days))return;const token=scope(),id=++trendId;
      Object.assign(model,{metric,days,trendLoading:true,trendError:'',trend:null,usage:null});emit();
      try{const [trend,usage]=await Promise.all([series(metric,days),model.overlay?series('usageLateNightMinutes',days):Promise.resolve(null)]);if(token===scope()&&id===trendId)Object.assign(model,{trend,usage});}
      catch(error){if(token===scope()&&id===trendId)model.trendError=core.failureMessage(error);}
      finally{if(token===scope()&&id===trendId){model.trendLoading=false;emit();}}
    }
    async function readHealthCalendar(month=model.day.slice(0,7)){sync();const token=scope(),id=++calendarId;Object.assign(model,{month,calendarLoading:true,calendarError:'',calendar:null});emit();
      try{const result=await core.accessApi(`/health/calendar?month=${month}`);if(token===scope()&&id===calendarId)model.calendar=result;}
      catch(error){if(token===scope()&&id===calendarId)model.calendarError=core.failureMessage(error);}
      finally{if(token===scope()&&id===calendarId){model.calendarLoading=false;emit();}}
    }
    async function openHealthMetric(metric,view='trend'){model.view=view;await readHealthTrend(metric);}
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
    async function askHealth(){const token=scope(),insight=model.overview?.insight;if(!insight)return;await core.selectMainChat();if(token!==scope())return;
      const quote=`> ${model.day} · ${insight.headline}\n> ${insight.text.replace(/\n/g,'\n> ')}\n\n`;
      effects.quoteHealth?.(quote);}
    return {health:model,resetHealth,readHealth,readHealthTrend,readHealthCalendar,openHealthMetric,healthOverlay,remindHealth,askHealth};
  };
})();
