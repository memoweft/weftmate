import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const root=mkdtempSync('C:/Temp/weftmate-qa1-desktop-'),profile=join(root,'profile'),out=resolve('tests/evidence/qa-1/desktop');mkdirSync(profile);mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'QA1Synthetic',password:`synthetic-${randomUUID()}-password`,deviceName:'QA1 desktop'};
const report={startedAt:new Date().toISOString(),realMain:true,realDsh:true,syntheticModel:true,checks:[],errors:[]};
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
let calls=0,app,page;
const model=createServer(async(req,res)=>{
 if(req.url==='/props')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({n_ctx:131072,total_slots:1}));
 if(req.url.endsWith('/models'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qa1-stream',object:'model',context_window:131072}]}));
 if(!req.url.endsWith('/chat/completions'))return res.writeHead(404).end();
 let raw='';for await(const p of req)raw+=p;const input=JSON.parse(raw);calls++;
 if(!input.stream)return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'合成验收回复'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}));
 res.writeHead(200,{'content-type':'text/event-stream'});
 for(let i=0;i<35;i++){if(res.destroyed)return;res.write(`data: ${JSON.stringify({id:'qa1-stream',object:'chat.completion.chunk',model:input.model,choices:[{index:0,delta:{role:'assistant',content:`合成连续使用验收，第 ${i+1} 行。\n\n`},finish_reason:null}]})}\n\n`);await pause(500);}
 res.end(`data: ${JSON.stringify({id:'qa1-stream',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:64000,completion_tokens:400,total_tokens:64400}})}\n\ndata: [DONE]\n\n`);
});await new Promise(r=>model.listen(0,'127.0.0.1',r));
const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(k))delete env[k];
const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
const shot=async(name)=>{await page.screenshot({path:join(out,name+'.png')});return 'desktop/'+name+'.png';};
async function check(name,fn){const t=Date.now();try{const detail=await fn();report.checks.push({name,status:'passed',durationMs:Date.now()-t,...detail});}catch(e){report.checks.push({name,status:'failed',durationMs:Date.now()-t,error:e.message,screenshot:await shot('failure-'+report.checks.length).catch(()=>null)});}save();}
 const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]))});const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});await preparation.close();
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['.',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});page=await app.firstWindow();page.setDefaultTimeout(12000);await page.waitForURL('**/personal/v1/ui');page.on('pageerror',e=>report.errors.push(e.message));
 await localUiSession(page,credentials);await page.locator('#assistant-view').waitFor();
 await api('/account/models',{requestId:'qa1-stream',name:'合成验收模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'qa1-stream',apiKey:'qa1-synthetic'});
 await page.waitForFunction(async()=>{const r=await(await fetch('/personal/v1/account/models/by-request/qa1-stream')).json();return r.operation?.status==='succeeded';});await page.reload();
 writeFileSync(resolve('.local/qa-1/desktop-private.json'),JSON.stringify({root,profile,origin:new URL(page.url()).origin,credentials,pid:app.process().pid}));
 await app.evaluate(async({app},profile)=>{console.log('monitor-start');const {monitorEventLoopDelay}=process.getBuiltinModule('node:perf_hooks');const fs=process.getBuiltinModule('node:fs');globalThis.qa1={hist:monitorEventLoopDelay({resolution:20}),samples:[],writes:0,started:Date.now(),watchers:[]};const q=globalThis.qa1;q.hist.enable();q.timer=setInterval(()=>q.samples.push({at:Date.now(),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}),10000);q.samples.push({at:Date.now(),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed});q.watchers.push(fs.watch(profile+'/personal-access',{recursive:true},(event,file)=>{if(file?.replaceAll('\\','/').endsWith('store.json'))q.writes++;}));},profile);
 for(const theme of ['light','dark']){
  await page.evaluate(t=>{localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme:t,accent:'neutral',fontSize:'15'}));document.documentElement.dataset.theme=t;},theme);
  await check(theme+'-settings',async()=>{await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();const cats=['常规','外观','账户','设备','用量','已归档','模型','审批','记忆','提醒与定时任务','系统状态','备份与恢复','关于'];const pages=[];for(const name of cats){const t=Date.now();await page.locator('#settings-dialog').getByRole('button',{name,exact:true}).click();await pause(200);pages.push({name,durationMs:Date.now()-t,screenshot:await shot(theme+'-settings-'+name)});}await page.keyboard.press('Escape');return {pages};});
  await page.keyboard.press('Escape');
  await check(theme+'-narrow-window',async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate').setContentSize(480,750));const screenshot=await shot(theme+'-narrow');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Horizontal overflow');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate').setContentSize(1100,780));return {screenshot};});
 }
 const duration=30*60*1000,start=Date.now();let cycle=0;
 while(Date.now()-start<duration){cycle++;await check('stability-cycle-'+cycle,async()=>{
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'新对话 Ctrl N',exact:true}).click();const text=`QA1_SYNTHETIC_BODY_${cycle} 合成循环消息`;
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill(text);
  await page.evaluate(text=>{window.qa1First=null;document.getElementById('message-form').addEventListener('submit',()=>{const start=performance.now();const o=new MutationObserver(()=>{if(document.getElementById('transcript').textContent.includes(text)){window.qa1First=performance.now()-start;o.disconnect();}});o.observe(document.getElementById('transcript'),{subtree:true,childList:true,characterData:true});},{once:true,capture:true});},text);
  await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.qa1First!==null);const immediateMs=await page.evaluate(()=>window.qa1First);
  await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();if(cycle%3===0){await pause(1000);await page.getByRole('button',{name:'停止回复',exact:true}).click();}else await pause(19000);
  if(cycle<=3||cycle%10===0)await shot('cycle-'+cycle);return {immediateMs};});
  console.log('QA1 stability',cycle,Math.round((Date.now()-start)/1000));await pause(12000);
 }
 report.stability=await app.evaluate(()=>{const q=globalThis.qa1;q.hist.disable();clearInterval(q.timer);q.watchers.forEach(w=>w.close());return {elapsedMs:Date.now()-q.started,p99Ms:q.hist.percentile(99)/1e6,maxMs:q.hist.max/1e6,storeWatchEvents:q.writes,samples:q.samples};});
 report.modelCalls=calls;report.finishedAt=new Date().toISOString();save();
}catch(e){report.fatal=e.message;save();console.error(e.message);}finally{await app?.close();model.closeAllConnections();await new Promise(r=>model.close(r));report.cleaned=true;save();}
