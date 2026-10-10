import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message,ms=90000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await pause(200);}throw Error(message);}
export async function run({desktop,mobile,application,evidence,report,shot,click,fill,hostOrigin,adbRun}) {
 const api=(path,body,method=body?'POST':'GET')=>desktop.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
 let calls=0;const expected=Array.from({length:80},(_,n)=>`ANDROID_M3_SEGMENT_${n+1}。\n\n`).join('');
 const model=createServer(async(req,res)=>{if(req.url.endsWith('/models'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'m31-native'}]}));if(!req.url.endsWith('/chat/completions'))return res.writeHead(404).end();let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);calls++;if(!input.stream)return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'原生合成回复'},finish_reason:'stop'}]}));res.writeHead(200,{'content-type':'text/event-stream'});for(let n=0;n<80;n++){if(res.destroyed)return;res.write('data: '+JSON.stringify({id:'m31-native',choices:[{index:0,delta:{role:'assistant',content:`ANDROID_M3_SEGMENT_${n+1}。\n\n`},finish_reason:null}]})+'\n\n');await pause(250);}res.end('data: '+JSON.stringify({id:'m31-native',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:300}})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>model.listen(0,'127.0.0.1',r));
 let reachable=true;const gate=createServer((req,res)=>{if(!reachable)return res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:{code:'HOST_UNAVAILABLE'}}));const target=new URL(hostOrigin);const upstream=httpRequest({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>res.writeHead(503).end());req.pipe(upstream);});await new Promise(r=>gate.listen(0,'127.0.0.1',r));
 adbRun('reverse',`tcp:${new URL(hostOrigin).port}`,`tcp:${gate.address().port}`);
 const checks=[];report.nativePresence={realNative:true,realFixedDsh:true,transport:'trusted direct loopback + ADB reverse; owned content transport gate',checks};
 try{
   const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:'M3 安卓合成流',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'m31-native',apiKey:'m31-synthetic-only'})).status,202);await until(async()=>(await api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded','Native model setup failed');
   const modelId=(await api('/models')).body.models.find(r=>r.name==='M3 安卓合成流').id,host=(await api('/status')).body;
   const created=(await api('/commands',{requestId:randomUUID(),kind:'session.create',modelProfileId:modelId,targetDeviceId:host.hostId})).body.command;let command;
   await until(async()=>{command=(await api('/commands/by-request/'+created.requestId)).body.command;return command.state==='accepted_by_dsh';},'Native session creation failed');
   await mobile.evaluate(async id=>{await listSharedSessions();await selectSharedSession(id);},command.sessionId);
   await fill(mobile,mobile.getByRole('textbox',{name:'输入消息',exact:true}),'安卓原生连接续传测试');await click(mobile,mobile.getByRole('button',{name:'发送',exact:true}));await until(()=>calls>0,'Native message did not reach model');await pause(1200);
   reachable=false;
   await until(async()=>{await mobile.evaluate(()=>{void uiCore.retryConnection();});await pause(1100);return mobile.evaluate(()=>uiCore.connectionView().kind==='host_offline');},'Native host disconnect was not confirmed',30000);
   for(const theme of ['light','dark']){await mobile.evaluate(theme=>applyTheme(theme),theme);await shot(mobile,'native-host-offline',theme);}
   reachable=true;await mobile.evaluate(()=>{void uiCore.retryConnection();});await until(()=>mobile.evaluate(()=>uiCore.connectionView().kind==='online'),'Native reconnect failed');
   await until(async()=>{const e=(await api('/sessions/'+command.sessionId+'/events?limit=200')).body.events;return e?.some(r=>r.type==='turn.ended');},'Native reply did not finish');await mobile.evaluate(()=>loadSharedHistory());
   const events=(await api('/sessions/'+command.sessionId+'/events?limit=200')).body.events;assert.equal(events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join(''),expected);assert.equal(calls,1);assert.equal(new Set(events.map(e=>e.seq)).size,events.length);
   checks.push({name:'Native bridge send + host listener outage + original reply catchup',passed:true,modelCalls:calls,segments:80,uniqueSeq:events.length});
   await mobile.evaluate(()=>uiCore.stopConnection());
   for(const theme of ['light','dark'])for(const kind of ['online','connecting','host_offline','network_unavailable','login_required','approval_required']){
     await mobile.evaluate(({theme,kind})=>{applyTheme(theme);uiCore.presence.success({runtime:'ready'});if(kind==='connecting')uiCore.presence.failure({code:'NETWORK'});else if(kind==='host_offline')uiCore.presence.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});else if(kind==='network_unavailable')uiCore.presence.network(false);else if(kind!=='online')uiCore.presence.authorization(kind);},{theme,kind});await shot(mobile,'native-state-'+kind,theme);
     const geometry=await mobile.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,bottom:document.querySelector('.presence-bar').getBoundingClientRect().bottom,height:innerHeight}));assert.equal(geometry.overflow,false);assert.ok(geometry.bottom<=geometry.height);
   }
   checks.push({name:'All six states in native light/dark screenshots',passed:true,projected:true});
 }finally{gate.closeAllConnections();await new Promise(r=>gate.close(r));model.closeAllConnections();await new Promise(r=>model.close(r));await writeFile(join(evidence,'native-presence-results.json'),JSON.stringify(report.nativePresence,null,2));}
}
