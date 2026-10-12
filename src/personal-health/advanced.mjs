/** Our public-principle estimates. Parameters and limitations: docs/HEALTH.md. */
import reference from './fitness-reference.json' with {type:'json'};
import {localNotificationTime} from '../personal-access/notification-policy.mjs';
import {digestLocalInstant} from '../personal-access/memory-digest.mjs';
export const HEALTH_ESTIMATE_DISCLAIMER='按公开原理做的估计，不是医学结论，不等同于任何厂商的同名指标。';
const known=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=v=>Math.max(0,Math.min(100,v));
const round=v=>known(v)?Math.round(v*100)/100:null;
const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const record=(s,d)=>s.days?.[d]?.health?.status==='available'?s.days[d].health:null;
const mean=a=>a.length?a.reduce((n,v)=>n+v,0)/a.length:null;
const label=state=>({high:'比平时高',low:'比平时低',normal:'接近平时',insufficient:'再积累一些记录'})[state];
const rank=(v,a)=>a.length?100*(a.filter(n=>n<v).length+.5*a.filter(n=>n===v).length)/a.length:null;
function sleepPeriods(r,day,zone){
  const from=digestLocalInstant(day,'00:00',zone),to=digestLocalInstant(shift(day,1),'00:00',zone);
  const stages=r.sleep?.stages,intervals=stages?.length?stages.filter(s=>s.stage!=='awake'):r.sleep?.start&&r.sleep?.end?[{start:r.sleep.start,end:r.sleep.end}]:[],merged=[];
  for(const interval of intervals){const start=Date.parse(interval.start),end=Date.parse(interval.end);if(end<=from||start>=to)continue;const last=merged.at(-1);if(last&&start<=last.end)last.end=Math.max(last.end,end);else merged.push({start,end});}
  return merged.map(({start,end})=>({start:localNotificationTime(start,zone).time,end:localNotificationTime(end,zone).time}));
}
function asleep(r,time,zone,fallback=true){
  const t=Date.parse(time),stages=r?.sleep?.stages;
  if(stages?.length){const stage=stages.find(s=>Date.parse(s.start)<=t&&t<Date.parse(s.end));if(stage)return stage.stage!=='awake';}
  if(r?.sleep?.start&&r?.sleep?.end)return Date.parse(r.sleep.start)<=t&&t<Date.parse(r.sleep.end);
  if(!fallback)return false;
  // With no sleep interval, only compare conservative daytime measurements.
  const h=Number(localNotificationTime(t,zone).time.slice(0,2));return h<6||h>=23;
}
const awakeCache=new WeakMap(),gridCache=new WeakMap();
const method=s=>known(s.stressIndex)?'stressIndex':s.sdnnMs>0&&s.meanHeartRateBpm>0?'sdnnHeartRate':null;
function awakeSamples(s,day,zone,now=Infinity){const r=record(s,day);if(!r)return [];let cached=awakeCache.get(r);if(cached?.day!==day||cached?.zone!==zone||cached?.samples!==r.hrvSamples||cached?.sleep!==r.sleep){cached={day,zone,samples:r.hrvSamples,sleep:r.sleep,items:(r.hrvSamples??[]).filter(v=>method(v)&&localNotificationTime(Date.parse(v.time),zone).day===day&&!asleep(r,v.time,zone))};awakeCache.set(r,cached);}return cached.items.filter(v=>Date.parse(v.time)<=now);}
export function healthStress(records,day,zone='UTC',now=Infinity){
  const r=record(records,day);if(!r?.hrvSamples?.length&&!Array.from({length:28},(_,n)=>record(records,shift(day,-n-1))).some(v=>v?.hrvSamples?.length))return null;
  const historical=Array.from({length:28},(_,n)=>{const d=shift(day,-n-1);return {day:d,samples:awakeSamples(records,d,zone)};});
  const samples=awakeSamples(records,day,zone,now).map(s=>{
    const m=method(s),days=historical.filter(d=>d.samples.some(v=>method(v)===m)),h=days.flatMap(d=>d.samples.filter(v=>method(v)===m));
    let value=null;
    if(days.length>=7)value=m==='stressIndex'?rank(s.stressIndex,h.map(v=>v.stressIndex)):.8*rank(-Math.log(s.sdnnMs),h.map(v=>-Math.log(v.sdnnMs)))+.2*rank(s.meanHeartRateBpm,h.map(v=>v.meanHeartRateBpm));
    return {time:s.time,value:round(value),method:m,baselineDays:days.length};
  });
  const latest=samples.at(-1),average=round(mean(samples.map(s=>s.value).filter(known))),score=latest?.value??null,state=score===null?'insufficient':score<15?'low':score>85?'high':'normal';
  return {score,average,latest:latest?{value:latest.value,time:latest.time}:null,samples:samples.map(({baselineDays,...s})=>s),baselineDays:latest?.baselineDays??0,state,label:label(state),missing:!samples.length?['awakeHrvSamples']:score===null?['baseline7Days']:[],disclaimer:HEALTH_ESTIMATE_DISCLAIMER};
}
export function healthEnergy(records,day,zone='UTC',scores={},stress=null,now=Infinity){
  const r=record(records,day);if(!r||!(r.heartRateQuarterHourly?.some(v=>known(v?.avg))||r.heartRateHourly?.some(v=>known(v?.avg))))return null;
  const missing=[];if(!r.sleep?.stages?.length&&!(r.sleep?.start&&r.sleep?.end))missing.push('sleepTiming');if(!known(r.sleepMinutes))missing.push('sleepMinutes');if(!known(scores.sleep?.score))missing.push('sleepScore');if(!known(scores.recovery?.score))missing.push('recoveryScore');if(!(r.restingHeartRateBpm>0))missing.push('restingHeartRateBpm');
  let value=missing.some(k=>k!=='sleepTiming')?null:clamp(20+.3*scores.sleep.score+.2*scores.recovery.score),nightCharged=0,dayDrained=0,degraded=false;
  const quality=known(scores.sleep?.score)&&known(scores.recovery?.score)?(scores.sleep.score+scores.recovery.score)/2:null,curve=[];
  let grid=gridCache.get(r);if(grid?.day!==day||grid?.zone!==zone){grid={day,zone,values:Array.from({length:96},(_,i)=>{const time=String(Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0');return {time,start:digestLocalInstant(day,time,zone)};})};gridCache.set(r,grid);}
  for(let i=0;i<96;i++){
    const {time,start}=grid.values[i],end=start+15*60000;
    let hr=r.heartRateQuarterHourly?.[i]?.avg;
    if(!known(hr)){hr=r.heartRateHourly?.[Math.floor(i/4)]?.avg;if(end<=now){degraded=true;if(!known(hr)&&!missing.includes('heartRateGaps'))missing.push('heartRateGaps');}}
    if(end>now||!known(value)||!known(hr)){curve.push({time,value:null});continue;}
    const t=start+7.5*60000,sleeping=asleep(r,new Date(t).toISOString(),zone,false),recent=stress?.samples.findLast(s=>Date.parse(s.time)<=t&&t-Date.parse(s.time)<=6*3600000&&known(s.value));
    const pressure=recent?.value??50;if(!recent&&!missing.includes('recentStress'))missing.push('recentStress');
    const quiet=hr<=r.restingHeartRateBpm+5&&recent&&pressure<35;
    const delta=sleeping ? .5+1.5*quality/100 : quiet ? .25*quality/100 : -(.4+1.2*Math.min(1,Math.max(0,(hr-r.restingHeartRateBpm)/40))+.8*pressure/100);
    const before=value;value=clamp(value+delta);if(sleeping)nightCharged+=Math.max(0,value-before);else dayDrained+=Math.max(0,before-value);
    curve.push({time,value:round(value)});
  }
  const values=curve.map(v=>v.value).filter(known),current=values.at(-1)??null,state=current===null?'insufficient':current<25?'low':current>75?'high':'normal';
  return {score:current,current,curve,sleepPeriods:sleepPeriods(r,day,zone),highest:values.length?Math.max(...values):null,lowest:values.length?Math.min(...values):null,nightCharged:values.length?round(nightCharged):null,dayDrained:values.length?round(dayDrained):null,degraded,state,label:current===null?'还缺一些记录':state==='low'?'电能偏低':state==='high'?'电能充足':'按自己的节奏',missing,disclaimer:HEALTH_ESTIMATE_DISCLAIMER};
}
export function invertFitnessAge(vo2Max,sex){
  const a=reference.ageAnchors,v=reference[sex];if(!v||!known(vo2Max))return null;
  if(vo2Max>=v[0])return {fitnessAge:a[0],bounded:vo2Max>v[0]};
  if(vo2Max<=v.at(-1))return {fitnessAge:a.at(-1),bounded:vo2Max<v.at(-1)};
  const i=v.findIndex((n,i)=>i<v.length-1&&vo2Max<=n&&vo2Max>=v[i+1]);
  return {fitnessAge:round(a[i]+(v[i]-vo2Max)/(v[i]-v[i+1])*(a[i+1]-a[i])),bounded:false};
}
export function healthFitnessAge(records,day){
  const profile=records.profile,trend=Array.from({length:60},(_,n)=>{const d=shift(day,n-59);return {day:d,value:record(records,d)?.vo2Max??null};}),latest=trend.findLast(t=>t.value>0);
  if(!profile&&!latest)return null;
  const missing=[];if(!Number.isInteger(profile?.birthYear))missing.push('birthYear');if(!['male','female'].includes(profile?.sex))missing.push('sex');if(!latest)missing.push('vo2Max');
  const actualAge=Number.isInteger(profile?.birthYear)?Number(day.slice(0,4))-profile.birthYear:null;if(actualAge!==null&&actualAge<20)missing.push('adultReference');
  const result=missing.length?{fitnessAge:null,bounded:false}:invertFitnessAge(latest.value,profile.sex),difference=known(result.fitnessAge)&&known(actualAge)?round(result.fitnessAge-actualAge):null;
  const index=known(actualAge)&&actualAge>=20?Math.min(5,Math.floor(actualAge/10)-2):null,percentiles=reference.percentiles[profile?.sex],referenceRange=index!==null&&percentiles?{low:percentiles['25'][index],high:percentiles['75'][index]}:null;
  return {...result,actualAge,difference,referenceRange,vo2Max:latest?.value??null,vo2MaxDay:latest?.day??null,trend,state:missing.length?'insufficient':difference<0?'low':difference>0?'high':'normal',label:missing.length?'还缺一些资料':difference<0?'体能比同龄参考年轻':difference>0?'体能比同龄参考年长':'接近同龄参考',missing,disclaimer:HEALTH_ESTIMATE_DISCLAIMER};
}
export function healthAdvanced(records,day,zone,scores,now=Infinity){const stress=healthStress(records,day,zone,now);return {stress,energy:healthEnergy(records,day,zone,scores,stress,now),fitnessAge:healthFitnessAge(records,day)};}
