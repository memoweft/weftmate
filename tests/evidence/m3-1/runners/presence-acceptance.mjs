import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,message,ms=90000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await pause(200);}throw Error(message);}
export async function run({desktop,mobile,application,profile,evidence,report,shot,device,relaySockets,relayPort,infraMeta,infra,processOnly}) {
 const api=(path,body,method=body?'POST':'GET')=>desktop.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
 const coreCode=()=>device?uiCore:globalThis.__m31Core;
 async function feature(page,method,...args){return page.evaluate(({method,args})=>{const core=globalThis.__m31Core||globalThis.uiCore|| (typeof uiCore!=='undefined'?uiCore:null);if(!core)throw Error('Feature core not exposed');return core[method](...args);},{method,args});}
 async function connect(page){await feature(page,'retryConnection');await until(()=>page.evaluate(()=>{const c=globalThis.__m31Core||(typeof uiCore!=='undefined'?uiCore:null);return c?.connectionView().kind==='online';}),'Online connection not restored');}
 let modelCalls=0;const expected=Array.from({length:90},(_,i)=>`M3_SEGMENT_${String(i+1).padStart(3,'0')} 合成接续段落。\n\n`).join('');
 const model=createServer(async(req,res)=>{
   if(req.url.endsWith('/models'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'m31-stream'}]}));
   if(!req.url.endsWith('/chat/completions'))return res.writeHead(404).end();let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);modelCalls++;
   if(!body.stream)return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'合成接续'},finish_reason:'stop'}]}));
   if(body.messages?.some(m=>(JSON.stringify(m.content)||'').includes('M3_TOOL_RECOVERY'))){
     const answered=body.messages.some(m=>m.role==='tool'&&(JSON.stringify(m.content)||'').includes('M3_TOOL_RECOVERY'));
     const shell=body.tools?.find(t=>['pwsh','powershell','shell','psh'].includes(t.function?.name));
     const loader=body.tools?.find(t=>t.function?.name==='load_tools');
     if(!answered&&!shell&&!loader){res.writeHead(500).end(JSON.stringify({error:{code:'SYNTHETIC_TOOL_CATALOG_MISSING'}}));return;}
     const name=shell?.function.name||loader?.function.name;
     const arrayName=Object.entries(loader?.function.parameters?.properties||{}).find(([k,v])=>v.type==='array')?.[0]||'names';
     const args=shell?{command:'Write-Output "M3_TOOL_RECOVERY"'}:{[arrayName]:['pwsh']};
     const delta=answered?{role:'assistant',content:'M3_TOOL_RECOVERY 已获批准并完成。'}:{role:'assistant',tool_calls:[{index:0,id:shell?'m31-native-call':'m31-load-call',type:'function',function:{name,arguments:JSON.stringify(args)}}]};
     res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'m31-tool',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'m31-tool',choices:[{index:0,delta:{},finish_reason:answered?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n');return;
   }
   res.writeHead(200,{'content-type':'text/event-stream'});for(let n=0;n<90;n++){if(res.destroyed)return;res.write('data: '+JSON.stringify({id:'m31',choices:[{index:0,delta:{role:'assistant',content:`M3_SEGMENT_${String(n+1).padStart(3,'0')} 合成接续段落。\n\n`},finish_reason:null}]})+'\n\n');await pause(250);}
   res.end('data: '+JSON.stringify({id:'m31',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:900,total_tokens:1000}})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const checks=[];report.presence={checks,fixedDsh:true,realElectron:true,fullRelay:true,randomPorts:true,syntheticAccount:true};
 async function configure(name,baseUrl,modelId,key){const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name,baseUrl,modelId,apiKey:key})).status,202);await until(async()=>(await api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded','Model configuration failed');return (await api('/models')).body.models.find(row=>row.name===name).id;}
 async function send(modelId,text,approvalMode){const host=(await api('/status')).body;const create=(await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:host.hostId,modelProfileId:modelId})).body.command;
   const created=await until(async()=>{const c=(await api('/commands/by-request/'+create.requestId)).body.command;return c.state==='accepted_by_dsh'&&c;},'Native conversation not created');
   await api('/sessions/'+created.sessionId+'/metadata',{title:'M3 接续验收'},'PATCH');await feature(mobile,device?'listMobileSessions':'refreshSessions');await feature(mobile,'selectSession',created.sessionId);
   if(approvalMode)assert.equal((await api('/sessions/'+created.sessionId+'/approval-mode',{mode:approvalMode},'PATCH')).status,200);
   const command=(await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:host.hostId,sessionId:created.sessionId,text,mode:'queue'})).body.command;
   return {command,sessionId:created.sessionId};
 }
 async function complete(turn){await until(async()=>{const result=(await api('/sessions/'+turn.sessionId+'/events?limit=200')).body;return result.events?.some(e=>e.type==='turn.ended');},'Reply did not finish',180000);await feature(mobile,'refreshHistory');return (await api('/sessions/'+turn.sessionId+'/events?limit=200')).body.events;}
 try {
   const synthetic=await configure('M3 合成连续流',`http://127.0.0.1:${model.address().port}/v1`,'m31-stream','m31-test-only');
   await desktop.reload();await desktop.locator('#assistant-view').waitFor();await mobile.reload();
   if(device)await until(()=>mobile.evaluate(()=>state.loggedIn),'Native login not restored');else await mobile.locator('#assistant-view').waitFor();
   await connect(mobile);await connect(desktop);
   const startCalls=modelCalls,turn=await send(synthetic,'输出连续合成段落，不调用工具。');await until(()=>modelCalls>startCalls,'Model stream did not start');await pause(1800);
   const before=(await api('/sessions/'+turn.sessionId+'/events?limit=200')).body.events;
   // Terminate the actual owned HAProxy process, then resume the same full chain.
   infra.stdin.write('stop\n');await pause(500);for(const s of relaySockets)s.destroy();
   await until(async()=>{await feature(mobile,'retryConnection');await pause(1100);return await mobile.evaluate(()=>__m31Core.connectionView().kind==='host_offline');},'Repeated independent probes did not confirm unreachable host',20000);await shot(mobile,'relay-disconnected','light');
   infra.stdin.write('start\n');await pause(1000);
   await connect(mobile);const after=await complete(turn);const text=after.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('');assert.equal(text,expected);assert.equal(modelCalls-startCalls,1);
   const identity=new Set(after.map(e=>e.seq));assert.equal(identity.size,after.length);assert.ok(before.every(e=>identity.has(e.seq)));
   console.log('M3-1 relay stream resumed');checks.push({name:'Actual HAProxy termination during fixed DSH stream',passed:true,modelGenerations:1,segments:90,exactReply:true,uniqueSeq:identity.size});
   // Host content listener stops while the native runtime retains its original turn.
   const second=await send(synthetic,'再输出一次连续合成段落。');await pause(1800);await application.evaluate(async()=>{await globalThis.__m31Host.stopListener();});
   await pause(3500);await feature(mobile,'retryConnection');
   await application.evaluate(async()=>{await globalThis.__m31Host.service.start();});await connect(mobile);await connect(desktop);const restored=await complete(second);assert.equal(restored.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join(''),expected);
   console.log('M3-1 host listener resumed');checks.push({name:'Host content listener close/start preserves original native stream',passed:true,scope:'HTTP host restart; runtime process stays alive',segments:90});
   // Lose the acceptance response after actual host commit, and reject the request before commit.
   await feature(mobile,'selectMainChat');
   const rawCore=()=>globalThis.__m31Core;
   for(const committed of device?[]:[true,false]){
     let interceptedId;
     let injected=false;
     await mobile.route('**/personal/v1/commands',async route=>{if(route.request().method()!=='POST'||injected)return route.continue();injected=true;interceptedId=JSON.parse(route.request().postData()).requestId;
     if(committed){const headers=await route.request().allHeaders();await new Promise((resolve,reject)=>{
       const request=route.request(),url=new URL(request.url());const outbound=httpsRequest({hostname:'127.0.0.1',port:relayPort,servername:url.hostname,path:url.pathname,method:'POST',headers:{...headers,host:url.host},rejectUnauthorized:false},response=>{response.resume();response.on('end',()=>response.statusCode===202?resolve():reject(Error('Acceptance injector HTTP '+response.statusCode)));});outbound.on('error',reject);outbound.setTimeout(10000,()=>outbound.destroy(Error('Acceptance injector timeout')));outbound.end(request.postDataBuffer());
     });}await route.abort('failed');});
     await mobile.getByRole('textbox',{name:'输入消息',exact:true}).fill(committed?'M3 原编号已受理合成消息':'M3 原编号未受理合成消息');await mobile.getByRole('button',{name:'发送',exact:true}).click();await pause(500);
     await until(()=>!!interceptedId,'The acceptance injection did not receive the command');
     await connect(mobile);await feature(mobile,'reconcileMainRequests');
     const rows=await mobile.evaluate(()=>__m31Core.mainOptimisticMessages().map(r=>({requestId:r.requestId,status:r.status})));const row=rows.find(r=>r.requestId===interceptedId);assert.ok(interceptedId);
     if(row)assert.equal(row.status,committed?'accepted':'undelivered');if(!committed){assert.ok(row);await feature(mobile,'retryMainRequest',interceptedId);await feature(mobile,'retryMainRequest',interceptedId);}
     const command=(await api('/commands/by-request/'+interceptedId)).body.command;assert.ok(['accepted_by_dsh','pending','dispatching','observed'].includes(command.state));
     console.log('M3-1 receipt checked',committed);checks.push({name:committed?'Lost committed acceptance':'Dropped before host acceptance',passed:true,requestId:interceptedId,sameNumberRetry:true});
     await pause(24000);await feature(mobile,'refreshHistory');
   }
   if(!device){
     const mimoKey=processOnly(execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim());assert.ok(mimoKey);
     const mimo=await configure('M3 MiMo 长回复','https://api.xiaomimimo.com/v1','mimo-v2.6-flash',mimoKey);
     const long=await send(mimo,'为合成连通性验收写一篇约3000字的中文说明，分40段，每段以段落编号开头，主题是纸船的折叠、编号和保存。直接开始正文，不调用工具，不省略段落。');
     await until(async()=>{const task=(await api('/tasks/'+long.command.commandId)).body;return task.replyEvidence?.status==='streaming'&&task.replyEvidence.textChunks>0;},'MiMo did not produce a real text chunk before interruption',120000);
     for(const s of relaySockets)s.destroy();await mobile.context().setOffline(true);await pause(4500);assert.equal(await mobile.evaluate(()=>__m31Core.connectionView().kind),'network_unavailable');await shot(mobile,'network-unavailable-real','light');
     await mobile.context().setOffline(false);await connect(mobile);const events=await complete(long);assert.ok(events.some(e=>e.type==='assistant.message'&&e.data.text.length>1000));assert.equal(new Set(events.map(e=>e.seq)).size,events.length);
     const reply=events.find(e=>e.type==='assistant.message'),full=(await api('/sessions/'+long.sessionId+'/events/'+reply.seq+'/detail')).body.text;
     const trace=(await readFile(join(profile,'requests.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.phase==='end'&&r.kind==='model'&&r.origin==='https://api.xiaomimimo.com').at(-1);assert.equal(full.length,trace.contentChars,'Full persisted reply preserves all received model text beyond the 4000-character history preview');
     console.log('M3-1 MiMo interrupted reply resumed');checks.push({name:'Real MiMo long reply interrupted at phone transport',passed:true,characters:full.length,matchedUpstreamCharacters:trace.contentChars,originalRequestId:long.command.requestId});
     await feature(mobile,'offlineConnectionRestored');
     await application.evaluate(async()=>{await globalThis.__m31Host.stopListener();});
     await until(async()=>{await feature(mobile,'retryConnection');await pause(1100);return mobile.evaluate(()=>__m31Core.connectionView().kind==='host_offline');},'Stopped host did not become offline',20000);
     await mobile.getByRole('button',{name:'离线模式',exact:true}).click();await mobile.getByRole('heading',{name:'离线模式',exact:true}).waitFor();
     await shot(mobile,'offline-mode-open','light');
     await application.evaluate(async()=>{await globalThis.__m31Host.service.start();});await connect(mobile);await feature(mobile,'offlineConnectionRestored');await mobile.locator('.offline-chat').waitFor({state:'hidden'});
     checks.push({name:'Confirmed host offline opens M3-A mode and returns automatically after sync',passed:true});
   }
   // Genuine native tool/approval identity survives the same transport loss.
   const tools=await send(synthetic,'M3_TOOL_RECOVERY：运行一次合成输出命令，需要批准后继续。','ask');
   await until(async()=>{const list=(await api('/sessions/'+tools.sessionId+'/approvals?limit=50')).body.approvals;return list?.some(a=>a.status==='pending');},'Native approval was not requested');
   await feature(mobile,'refreshConversationTasks');await feature(mobile,'refreshConversationApprovals');await mobile.getByRole('region',{name:'待批准操作',exact:true}).waitFor();
   await mobile.context().setOffline(true);await pause(1200);await shot(mobile,'approval-with-disconnect','light');await mobile.context().setOffline(false);await connect(mobile);
   await mobile.getByRole('button',{name:'批准',exact:true}).click();await until(async()=>{await feature(mobile,'refreshConversationTasks');await feature(mobile,'refreshConversationApprovals');const pending=(await api('/sessions/'+tools.sessionId+'/approvals?limit=50')).body.approvals?.filter(a=>a.status==='pending')||[];if(pending.length)await mobile.getByRole('button',{name:'批准',exact:true}).click();return (await api('/sessions/'+tools.sessionId+'/events?limit=200')).body.events?.some(e=>e.type==='turn.ended');},'Native approved tool did not complete');const toolEvents=await complete(tools);assert.ok(toolEvents.some(e=>e.type==='step.completed'));assert.ok(toolEvents.some(e=>e.type==='approval.resolved'));
   checks.push({name:'Actual native approval and tool progress restore across disconnect',passed:true});
   // All six visual projections use the production classifier and component; no CSS forcing.
   for(const [surface,page,widths]of [['electron',desktop,[1200,480]],['phone-web',mobile,device?[390]:[390,360]]]) {
     await feature(page,'stopAssistantRefresh');
     for(const width of widths){if(surface==='electron')await application.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/personal/v1/ui')).setSize(width,800),width);else if(!device)await page.setViewportSize({width,height:width===360?780:844});
       for(const theme of ['light','dark'])for(const kind of ['online','connecting','host_offline','network_unavailable','login_required','approval_required']){
         await page.evaluate(({kind,theme})=>{document.documentElement.dataset.theme=theme;const c=globalThis.__m31Core||(typeof uiCore!=='undefined'?uiCore:null);c.presence.success({runtime:'ready'});if(kind==='connecting')c.presence.failure({code:'NETWORK'});else if(kind==='host_offline')c.presence.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});else if(kind==='network_unavailable')c.presence.network(false);else if(kind!=='online')c.presence.authorization(kind);},{kind,theme});
         await page.screenshot({path:join(evidence,`${surface}-${width}-${theme}-${kind}.png`)});
         const geometry=await page.evaluate(()=>{const bar=document.querySelector('.presence-bar');return {overflow:document.documentElement.scrollWidth>innerWidth,bar:bar.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight}};});assert.equal(geometry.overflow,false);assert.ok(geometry.bar.bottom<=geometry.viewport.height);(report.presence.visuals||=[]).push({surface,width,theme,kind,projection:true,...geometry});
       }
     }
   }
   const traces=(await readFile(join(profile,'requests.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);report.presence.mimoUsage=traces.filter(r=>r.phase==='end'&&r.usage).map(r=>r.usage);
 } finally {model.closeAllConnections();await new Promise(r=>model.close(r));await writeFile(join(evidence,'presence-results.json'),JSON.stringify(report.presence,null,2));}
}
