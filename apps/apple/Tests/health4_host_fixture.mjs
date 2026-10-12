// Test-only contract service; all numbers are synthetic and no cloud is contacted.
import http from 'node:http';
import assert from 'node:assert/strict';
import {validateHealthRecord} from './health4_validate_record.mjs';
let version=2, scenario='data', enabled=false, topEnabled=true, offline=false, failBatch=0, requests=[], reminders=0, issues=[], reads=[], analyses=new Map(), records=new Map(), profiles=[];
const day=new Intl.DateTimeFormat('en-CA',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const score=(value,label='正常')=>({score:value,state:scenario==='insufficient'?'insufficient':'normal',label:scenario==='insufficient'?'再戴几天就有对比了':label,reasons:[{text:'昨晚的睡眠和你平时差不多',inputs:['sleepMinutes']}],missing:[],baseline:70,low:50,high:90});
function overview() {
 const vital=(id,value)=>({id,value,baseline: value,low:value*0.9,high:value*1.1,state:scenario==='insufficient'?'insufficient':'normal',label:scenario==='insufficient'?'再戴几天就有对比了':'正常'});
 return {day,connected:scenario!=='disconnected',updatedAt:new Date().toISOString(),capabilities:{record:version,profile:version>=3},
 insight:{headline:'今天可以按自己的节奏来',text:'昨晚睡眠比较稳定，今天适合轻松活动。留一点时间，让身体慢慢恢复。',suggestions:[{id:'walk',text:'下午出去走一走',reminder:{title:'出去走一走',time:new Date(Date.now()+3600000).toISOString()}}]},
 recovery:score(78),sleep:{...score(82),minutes:450,targetMinutes:450,start:new Date(Date.now()-36000000).toISOString(),end:new Date(Date.now()-9000000).toISOString(),deepMinutes:60,remMinutes:60},load:score(61,'刚好'),
 vitals:Object.fromEntries([['restingHeartRateBpm',60],['hrvSdnnMs',50],['respiratoryRateBrpm',16],['spo2Pct',98],['wristTempC',36.5]].map(([id,v])=>[id,vital(id,v)])),
 activity:{steps:1234,activeEnergyKcal:200,exerciseMinutes:5,workouts:[{type:'跑步',minutes:5}]},usage:{activeMinutes:240,lateNightMinutes:20,lastUsedAt:null},
 ...(scenario==='extras'?{stress:{score:35,average:38,latest:{value:35,time:new Date().toISOString()},samples:[{time:new Date().toISOString(),value:35,method:'sdnnHeartRate'}],baselineDays:28,label:'比较平静',missing:[]},energy:{score:72,current:72,label:'还有余力',curve:Array.from({length:96},(_,i)=>({value:i<48?90-i/2:null,time:String(Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0')})),sleepPeriods:[{start:'23:00',end:'07:00'}],degraded:true,nightCharged:20,dayDrained:28},fitnessAge:{fitnessAge:34,actualAge:38,difference:-4,referenceRange:{low:35.9,high:49.2},label:'相对你自己的体能估计',missing:[]}}:{})};
}
function checkRecord(h) { validateHealthRecord(h,version); }
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname.replace('/personal/v1',''),data=body?JSON.parse(body):{};
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json',...(path==='/auth/login'?{'set-cookie':'wm_personal_session='+ 'a'.repeat(43)+'; Path=/; HttpOnly'}:{})});res.end(JSON.stringify(value));};
 try {
 if(url.pathname==='/fixture/control'){version=data.version??version;scenario=data.scenario??scenario;offline=data.offline??offline;failBatch=data.failBatch??failBatch;enabled=data.enabled??enabled;if(data.resetAnalysis)analyses.clear();return send(200,{ok:true});}
 if(url.pathname==='/fixture/report')return send(200,{syntheticOnly:true,version,issues,reads,requests:requests.map(r=>({kind:r.kind,days:r.items.map(x=>x.day),versions:r.items.map(x=>x.health.version)})),records:[...records].map(([day,health])=>({day,health})),profiles,reminders,analysisScopes:[...analyses.keys()],modelInsightsEnabled:topEnabled,itemAnalysisEnabled:enabled});
 if(offline)return send(503,{error:{code:'UNAVAILABLE'}});
 if(path==='/auth/login'||path==='/auth/me')return send(200,{account:{ownerId:'health4-owner',username:'health4_synthetic',displayName:'合成账号'},device:{id:'health4-phone',name:'合成设备',revoked:false,current:true},csrfToken:'b'.repeat(43)});
 if(path==='/status')return send(200,{ownerId:'health4-owner',hostId:'health4-host'});
 if(path==='/settings/notifications')return send(200,{settings:{reviewEnabled:true,reviewRetentionDays:90},timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
 if(path==='/health/overview')return send(200,overview());
 if(path==='/settings/health') {if(req.method==='PATCH'){if('itemAnalysisEnabled'in data)enabled=data.itemAnalysisEnabled;if('modelInsightsEnabled'in data)topEnabled=data.modelInsightsEnabled;}return send(200,{settings:{modelInsightsEnabled:topEnabled,...(scenario==='oldHost'?{}:{itemAnalysisEnabled:enabled}),sleepTargetMinutes:450,retentionDays:400},updatedAt:new Date().toISOString()});}
 if(path==='/health/records/batch'||/^\/daily-summaries\/.*\/health$/.test(path)) {
 assert(req.headers.cookie);assert(req.headers['x-weftmate-csrf']);
 const items=path==='/health/records/batch'?data.items:[{day:path.split('/')[2],health:data}];
 if(failBatch>0 && path==='/health/records/batch'){failBatch--;return send(503,{error:{code:'UNAVAILABLE'}});}
 for(const item of items)checkRecord(item.health);
 requests.push({kind:path==='/health/records/batch'?'batch':'single',items});
 const changedDays=items.filter(i=>JSON.stringify(records.get(i.day))!==JSON.stringify(i.health)).map(i=>i.day);
 items.forEach(i=>records.set(i.day,i.health));return send(200,{items,changedDays});
 }
 if(path==='/health/profile'){assert(version>=3);assert.deepEqual(Object.keys(data).sort(),['birthYear','heightCm','sex','version','weightKg'].sort());profiles.push(data);return send(200,{});}
 if(path.startsWith('/health/metrics/')) {
 const id=path.split('/').at(-1),days=Number(url.searchParams.get('days'));reads.push({id,days});
 const values={steps:1234,sleepMinutes:450,deepMinutes:60,remMinutes:60,hrvSdnnMs:50,restingHeartRateBpm:60,respiratoryRateBrpm:16,spo2Pct:98,wristTempC:36.5,usageLateNightMinutes:20};const center=values[id]??70;
 return send(200,{id,days,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,average:center,points:Array.from({length:days},(_,i)=>{let d=new Date();d.setDate(d.getDate()-days+1+i);const key=new Intl.DateTimeFormat('en-CA').format(d);return {day:key,value:center+(i%5-2)*center*0.015,baseline:center,low:scenario==='insufficient'?null:center*0.9,high:scenario==='insufficient'?null:center*1.1,state:scenario==='insufficient'?'insufficient':'normal',label:scenario==='insufficient'?'再戴几天就有对比了':'和你平时差不多'};})});
 }
 if(path==='/health/calendar'){const month=url.searchParams.get('month');return send(200,{month,days:Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()},(_,i)=>({day:month+'-'+String(i+1).padStart(2,'0'),hasWorkout:i%3===0,sleepScore:70,recoveryScore:70}))});}
 if(path.startsWith('/health/suggestions/')){assert.deepEqual(Object.keys(data).sort(),['requestId','sessionId']);reminders++;return send(200,{item:{id:'health4-reminder'}});}
 if(path==='/health/analysis'){
 if(req.method==='GET')return send(200,{day,items:[...analyses.values()]});
 if(!enabled)return send(409,{error:{code:'AI_ANALYSIS_OFF'}});
 assert(data.scope!=='overview');assert.deepEqual(Object.keys(data).sort(),['day','scope']);
 await new Promise(r=>setTimeout(r,4000));const value={scope:data.scope,day:data.day,mode:'statistics',text:'这几天的变化接近你平时的范围。可以保持轻松的活动节奏。',points:['留意今晚的休息时间'],basis:['近 28 天的心率变异性'],generatedAt:new Date().toISOString()};analyses.set(data.scope,value);return send(200,value);
 }
 return send(404,{error:{code:'NOT_FOUND'}});
 }catch(error) { issues.push({path,message:error.message});send(400,{error:{code:'INVALID_REQUEST'}}); }
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({origin:'http://127.0.0.1:'+server.address().port})));process.on('SIGTERM',()=>server.close());
