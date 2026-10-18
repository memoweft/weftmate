import { failure,exactKeys } from '../personal-access/common.mjs';
import { localNotificationTime } from '../personal-access/notification-policy.mjs';
import { REQUEST_ID } from '../personal-access/constants.mjs';
import { projectDailyDigest } from '../personal-access/daily-digest.mjs';
import { notificationSettings } from '../personal-access/notification-policy.mjs';
import { computerDay, computerNight } from '../personal-access/computer-usage.mjs';
import { EMPTY_HEALTH,validHealthDay } from './records-schema.mjs';
import { healthOverview,healthMetrics,healthCalendar,healthShiftDay,healthWeeklySummary,METRIC_IDS } from './analysis.mjs';
import {createHealthItemAnalysis} from './item-analysis.mjs';
import { identifyHealthSuggestions,statisticalHealthInsight } from './insight.mjs';
import { sleepQuerySummary } from './query-sleep.mjs';

export function createHealthOperations(context){
  const itemAnalysis=createHealthItemAnalysis(context);
  const zone=owner=>context.usage.settings(owner).timeZone;
  const today=owner=>localNotificationTime(context.timestamp(),zone(owner)).day;
  function accountForDay(owner,day=today(owner)){const account=context.accountState(owner);if(day!==today(owner)||!notificationSettings(account).reviewEnabled)return account;return {...account,dailyDigest:{...account.dailyDigest,days:{...account.dailyDigest?.days,[day]:projectDailyDigest(account,day,zone(owner),context.usage.exportAccount?.(owner)?.records??[])}}};}
  const stats=(s,owner,day)=>identifyHealthSuggestions(statisticalHealthInsight(s,context.accountState(owner),day,zone(owner),context.timestamp()),owner,day,s.generation);
  const queryUsage=(usage,owner)=>{const local=usage.lastUsedAt?localNotificationTime(Date.parse(usage.lastUsedAt),zone(owner)):null;return {...usage,lastUsedAtLocal:local?`${local.day} ${local.time}`:null};};
  const hydrate=(s,owner,day)=>{const row=s.days[day];if(row?.health.status==='available'&&!row.insight)row.insight=stats(s,owner,day);return healthOverview(s,accountForDay(owner,day),day,zone(owner),context.timestamp());};
  async function persisted(owner,day){let s=await context.healthRecords.read(owner);if(s.days[day]?.health.status==='available'&&!s.days[day].insight){await context.serial(()=>context.healthRecords.update(owner,next=>{const row=next.days[day];if(row?.health.status==='available'&&!row.insight)row.insight=stats(next,owner,day);}));s=await context.healthRecords.read(owner);}return s;}
  function queryParams(url,keys){for(const key of url.searchParams.keys())if(!keys.includes(key)||url.searchParams.getAll(key).length!==1)throw failure('INVALID_REQUEST');}
  async function project(owner){const s=await context.healthRecords.read(owner);await context.serial(()=>context.mutate(owner,next=>{if(next.dailyDigest){next.dailyDigest.healthDays={};for(const [day,digest]of Object.entries(next.dailyDigest.days))digest.health=s.days[day]?.health??structuredClone(EMPTY_HEALTH);}}));return s;}
  async function query(owner,input){
    exactKeys(input,['metric','from','to'],['metric']);if(input.metric!=='overview'&&!METRIC_IDS.includes(input.metric))throw failure('INVALID_REQUEST');
    const to=input.to===undefined?today(owner):validHealthDay(input.to),from=input.from===undefined?healthShiftDay(to,-6):validHealthDay(input.from);
    if(from>to||to>today(owner)||from<healthShiftDay(to,-89))throw failure('INVALID_REQUEST');
    const s=await context.healthRecords.read(owner),connected=Object.values(s.days).some(r=>r.health.status==='available');
    let usageConnected=false;for(let day=from;day<=to;day=healthShiftDay(day,1))usageConnected||=!!(computerDay(context.accountState(owner),day,zone(owner))||computerNight(context.accountState(owner),day,zone(owner)));
    if(!connected&&(!usageConnected||!['overview','usageActiveMinutes','usageLateNightMinutes'].includes(input.metric)))return {connected:false,message:'还没接上',from,to,items:[]};
    const items=[];for(let day=from;day<=to;day=healthShiftDay(day,1)){
      if(input.metric==='overview'){const o=hydrate(s,owner,day);items.push({day,recovery:{score:o.recovery.score,state:o.recovery.state,label:o.recovery.label},sleep:{score:o.sleep.score,minutes:o.sleep.minutes,state:o.sleep.state,label:o.sleep.label},load:{score:o.load.score,state:o.load.state,label:o.load.label},stress:o.stress?{score:o.stress.score,average:o.stress.average,latest:o.stress.latest,state:o.stress.state,label:o.stress.label}:null,energy:o.energy?{current:o.energy.current,state:o.energy.state,label:o.energy.label,degraded:o.energy.degraded}:null,fitnessAge:o.fitnessAge?{fitnessAge:o.fitnessAge.fitnessAge,actualAge:o.fitnessAge.actualAge,difference:o.fitnessAge.difference,state:o.fitnessAge.state,missing:o.fitnessAge.missing}:null,vitals:o.vitals,usage:queryUsage(o.usage,owner)});}
      else items.push(healthMetrics(s,accountForDay(owner,day),input.metric,1,day,zone(owner),context.timestamp()).points[0]);
    }return {connected,from,to,timeZone:zone(owner),metric:input.metric,items,
      ...(['overview','sleep','sleepMinutes'].includes(input.metric) ? {sleepSummary:sleepQuerySummary(s,from,to,zone(owner))} : {}),
      ...(!connected&&usageConnected?{usageConnected:true}:{})};
  }
  async function handleHttp(request,response,url,owner){
    const path=url.pathname,dayMatch=/^\/personal\/v1\/daily-summaries\/(\d{4}-\d{2}-\d{2})\/health$/.exec(path),metricMatch=/^\/personal\/v1\/health\/metrics\/([A-Za-z0-9]+)$/.exec(path),suggestion=/^\/personal\/v1\/health\/suggestions\/(health-[a-f0-9]{32})\/remind$/.exec(path);
    if(!dayMatch&&!metricMatch&&!suggestion&&!['/personal/v1/health/records/batch','/personal/v1/health/overview','/personal/v1/health/calendar','/personal/v1/health/profile','/personal/v1/health/analysis','/personal/v1/health/weekly','/personal/v1/settings/health'].includes(path))return false;
    const auth=context.authenticate(request,request.method==='GET'?'sessions:read':'account:manage');
    if(dayMatch||path.endsWith('/records/batch')){
      if(request.method!=='PUT'||url.search)throw failure('INVALID_REQUEST');const body=await context.readJson(request,dayMatch?64*1024:1280*1024);if(!dayMatch)exactKeys(body,['items'],['items']);
      const value=await context.serial(()=>context.healthRecords.upsert(owner,dayMatch?[{day:dayMatch[1],health:body}]:body.items,()=>context.authenticate(request,'account:manage')));
      if(value.changedDays.length){await project(owner);context.healthInsights.changed(owner);}
      context.json(response,200,dayMatch?value.items[0]:value);return true;
    }
    if(path==='/personal/v1/health/profile'){
      if(request.method!=='PUT'||url.search)throw failure('INVALID_REQUEST');const body=await context.readJson(request);
      const value=await context.serial(()=>context.healthRecords.profile(owner,body,()=>context.authenticate(request,'account:manage')));context.healthInsights.changed(owner);context.json(response,200,value);return true;
    }
    if(path==='/personal/v1/health/analysis'){
      if(!['GET','POST'].includes(request.method))throw failure('INVALID_REQUEST');let value;
      if(request.method==='POST'){if(url.search)throw failure('INVALID_REQUEST');value=await itemAnalysis.generate(owner,await context.readJson(request),()=>context.authenticate(request,'account:manage'));}
      else{queryParams(url,['day']);const day=validHealthDay(url.searchParams.get('day')??today(owner));if(day>today(owner))throw failure('INVALID_REQUEST');value=await itemAnalysis.get(owner,day);}
      context.json(response,200,value);return true;
    }
    if(path==='/personal/v1/settings/health'){
      if(url.search||!['GET','PATCH'].includes(request.method))throw failure('INVALID_REQUEST');
      if(request.method==='PATCH'){
        const body=await context.readJson(request);if(Object.keys(body).some(k=>k!=='itemAnalysisEnabled')){context.healthInsights.cancel(owner);context.activity?.dailyDigest?.cancel(owner);}if(body.itemAnalysisEnabled===false||body.clear)itemAnalysis.cancel(owner);
        const value=await context.serial(()=>context.healthRecords.settings(owner,body,()=>context.authenticate(request,'account:manage')));
        const records=await project(owner);
        if(Object.keys(body).some(k=>k!=='itemAnalysisEnabled'))await context.serial(()=>context.mutate(owner,next=>{if(next.dailyDigest){const refresh=week=>{const health=healthWeeklySummary(records,next,week.from,week.to,zone(owner));week.text=(week.usageText??week.text)+(health?'\n'+health.text:'');if(health)week.health=health;else delete week.health;};for(const week of Object.values(next.dailyDigest.weeks))if(week.health)refresh(week);for(const item of Object.values(next.activity?.items??{}))if(item.weeklyInsight?.health)refresh(item.weeklyInsight);}}));
        context.json(response,200,value);return true;
      }const s=await context.healthRecords.read(owner);context.json(response,200,{settings:s.settings,updatedAt:s.settingsUpdatedAt});return true;
    }
    if(suggestion){
      if(request.method!=='POST'||url.search)throw failure('INVALID_REQUEST');const body=await context.readJson(request);exactKeys(body,['sessionId','requestId'],['requestId']);if(typeof body.requestId!=='string'||!REQUEST_ID.test(body.requestId))throw failure('INVALID_REQUEST');
      const day=today(owner),s=await persisted(owner,day),o=hydrate(s,owner,day),item=o.insight?.suggestions.find(r=>r.id===suggestion[1]);
      if(!item)throw failure('NOT_FOUND',404);if(!item.reminder||Date.parse(item.reminder.time)<=context.timestamp())throw failure('INVALID_REQUEST');
      const local=localNotificationTime(Date.parse(item.reminder.time),zone(owner));
      const value=await context.scheduleOperations.createUI(owner,auth,{sessionId:body.sessionId??await context.mainChat.prepareReminder(owner,()=>context.authenticate(request,'account:manage')),requestId:body.requestId,text:item.reminder.title,kind:'reminder',at:{date:local.day,time:local.time+':00'}},()=>context.authenticate(request,'account:manage'));
      context.json(response,201,value);return true;
    }
    if(request.method!=='GET')throw failure('INVALID_REQUEST');await context.activity?.dailyDigest?.refresh(owner);const s=await context.healthRecords.read(owner);let value;
    if(metricMatch){queryParams(url,['days','to']);const to=validHealthDay(url.searchParams.get('to')??today(owner));if(to>today(owner))throw failure('INVALID_REQUEST');const id=metricMatch[1],days=url.searchParams.has('days')?Number(url.searchParams.get('days')):7;if(!METRIC_IDS.includes(id)||![7,14,30,60,90].includes(days))throw failure('INVALID_REQUEST');value=healthMetrics(s,accountForDay(owner),id,days,to,zone(owner),context.timestamp());}
    else if(path.endsWith('/weekly')){queryParams(url,['to']);const to=validHealthDay(url.searchParams.get('to')??healthShiftDay(today(owner),1));if(to>healthShiftDay(today(owner),1))throw failure('INVALID_REQUEST');const from=healthShiftDay(to,-7);const report=context.accountState(owner).dailyDigest?.weeks?.[to];value={from,to,health:report?.health??healthWeeklySummary(s,accountForDay(owner),from,to,zone(owner))};}
    else if(path.endsWith('/calendar')){queryParams(url,['month']);const month=url.searchParams.get('month')??today(owner).slice(0,7);validHealthDay(month+'-01');value=healthCalendar(s,month,zone(owner));}
    else{queryParams(url,['day']);const day=validHealthDay(url.searchParams.get('day')??today(owner));value=hydrate(await persisted(owner,day),owner,day);}
    context.json(response,200,value);return true;
  }
  return {handleHttp,query,project,accountForDay,close:itemAnalysis.close};
}
