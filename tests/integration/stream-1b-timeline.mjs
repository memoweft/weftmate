import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const mimo=process.argv.includes('--mimo'),long=process.argv.includes('--long'),out=resolve('tests/evidence/stream-1/rework/timeline',process.argv.includes('--privacy')?'privacy':process.argv.includes('--motion')?'mimo-motion':long?(mimo?(process.argv.includes('--text-only')?'mimo-long-final':process.argv.includes('--after')?'mimo-long-after':'mimo-long'):'synthetic-long'):mimo?'mimo':'synthetic');mkdirSync(out,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'weftmate-stream1-live-')),profile=join(root,'profile'),wire=join(root,'wire.jsonl');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'stream1-'+randomUUID(),password:'synthetic-'+randomUUID(),deviceName:'synthetic-host'};
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,hostName:'synthetic-host',backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>k==='listModels'?[]:{}]))});
const info=await prep.start(),grant=await prep.issueSetupGrant();
assert.equal((await fetch(info.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:info.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})})).status,201);await prep.close();
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(read,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const v=await read();if(v)return v;await pause(100);}throw Error('stream1 condition timed out');}
const provider=[];
const server=createServer(async(req,res)=>{
 if(req.method!=='POST')return res.writeHead(404).end('{}');let raw='';for await(const part of req)raw+=part;const b=JSON.parse(raw);
 const completion=b.messages?.[0]?.content?.includes('续写用户草稿');
 const text=completion?'整理成清单。':b.messages?.[0]?.content?.includes('预测用户')?'{"suggestions":["整理成清单","补充备份步骤"]}':'# 家庭资料整理\n\n'+('先按年份整理照片，再把证件和账单分类保存。\n\n'.repeat(36))+'合成回复完成。';
 if(!b.stream)return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{content:text}}],usage:{prompt_tokens:20,completion_tokens:10}}));
 res.writeHead(200,{'content-type':'text/event-stream'});
 for(let n=0;n<text.length;n+=36){await pause(100);provider.push({at:Date.now(),length:Math.min(36,text.length-n)});res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text.slice(n,n+36)},finish_reason:null}]})}\n\n`);}
 res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":10}}\n\ndata: [DONE]\n\n');
});await new Promise(done=>server.listen(0,'127.0.0.1',done));
const env={...process.env,STREAM1_WIRE:wire,STREAM1_HOOK:resolve('tests/integration/stream-1-wire-hook.mjs')};
if(process.argv.includes('--text-only'))env.STREAM1_TEXT_ONLY='1';
for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE')delete env[k];
let app,browser,page,phone,api;const report={mimo,textOnlyProvider:process.argv.includes('--text-only'),errors:[],provider,completions:[]};
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/stream-1-electron-entry.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
 page=await app.firstWindow();await page.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.__timelineCore=core;ui.loadAttachmentHasher =')}));page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials,'STREAM-1',{mainChat:true});
 api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw Error(value.error?.code||r.status);return value;},{path,body,method});
 report.hostName=(await api('/status')).hostName;assert.equal(report.hostName,'synthetic-host');
 const id=randomUUID();await api('/account/models',{requestId:id,name:'STREAM-1 model',baseUrl:mimo?'https://api.xiaomimimo.com/v1':`http://127.0.0.1:${server.address().port}/v1`,modelId:mimo?'mimo-v2.6-flash':'synthetic-stream',apiKey:mimo?'synthetic-not-provider-key':'synthetic-key'});
 await until(async()=>(await api('/account/models/by-request/'+id)).operation?.status==='succeeded');await page.reload();await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
 await api('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
 browser=await chromium.launch({headless:true});phone=await browser.newPage({viewport:{width:390,height:844}});await phone.goto(new URL('/personal/v1/ui',page.url()).href);await localUiSession(phone,credentials,'STREAM-1 phone',{mainChat:true});
 async function monitor(p){await p.waitForFunction(()=>!!globalThis.WeftContent);await p.evaluate(()=>{globalThis.stream1Frames=[];globalThis.stream1Updates=[];const update=WeftContent.update;WeftContent.update=function(node,text,options){const at=performance.now(),v=update(node,text,options);stream1Updates.push({at,duration:performance.now()-at,length:text.length,wallAt:Date.now()});return v;};function frame(){const body=[...document.querySelectorAll('.message.assistant .message-text,.main-chat-row.assistant .markdown')].at(-1);stream1Frames.push({active:globalThis.__timelineCore?.mainReplyActive(),pending:globalThis.__timelineCore?.optimisticMessages().map(r=>r.status),main:globalThis.__timelineCore?.state.mainChat?.running,at:Date.now(),length:body?.textContent?.replace(/\u200b/g,'').length||0,dot:!!body?.querySelector('.reply-indicator'),streaming:!!body?.classList.contains('reply-streaming'),fragments:document.querySelectorAll('.reply-fragment').length});globalThis.stream1Raf=requestAnimationFrame(frame);}frame();});}
 await monitor(page);await monitor(phone);
 const prompt=process.argv.includes('--motion')?'用中文给三点整理照片的实用建议，每点一句话，直接输出。':long?'请写一份约10000字的中文家庭资料整理实施指南，正文至少10000字，分30个小节，每节详细展开具体做法、情境和实例，包括照片、账单、证件、备份、命名、维护。用自然中文，不调用工具。':'家里的照片、账单和证件越来越多，请给一个自然、详细、可执行的整理方案，分段说明分类、命名、备份与维护，并举几个例子。不要使用工具。';
 report.started=Date.now();await page.getByRole('textbox',{name:'输入消息',exact:true}).fill(prompt);await page.getByRole('button',{name:'发送',exact:true}).click();
 await until(async()=>(await api('/chats/main')).chat.activeSessionId);const session=(await api('/chats/main')).chat.activeSessionId;report.session=session;
 const samples=[];let last=0;
 const motion=process.argv.includes('--motion')?Promise.all([['desktop',page],['phone',phone]].map(async([surface,p])=>{await p.waitForFunction(()=>document.getAnimations().some(a=>a.effect?.target?.closest('.reply-streaming')&&a.effect.getTiming().duration===120),{polling:'raf',timeout:30000});const frames=[];for(let n=0;n<8;n++){frames.push(await p.evaluate(()=>({at:Date.now(),opacity:document.getAnimations().filter(a=>a.effect?.target?.closest('.reply-streaming')&&a.effect.getTiming().duration===120).map(a=>getComputedStyle(a.effect.target).opacity),dots:document.querySelectorAll('.reply-indicator').length})));await p.screenshot({path:join(out,`${surface}-motion-${n}.png`)});}return {surface,frames};})):null;
 while(true){const e=await api(`/sessions/${session}/events?afterSeq=-1&limit=200`);samples.push({at:Date.now(),events:e.events.map(x=>({seq:x.seq,type:x.type,length:x.data?.text?.length})),live:e.liveEvents?.map(x=>({seq:x.seq,cursor:x.data.cursor,length:x.data.text.length}))});
  const length=await page.evaluate(()=>[...document.querySelectorAll('.message.assistant .message-text')].at(-1)?.textContent.length||0);
  if(!process.argv.includes('--motion')&&length>last+80){last=length;await page.screenshot({path:join(out,`desktop-frame-${String(samples.length).padStart(4,'0')}.png`)});if(samples.length<120)await phone.screenshot({path:join(out,`phone-frame-${String(samples.length).padStart(4,'0')}.png`)});}
  if(e.events.some(x=>x.type==='turn.ended'))break;if(samples.length>(long?9000:1200))throw Error('reply did not finish');await pause(100);
 }
 if(motion)report.motion=await motion;await pause(700);report.samples=samples;
 for(const [surface,p] of [['desktop',page],['phone',phone]]){
  report[surface]=await p.evaluate(()=>({frames:stream1Frames,updates:stream1Updates,remainingDots:document.querySelectorAll('.reply-indicator').length,assistantRows:document.querySelectorAll('.message.assistant').length}));
  for(const theme of ['light','dark']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.screenshot({path:join(out,`${surface}-final-${theme}.png`)});}
 }
 report.debug=await page.evaluate(()=>({main:__timelineCore.state.mainChat,session:__timelineCore.state.selectedSessionId,inMain:__timelineCore.inMainChat(),reply:__timelineCore.mainReplyActive(),optimistic:__timelineCore.optimisticMessages().map(x=>x.status),events:__timelineCore.mainChatDays().flatMap(g=>g.events).map(e=>({type:e.type,live:e.data.live})),cap:__timelineCore.state.personalCapabilities,timer:!!__timelineCore.state.liveRefreshTimer}));assert.ok(new Set(report.desktop.frames.map(x=>x.length)).size>4,'desktop must grow');assert.ok(new Set(report.phone.frames.map(x=>x.length)).size>4,'phone must grow');assert.ok(report.desktop.frames.some(x=>x.dot));assert.equal(report.desktop.remainingDots,0);assert.equal(report.phone.remainingDots,0);
 if(long){const events=(await api(`/sessions/${session}/events?limit=200`)).events;const last=events.findLast(e=>e.type==='assistant.message');if(last)report.finalText=(await api(`/sessions/${session}/events/${last.seq}/detail`)).text;}
 if(mimo&&!long&&!process.argv.includes('--motion')){await api('/settings/personalization',{nextSuggestionsEnabled:true},'PATCH');
  const drafts=['请把刚才的整理建议','把照片分类方案','请给证件备份','把命名规则','请把维护步骤','帮我把账单','请把这套方案','把备份注意事项','请给我一份','把刚才的例子'];
  for(const draft of drafts){const started=Date.now(),v=await api(`/sessions/${session}/suggestions`,{kind:'completion',draft,requestId:randomUUID()});report.completions.push({draft,durationMs:Date.now()-started,completion:v.completion});console.log(JSON.stringify(report.completions.at(-1)));}
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('请把刚才的整理建议');await until(async()=>page.locator('.composer-completion').count()?await page.locator('.composer-completion').isVisible():false,18000).catch(()=>{});await page.screenshot({path:join(out,'gray-completion.png')});
 }
 report.usage=await api('/usage');report.wire=existsSync(wire)?readFileSync(wire,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');assert.deepEqual(report.errors,[]);console.log('STREAM-1 live desktop and phone passed');
}catch(e){report.failure=e.message;for(const [surface,p]of [['desktop',page],['phone',phone]])if(p)try{report[surface]=await p.evaluate(()=>({frames:stream1Frames,updates:stream1Updates,remainingDots:document.querySelectorAll('.reply-indicator').length}));}catch{}if(page)await page.screenshot({path:join(out,'failure.png')});throw e;}
finally{if(existsSync(wire))report.wire=readFileSync(wire,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await app?.close();server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}
