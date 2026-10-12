/** Versioned, deterministic personal comparisons. No model and no population thresholds. */
import { localNotificationTime } from '../personal-access/notification-policy.mjs';
import { HEALTH_DEFAULTS } from './records-schema.mjs';
export const HEALTH_ALGORITHM_VERSION=1;
const DAY=86400000;
export const healthShiftDay=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
export const VITAL_IDS=['restingHeartRateBpm','hrvSdnnMs','respiratoryRateBrpm','spo2Pct','wristTempC'];
export const METRIC_IDS=[...VITAL_IDS,'vo2Max','activeEnergyKcal','exerciseMinutes','steps','sleepMinutes','inBedMinutes','deepMinutes','coreMinutes','remMinutes','awakeMinutes','recovery','sleep','load','usageActiveMinutes','usageLateNightMinutes','heartRateAvgBpm','heartRateMinBpm','heartRateMaxBpm','workoutMinutes'];
const known=v=>typeof v==='number'&&Number.isFinite(v);
const round=v=>known(v)?Math.round(v*100)/100:null;
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
export function percentile(values,p){const a=values.filter(known).sort((a,b)=>a-b);if(!a.length)return null;const i=(a.length-1)*p,l=Math.floor(i);return a[l]+(a[Math.ceil(i)]-a[l])*(i-l);}
export const average=values=>{const a=values.filter(known);return a.length?a.reduce((a,b)=>a+b,0)/a.length:null;};
const record=(state,day)=>state.days?.[day]?.health?.status==='available'?state.days[day].health:null;
export function metricValue(state,account={},day,id) {
  const r=record(state,day),usage=account.dailyDigest?.days?.[day]?.usage;
  if(id==='usageActiveMinutes')return usage?.estimatedActiveMinutes??null;
  if(id==='usageLateNightMinutes')return usage?.lateNightMinutes??null;
  if(!r)return null;
  if(['inBedMinutes','deepMinutes','coreMinutes','remMinutes','awakeMinutes'].includes(id))return r.sleep?.[id]??null;
  if(id==='workoutMinutes')return r.workouts.length?(r.workouts.some(w=>known(w.minutes))?r.workouts.reduce((n,w)=>n+(w.minutes??0),0):null):0;
  if(id.startsWith('heartRate')){const k={heartRateAvgBpm:'avg',heartRateMinBpm:'min',heartRateMaxBpm:'max'}[id],values=(r.heartRateHourly??[]).map(v=>v?.[k]).filter(known);return !values.length?null:id==='heartRateAvgBpm'?average(values):id==='heartRateMinBpm'?Math.min(...values):Math.max(...values);}
  return r[id]??null;
}
export function comparison(value,values){
  const a=values.filter(known);if(a.length<7)return {value:value??null,baseline:null,low:null,high:null,state:'insufficient',label:'再戴几天就有对比了'};
  if(!known(value))return {value:null,baseline:percentile(a,.5),low:percentile(a,.15),high:percentile(a,.85),state:'insufficient',label:'未记录'};
  const baseline=percentile(a,.5),low=percentile(a,.15),high=percentile(a,.85),state=value<low?'low':value>high?'high':'normal';
  return {value,baseline,low,high,state,label:{normal:'正常',low:'比平时低',high:'比平时高'}[state]};
}
const previous=(state,day,id,account={})=>Array.from({length:28},(_,n)=>metricValue(state,account,healthShiftDay(day,-n-1),id));
const vital=(state,day,id,account)=>({id,...comparison(metricValue(state,account,day,id),previous(state,day,id,account))});
const emptyScore=(missing=[])=>({score:null,state:'insufficient',label:'再戴几天就有对比了',reasons:[],missing,baseline:null,low:null,high:null});
const relative=(value,baseline,scale,direction=1)=>clamp(70+direction*30*(value-baseline)/scale);
function combine(parts,all){
  const valid=parts.filter(p=>known(p.score)),missing=all.filter(id=>!valid.some(p=>p.inputs.includes(id)));
  if(!valid.length)return emptyScore(missing);
  const score=Math.round(valid.reduce((n,p)=>n+p.score*p.weight,0)/valid.reduce((n,p)=>n+p.weight,0));
  return {...emptyScore(missing),score,reasons:valid.sort((a,b)=>Math.abs(b.score-70)*b.weight-Math.abs(a.score-70)*a.weight).slice(0,3).map(({text,inputs})=>({text,inputs}))};
}
const sleepTimes=new WeakMap();
function sleepTime(r,zone){if(!r?.sleep?.start)return null;const cached=sleepTimes.get(r);if(cached?.start===r.sleep.start&&cached.zone===zone)return cached.value;const t=localNotificationTime(Date.parse(r.sleep.start),zone).time.split(':').map(Number),v=t[0]*60+t[1],value=v<720?v+1440:v;sleepTimes.set(r,{start:r.sleep.start,zone,value});return value;}
function rawSleep(state,day,zone){
  const r=record(state,day),target=state.settings?.sleepTargetMinutes??450,parts=[],all=['sleepMinutes','deepMinutes','remMinutes','awakeMinutes','sleepStartRegularity'];
  if(known(r?.sleepMinutes))parts.push({score:clamp(r.sleepMinutes/target*100),weight:.45,inputs:['sleepMinutes'],text:`睡眠 ${round(r.sleepMinutes)} 分钟，目标 ${target} 分钟`});
  const deep=r?.sleep?.deepMinutes,rem=r?.sleep?.remMinutes;
  if(known(deep)&&known(rem)&&r.sleepMinutes>0){const share=(deep+rem)/r.sleepMinutes,h=Array.from({length:28},(_,n)=>{const h=record(state,healthShiftDay(day,-n-1));return known(h?.sleep?.deepMinutes)&&known(h?.sleep?.remMinutes)&&h.sleepMinutes>0?(h.sleep.deepMinutes+h.sleep.remMinutes)/h.sleepMinutes:null;}),b=comparison(share,h);
    if(b.state!=='insufficient')parts.push({score:relative(share,b.baseline,Math.max(.05,(b.high-b.low)/2)),weight:.25,inputs:['deepMinutes','remMinutes'],text:`深睡和快速眼动占 ${round(share*100)}%，${b.label}`});}
  if(known(r?.sleep?.awakeMinutes)&&known(r?.sleepMinutes)&&r.sleepMinutes+r.sleep.awakeMinutes>0)parts.push({score:clamp(100-200*r.sleep.awakeMinutes/(r.sleepMinutes+r.sleep.awakeMinutes)),weight:.2,inputs:['awakeMinutes'],text:`夜里清醒 ${round(r.sleep.awakeMinutes)} 分钟`});
  const bedtime=sleepTime(r,zone),h=Array.from({length:28},(_,n)=>sleepTime(record(state,healthShiftDay(day,-n-1)),zone)).filter(known);
  if(known(bedtime)&&h.length>=7){const diff=Math.abs(bedtime-percentile(h,.5));parts.push({score:clamp(100-diff/1.5),weight:.1,inputs:['sleepStartRegularity'],text:`入睡比平时相差 ${round(diff)} 分钟`});}
  const result=combine(parts,all);
  // Seven actual sleep nights before this day are required for a judgment.
  return previous(state,day,'sleepMinutes').filter(known).length>=7?result:emptyScore(result.missing);
}
function rawRecovery(state,day){
  const parts=[],r=record(state,day),all=['hrvSdnnMs','restingHeartRateBpm','sleepMinutes','wristTempC'];
  for(const [id,weight,direction,minScale,name]of [['hrvSdnnMs',.35,1,1,'心率变异性'],['restingHeartRateBpm',.3,-1,1,'静息心率']]){const b=vital(state,day,id);if(b.state!=='insufficient')parts.push({score:relative(b.value,b.baseline,Math.max(minScale,(b.high-b.low)/2)),weight,inputs:[id],text:`${name}${b.label}`});}
  if(known(r?.sleepMinutes)&&previous(state,day,'sleepMinutes').filter(known).length>=7)parts.push({score:clamp(r.sleepMinutes/(state.settings?.sleepTargetMinutes??450)*100),weight:.25,inputs:['sleepMinutes'],text:`昨晚睡了 ${round(r.sleepMinutes)} 分钟`});
  const b=vital(state,day,'wristTempC');if(b.state!=='insufficient')parts.push({score:clamp(85-30*Math.abs(b.value-b.baseline)/Math.max(.1,(b.high-b.low)/2)),weight:.1,inputs:['wristTempC'],text:`手腕温度${b.label}`});
  return combine(parts,all);
}
function loadParts(state,day){
  const r=record(state,day);if(!r)return {exerciseMinutes:null,activeEnergyKcal:null};
  let weighted=null;
  if(r.workouts.length){const values=r.workouts.map(w=>Array.isArray(w.zoneMinutes)&&w.zoneMinutes.every(known)?w.zoneMinutes.reduce((n,m,i)=>n+m*(i+1),0):w.minutes).filter(known);if(values.length)weighted=values.reduce((n,v)=>n+v,0);}
  if(weighted===null&&known(r.exerciseMinutes))weighted=r.exerciseMinutes;
  const energy=r.activeEnergyKcal;
  return {exerciseMinutes:weighted,activeEnergyKcal:known(energy)?energy/10:null};
}
export function dailyLoad(state,day,mask=null){
  const parts=loadParts(state,day),keys=mask??Object.keys(parts).filter(k=>known(parts[k]));
  return keys.length&&keys.every(k=>known(parts[k]))?keys.reduce((n,k)=>n+parts[k],0):null;
}
function loadSelection(state,day){
  const parts=loadParts(state,day),history=Array.from({length:28},(_,n)=>loadParts(state,healthShiftDay(day,-n-1))),measured=Object.keys(parts).filter(k=>known(parts[k])),ready=measured.filter(k=>history.filter(p=>known(p[k])).length>=7);
  let mask=ready.length?ready:measured;
  if(ready.length===2&&history.filter(p=>ready.every(k=>known(p[k]))).length<7)mask=[...ready].sort((a,b)=>history.filter(p=>known(p[b])).length-history.filter(p=>known(p[a])).length).slice(0,1);
  return {mask,missing:Object.keys(parts).filter(k=>!ready.includes(k)||!mask.includes(k))};
}
function rawLoad(state,day){
  const {mask,missing}=loadSelection(state,day),daily=dailyLoad(state,day,mask),h=Array.from({length:28},(_,n)=>dailyLoad(state,healthShiftDay(day,-n-1),mask)),b=comparison(daily,h),result=emptyScore(missing);
  if(b.state==='insufficient')return result;
  return {...result,score:Math.round(clamp(50+25*(daily-b.baseline)/Math.max(1,(b.high-b.low)/2))),reasons:[{text:`今日负荷${b.label}`,inputs:mask}]};
}
export function healthScores(state,day,zone='UTC'){
  const raw={recovery:rawRecovery(state,day),sleep:rawSleep(state,day,zone),load:rawLoad(state,day)};
  for(const id of ['recovery','sleep','load']){
    const history=Array.from({length:28},(_,n)=>{const d=healthShiftDay(day,-n-1);return id==='recovery'?rawRecovery(state,d).score:id==='sleep'?rawSleep(state,d,zone).score:rawLoad(state,d).score;}),value=raw[id].score;
    // Input histories, rather than a second seven-day score warmup, govern readiness.
    const b=comparison(value,history);if(known(value)&&b.state==='insufficient'){b.state='normal';b.label='正常';}
    raw[id]={...raw[id],baseline:b.baseline,low:b.low,high:b.high,state:b.state,label:b.label};
  }
  const r=record(state,day);Object.assign(raw.sleep,{minutes:r?.sleepMinutes??null,targetMinutes:state.settings?.sleepTargetMinutes??450,start:r?.sleep?.start??null,end:r?.sleep?.end??null});
  const {mask}=loadSelection(state,day),loads=n=>Array.from({length:n},(_,i)=>dailyLoad(state,healthShiftDay(day,-i),mask)),a7=loads(7),a42=loads(42),avg7=average(a7),avg42=average(a42),diff=known(avg7)&&known(avg42)?avg7-avg42:null;
  Object.assign(raw.load,{daily:round(dailyLoad(state,day,mask)),average7:round(avg7),average42:round(avg42),difference:round(diff)});
  if(raw.load.score!==null){const tolerance=Math.max(1,(avg42??0)*.15),state=diff===null?'insufficient':diff>tolerance?'more':diff< -tolerance?'less':'balanced';Object.assign(raw.load,{state,label:{more:'练多了',less:'练少了',balanced:'刚好',insufficient:'再戴几天就有对比了'}[state]});}
  return raw;
}
export function healthOverview(state,account,day,zone='UTC'){
  state={settings:HEALTH_DEFAULTS,...state};const r=record(state,day),row=state.days?.[day],usage=account.dailyDigest?.days?.[day]?.usage;
  return {day,connected:Object.values(state.days??{}).some(d=>d.health.status==='available'),updatedAt:row?.updatedAt??null,insight:r?row.insight??null:null,...healthScores(state,day,zone),vitals:VITAL_IDS.map(id=>vital(state,day,id,account)),activity:{steps:r?.steps??null,activeEnergyKcal:r?.activeEnergyKcal??null,exerciseMinutes:r?.exerciseMinutes??null,workouts:r?.workouts??[]},usage:{activeMinutes:usage?.estimatedActiveMinutes??null,lateNightMinutes:usage?.lateNightMinutes??null}};
}
export function healthMetrics(state,account,id,days,today,zone){
  const points=Array.from({length:days},(_,n)=>{const day=healthShiftDay(today,n-days+1);if(['recovery','sleep','load'].includes(id)){const s=healthScores(state,day,zone)[id];return {day,value:s.score,baseline:s.baseline,low:s.low,high:s.high,state:s.state,label:s.label};}return {day,...vital(state,day,id,account)};});
  return {id,days,timeZone:zone,average:round(average(points.map(p=>p.value))),points};
}
export function healthCalendar(state,month,zone){const first=month+'-01',next=healthShiftDay(first,32).slice(0,7)+'-01',days=[];for(let day=first;day<next;day=healthShiftDay(day,1)){const s=healthScores(state,day,zone);days.push({day,hasWorkout:(record(state,day)?.workouts.length??0)>0,sleepScore:s.sleep.score,recoveryScore:s.recovery.score});}return {month,days};}
export function healthWeeklySummary(state,account,from,to,zone){
  const rows=[];for(let day=from;day<to;day=healthShiftDay(day,1))rows.push(healthOverview(state,account,day,zone));
  const sleep=round(average(rows.map(r=>r.sleep.minutes))),recovery=round(average(rows.map(r=>r.recovery.score))),workouts=rows.reduce((n,r)=>n+r.activity.workouts.length,0),late=rows.filter(r=>r.usage.lateNightMinutes>0),paired=rows.filter(r=>r.usage.lateNightMinutes>0&&r.recovery.state==='low');
  if(sleep===null&&recovery===null&&!workouts)return null;
  return {sleepMinutes:sleep,recoveryScore:recovery,workouts,lateNightDays:late.length,pairedLowRecoveryDays:paired.length,text:`这周健康：${sleep===null?'睡眠还缺记录':`平均睡眠 ${sleep} 分钟`}，${recovery===null?'恢复还在积累对比':`平均恢复 ${recovery} 分`}，运动 ${workouts} 次。${paired.length?`有 ${paired.length} 天凌晨还在使用、当天恢复也比平时低；这只是同时出现的记录。`:late.length?`有 ${late.length} 天凌晨还在使用，可以和睡眠记录一起看看。`:'已记录的使用中没有凌晨活动。'}`};
}
