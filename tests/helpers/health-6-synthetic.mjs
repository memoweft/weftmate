/** UI-only v3 fixture. Extra field shapes must be confirmed with HEALTH-5. */
import {healthPageSynthetic} from './health-page-synthetic.mjs';
export function health6Synthetic({variant='six',legacy=false}={}){
  const base=healthPageSynthetic(),settings={modelInsightsEnabled:true,...(!legacy?{itemAnalysisEnabled:false}:{}),sleepTargetMinutes:480,retentionDays:400},cache=new Map(),calls=[];
  const overview=(day=base.today)=>{const o=base.overview(day);o.usage.lastUsedAt=`${day}T01:20:00+08:00`;
    if(variant==='no-usage-time')delete o.usage.lastUsedAt;
    const samples=[7,11,14,18].map((h,i)=>({time:`${day}T${String(h).padStart(2,'0')}:32:00+08:00`,value:32+i*6.7}));
    o.stress={score:52.1,state:'normal',label:'较平稳',average:42.05,latestSampleAt:samples.at(-1).time,samples};
    o.energy={score:64.6,state:'normal',label:'还有余力',resolution:variant==='hourly'?'hourly':'quarterHourly',charged:54.2,drained:29.6,curve:Array.from({length:96},(_,i)=>({time:new Date(Date.parse(`${day}T00:00:00+08:00`)+i*900000).toISOString(),value:i<28?38+i*1.6:83-(i-28)*.5})),sleepPeriods:[{start:`${day}T00:00:00+08:00`,end:`${day}T07:00:00+08:00`}]};
    o.fitnessAge={value:variant==='profile-missing'?null:29.2,actualAge:34,referenceRange:{low:36.4,high:45.1},state:'normal',label:'比同龄人更有活力'};
    if(variant==='three'){o.stress=o.energy=o.fitnessAge=null;}if(variant==='five')o.fitnessAge=null;return o;
  };
  return {base,settings,cache,calls,overview,reply(path,{method='GET',body}={}){
    calls.push({path,method,body});const url=new URL(path,'http://synthetic.invalid');
    if(url.pathname.endsWith('/settings/health')){if(method==='PATCH')Object.assign(settings,body);return {settings:{...settings},updatedAt:base.today+'T12:00:00Z'};}
    if(url.pathname.endsWith('/health/overview'))return overview(url.searchParams.get('day')??base.today);
    if(url.pathname.endsWith('/health/analysis')){
      if(method==='GET')return {items:[...cache.values()].filter(item=>item.day===url.searchParams.get('day'))};
      if(!settings.itemAnalysisEnabled)throw Object.assign(Error('AI_ANALYSIS_OFF'),{code:'AI_ANALYSIS_OFF',status:409});
      const item={...body,mode:'statistics',text:'这一项接近平时的范围。先观察连续几天的变化，给自己留一点休息时间。',points:['每天的变化放在一起看，比单次数字更有帮助。'],basis:['近 28 天的每日汇总','近 7 天的睡眠时长'],generatedAt:body.day+'T12:00:00Z'};cache.set(body.day+':'+body.scope,item);return item;
    }
    if(url.pathname.includes('/health/metrics/')){const id=url.pathname.split('/').at(-1);if(['stress','energy','fitnessAge'].includes(id)){const series=base.metric('recovery',Number(url.searchParams.get('days')??30));return {...series,id,points:series.points.map((p,i)=>({...p,value:45+Math.sin(i)*8,low:35,high:60}))};}}
    return base.reply(path);
  }};
}
