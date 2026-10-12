/** Wholly synthetic, seeded aggregates. No reference images or personal records. */
import { healthShiftDay,healthOverview } from '../../src/personal-health/analysis.mjs';
import { digestLocalInstant } from '../../src/personal-access/memory-digest.mjs';
export function generateHealthSequence({seed=24017,days=90,to='2026-10-12',timeZone='Asia/Shanghai',version=2}={}) {
  let n=seed>>>0;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;},jitter=amount=>(random()-.5)*amount,one=v=>Math.round(v*10)/10;
  const items=[],usageDays={},events=[];
  for(let i=0;i<days;i++){
    const day=healthShiftDay(to,i-days+1),weekday=new Date(day+'T00:00:00Z').getUTCDay(),weekend=weekday===0||weekday===6,late=i>=days-12&&i<=days-9,raised=i>=days-36&&i<=days-33,missing=i%19===5;
    const minutes=Math.round((weekend?490:455)-(late?85:0)+jitter(36)),exercise=Math.max(0,Math.round((weekend?52:28)+jitter(20))),bedtime=late?'01:20':'23:05';
    const start=digestLocalInstant(healthShiftDay(day,late?0:-1),bedtime,timeZone),end=start+minutes*60000,deep=Math.round(minutes*.16+jitter(12)),rem=Math.round(minutes*.23+jitter(12)),core=minutes-deep-rem,awake=Math.round(18+jitter(12));
    const health={version:2,status:missing?'unavailable':'available',steps:missing?null:Math.round((weekend?9600:6800)+jitter(2200)),sleepMinutes:missing?null:minutes,restingHeartRateBpm:missing?null:one(57+jitter(4)+(late?5:0)+(raised?9:0)),exerciseMinutes:missing?null:exercise,activeEnergyKcal:missing?null:one(390+exercise*3+jitter(90)),sleep:missing?null:{minutes,inBedMinutes:minutes+awake,start:new Date(start).toISOString(),end:new Date(end).toISOString(),deepMinutes:deep,coreMinutes:core,remMinutes:rem,awakeMinutes:awake},hrvSdnnMs:missing||i%13===4?null:one(48+jitter(9)-(late?14:0)-(raised?8:0)),respiratoryRateBrpm:missing?null:one(14+jitter(1)),spo2Pct:missing||i%11===3?null:one(97+jitter(1)),wristTempC:missing?null:one(35.4+jitter(.4)+(raised?.7:0)),vo2Max:missing?null:one(42+jitter(2)),heartRateHourly:missing?null:Array.from({length:24},(_,h)=>h%8===2?null:{avg:one(66+(h>8&&h<19?10:0)+jitter(4)),min:54,max:105}),workouts:missing||i%3===0?[]:[{type:weekend?'骑行':'步行',start:new Date(digestLocalInstant(day,'17:30',timeZone)).toISOString(),minutes:exercise,kcal:one(exercise*4),avgHeartRateBpm:118,maxHeartRateBpm:146,zoneMinutes:[exercise*.4,exercise*.3,exercise*.2,exercise*.1,0].map(one)}]};
    // Rounding zones must never exceed exact workout minutes.
    if(health.workouts.length){const w=health.workouts[0];w.zoneMinutes[0]=one(w.minutes-w.zoneMinutes.slice(1).reduce((a,b)=>a+b,0));}
    if(version===3){
      health.version=3;
      health.hrvSamples=missing?null:['08:30','12:30','16:30','20:30'].map((time,j)=>({time:new Date(digestLocalInstant(day,time,timeZone)).toISOString(),sdnnMs:one(48+jitter(8)-(late?17:0)),rmssdMs:j%2===0?one(40+jitter(6)-(late?12:0)):null,stressIndex:j%2===0?one(100+jitter(24)+(late?130:0)):null,meanHeartRateBpm:j%2===0?one(66+jitter(6)+(late?17:0)):null}));
      health.heartRateQuarterHourly=missing?null:Array.from({length:96},(_,q)=>({avg:one((q<28?55:q>32&&q<76?76:64)+jitter(4)+(late?14:0)),min:48,max:120}));
      if(health.sleep)health.sleep.stages=[{start:new Date(start).toISOString(),end:new Date(start+deep*60000).toISOString(),stage:'deep'},{start:new Date(start+deep*60000).toISOString(),end:new Date(start+(deep+core)*60000).toISOString(),stage:'core'},{start:new Date(start+(deep+core)*60000).toISOString(),end:new Date(end).toISOString(),stage:'rem'}];
    }
    items.push({day,health});
    const active=weekend?35:95,lateMinutes=late?40:0;
    usageDays[day]={usage:{lastUserMessageAt:new Date(digestLocalInstant(day,late?'01:35':'14:00',timeZone)+(late?0:active-5)*60000).toISOString(),estimatedActiveMinutes:active+lateMinutes,lateNightMinutes:lateMinutes,hourlyTurns:Array.from({length:24},(_,h)=>h===14?active/5:late&&h===1?lateMinutes/5:0),models:{}},tasks:{completed:weekend?1:3}};
    for(let m=0;m<active;m+=5)events.push({seq:events.length,type:'user.message',at:new Date(digestLocalInstant(day,'14:00',timeZone)+m*60000).toISOString(),data:{text:'SYNTHETIC PRIVATE BODY'}});
    if(late)for(let m=0;m<lateMinutes;m+=5)events.push({seq:events.length,type:'user.message',at:new Date(digestLocalInstant(day,'01:00',timeZone)+m*60000).toISOString(),data:{text:'SYNTHETIC PRIVATE BODY'}});
  }
  return {items,usageDays,events,seed,timeZone,...(version===3?{profile:{version:1,birthYear:1988,sex:'male',heightCm:175,weightKg:72}}:{})};
}

/** Page package entry: explicit v3 retains old v2 fixture callers unchanged. */
export const generateHealthV3Sequence=options=>generateHealthSequence({...options,version:3});

/** HEALTH-6 page gallery seam, uses production algorithms on entirely synthetic records. */
export function generateHealthV3Fixture(options={}) {
  const data=generateHealthV3Sequence(options),day=data.items.at(-1)?.day,records={generation:1,settings:{modelInsightsEnabled:true,itemAnalysisEnabled:false,sleepTargetMinutes:450,retentionDays:400},profile:data.profile,days:Object.fromEntries(data.items.map(r=>[r.day,{health:r.health,updatedAt:day+'T00:00:00Z'}]))};
  return {...data,records,overview:day?healthOverview(records,{dailyDigest:{days:data.usageDays}},day,data.timeZone):null};
}
