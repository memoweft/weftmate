/** Daily aggregates only; nullable measurements are never replaced by zero. */
import { failure, exactKeys, plainObject } from '../personal-access/common.mjs';

const base = ['version','status','steps','sleepMinutes','restingHeartRateBpm','exerciseMinutes','workouts'];
const extra = ['activeEnergyKcal','sleep','hrvSdnnMs','respiratoryRateBrpm','spo2Pct','wristTempC','vo2Max','heartRateHourly'];
const v3 = ['hrvSamples','heartRateQuarterHourly'];
const invalid = () => { throw failure('INVALID_REQUEST'); };
export const EMPTY_HEALTH = Object.freeze({version:1,status:'unavailable',steps:null,sleepMinutes:null,restingHeartRateBpm:null,exerciseMinutes:null,workouts:[]});
export function validHealthDay(day) {
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)invalid();
  return day;
}
export function healthInstant(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))invalid();
  validHealthDay(value.slice(0,10)); return value;
}
function number(value,max=Infinity,min=0,integer=false) {
  if(value===null||value===undefined)return;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isSafeInteger(value))invalid();
}
export function validateHealthRecord(input) {
  if(!plainObject(input)||![1,2,3].includes(input.version))invalid();
  exactKeys(input,input.version===1?base:[...base,...extra,...(input.version===3?v3:[])],base);
  if(!['available','unavailable'].includes(input.status))invalid();
  for(const key of base.slice(2,6)){if(input[key]===undefined)invalid();number(input[key],key.endsWith('Minutes')?1440:Infinity,0,key==='steps');}
  if(!Array.isArray(input.workouts))invalid();
  for(const row of input.workouts) {
    const workoutExtra=['start','kcal','avgHeartRateBpm','maxHeartRateBpm','zoneMinutes'];
    exactKeys(row,input.version===1?['type','minutes']:['type','minutes',...workoutExtra],['type','minutes']);
    if(typeof row.type!=='string'||!row.type.trim()||row.type.length>80||input.version===1&&row.minutes===null||row.minutes===undefined)invalid();
    number(row.minutes,1440);
    for(const k of ['kcal','avgHeartRateBpm','maxHeartRateBpm'])number(row[k]);
    if(row.start!=null)healthInstant(row.start);
    if(row.avgHeartRateBpm!=null&&row.maxHeartRateBpm!=null&&row.avgHeartRateBpm>row.maxHeartRateBpm)invalid();
    if(row.zoneMinutes!=null){if(!Array.isArray(row.zoneMinutes)||row.zoneMinutes.length!==5)invalid();for(const v of row.zoneMinutes){if(v===undefined)invalid();number(v,1440);}if(row.minutes!==null&&row.zoneMinutes.reduce((a,b)=>a+(b??0),0)-row.minutes>1e-9)invalid();}
  }
  for(const key of extra.filter(k=>!['sleep','heartRateHourly'].includes(k)))number(input[key],key==='spo2Pct'?100:Infinity,key==='wristTempC'?-Infinity:0);
  const output=structuredClone(input);
  if(input.sleep!=null){
    const keys=['minutes','inBedMinutes','start','end','deepMinutes','coreMinutes','remMinutes','awakeMinutes',...(input.version===3?['stages']:[])];exactKeys(input.sleep,keys);
    for(const key of keys.filter(k=>k.endsWith('Minutes')||k==='minutes'))number(input.sleep[key],1440);
    for(const k of ['start','end'])if(input.sleep[k]!=null)healthInstant(input.sleep[k]);
    if(input.sleep.start!=null&&input.sleep.end!=null&&Date.parse(input.sleep.end)<Date.parse(input.sleep.start))invalid();
    if(Object.hasOwn(input.sleep,'minutes')&&input.sleep.minutes!==input.sleepMinutes)invalid();
    output.sleep.minutes=input.sleepMinutes;
    const phases=['deepMinutes','coreMinutes','remMinutes'].reduce((n,k)=>n+(input.sleep[k]??0),0);
    if(input.sleepMinutes!=null&&phases>input.sleepMinutes||input.sleep.inBedMinutes!=null&&phases+(input.sleep.awakeMinutes??0)>input.sleep.inBedMinutes)invalid();
    if(input.sleep.stages!=null){
      if(!Array.isArray(input.sleep.stages)||input.sleep.stages.length>200)invalid();let end=-Infinity;
      for(const row of input.sleep.stages){exactKeys(row,['start','end','stage'],['start','end','stage']);healthInstant(row.start);healthInstant(row.end);if(!['deep','core','rem','awake'].includes(row.stage)||Date.parse(row.start)<end||Date.parse(row.end)<=Date.parse(row.start))invalid();end=Date.parse(row.end);}
    }
  }
  for(const [key,length]of [['heartRateHourly',24],['heartRateQuarterHourly',96]])if(input[key]!=null){
    if(!Array.isArray(input[key])||input[key].length!==length)invalid();
    for(const row of input[key]){if(row===null)continue;exactKeys(row,['avg','min','max'],['avg','min','max']);for(const v of Object.values(row)){if(v===undefined)invalid();number(v);}if(row.min!=null&&row.avg!=null&&row.min>row.avg||row.avg!=null&&row.max!=null&&row.avg>row.max||row.min!=null&&row.max!=null&&row.min>row.max)invalid();}
  }
  if(input.hrvSamples!=null){
    if(!Array.isArray(input.hrvSamples)||input.hrvSamples.length>96)invalid();let last=-Infinity;
    for(const row of input.hrvSamples){exactKeys(row,['time','sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm'],['time','sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm']);healthInstant(row.time);if(Date.parse(row.time)<=last)invalid();last=Date.parse(row.time);for(const k of ['sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm']){if(row[k]===undefined)invalid();number(row[k]);}}
  }
  if(input.status==='unavailable'){
    const values=[...base.slice(2,6).map(k=>input[k]),...extra.filter(k=>!['sleep','heartRateHourly'].includes(k)).map(k=>input[k]),...Object.values(input.sleep??{}),...(input.heartRateHourly??[]),...(input.heartRateQuarterHourly??[]),...(input.hrvSamples??[])];
    if(input.workouts.length||values.some(v=>v!=null))invalid();
  }
  return output;
}
export const HEALTH_DEFAULTS=Object.freeze({modelInsightsEnabled:true,itemAnalysisEnabled:false,sleepTargetMinutes:450,retentionDays:400});
export function healthSettingsPatch(input) {
  exactKeys(input,['modelInsightsEnabled','itemAnalysisEnabled','sleepTargetMinutes','retentionDays','clear']);
  if(!Object.keys(input).length||input.modelInsightsEnabled!==undefined&&typeof input.modelInsightsEnabled!=='boolean'||input.clear!==undefined&&input.clear!==true)invalid();
  if(input.itemAnalysisEnabled!==undefined&&typeof input.itemAnalysisEnabled!=='boolean')invalid();
  if(input.sleepTargetMinutes!==undefined){number(input.sleepTargetMinutes,720,180,true);if(input.sleepTargetMinutes===null)invalid();}
  if(Object.hasOwn(input,'retentionDays')&&![90,180,400,null].includes(input.retentionDays))invalid();
  return structuredClone(input);
}
export function validateHealthProfile(input,currentYear=new Date().getUTCFullYear()){
  exactKeys(input,['version','birthYear','sex','heightCm','weightKg'],['version','birthYear','sex','heightCm','weightKg']);
  if(input.version!==1||!['male','female','other',null].includes(input.sex))invalid();
  if(['birthYear','heightCm','weightKg'].some(k=>input[k]===undefined))invalid();
  number(input.birthYear,currentYear,1900,true);
  for(const key of ['heightCm','weightKg']){number(input[key]);if(input[key]!==null&&input[key]<=0)invalid();}
  return structuredClone(input);
}
