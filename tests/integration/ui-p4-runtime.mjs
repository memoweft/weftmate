// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Production main.mjs + pinned DSH + loopback streaming model. Synthetic account only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=mkdtempSync(join(tmpdir(),'weftmate-p4-runtime-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const evidence=resolve('tests/evidence/ui-p4'), credentials={username:'ComposerFixture',password:`synthetic-${randomUUID()}-password`,deviceName:'UI-P4 Runtime'};
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(method=>[method,async()=>method==='listModels'?[]:{}]));
const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();
const registered=await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});
assert.equal(registered.status,201);await preparation.close();
let modelCalls=0,frames=0;
const model=createServer(async(request,response)=>{
  if(request.url==='/props'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({n_ctx:828000,total_slots:1}));return;}
  if(request.url==='/v1/models'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:[{id:'p4-synthetic',object:'model',context_window:828000}]}));return;}
  if(request.url!=='/v1/chat/completions'){response.writeHead(404).end();return;}
  let raw='';for await(const chunk of request)raw+=chunk;const input=JSON.parse(raw);modelCalls++;
  response.writeHead(200,{'content-type':'text/event-stream'});
  const frame=(text,finish=null,usage)=>{frames++;response.write(`data: ${JSON.stringify({id:'p4-runtime',object:'chat.completion.chunk',model:input.model,choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:finish}],...(usage?{usage}:{})})}\n\n`);};
  for(let n=0;n<20;n++){if(response.destroyed)return;frame(`合成流式回复 ${n}：输入区与滚动验证。\n\n`);await new Promise(done=>setTimeout(done,80));}
  frame('', 'stop',{prompt_tokens:713000,completion_tokens:500,total_tokens:713500});response.end('data: [DONE]\n\n');
});
await new Promise(done=>model.listen(0,'127.0.0.1',done));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app,browser;const errors=[];const report={syntheticOnly:true,realMain:true,realDsh:true,paidModelRequests:0,themes:[]};
try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['.',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
  const page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials);
  const api=async(path,body)=>page.evaluate(async({path,body})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch('/personal/v1'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body});
  assert.equal((await api('/account/models',{requestId:'p4-model',name:'合成上下文模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'p4-synthetic',apiKey:'synthetic-only'})).status,202);
  await page.waitForFunction(async()=>{const value=await(await fetch('/personal/v1/account/models/by-request/p4-model')).json();return value.operation?.status==='succeeded';});await page.reload();
  browser=await chromium.launch({headless:true});
  const origin=new URL(page.url()).origin,remote=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await remote.goto(origin+'/personal/v1/ui');await localUiSession(remote,credentials);
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.getByRole('button',{name:'新对话 Ctrl N',exact:true}).click();const text=`合成首条消息 ${theme}`;
    await page.getByRole('button',{name:'自动',exact:true}).waitFor();await page.getByRole('button',{name:'自动',exact:true}).click();
    await page.getByRole('menuitemradio',{name:/每次询问/}).click();
    await page.getByRole('button',{name:'每次询问',exact:true}).waitFor();
    await page.screenshot({path:join(evidence,`runtime-${theme}-00-new-approval-mode.png`)});
    await page.getByRole('textbox',{name:'输入消息',exact:true}).fill(text);
    await page.evaluate(text=>{window.p4RuntimeElapsed=null;document.getElementById('message-form').addEventListener('submit',()=>{const start=performance.now();const observer=new MutationObserver(()=>{if(document.getElementById('transcript').textContent.includes(text)){window.p4RuntimeElapsed=performance.now()-start;observer.disconnect();}});observer.observe(document.getElementById('transcript'),{subtree:true,childList:true,characterData:true});},{capture:true,once:true});},text);
    await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.p4RuntimeElapsed!==null);
    await page.screenshot({path:join(evidence,`runtime-${theme}-01-first-message.png`)});
    const elapsed=await page.evaluate(()=>window.p4RuntimeElapsed);assert.ok(elapsed<100);
    await page.getByText(/合成流式回复 19/).first().waitFor();
    await page.waitForFunction(async()=>{const data=await(await fetch('/personal/v1/sessions')).json();return data.sessions.some(row=>row.contextUsage?.usedTokens>=713000);});
    const sessions=(await api('/sessions')).body.sessions,current=sessions.find(row=>row.contextUsage?.usedTokens>=713000);assert.equal(current.contextUsage.contextWindow,828000);
    assert.equal((await api(`/sessions/${current.sessionId}/approval-mode`)).body.mode,'ask');
    await page.waitForFunction(()=>document.querySelector('[aria-label="背景信息窗口：86% 已用"]'));
    await page.getByRole('button',{name:'背景信息窗口：86% 已用',exact:true}).focus();await page.screenshot({path:join(evidence,`runtime-${theme}-02-real-context.png`)});
    await remote.reload();await remote.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await remote.getByRole('button',{name:'背景信息窗口：86% 已用',exact:true}).click();await remote.getByRole('tooltip').waitFor();await remote.screenshot({path:join(evidence,`runtime-mobile-${theme}-context.png`)});
    report.themes.push({theme,firstMessageMs:elapsed,contextUsage:current.contextUsage,newDraftApprovalMode:'ask'});
  }
  report.modelCalls=modelCalls;report.streamingFrames=frames;report.errors=errors;assert.deepEqual(errors,[]);writeFileSync(join(evidence,'runtime.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser?.close();await app?.close();await new Promise(done=>model.close(done));assert.ok(root.startsWith(join(tmpdir(),'weftmate-p4-runtime-')));rmSync(root,{recursive:true,force:true});}
