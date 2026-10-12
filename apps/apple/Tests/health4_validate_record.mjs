import assert from 'node:assert/strict';
const base=['version','status','steps','sleepMinutes','restingHeartRateBpm','exerciseMinutes','workouts'];
const second=['activeEnergyKcal','sleep','hrvSdnnMs','respiratoryRateBrpm','spo2Pct','wristTempC','vo2Max','heartRateHourly'];
const third=['hrvSamples','heartRateQuarterHourly'];
function keys(object,allowed,required=[]){assert(object&&typeof object==='object'&&!Array.isArray(object));assert(Object.keys(object).every(k=>allowed.includes(k)));assert(required.every(k=>Object.hasOwn(object,k)));}
function number(v,max=Infinity,min=0){if(v!=null)assert(Number.isFinite(v)&&v>=min&&v<=max);}
function instant(v){if(v!=null)assert(typeof v==='string'&&Number.isFinite(Date.parse(v))&&/(Z|[+-]\d\d:\d\d)$/.test(v));}
function bucket(v){if(v==null)return;keys(v,['avg','min','max']);Object.values(v).forEach(x=>number(x));if(v.min!=null&&v.avg!=null)assert(v.min<=v.avg);if(v.max!=null&&v.avg!=null)assert(v.avg<=v.max);}
export function validateHealthRecord(h,supported=3){
 keys(h,[...base,...(h.version>=2?second:[]),...(h.version>=3?third:[])],base);
 assert([1,2,3].includes(h.version)&&h.version<=supported);assert(['available','unavailable'].includes(h.status));
 number(h.steps);if(h.steps!=null)assert(Number.isSafeInteger(h.steps));number(h.sleepMinutes,1440);number(h.exerciseMinutes,1440);number(h.restingHeartRateBpm);
 for(const key of ['activeEnergyKcal','hrvSdnnMs','respiratoryRateBrpm','vo2Max'])number(h[key]);number(h.spo2Pct,100);number(h.wristTempC,Infinity,-Infinity);
 assert(Array.isArray(h.workouts));
 for(const w of h.workouts){keys(w,['type','minutes',...(h.version>=2?['start','kcal','avgHeartRateBpm','maxHeartRateBpm','zoneMinutes']:[])],['type','minutes']);assert(typeof w.type==='string'&&w.type.trim()&&w.type.length<=80);number(w.minutes,1440);instant(w.start);number(w.kcal);number(w.avgHeartRateBpm);number(w.maxHeartRateBpm);if(w.zoneMinutes!=null){assert(w.zoneMinutes.length===5);w.zoneMinutes.forEach(x=>number(x,1440));assert(w.zoneMinutes.reduce((a,b)=>a+(b??0),0)<=w.minutes+1e-7);}}
 if(h.sleep!=null){const s=h.sleep;keys(s,['minutes','inBedMinutes','start','end','deepMinutes','coreMinutes','remMinutes','awakeMinutes',...(h.version>=3?['stages']:[])]);for(const k of ['minutes','inBedMinutes','deepMinutes','coreMinutes','remMinutes','awakeMinutes'])number(s[k],1440);instant(s.start);instant(s.end);if(s.start&&s.end)assert(Date.parse(s.end)>=Date.parse(s.start));if(s.minutes!=null)assert(s.minutes===h.sleepMinutes);const sleep=(s.deepMinutes??0)+(s.coreMinutes??0)+(s.remMinutes??0);assert(sleep<=(h.sleepMinutes??0)+1e-7);if(s.inBedMinutes!=null)assert(sleep+(s.awakeMinutes??0)<=s.inBedMinutes+1e-7);if(s.stages!=null){assert(s.stages.length<=200);for(const stage of s.stages){keys(stage,['start','end','stage'],['start','end','stage']);instant(stage.start);instant(stage.end);assert(Date.parse(stage.end)>=Date.parse(stage.start));assert(['deep','core','rem','awake'].includes(stage.stage));}}}
 for(const [k,count] of [['heartRateHourly',24],['heartRateQuarterHourly',96]])if(h[k]!=null){assert(h[k].length===count);h[k].forEach(bucket);}
 if(h.hrvSamples!=null){assert(h.hrvSamples.length<=96);let previous=-Infinity;for(const value of h.hrvSamples){keys(value,['time','sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm'],['time','sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm']);instant(value.time);assert(Date.parse(value.time)>=previous);previous=Date.parse(value.time);for(const k of ['sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm'])number(value[k]);}}
 if(h.status==='unavailable'){assert(h.workouts.length===0);for(const k of [...base.slice(2,6),...second.filter(k=>!['sleep','heartRateHourly'].includes(k))])assert(h[k]==null);assert(h.sleep==null);assert(!h.heartRateHourly?.some(Boolean));assert(!h.heartRateQuarterHourly?.some(Boolean));assert(!h.hrvSamples?.length);}
 return structuredClone(h);
}
