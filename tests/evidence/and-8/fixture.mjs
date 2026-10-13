import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {startNativeFixture} from '../and-4/fixture.mjs';
import {generateHealthV3Fixture} from '../../helpers/health-sequence.mjs';
import {healthOverview,healthMetrics,healthCalendar,healthShiftDay} from '../../../src/personal-health/analysis.mjs';

/** Production calculations, seeded records, real synthetic login and native network dispatcher. */
export async function startHealthFixture(){
  const base=await startNativeFixture(),requests=[],today='2026-10-14',zone='Asia/Shanghai';
  const data=generateHealthV3Fixture({to:today,days:90}),account={dailyDigest:{days:data.usageDays}};
  let mode='ready',settings={...data.records.settings},analyses=new Map(),reminders=new Map();
  const now=Date.parse(today+'T22:00:00+08:00');
  const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  // Fix the visible duration to exercise the deliberate native formatting correction.
  const sleep=data.records.days[today].health.sleep;sleep.minutes=466;sleep.end=new Date(Date.parse(sleep.start)+466*60000).toISOString();data.records.days[today].health.sleepMinutes=466;
  data.records.days[today].health.workouts=[{type:'户外步行',minutes:24},{type:'舒展',minutes:10},{type:'骑行',minutes:18},{type:'室内步行',minutes:8}];
  function overview(day){
    const state=mode==='empty'?{...data.records,days:{}}:data.records;
    const result=healthOverview(state,account,day,zone,now);
    if(result.connected&&day===today)result.insight={headline:'把今天的节奏放轻松',text:'昨晚睡眠接近自己的目标。把睡眠、活动和电脑使用放在一起，继续观察这几天的变化。',observations:[{text:'睡眠和深夜使用记录放在一起看，先观察自己的节奏。',inputs:['sleepMinutes','usageLateNightMinutes']}],suggestions:[{id:'health-11111111111111111111111111111111',text:'今晚给自己留一点放松的时间',reminder:{title:'留一点放松的时间',time:healthShiftDay(today,1)+'T13:30:00Z'}}],mode:'statistics',generatedAt:today+'T10:00:00Z'};
    return result;
  }
  const server=createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://localhost'),p=u.pathname;
    if(p.startsWith('/__and8/')){const command=p.split('/').at(-1);if(command==='reset'){mode='ready';settings={...data.records.settings};analyses.clear();reminders.clear()}else if(['empty','error','slow','analysis-limit','analysis-fail','trend-error','missing'].includes(command))mode=command;return json(res,{ok:true,mode,requests,settings,analyses:[...analyses.values()],reminders:[...reminders.values()],sentMessages:base.requests.filter(r=>r.method==='POST'&&r.path==='/personal/v1/commands').length});}
    if(p.startsWith('/personal/v1/health/')||p==='/personal/v1/settings/health'){
      const meResponse=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});if(!meResponse.ok)return json(res,{error:{code:'UNAUTHORIZED'}},401);const me=await meResponse.json();
      let body={};if(req.method!=='GET'){if(req.headers['x-weftmate-csrf']!==me.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw||'{}')}
      requests.push({path:p,query:u.searchParams.toString(),method:req.method,...(req.method!=='GET'?{body}: {})});
      if(mode==='error')return json(res,{error:{code:'HOST_UNAVAILABLE'}},503);
      if(mode==='slow')await new Promise(r=>setTimeout(r,1700));
      if(p.endsWith('/overview'))return json(res,overview(u.searchParams.get('day')||today));
      if(p.includes('/metrics/')){if(mode==='trend-error')return json(res,{error:{code:'HOST_UNAVAILABLE'}},503);return json(res,healthMetrics(data.records,account,p.split('/').at(-1),Number(u.searchParams.get('days')||7),u.searchParams.get('to')||today,zone,now))}
      if(p.endsWith('/calendar'))return json(res,healthCalendar(data.records,u.searchParams.get('month')||today.slice(0,7),zone));
      if(p.endsWith('/settings/health')){if(req.method==='PATCH'){Object.assign(settings,body);if(!settings.itemAnalysisEnabled)mode='ready'}return json(res,{settings})}
      if(p.endsWith('/analysis')){
        if(req.method==='GET')return json(res,{day:u.searchParams.get('day')||today,items:[...analyses.values()].filter(a=>a.day===(u.searchParams.get('day')||today))});
        if(!settings.itemAnalysisEnabled)return json(res,{error:{code:'AI_ANALYSIS_OFF'}},409);
        if(mode==='analysis-limit')return json(res,{error:{code:'AI_ANALYSIS_LIMIT'}},429);
        if(mode==='analysis-fail')return json(res,{error:{code:'HOST_UNAVAILABLE'}},503);
        const key=body.day+'|'+body.scope;
        if(!analyses.has(key))analyses.set(key,{day:body.day,scope:body.scope,mode:'statistics',text:'这一项与近几天的记录一起看，先观察连续变化。',points:['先看连续几天的变化，不只盯着一天。'],basis:['这一项的每日汇总','近 7 天的深夜使用时长'],generatedAt:today+'T10:00:00Z'});
        return json(res,analyses.get(key));
      }
      if(p.endsWith('/remind')){if(!reminders.has(body.requestId))reminders.set(body.requestId,{item:{id:'synthetic-health-reminder',state:'scheduled'}});return json(res,reminders.get(body.requestId))}
      return json(res,{error:{code:'NOT_FOUND'}},404);
    }
    const headers={};for(const[k,v]of Object.entries(req.headers))if(typeof v==='string'&&!['host','connection','content-length','origin'].includes(k))headers[k]=v;headers.origin=base.origin;
    const r=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
    const h=Object.fromEntries(r.headers);delete h['content-length'];delete h['content-encoding'];if(r.headers.getSetCookie().length)h['set-cookie']=r.headers.getSetCookie();
    if(p==='/personal/v1/status'){const value=await r.json();value.hostName='合成电脑';return json(res,value,r.status)}
    res.writeHead(r.status,h);if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
  }catch{json(res,{error:{code:'FIXTURE_FAILED'}},500)}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},requests,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await base.close()}};
}
