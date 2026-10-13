import { formatDuration } from '../human-format.mjs';
import { digest, boundedUpstreamBody } from '../personal-access/common.mjs';
import { currentChatProfile } from '../background-model-selection.mjs';
import { localNotificationTime } from '../personal-access/notification-policy.mjs';
import { healthOverview,healthShiftDay,average,VITAL_IDS,metricValue } from './analysis.mjs';

export const HEALTH_INSIGHT_PROMPT=`根据所给汇总数字，输出严格JSON：{headline,text,observations:[{text,inputs:[指标id]}],suggestions:[{text,reminder?:{title,time}}]}。headline≤16字，text≤120字，observations和suggestions各≤2条。说人话，不编造；睡眠等时长用小时和分，例如466分钟说7小时46分；stress.score与latest是最近一次测量，average才是当日已有测量的平均值，不混用；每条观察指明实际用到的指标id，必须有给定数字或相对平时的状态作依据。最多一条跨健康与使用的观察；只说同时出现，不说使用导致健康变化。输入只含今天汇总、个人基线、三个分数的主要因为、七天趋势和使用汇总、已有提醒数量；不给对话原文、记忆原文或逐条样本。usage7.activeMinutes是电脑使用时间；source为computer时来自系统空闲采样，为chat时来自消息活动估算；程序没运行的时间未知，不是运动分钟；运动只看activity.exerciseMinutes与workoutCount。observations.inputs只使用输入中实际出现的stress、energy、fitnessAge、vitals.id、分数名、reasons.inputs、sleepMinutes、steps、activeEnergyKcal、exerciseMinutes、workoutCount、usageActiveMinutes、usageLateNightMinutes。严禁医学诊断、疾病名、药名、建议用药。异常只说“比你平时高／低，持续几天的话留意一下，不放心就问医生”。无充分历史只说“再戴几天就有对比了”。通常只写一条观察和一条建议；正文用一两句话。建议温和具体；仅合适时提供一个未来ISO时刻的reminder，不自动创建提醒。不要推断未测到的数据，不用人群标准。`;
export const HEALTH_UNSAFE_TEXT=/(?:感冒|流感|新冠|感染|炎症|发烧|发热|痛风|哮喘|甲亢|甲减|肝炎|肾炎|结核|糖尿病|高血压|低血压|心脏病|心肌|心律失常|房颤|肺炎|抑郁|焦虑症|失眠|呼吸暂停|癌|疾病|诊断|患有|用药|服药|吃药|药物|药剂|处方|抗生素|布洛芬|阿司匹林|退烧药|治疗|hypertension|diabetes|influenza|diagnos|medicat|prescri|ibuprofen|aspirin|disease|infection|cancer)/i;
export function healthModelSummary(state,account,day,zone,reminderCount=0,now=null){
  const o=healthOverview(state,account,day,zone,now??Infinity),seven=Array.from({length:7},(_,n)=>{const d=healthShiftDay(day,n-6),v=healthOverview(state,account,d,zone),usage=account.dailyDigest?.days?.[d];return {day:d,recovery:v.recovery.score,recoveryState:v.recovery.state,sleep:v.sleep.score,sleepState:v.sleep.state,load:v.load.score,loadState:v.load.state,sleepMinutes:v.sleep.minutes,activeMinutes:v.usage.activeMinutes,lateNightMinutes:v.usage.lateNightMinutes,source:v.usage.source,lastUsedAt:v.usage.lastUsedAt,lastUsedAtSource:v.usage.lastUsedAtSource,completed:usage?.tasks?.completed??null};});
  const trends={};for(const id of ['recovery','sleep','load','sleepMinutes',...VITAL_IDS,'steps','exerciseMinutes','activeEnergyKcal']){const values=seven.map(r=>Object.hasOwn(r,id)?r[id]:metricValue(state,account,r.day,id)),first=average(values.slice(0,3)),last=average(values.slice(-3)),tolerance=Math.max(.01,Math.abs(first??0)*.03);trends[id]=first===null||last===null?'insufficient':last-first>tolerance?'up':last-first< -tolerance?'down':'stable';}
  return {day,timeZone:zone,...(now!==null?{currentTime:new Date(now).toISOString()}:{}),vitals:o.vitals,activity:{steps:o.activity.steps,activeEnergyKcal:o.activity.activeEnergyKcal,exerciseMinutes:o.activity.exerciseMinutes,workoutCount:o.activity.workouts.length},recovery:o.recovery,sleep:o.sleep,load:o.load,stress:o.stress?{score:o.stress.score,average:o.stress.average,latest:o.stress.latest,state:o.stress.state}:null,energy:o.energy?{current:o.energy.current,state:o.energy.state,degraded:o.energy.degraded}:null,fitnessAge:o.fitnessAge?{fitnessAge:o.fitnessAge.fitnessAge,actualAge:o.fitnessAge.actualAge,difference:o.fitnessAge.difference,state:o.fitnessAge.state}:null,trend7:trends,usage7:seven,todayReminderCount:reminderCount};
}
export function statisticalHealthInsight(state,account,day,zone,now){
  const o=healthOverview(state,account,day,zone),observations=[],suggestions=[];
  const below=o.vitals.find(v=>v.state==='low'||v.state==='high');
  if(o.sleep.minutes!==null)observations.push({text:`昨晚睡了 ${formatDuration(o.sleep.minutes)}，目标 ${formatDuration(o.sleep.targetMinutes)}。`,inputs:['sleepMinutes']});
  if(below){const names={restingHeartRateBpm:'静息心率',hrvSdnnMs:'心率变异性',respiratoryRateBrpm:'呼吸频率',spo2Pct:'血氧',wristTempC:'手腕温度'};observations.push({text:`${names[below.id]}${below.label}，持续几天的话留意一下，不放心就问医生。`,inputs:[below.id]});}
  else if(o.recovery.score!==null)observations.push({text:`恢复估计 ${o.recovery.score} 分，${o.recovery.label}。`,inputs:['recovery']});
  if(o.sleep.minutes!==null&&o.sleep.minutes<o.sleep.targetMinutes){const time=new Date(now+3600000).toISOString();suggestions.push({text:'今晚给自己多留一点休息时间。',reminder:{title:'给自己留点休息时间',time}});}
  else suggestions.push({text:'按自己的节奏安排今天，看看接下来几天的趋势。'});
  const score=o.recovery.score,text=score===null?'再戴几天就有对比了。先看看已经记录的睡眠和活动，缺测的部分以后再补。':`今天恢复估计 ${score} 分，${o.recovery.label}。${o.recovery.reasons[0]?.text??''}。分数用来看趋势，按自己的节奏就好。`;
  return {headline:score===null?'先积累几天对比':'看看今天的状态',text:text.slice(0,120),observations:observations.slice(0,2),suggestions,mode:'statistics',generatedAt:new Date(now).toISOString()};
}
const exact=(v,allowed,required=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k));
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&!HEALTH_UNSAFE_TEXT.test(v);
export function validateHealthInsight(value,summary,now){
  if(!exact(value,['headline','text','observations','suggestions'],['headline','text','observations','suggestions'])||!text(value.headline,16)||!text(value.text,120)||!Array.isArray(value.observations)||value.observations.length>2||!Array.isArray(value.suggestions)||value.suggestions.length>2)return null;
  const supported=new Set([...['recovery','sleep','load'].flatMap(id=>summary[id].reasons.flatMap(r=>r.inputs)),...['stress','energy','fitnessAge'].filter(id=>summary[id]&&summary[id].state!=='insufficient'),...summary.vitals.filter(v=>v.value!==null).map(v=>v.id),...['recovery','sleep','load'].filter(id=>summary[id].score!==null),...(summary.sleep.minutes!==null?['sleepMinutes']:[]),...Object.keys(summary.activity).filter(k=>summary.activity[k]!==null),...(summary.usage7.some(v=>v.activeMinutes!==null)?['usageActiveMinutes']:[]),...(summary.usage7.some(v=>v.lateNightMinutes!==null)?['usageLateNightMinutes']:[])]);
  let cross=0;
  const allNumbers=new Set(['7','28']);
  const numeric=value=>{if(typeof value==='number'&&Number.isFinite(value)){for(const n of [value,Math.round(value),Math.round(value*10)/10,Math.round(value*100)/100])allNumbers.add(String(n));}else if(Array.isArray(value))value.forEach(numeric);else if(value&&typeof value==='object')Object.values(value).forEach(numeric);};numeric(summary);
  for(const row of summary.usage7)if(row.sleepMinutes!==null){numeric(Math.floor(row.sleepMinutes/60));numeric(row.sleepMinutes%60);numeric(row.sleepMinutes/60);}
  for(const minutes of [summary.sleep.minutes,summary.sleep.targetMinutes])if(typeof minutes==='number'){numeric(minutes/60);numeric(Math.floor(minutes/60));numeric(minutes%60);}
  if(summary.sleep.minutes!==null)numeric(Math.abs(summary.sleep.minutes-summary.sleep.targetMinutes));
  for(const row of [...summary.vitals,...['recovery','sleep','load'].map(id=>({value:summary[id].score,baseline:summary[id].baseline}))])if(row.value!==null&&row.baseline!==null){numeric(Math.abs(row.value-row.baseline));if(row.baseline!==0)numeric(Math.abs((row.value-row.baseline)/row.baseline*100));}
  numeric(average(summary.usage7.map(r=>r.sleepMinutes)));numeric(summary.usage7.filter(r=>r.lateNightMinutes>0).length);
  const numbersSupported=content=>(content.match(/(?<![A-Za-z])\d+(?:\.\d+)?/g)??[]).every(n=>allNumbers.has(String(Number(n))));
  for(const o of value.observations){
    if(!exact(o,['text','inputs'],['text','inputs'])||!text(o.text,120)||!Array.isArray(o.inputs)||!o.inputs.length||o.inputs.some(id=>!supported.has(id)))return null;
    const usage=o.inputs.some(id=>id.startsWith('usage'));
    if(/电脑|深夜使用|凌晨.*(?:用|活跃)|熬夜/.test(o.text)&&!usage)return null;
    if(usage&&o.inputs.some(id=>!id.startsWith('usage'))){cross++;const lower=/比平时低|比你平时低|低于|下降|恢复.*低|睡眠.*低/.test(o.text);const paired=summary.usage7.some(row=>{const activity=o.inputs.includes('usageLateNightMinutes')?row.lateNightMinutes:row.activeMinutes;if(!(activity>0))return false;return o.inputs.filter(id=>!id.startsWith('usage')).some(id=>{const vital=row.day===summary.day&&summary.vitals.find(v=>v.id===id);return vital?vital.value!==null&&(!lower||vital.state==='low'):row[id]!=null&&(!lower||row[(id==='sleepMinutes'?'sleep':id)+'State']==='low');});});if(!paired)return null;}
    if(!numbersSupported(o.text))return null;
    if(usage&&/导致|造成|因为.*所以|因果/.test(o.text))return null;
  }
  if(cross>1)return null;
  for(const s of value.suggestions){if(!exact(s,['text','reminder'],['text'])||!text(s.text,120))return null;if(s.reminder){if(!exact(s.reminder,['title','time'],['title','time'])||!text(s.reminder.title,80)||typeof s.reminder.time!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s.reminder.time)||!Number.isFinite(Date.parse(s.reminder.time))||Date.parse(s.reminder.time)<=now)return null;}}
  return structuredClone(value);
}
export function identifyHealthSuggestions(insight,ownerId,day,generation){return {...insight,suggestions:insight.suggestions.map((s,n)=>({...s,id:`health-${digest(`${ownerId}|${day}|${generation}|${insight.mode}|${JSON.stringify(s)}|${n}`).slice(0,32)}`}))};}

/** Same background selection/priority/fallback as DATA-1. Claims survive restart. */
export function createHealthInsights(context,{debounceMs=250,timeoutMs=30000}={}){
  const timers=new Map(),jobs=new Map(),dirty=new Set();let closed=false;
  const today=owner=>localNotificationTime(context.timestamp(),context.usage.settings(owner).timeZone).day;
  const usageRevision=owner=>`${context.accountState(owner).dailyDigest?.generation??0}:${context.accountState(owner).dailyDigest?.computerUsageRevision??0}`;
  function cancel(owner){clearTimeout(timers.get(owner));timers.delete(owner);dirty.delete(owner);jobs.get(owner)?.controller.abort();}
  async function generate(owner){
    if(closed||jobs.has(owner)||context.dataControls?.isLocked(owner))return;
    const job={controller:new AbortController(),promise:null};jobs.set(owner,job);
    job.promise=(async()=>{
      const zone=context.usage.settings(owner).timeZone,day=today(owner),now=context.timestamp(),claimLimit=localNotificationTime(now,zone).time<'06:00'?2:3,revision=usageRevision(owner);let snapshot;
      await context.serial(()=>context.healthRecords.update(owner,s=>{
        const row=s.days[day];if(!row||row.health.status!=='available')return;
        if(!row.insight)row.insight=identifyHealthSuggestions(statisticalHealthInsight(s,context.accountState(owner),day,zone,now),owner,day,s.generation);
        const claims=s.modelClaims?.day===day?s.modelClaims.count:row.claims??0;
        if(!s.settings.modelInsightsEnabled||claims>=claimLimit||row.insightGeneration===s.generation&&row.insightUsageRevision===revision)return;
        snapshot=structuredClone(s);
      }));
      if(!snapshot||job.controller.signal.aborted)return;
      const account=context.accountState(owner),profileId=account.backgroundModelProfileId??currentChatProfile(account,id=>context.modelSelectable(owner,id));
      let insight=null;
      try{
        const catalog=await context.callBackend(()=>context.backend.listModels({ownerId:owner})),profile=context.visibleModels(owner,catalog).find(p=>p.id===profileId);
        if(profile&&context.backend.modelCompletion&&!job.controller.signal.aborted){
          let claimed=false;await context.serial(()=>context.healthRecords.update(owner,s=>{const row=s.days[day],claims=s.modelClaims?.day===day?s.modelClaims.count:row?.claims??0;if(s.generation===snapshot.generation&&s.settings.modelInsightsEnabled&&row&&claims<claimLimit&&(row.insightGeneration!==s.generation||row.insightUsageRevision!==revision)&&usageRevision(owner)===revision&&!job.controller.signal.aborted){s.modelClaims={day,count:claims+1};row.claims=claims+1;row.insightGeneration=s.generation;row.insightUsageRevision=revision;claimed=true;}}));if(!claimed)return;
          let reminderCount=0;for(const [sessionId,row]of Object.entries(account.sessions))if(row.origin==='personal-remote'&&!row.deleting&&context.backend.schedules){try{const list=await context.backend.schedules({ownerId:owner,sessionId,action:'list'});reminderCount+=(list.items??[]).filter(r=>r.kind==='reminder'&&r.nextRunAt&&localNotificationTime(Date.parse(r.nextRunAt),zone).day===day).length;}catch{/* Schedule failure means unavailable count, never original reminder text. */reminderCount=null;break;}}
          const summary=healthModelSummary(snapshot,context.healthOperations?.accountForDay(owner,day)??account,day,zone,reminderCount,now),signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(timeoutMs)]);
          // Race also bounds providers that fail to honor the supplied abort signal.
          const response=await abortable(context.backend.modelCompletion({ownerId:owner,profileId,priority:'background',purpose:'health-insight',signal,body:{model:profile.model,stream:false,max_tokens:1536,temperature:.2,messages:[{role:'system',content:HEALTH_INSIGHT_PROMPT},{role:'user',content:JSON.stringify(summary)}]}}),signal);
          if(response.ok){const result=JSON.parse(await abortable(boundedUpstreamBody(response,16384),signal)),value=JSON.parse(result.choices?.[0]?.message?.content??'null');insight=validateHealthInsight(value,summary,now);}else await response.body?.cancel();
        }
      }catch{/* Already committed statistics remain available. */}
      if(insight&&!closed&&!job.controller.signal.aborted)await context.serial(()=>context.healthRecords.update(owner,s=>{if(s.generation===snapshot.generation&&usageRevision(owner)===revision&&s.settings.modelInsightsEnabled&&s.days[day])s.days[day].insight=identifyHealthSuggestions({...insight,mode:'model',generatedAt:new Date(context.timestamp()).toISOString()},owner,day,s.generation);}));
    })().catch(()=>{}).finally(()=>{jobs.delete(owner);if(dirty.delete(owner)&&!closed)changed(owner);});
    return job.promise;
  }
  function changed(owner){if(closed)return;clearTimeout(timers.get(owner));if(jobs.has(owner)){dirty.add(owner);jobs.get(owner).controller.abort();return;}const timer=setTimeout(()=>{timers.delete(owner);void generate(owner);},debounceMs);timer.unref?.();timers.set(owner,timer);}
  async function usageChanged(owner,{clear=false}={}) {
    cancel(owner);
    const state=await context.healthRecords.read(owner),day=today(owner);
    if(clear?Object.values(state.days).some(row=>row.insight):state.days[day]?.health.status==='available')await context.serial(()=>context.healthRecords.update(owner,next=>{
      if(clear)for(const row of Object.values(next.days))delete row.insight;
      else if(next.days[day])delete next.days[day].insight;
    }));
    changed(owner);
  }
  return {changed,cancel,generate,usageChanged,async drain(owner){cancel(owner);await jobs.get(owner)?.promise;},async close(){closed=true;for(const owner of timers.keys())cancel(owner);for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(j=>j.promise));}};
}
function abortable(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(new Error('HEALTH_MODEL_UNAVAILABLE'));},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}Promise.resolve(promise).then(v=>{cleanup();resolve(v);},e=>{cleanup();reject(e);});});}
