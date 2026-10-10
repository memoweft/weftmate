import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const evidence=resolve('tests/evidence/ux-8');mkdirSync(evidence,{recursive:true});
assert.ok(process.env.UX3_MIMO_KEY,'MiMo credential must be supplied in process memory');
const root=mkdtempSync(join(tmpdir(),'weftmate-ux8-mimo-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'ReplyMotionMimoFixture',password:`synthetic-${randomUUID()}-password`,deviceName:'消息操作真实隔离验收'};
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(method=>[method,async()=>method==='listModels'?[]:{}]));
const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();
assert.equal((await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})})).status,201);await preparation.close();
const wireFile=join(root,'wire.jsonl'),hook=join(root,'wire-hook.mjs');
writeFileSync(hook,`process.env.UX3_WIRE_FILE=${JSON.stringify(wireFile)};const fetchOriginal=globalThis.fetch;globalThis.fetch=(url,options)=>{if(new URL(typeof url==='string'||url instanceof URL?url:url.url).port==='8081')throw new Error('Daily endpoint prohibited');return fetchOriginal(url,options)};await import(${JSON.stringify(new URL('./ux-3-wire-hook.mjs',import.meta.url).href)});`);
const env={...process.env,UX3_WIRE_FILE:wireFile,UX3_HOOK_MODULE:new URL('file:///'+hook.replaceAll('\\','/')).href};
for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let app,page,api;const failures=[];
async function until(read,timeout=240000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Isolated UX-8 runtime timed out');}
try {
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/ux-3-runtime-electron.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
  page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>failures.push(error.message));await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials,'UX-8 real main enabled',{mainChat:true});
  api=(path,body,method)=>page.evaluate(async({path,body,method})=>{const me=body?await(await fetch('/personal/v1/auth/me')).json():{};const response=await fetch('/personal/v1'+path,{method:method||(body?'POST':'GET'),headers:body?{'content-type':'application/json','x-weftmate-csrf':me.csrfToken}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(value.error?.code);return value;},{path,body,method});
  await api('/account/models',{requestId:'ux8-model',name:'合成账号 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:'synthetic-not-provider-key'});
  await until(async()=>{const data=await api('/account/models/by-request/ux8-model');return data.operation?.status==='succeeded';});await page.reload();
  const selectedModel=(await api('/models')).models.find(model=>model.name==='合成账号 MiMo');
  const hostId=(await api('/status')).hostId;
  const created=await api('/commands',{requestId:'ux8-native-side',kind:'session.create',targetDeviceId:hostId,modelProfileId:selectedModel.id});
  const ready=await until(async()=>{const command=(await api('/commands/'+created.command.commandId)).command;return command.state==='accepted_by_dsh'&&command;});
  await api(`/sessions/${ready.sessionId}/metadata`,{title:'回复动效真实验收'},'PATCH');await page.reload();
  await page.getByRole('button',{name:'回复动效真实验收',exact:true}).click();
  await api(`/sessions/${ready.sessionId}/thinking`,{enabled:true},'PATCH');await api('/settings/personalization',{thinkingDisplay:'expanded'},'PATCH');
  const syntheticFile=join(root,'ux8-tool-fixture.txt');writeFileSync(syntheticFile,'合成读书会：12名参与者，90分钟，预算0元。');
  const prompt=`这是隔离合成界面验证。先调用读取文件工具读取这个真实合成文件（绝对路径）：${syntheticFile}，然后依据文件，用中文输出约3000字读书会长方案，包括至少12段、清单、Python代码块、Markdown表格，最后写“合成长回复完成”。不得访问网络。请深入思考后完整输出。`;
  await page.evaluate(()=>{globalThis.ux8Frames=[];new MutationObserver(()=>{const text=document.querySelector('.message.assistant .message-text');globalThis.ux8Stages ||= []; const stage=document.querySelector('.inline-progress-text')?.firstChild?.textContent; if(stage && globalThis.ux8Stages.at(-1)?.text!==stage)globalThis.ux8Stages.push({at:performance.now(),text:stage});if(text){const length=text.textContent.length,last=globalThis.ux8Frames.at(-1);if(last?.length!==length)globalThis.ux8Frames.push({at:performance.now(),length,codes:text.querySelectorAll('pre').length,tables:text.querySelectorAll('table').length,math:text.querySelectorAll('.katex').length});}}).observe(document.body,{subtree:true,childList:true,characterData:true});});
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill(prompt);await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.locator('.inline-progress-text').first().waitFor({timeout:30000});await page.screenshot({path:join(evidence,'mimo-thinking.png')});
  const completed=await until(async()=>{const events=(await api(`/sessions/${ready.sessionId}/events?afterSeq=-1&limit=200`)).events;return events.some(event=>event.type==='turn.ended')&&events;});
  await page.locator('.message.assistant .render-code').waitFor();await page.locator('.message.assistant table').waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`mimo-${theme}.png`)});}
  const stages=await page.evaluate(()=>globalThis.ux8Stages||[]);
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('继续输出一篇约5000字的读书会实施计划，每个段落详细展开。这是停止按钮的合成验证。');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();await page.waitForTimeout(2500);await page.getByRole('button',{name:'停止回复',exact:true}).click();await until(async()=>{const events=(await api(`/sessions/${ready.sessionId}/events?afterSeq=-1&limit=200`)).events;return events.some(event=>event.type==='turn.ended'&&event.data?.reason==='aborted');});await page.screenshot({path:join(evidence,'mimo-stopped.png')});
  const usage=await api('/usage?timeZone=Asia%2FShanghai'),wire=existsSync(wireFile)?readFileSync(wireFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  writeFileSync(join(evidence,'mimo.json'),JSON.stringify({syntheticAccount:true,realElectron:true,realDsh:true,noDailyEndpoint:true,code:true,table:true,observedFrames:await page.evaluate(()=>ux8Frames),stages,stopped:true,thinkingCharacters:completed.filter(e=>e.type==='assistant.message').reduce((n,e)=>n+(e.data?.modelThinking?.length||0),0),toolEvents:completed.filter(e=>e.type.startsWith('step.')).map(e=>({type:e.type,state:e.data?.state,summary:e.data?.summary})),wire,usage,rendererErrors:failures},null,2)+'\n');assert.deepEqual(failures,[]);console.log('UX-8 real MiMo long reply, tool status and stop passed.');
} finally {let usage;try{if(api)usage=await api('/usage?timeZone=Asia%2FShanghai');}catch{}
  if(existsSync(wireFile)){const file=join(evidence,'mimo-attempts.json'),attempts=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];attempts.push({at:new Date().toISOString(),wire:readFileSync(wireFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),...(usage?{usage}:{})});writeFileSync(file,JSON.stringify(attempts,null,2)+'\n');}await app?.close();rmSync(root,{recursive:true,force:true});}
