// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
async function until(read,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(done=>setTimeout(done,200));}throw new Error('isolated runtime condition timed out');}
assert.ok(process.env.UX3_MIMO_KEY,'MiMo credential must be supplied in process memory');
const root=mkdtempSync(join(tmpdir(),'weftmate-st1-mimo-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'ThinkingFixture',password:`synthetic-${randomUUID()}-password`,deviceName:'隔离推理验收'};
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(method=>[method,async()=>method==='listModels'?[]:{}]));
const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();
const response=await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});assert.equal(response.status,201);await preparation.close();
const wireFile=join(root,'wire.jsonl');
const hook=join(root,'wire-hook.mjs');writeFileSync(hook,`process.env.UX3_WIRE_FILE=${JSON.stringify(wireFile)};await import(${JSON.stringify(new URL('./ux-3-wire-hook.mjs',import.meta.url).href)});`);
const env={...process.env,UX3_WIRE_FILE:wireFile,UX3_HOOK_MODULE:new URL("file:///"+hook.replaceAll("\\","/")).href};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app,attemptUsage=null;const evidence=resolve('tests/evidence/st-1');mkdirSync(evidence,{recursive:true});
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/ux-3-runtime-electron.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
 app.process().stderr?.on('data',data=>process.stderr.write(data));
 const page=await app.firstWindow();page.setDefaultTimeout(60000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials);
 const api=async(path,body,method)=>page.evaluate(async({path,body,method})=>{const me=body?await(await fetch('/personal/v1/auth/me')).json():{};const response=await fetch('/personal/v1'+path,{method:method||(body?'POST':'GET'),headers:body?{'content-type':'application/json','x-weftmate-csrf':me.csrfToken}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method});

 assert.equal((await api('/account/models',{requestId:'st1-mimo-model',name:'合成账号 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:'synthetic-not-provider-key'})).status,202);
 await until(async()=> (await api('/account/models/by-request/st1-mimo-model')).body.operation?.status==='succeeded');await page.reload();
 await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'个性化',exact:true}).click();
 await page.getByRole('textbox',{name:'怎么称呼你',exact:true}).fill('小合成');
 await page.getByRole('textbox',{name:'固定说明',exact:true}).fill('回答末尾加一行「—WM」。');
 await page.getByRole('button',{name:'保存个性化',exact:true}).click();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
 await page.getByRole('combobox',{name:'回复语气',exact:true}).click();await page.getByRole('option',{name:'简洁',exact:true}).click();
 await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'助手',exact:true}).click();
 await page.getByRole('switch',{name:'网页搜索',exact:true}).uncheck();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
 await page.getByRole('switch',{name:'新对话默认深入思考',exact:true}).check();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await page.getByRole('button',{name:'新对话 Ctrl N',exact:true}).click();
 await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('用设置里的称呼向我问好。只需一句，不调用工具。');await page.getByRole('button',{name:'发送',exact:true}).click();
 const captured=await until(async()=>{const rows=(await api('/sessions')).body.sessions;for(const row of rows||[]){const events=(await api(`/sessions/${row.sessionId}/events?limit=100`)).body.events||[];if(events.some(e=>e.type==='turn.ended')&&events.some(e=>e.type==='user.message'&&e.data.text.includes('用设置里的称呼')))return {session:row,events};}return false;});
 const reply=captured.events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');assert.match(reply,/小合成/);assert.match(reply,/—WM\s*$/);assert.equal(captured.session.deepThinking,true);
 assert.ok(captured.events.some(e=>e.type==='assistant.message'&&e.data.modelThinking),'provider thinking must reach the presentation');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`mimo-${theme}-reply.png`)});}
 const displays=[];
 for(const [mode,label]of [['collapsed','折叠'],['expanded','展开'],['hidden','不显示']]){
   await api('/settings/personalization',{thinkingDisplay:mode},'PATCH');await page.reload();
   if(mode==='hidden')assert.equal(await page.getByText('思考过程',{exact:true}).filter({visible:true}).count(),0);
   else{await page.getByText('思考过程',{exact:true}).waitFor();assert.equal(await page.getByText('思考过程',{exact:true}).evaluate(n=>n.parentElement.open),mode==='expanded');}
   await page.screenshot({path:join(evidence,`mimo-thinking-${mode}.png`)});displays.push(label);
 }
 const status=(await api('/status')).body,hostId=status.hostId,modelProfileId=captured.session.modelProfileId;
 const command=async body=>{const r=await api('/commands',{requestId:'st1-'+randomUUID(),targetDeviceId:hostId,...body});assert.equal(r.status,202,JSON.stringify(r.body));return until(async()=>{const row=(await api('/commands/'+r.body.command.commandId)).body.command;assert.ok(!['rejected','failed'].includes(row.state),JSON.stringify(row));return row.state==='accepted_by_dsh'&&row;});};
 const turns=[{kind:'new',reply,thinking:true}];
 const main=(await api('/chats/main')).body.chat;
 const mainCommand=await command({kind:'chat.message',chatId:main.chatId,modelProfileId,text:'用设置里的称呼向我问好。只需一句，不调用工具。'});
 const verifyTurn=async(kind,sessionId)=>{const events=await until(async()=>{const rows=(await api(`/sessions/${sessionId}/events?limit=100`)).body.events||[];return rows.some(e=>e.type==='turn.ended')&&rows;});const text=events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');assert.match(text,/小合成/);assert.match(text,/—WM\s*$/);turns.push({kind,reply:text,thinking:events.some(e=>e.data?.modelThinking)});};
 await verifyTurn('main',mainCommand.sessionId);
 const projectRoot=join(profile,'synthetic-project');mkdirSync(projectRoot);
 const projectResponse=await api('/projects',{requestId:'st1-project',name:'合成项目',rootPath:projectRoot,instructions:'只用中文回答。',permission:'read-only'});
 assert.ok(projectResponse.status<300,JSON.stringify(projectResponse.body));const projectId=projectResponse.body.project.projectId;
 const projectChat=await command({kind:'session.side.create',parent:{kind:'project',id:projectId},modelProfileId,title:'合成项目对话'});
 await command({kind:'session.message',sessionId:projectChat.sessionId,text:'用设置里的称呼向我问好。只需一句，不调用工具。'});await verifyTurn('project',projectChat.sessionId);

 for(const [kind,temporary]of [['side',false],['temporary',true]]){
   const created=await command(temporary?{kind:'session.create',modelProfileId,temporary:true}:{kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId,title:'合成旁聊'});
   await command({kind:'session.message',sessionId:created.sessionId,text:'用设置里的称呼向我问好，并说明我刚才让你做什么。不要调用工具，只需一句。'});
   const events=await until(async()=>{const events=(await api(`/sessions/${created.sessionId}/events?limit=100`)).body.events||[];return events.some(e=>e.type==='turn.ended')&&events;});
   const text=events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');assert.match(text,/小合成/);assert.match(text,/—WM\s*$/);turns.push({kind,reply:text,thinking:events.some(e=>e.data?.modelThinking)});
 }
 // A request that would normally use research still has no network tool catalog when disabled.
 await command({kind:'session.message',sessionId:captured.session.sessionId,text:'请查今天最新的天气。如果网页搜索关闭，请说明无法查证，不要改用命令或其他工具。'});
 const searchEvents=await until(async()=>{const events=(await api(`/sessions/${captured.session.sessionId}/events?limit=100`)).body.events||[];return events.filter(e=>e.type==='turn.ended').length>=2&&events;});
 assert.ok(!searchEvents.some(e=>e.type==='step.started'&&['web_fetch','web_search','browser'].includes(e.data.toolName)));
 const usage=(await api('/usage?timeZone=Asia%2FShanghai')).body;attemptUsage=usage;
 const wire=existsSync(wireFile)?readFileSync(wireFile,'utf8').trim().split('\n').map(JSON.parse):[];
 writeFileSync(join(evidence,'mimo.json'),JSON.stringify({realElectron:true,realPinnedDsh:true,turns,thinkingDisplays:displays,webSearchDisabled:true,wire,usage},null,2)+'\n');
 console.log('ST-1 MiMo verification passed',JSON.stringify({turns:turns.length,thinkingDisplays:displays,requests:wire.filter(r=>r.model).length}));
}catch(error){const page=(await app?.windows())?.find(p=>p.url().includes('/personal/v1/ui'));if(page)await page.screenshot({path:join(evidence,'mimo-failure.png')});throw error;}
finally{if(existsSync(wireFile)){const file=join(evidence,'mimo-attempts.json');const attempts=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];attempts.push({at:new Date().toISOString(),usage:attemptUsage,wire:readFileSync(wireFile,'utf8').trim().split('\n').map(JSON.parse)});writeFileSync(file,JSON.stringify(attempts,null,2)+'\n');}await app?.close();rmSync(root,{recursive:true,force:true});}
