import {failure,exactKeys,boundedUpstreamBody} from '../personal-access/common.mjs';
import {currentChatProfile} from '../background-model-selection.mjs';
import {localNotificationTime} from '../personal-access/notification-policy.mjs';
import {healthOverview,healthMetrics,healthShiftDay,VITAL_IDS} from './analysis.mjs';
import {validHealthDay} from './records-schema.mjs';
import {HEALTH_UNSAFE_TEXT} from './insight.mjs';

export const HEALTH_ANALYSIS_SCOPES=['recovery','sleep','load','stress','energy','fitnessAge','activity',...VITAL_IDS.map(id=>'vital:'+id)];
export const HEALTH_ITEM_PROMPT='根据这一项的汇总数字输出严格JSON：{text,points,basis}。text是第一句结论加简短解释，最多200字；points最多3条、每条最多80字；basis只从输入basis选择。用人话，只描述记录和趋势，不编造数字，不推断没有的测量。压力、电能、体能年龄是按公开原理做的估计。只描述同时出现的变化，不声称因果。严禁医学诊断、疾病名、药名、建议用药；不作医学结论。不足数据就照实说，不把缺测当零。';
const names={recovery:'恢复',sleep:'睡眠',load:'负荷',stress:'压力',energy:'电能',fitnessAge:'体能年龄',activity:'活动',restingHeartRateBpm:'静息心率',hrvSdnnMs:'心率变异性',respiratoryRateBrpm:'呼吸频率',spo2Pct:'血氧',wristTempC:'手腕温度'};
const known=v=>typeof v==='number'&&Number.isFinite(v);
const mean=values=>{const a=values.filter(known);return a.length?Math.round(a.reduce((n,v)=>n+v,0)/a.length*100)/100:null;};
export function healthItemSummary(state,account,scope,day,zone,now=Infinity){
  const id=scope.startsWith('vital:')?scope.slice(6):scope,ids=id==='activity'?['steps','exerciseMinutes','activeEnergyKcal']:id==='fitnessAge'?['fitnessAge','vo2Max']:id==='sleep'?['sleep','sleepMinutes','deepMinutes','remMinutes','awakeMinutes']:id==='load'?['load','workoutMinutes','activeEnergyKcal']:[id];
  const series=Object.fromEntries(ids.map(metric=>[metric,healthMetrics(state,account,metric,60,day,zone,now).points]));
  const overview=healthOverview(state,account,day,zone,now),related={};
  for(const metric of (id==='sleep'?['recovery','usageLateNightMinutes']:id==='recovery'?['sleepMinutes','usageLateNightMinutes']:id==='load'?['recovery','sleepMinutes']:id==='energy'?['sleepMinutes','stress']:id==='stress'?['restingHeartRateBpm','sleepMinutes']:[]))related[metric]=healthMetrics(state,account,metric,7,day,zone,now).points.map(({day,value})=>({day,value}));
  const basis=ids.filter(metric=>series[metric].some(p=>known(p.value))).map(metric=>'近60天的'+(names[metric]??{vo2Max:'最大摄氧量',steps:'步数',exerciseMinutes:'运动分钟',activeEnergyKcal:'活动能量',sleepMinutes:'睡眠时长',deepMinutes:'深睡时长',remMinutes:'快速眼动时长',awakeMinutes:'清醒时长',workoutMinutes:'运动时长'}[metric]??metric));
  if(scope.startsWith('vital:')&&series[id].some(p=>known(p.baseline)))basis.push('近28天的个人基线');
  for(const [metric,points]of Object.entries(related))if(points.some(p=>known(p.value)))basis.push('近7天的'+(names[metric]??{sleepMinutes:'睡眠时长',usageLateNightMinutes:'深夜使用时长'}[metric]??metric));
  const states=Object.fromEntries(['recovery','sleep','load','stress','energy','fitnessAge'].map(key=>[key,{score:overview[key]?.score??overview[key]?.fitnessAge??null,state:overview[key]?.state??'insufficient'}]));
  return {scope,day,series,related,states,basis,fitnessComparison:id==='fitnessAge'?{actualAge:overview.fitnessAge?.actualAge??null,difference:overview.fitnessAge?.difference??null,referenceRange:overview.fitnessAge?.referenceRange??null}:undefined};
}
export function statisticalItemAnalysis(summary,now){
  const id=summary.scope.startsWith('vital:')?summary.scope.slice(6):summary.scope,name=names[id],primary=Object.values(summary.series)[0],latest=primary.at(-1)?.value??null,average=mean(primary.map(p=>p.value)),state=summary.states[id]?.state??primary.at(-1)?.state;
  const text=latest===null?`${name}还缺一些记录，先积累数据再看对比。`:`${name}今天的记录为 ${latest}${id==='fitnessAge'?' 岁':id==='activity'?' 步':summary.scope.startsWith('vital:')?'':' 分'}。${state==='insufficient'?'个人对比还需要积累。':'可以结合接下来几天的趋势看看。'}`;
  return {scope:summary.scope,day:summary.day,mode:'statistics',text,points:average===null?[]:[`近60天有记录的平均值为 ${average}。`],basis:summary.basis,generatedAt:new Date(now).toISOString()};
}
export function validateItemAnalysis(value,summary){
  const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&!HEALTH_UNSAFE_TEXT.test(v)&&!/(?:导致|造成|因为.*所以|医学结论|已经证明)/.test(v);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='basis,points,text'||!text(value.text,200)||!Array.isArray(value.points)||value.points.length>3||value.points.some(v=>!text(v,80))||!Array.isArray(value.basis)||value.basis.length>summary.basis.length||value.basis.some(v=>!summary.basis.includes(v)))return null;
  const numbers=new Set(['7','28','60']);
  const collect=v=>{if(known(v))for(const n of [v,Math.round(v),Math.round(v*10)/10,Math.round(v*100)/100]){numbers.add(String(n));numbers.add(String(Math.abs(n)));}else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.entries(v).filter(([k])=>k!=='day').forEach(([,n])=>collect(n));};
  for(const points of [...Object.values(summary.series),...Object.values(summary.related)])for(const row of points)for(const part of row.day.split('-'))numbers.add(String(Number(part)));
  collect(summary);for(const points of [...Object.values(summary.series),...Object.values(summary.related)]){collect(mean(points.map(p=>p.value)));collect(points.filter(p=>known(p.value)).length);}
  for(const content of [value.text,...value.points])if((content.match(/(?<![A-Za-z])\d+(?:\.\d+)?/g)??[]).some(n=>!numbers.has(String(Number(n)))))return null;
  if(!Object.values(summary.series).some(p=>p.some(v=>known(v.value)))&&!/缺|未|积累|不足|没有/.test(value.text))return null;
  return structuredClone(value);
}
function bounded(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(Error('HEALTH_MODEL_UNAVAILABLE'));},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)return abort();Promise.resolve(promise).then(v=>{cleanup();resolve(v);},e=>{cleanup();reject(e);});});}
/** Only explicit expansion calls generate. Claims and cache belong to the account file. */
export function createHealthItemAnalysis(context,{timeoutMs=30000}={}){
  const flights=new Map();let closed=false;
  const today=owner=>localNotificationTime(context.timestamp(),context.usage.settings(owner).timeZone).day;
  function cancel(owner){for(const job of flights.values())if(job.owner===owner)job.controller.abort();}
  async function get(owner,day){const state=await context.healthRecords.read(owner);return {day,items:Object.values(state.itemAnalyses?.items??{}).filter(item=>item.day===day)};}
  async function generate(owner,input,authorize=()=>{}){
    exactKeys(input,['scope','day'],['scope','day']);const day=validHealthDay(input.day);if(!HEALTH_ANALYSIS_SCOPES.includes(input.scope)||day>today(owner))throw failure('INVALID_REQUEST');
    const initial=await context.healthRecords.read(owner);if(!initial.settings.itemAnalysisEnabled)throw failure('AI_ANALYSIS_OFF',409);
    if(initial.settings.retentionDays!==null&&day<healthShiftDay(today(owner),1-initial.settings.retentionDays))throw failure('INVALID_REQUEST');
    const key=day+':'+input.scope,flightKey=owner+':'+key;
    if(initial.itemAnalyses?.items?.[key]){authorize();return initial.itemAnalyses.items[key];}
    if(closed||context.dataControls?.isLocked(owner))throw failure('SERVICE_CLOSING',503);
    if(flights.has(flightKey)){const value=await flights.get(flightKey).promise;authorize();return value;}
    const job={owner,controller:new AbortController(),promise:null};
    job.promise=(async()=>{
      const claimDay=today(owner);let snapshot,cached;
      await context.serial(()=>context.healthRecords.update(owner,s=>{if(!s.settings.itemAnalysisEnabled)throw failure('AI_ANALYSIS_OFF',409);s.itemAnalyses??={day:claimDay,count:0,items:{}};cached=s.itemAnalyses.items[key];if(cached)return;const count=s.itemAnalysisClaims?.day===claimDay?s.itemAnalysisClaims.count:s.itemAnalyses.count;if(count>=40)throw failure('AI_ANALYSIS_LIMIT',429);s.itemAnalysisClaims={day:claimDay,count:count+1};s.itemAnalyses.count=count+1;snapshot=structuredClone(s);},authorize));
      if(cached)return cached;
      const now=context.timestamp(),zone=context.usage.settings(owner).timeZone,account=context.healthOperations?.accountForDay(owner,day)??context.accountState(owner),summary=healthItemSummary(snapshot,account,input.scope,day,zone,now);
      let value=statisticalItemAnalysis(summary,now);
      try{
        const profileId=account.backgroundModelProfileId??currentChatProfile(account,id=>context.modelSelectable(owner,id)),signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(timeoutMs)]);
        const catalog=await bounded(context.callBackend(()=>context.backend.listModels({ownerId:owner})),signal),profile=context.visibleModels(owner,catalog).find(p=>p.id===profileId);
        if(profile&&context.backend.modelCompletion&&!signal.aborted){
          const response=await bounded(context.backend.modelCompletion({ownerId:owner,profileId,priority:'background',purpose:'health-insight',signal,body:{model:profile.model,stream:false,max_tokens:1536,temperature:.2,messages:[{role:'system',content:HEALTH_ITEM_PROMPT},{role:'user',content:JSON.stringify(summary)}]}}),signal);
          if(response.ok){const result=JSON.parse(await bounded(boundedUpstreamBody(response,16384),signal)),valid=validateItemAnalysis(JSON.parse(result.choices?.[0]?.message?.content??'null'),summary);if(valid)value={...value,...valid,mode:'model'};}else await response.body?.cancel();
        }
      }catch{/* Safe same-shape statistics remain available. */}
      await context.serial(()=>context.healthRecords.update(owner,s=>{if(!s.settings.itemAnalysisEnabled||job.controller.signal.aborted)throw failure('AI_ANALYSIS_OFF',409);if(closed||today(owner)!==claimDay||(snapshot.dataGeneration??0)!==(s.dataGeneration??0)||context.dataControls?.isLocked(owner))throw failure('HEALTH_DATA_CHANGED',409);s.itemAnalyses.items[key]=value;},authorize));
      return value;
    })().finally(()=>flights.delete(flightKey));flights.set(flightKey,job);return job.promise;
  }
  return {get,generate,cancel,async close(){closed=true;for(const job of flights.values())job.controller.abort();await Promise.allSettled([...flights.values()].map(j=>j.promise));}};
}
