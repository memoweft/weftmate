/** Seeded HEALTH-2 records + production v2 projections; formal HEALTH-5 v3 interface fixtures. */
import {generateHealthSequence} from './health-sequence.mjs';
import {healthOverview,healthMetrics,healthCalendar} from '../../src/personal-health/analysis.mjs';
import {HEALTH_DEFAULTS} from '../../src/personal-health/records-schema.mjs';
export function health6Synthetic({variant='six',legacy=false,today='2026-10-12'}={}){
  const sequence=generateHealthSequence({to:today}),recordState={settings:{...HEALTH_DEFAULTS},days:Object.fromEntries(sequence.items.map(row=>[row.day,{health:row.health,updatedAt:row.day+'T12:00:00Z'}]))},account={dailyDigest:{days:sequence.usageDays}};
  const projected=new Map(),read=(key,run)=>{if(!projected.has(key))projected.set(key,run());return structuredClone(projected.get(key));};
  const base={today,sequence,overview:(day=today)=>read(`overview:${day}`,()=>healthOverview(recordState,account,day,sequence.timeZone)),metric:(id,days=30,to=today)=>read(`metric:${id}:${days}:${to}`,()=>healthMetrics(recordState,account,id,days,to,sequence.timeZone)),calendar:(month=today.slice(0,7))=>read(`calendar:${month}`,()=>healthCalendar(recordState,month,sequence.timeZone))};
  const settings={modelInsightsEnabled:true,...(!legacy?{itemAnalysisEnabled:false}:{}),sleepTargetMinutes:450,retentionDays:400},cache=new Map(),calls=[];
  const overview=(day=base.today)=>{const o=base.overview(day);o.capabilities={record:3,profile:true};o.usage.lastUsedAt=`${day}T01:20:00+08:00`;
    o.insight={headline:'把今天的节奏放轻松',text:'把连续几天的睡眠、活动和自己的常见范围放在一起看，给自己留一点休息时间。',mode:'statistics',observations:[],suggestions:[],generatedAt:day+'T12:00:00Z'};
    if(variant==='no-usage-time')o.usage.lastUsedAt=null;
    o.load.recommendedRange=variant==='no-recommendation'?null:{low:o.load.average42*.85,high:o.load.average42*1.15,unit:'relative'};
    const samples=[7,11,14,18].map((h,i)=>({time:`${day}T${String(h).padStart(2,'0')}:32:00+08:00`,value:32+i*6.7,method:'sdnnHeartRate'}));
    o.stress={score:52.1,state:'normal',label:'较平稳',average:42.05,latest:{value:samples.at(-1).value,time:samples.at(-1).time},samples,baselineDays:28,missing:[],disclaimer:'按公开方法做的估计，不是医学结论'};
    const curve=Array.from({length:96},(_,i)=>({time:`${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`,value:i>73?null:i<28?38+i*1.6:83-(i-28)*.5}));
    o.energy={score:60.5,current:60.5,state:'normal',label:'还有余力',degraded:variant==='hourly',nightCharged:45,dayDrained:22.5,highest:83,lowest:38,missing:[],curve,sleepPeriods:[{start:'00:00',end:'07:00'}],disclaimer:'按公开原理做的估计，不是医学结论'};
    const missing=variant==='profile-missing'?['birthYear','sex']:variant==='birth-missing'?['birthYear']:variant==='sex-missing'?['sex']:variant==='vo2-missing'?['vo2Max']:[],vo2=base.metric('vo2Max',60,day);
    o.fitnessAge={fitnessAge:missing.length?null:29.2,actualAge:missing.includes('birthYear')?null:34,difference:missing.length?null:-4.8,vo2Max:missing.includes('vo2Max')?null:vo2.points.findLast(p=>typeof p.value==='number')?.value??null,vo2MaxDay:missing.includes('vo2Max')?null:vo2.points.findLast(p=>typeof p.value==='number')?.day??null,trend:vo2.points.map(({day,value})=>({day,value:missing.includes('vo2Max')?null:value})),bounded:false,referenceRange:missing.length?null:{low:36.4,high:45.1},state:missing.length?'insufficient':'normal',missing,label:missing.length?'资料还不完整':'比同龄人更有活力',disclaimer:'按公开参考值估计，不是医学结论'};
    if(variant==='stress-missing'){o.stress.latest=null;o.stress.samples=[];o.stress.score=o.stress.average=null;o.stress.state='insufficient';o.stress.missing=['hrvSamples'];}
    if(variant==='disclaimer-missing')for(const id of ['stress','energy','fitnessAge'])delete o[id].disclaimer;
    if(variant==='three'){o.stress=o.energy=o.fitnessAge=null;}if(variant==='five')o.fitnessAge=null;return o;
  };
  return {base,settings,cache,calls,overview,reply(path,{method='GET',body}={}){
    calls.push({path,method,body});const url=new URL(path,'http://synthetic.invalid');
    if(url.pathname.endsWith('/settings/health')){if(method==='PATCH')Object.assign(settings,body);return {settings:{...settings},updatedAt:base.today+'T12:00:00Z'};}
    if(url.pathname.endsWith('/health/overview'))return overview(url.searchParams.get('day')??base.today);
    if(url.pathname.endsWith('/health/analysis')){const day=url.searchParams.get('day');
      if(method==='GET')return {day,items:[...cache.values()].filter(item=>item.day===day)};
      if(!settings.itemAnalysisEnabled)throw Object.assign(Error('AI_ANALYSIS_OFF'),{code:'AI_ANALYSIS_OFF',status:409});
      const item={...body,mode:'statistics',text:'这一项接近平时的范围。先观察连续几天的变化，给自己留一点休息时间。',points:['每天的变化放在一起看，比单次数字更有帮助。'],basis:['近 28 天的每日汇总','近 7 天的睡眠时长'],generatedAt:body.day+'T12:00:00Z'};cache.set(body.day+':'+body.scope,item);return item;
    }
    if(url.pathname.includes('/health/metrics/')){const id=url.pathname.split('/').at(-1),days=Number(url.searchParams.get('days')??30),to=url.searchParams.get('to')??today;if(['stress','energy','fitnessAge'].includes(id)){const series=base.metric('recovery',days,to);return {...series,id,points:series.points.map((p,i)=>({...p,value:45+Math.sin(i)*8,low:35,high:60}))};}const result=base.metric(id,days,to);return variant==='vo2-missing'&&id==='vo2Max'?{...result,average:null,points:result.points.map(p=>({...p,value:null,low:null,high:null,baseline:null,state:'insufficient',label:'未记录'}))}:result;}
    if(url.pathname.endsWith('/health/calendar'))return base.calendar(url.searchParams.get('month')??undefined);
    throw new Error('Unknown synthetic health route');
  }};
}
