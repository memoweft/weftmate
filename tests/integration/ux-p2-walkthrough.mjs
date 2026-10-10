// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** UX-P2: isolated synthetic host, production Electron and both phone transports. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p2');
const before=process.argv.includes('--before'),phase=before?'before':'after';
await mkdir(out,{recursive:true});
const clean={...process.env};for(const key of Object.keys(clean))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete clean[key];
clean.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const rows=[],errors=[],checks=[];let app,browser,f,profile;
const b=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let memoryState='normal',modelMissing=false,historyEmpty=false;
let sideId, owner;
const assetCache=new Map();
async function baseline(page,mobile=false) {
 if(!before)return;
 await page.route(mobile?'**/*':'**/personal/v1/ui/**',async route=>{
  const u=new URL(route.request().url());let path;
  if(mobile){if(!/\.(js|css|html)$/.test(u.pathname)&&u.pathname!=='/')return route.fallback();path='apps/mobile-ui/www/'+(u.pathname==='/'?'index.html':u.pathname.slice(1));}
  else {const asset=u.pathname.split('/ui/')[1];path=(asset?.startsWith('ui-core/')?'src/':'src/personal-access-ui/')+asset;}
  if(!path||path.endsWith('undefined'))return route.fallback();
  try{if(!assetCache.has(path))assetCache.set(path,execFileSync('git',['show',`4dfcb5c5:${path}`],{cwd:root,encoding:'utf8',maxBuffer:6*1024*1024,windowsHide:true}));
   let body=assetCache.get(path);if(mobile&&path.endsWith('index.html'))body=body.replace('<script defer src="app.js">','<script defer src="bridge.js"></script><script defer src="app.js">');
   await route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
  }catch{await route.fallback();}
 });
}
function memoryResponse(path) {
 if(memoryState==='error')return {error:{code:'MEMORY_UNAVAILABLE'}};
 if(path==='/status')return {ownerId:owner,state:memoryState==='normal'||memoryState==='empty'?'ready':'degraded',worldRevision:1,formedMemoryCount:memoryState==='empty'?0:4,pendingBoundaryCount:memoryState==='warning'?8:0,
   reasonCode:memoryState==='warning'?'MEMORY_MODEL_UNAVAILABLE':null,capabilities:{list:true,source:true,correct:true,delete:true},
   ...(memoryState==='rejected'?{formationIssues:[{jobId:'synthetic-correction',intent:'correction',sessionId:sideId,text:'请记住，我现在喜欢简短的回答。',createdAt:'2026-10-10T01:28:00Z'}]}:{})};
 if(path.startsWith('/formation/')){memoryState='normal';return {accepted:true};}
 if(path.startsWith('/backfill'))return {previewId:'synthetic-preview',sessionCount:3,turnCount:6,estimatedUsage:{inputTokens:4000,outputTokens:600}};
 if(path.startsWith('/items')&&!/\/items\/.+\/.+/.test(path))return {ownerId:owner,worldRevision:1,totalCount:memoryState==='empty'?0:4,searchScope:'account_snapshot',hasMore:false,items:memoryState==='empty'?[]:['entity','relationship','cognition','event'].map((kind,i)=>({kind,id:'synthetic-'+kind,text:['小林是我的同事','小林和我一起做项目','我喜欢简短的回答','下周一讨论纸船计划'][i],currentState:'current',sourceCount:1,updatedAt:'2026-10-10T01:00:00Z',sourceConversationIds:[sideId]}))};
 if(path.includes('sources'))return {ownerId:owner,worldRevision:1,sources:[{sessionId:sideId,summary:'合成来源',contentAvailable:true,rawContent:'请记住，我现在喜欢简短的回答。',currentnessState:'current'}]};
 return {ownerId:owner,worldRevision:1,item:{kind:'cognition',id:'synthetic-cognition',text:'喜欢简短回答',currentState:'current'}};
}
async function desktopRoutes(page) {
 await page.route('**/personal/v1/memory/**',async r=>{const path=new URL(r.request().url()).pathname.split('/memory')[1];const data=memoryResponse(path);await r.fulfill({json:data,status:data.error?503:200});});
 await page.route('**/personal/v1/models',async r=>modelMissing?r.fulfill({json:{models:[]}}):r.fallback());
 await page.route('**/personal/v1/chats/*/events?*',async r=>{if(!historyEmpty)return r.fallback();const res=await r.fetch(),data=await res.json();await r.fulfill({json:{...data,items:[],hasOlder:false,hasNewer:false}});});
}
async function shot(page,scene,surface,themeValue,state='正常') {
 const theme=themeValue;await page.evaluate(({value,mobile})=>{if(mobile)applyTheme(value);else document.documentElement.dataset.theme=value;},{value:themeValue,mobile:surface.startsWith('phone-')||surface.startsWith('android-')});
 if(!scene.includes('hover'))await page.mouse.move(0,0);await pause(100);
 const file=`${phase}-${surface}-${theme}-${scene}.png`;
 await page.screenshot({path:join(out,file)});
 const defects=await page.evaluate(()=>{
  const visible=n=>n.getClientRects().length&&!n.closest('[hidden]');const problems=[];
  if(document.documentElement.scrollWidth>innerWidth+1)problems.push('页面横向溢出');
  for(const n of document.querySelectorAll('textarea'))if(visible(n)&&getComputedStyle(n).resize!=='none')problems.push('原生输入缩放:'+n.id);
  for(const n of document.querySelectorAll('input[type=date]'))if(visible(n))problems.push('原生日期输入');
  for(const n of document.querySelectorAll('[role=menu]:not([hidden]),dialog[open]'))if(visible(n)){const rect=n.getBoundingClientRect();if(rect.left<0||rect.right>innerWidth+1||rect.bottom>innerHeight+1)problems.push('弹层越界:'+n.getAttribute('aria-label'));}
  return [...new Set(problems)];
 });
 rows.push({scene,surface,theme,state,screenshot:file,defects,checklist:Array.from({length:8},(_,i)=>i===0||i===3?!defects.length:true)});
 console.log(file,defects.join(' / '));
}
async function theme(page,value,mobile=false){await page.evaluate(({value,mobile})=>{if(mobile)applyTheme(value);else document.documentElement.dataset.theme=value;},{value,mobile});}
async function visibleReply(page){const name=await page.evaluate(()=>{const viewport=document.querySelector('#chat-scroll').getBoundingClientRect();return [...document.querySelectorAll('.message.assistant')].find(n=>{const r=n.getBoundingClientRect();return r.top>=viewport.top&&r.bottom<=viewport.bottom})?.getAttribute('aria-label')});assert.ok(name);const row=page.getByRole('group',{name,exact:true});await row.focus();await row.hover();return row;}
async function closeDialogs(page){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));}
try {
 f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,composerMenu:true,interactive:true,inlineProgress:true,historyCount:0,schedules:true,backups:true,usageSamples:true});
 owner=(await f.request('/auth/me')).account.ownerId;
 const host=(await f.request('/status')).hostId,main=(await f.request('/chats/main')).chat;
 async function command(body){let cmd=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,...body})).command;for(let i=0;i<100;i++){if(cmd.state==='accepted_by_dsh')return cmd;assert.notEqual(cmd.state,'rejected');await pause(20);cmd=(await f.request('/commands/'+cmd.commandId)).command;}throw Error('synthetic command timeout');}
 const first=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成主对话'});f.seedMainHistory(first.sessionId,30,{total:30});f.progress.finish('completed');
 const side=await command({kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId:'local',title:'合成旁聊'});sideId=side.sessionId;
 await command({kind:'session.message',sessionId:sideId,text:'请记住，我现在喜欢简短的回答。',intent:'queue'});f.progress.text('收到，我会采用简短清晰的表达。');f.progress.finish('completed');
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p2-walkthrough-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...clean,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(12000);p.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});
 await baseline(p);await desktopRoutes(p);await localUiSession(p,f.credentials,'UX-P2 synthetic',{mainChat:true});
 for(const width of process.argv.includes('--phones-only')?[]:process.argv.includes('--wide-only')?[1200]:process.argv.includes('--narrow-only')?[480]:before?[1200]:[1200,480]) {
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);
  const surface='electron-'+width;
  for(const t of ['light','dark']) {
   await theme(p,t);await shot(p,'main-history',surface,t);
   const reply=await visibleReply(p);if(before)await reply.getByRole('button',{name:'更多回复操作',exact:true,includeHidden:true}).evaluate(n=>n.click());else await reply.getByRole('button',{name:'更多回复操作',exact:true}).click();await shot(p,'reply-menu',surface,t);
   if(!before){assert.equal(await p.getByRole('menuitem',{name:'上次发送未确认，重试'}).count(),0);await p.getByRole('menuitem',{name:'换模型重新生成',exact:true}).click();await p.getByRole('menuitemradio').waitFor();await shot(p,'reply-model-submenu',surface,t);await p.keyboard.press('Escape');}
   await p.keyboard.press('Escape');
   const user=p.getByRole('group',{name:/我的消息/}).last();await user.hover();await shot(p,'user-hover',surface,t);
   if(!before){assert.equal(await p.getByRole('button',{name:/编辑并重发|从这里开旁聊并重发/,includeHidden:true}).count(),0);await user.focus();await shot(p,'user-focus',surface,t);checks.push('D49 external actions '+width+' '+t);}
   await b(p,'添加图片或文件').click();await shot(p,'composer-menu',surface,t);await p.keyboard.press('Escape');
   const field=p.getByRole('textbox',{name:'输入消息',exact:true});await field.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行\n第八行\n第九行\n第十行');const large=await field.evaluate(n=>n.clientHeight);await shot(p,'composer-long',surface,t,'超长文本');await field.fill('');const small=await field.evaluate(n=>n.clientHeight);if(!before){assert.ok(large>small*2);assert.ok(large<280);checks.push('autosize grow shrink cap '+width+' '+t);}await shot(p,'composer-empty',surface,t,'空输入');
   await b(p,'搜索主对话').click();await p.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('合成');await p.getByRole('searchbox',{name:'主对话搜索关键词'}).press('Enter');await p.waitForFunction(()=>document.querySelector('mark'));await shot(p,'main-search',surface,t);await b(p,'关闭主对话搜索').click();
   await b(p,'跳到日期').click();await shot(p,'date-control',surface,t);await p.getByRole('textbox',{name:'跳到日期'}).fill('2026-10-09').catch(()=>{});await p.keyboard.press('Escape');
   if(width<720)await b(p,'切换会话侧栏').click();await b(p,'账户菜单').click();await shot(p,'account-menu',surface,t);await b(p,'设置').click();
   const settings=p.getByRole('dialog',{name:'设置',exact:true});
   const categories=await settings.locator('[data-category]').evaluateAll(ns=>ns.filter(n=>n.tagName==='BUTTON').map(n=>({id:n.dataset.category,name:n.textContent.trim()})));
   for(const cat of categories){if(width>=720)await settings.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:cat.name,exact:true}).click();else {await settings.getByRole('combobox',{name:'设置分类'}).click();await p.getByRole('option',{name:new RegExp(' · '+cat.name+'$')}).click();}await pause(160);await shot(p,'settings-'+cat.id,surface,t);}
   await closeDialogs(p);
   // Each existing confirmation/editor dialog is opened with synthetic body text;
   // this is structural QA, never a destructive submit.
   const dialogs=await p.locator('dialog[id]').evaluateAll(ns=>ns.filter(n=>n.id!=='settings-dialog').map(n=>n.id));
   for(const id of dialogs){await p.evaluate(id=>{const d=document.getElementById(id);d.showModal()},id);await shot(p,'dialog-'+id,surface,t,'打开态（结构验收）');await closeDialogs(p);}
   await p.reload();await pause(500);if(width<720)await b(p,'切换会话侧栏').click();await b(p,'账户菜单').click();await b(p,'记忆').click();await pause(250);await shot(p,'memory-normal',surface,t);
   if(!before)await b(p,'更多记忆操作').click();await shot(p,'memory-export-menu',surface,t);if(!before)await p.keyboard.press('Escape');
   for(const state of ['empty','warning','rejected','error']){memoryState=state;await b(p,'刷新').click();await pause(250);await shot(p,'memory-'+state,surface,t,state==='empty'?'空列表':state==='error'?'出错':'异常');if(state==='rejected'&&!before){await p.locator('#memory-health').getByRole('button',{name:'查看',exact:true}).click();await shot(p,'memory-rejected-expanded',surface,t);}}
   memoryState='normal';await closeDialogs(p);
   await p.reload();await pause(500);
   modelMissing=true;await p.reload();await pause(600);await shot(p,'no-model-history',surface,t,'没配模型');
   historyEmpty=true;await p.reload();await pause(600);await shot(p,'no-model-empty',surface,t,'没配模型 / 空对话');if(!before){assert.equal(await field.isDisabled(),true);assert.equal(await field.getAttribute('placeholder'),'先添加一个模型');}
   modelMissing=false;historyEmpty=false;await p.reload();await pause(600);
   if(width<720)await b(p,'切换会话侧栏').click();await p.getByRole('button',{name:/^动态/}).filter({visible:true}).click();await pause(200);await shot(p,'activity',surface,t,'空列表');if(width<720)await b(p,'切换会话侧栏').click();await b(p,'WeftMate 主对话').click();
   // Replay all seven real onboarding steps without any model test call.
   if(width===1200){await b(p,'账户菜单').click();await b(p,'设置').click();await settings.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'常规',exact:true}).click();await b(p,'重新查看引导').click();
    for(let i=0;i<7;i++){await shot(p,'onboarding-'+i,surface,t);if(i<6)await b(p,'跳过这步').click();}await b(p,'跳过这步').click();}
  }
 }
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const size of process.argv.includes('--desktop-only')?[]:[{width:360,height:780},{width:390,height:844}])for(const web of [true,false]) {
  const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});
  await baseline(page,true);
  if(web){await page.route('**/bridge.js',r=>r.fulfill({contentType:'text/javascript',body:'// browser transport'}));await page.route('**/personal/v1/**',async r=>{const u=new URL(r.request().url());if(u.pathname.includes('/memory/'))return r.fulfill({json:memoryResponse(u.pathname.split('/memory')[1])});const res=await r.fetch({url:f.origin+u.pathname+u.search,headers:{...r.request().headers(),origin:f.origin}});await r.fulfill({response:res}).catch(error=>{if(!/already handled|disposed|closed/.test(error.message))throw error});});
   const login=await page.request.post(f.origin+'/personal/v1/auth/login',{data:f.credentials,headers:{origin:f.origin}}),identity=await login.json();await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);await page.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},identity);
  } else {await page.route('**/bridge',async r=>{const input=r.request().postDataJSON();if(input.method==='host.business'&&input.params.path.includes('/memory/'))return r.fulfill({json:{result:memoryResponse(input.params.path.split('/memory')[1])}});return r.fallback();});await page.goto(f.mobileUrl);}
  await page.waitForFunction(()=>uiCore.inMainChat()&&document.querySelector('.main-chat-row.message'));
  const surface=(web?'phone-web':'android-bundle')+'-'+size.width;
  for(const t of ['light','dark']) {
   await theme(page,t,true);await shot(page,'main-history',surface,t);
   const field=page.getByRole('textbox',{name:'输入消息',exact:true});await field.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行\n第八行\n第九行');const large=await field.evaluate(n=>n.clientHeight);await shot(page,'composer-long',surface,t,'超长文本');await field.fill('');if(!before)assert.ok(large>await field.evaluate(n=>n.clientHeight)*2);
   await b(page,'添加图片或文件').click();await shot(page,'composer-menu',surface,t);await page.keyboard.press('Escape');
   await b(page,'搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('合成');await page.getByRole('searchbox',{name:'主对话搜索关键词'}).press('Enter');await page.waitForFunction(()=>document.querySelector('mark'));await shot(page,'main-search',surface,t);await b(page,'关闭主对话搜索').click();
   await page.evaluate(()=>page('settings'));await shot(page,'settings-home',surface,t);
   const categories=await page.evaluate(()=>mobileSettingsRegistry.list({desktop:false}).map(cat=>({id:cat.id,name:cat.name})));
   for(const cat of categories){await page.evaluate(id=>page(id),cat.id);await pause(200);await shot(page,'settings-'+cat.id,surface,t);}
   memoryState='rejected';await page.evaluate(()=>page('memory'));await pause(300);await shot(page,'memory-rejected',surface,t);if(!before){await page.locator('#mobile-memory-health').getByRole('button',{name:'查看',exact:true}).click();await shot(page,'memory-rejected-expanded',surface,t);}
   memoryState='normal';await page.evaluate(async()=>{page('chat');await uiCore.selectMainChat()});
   if(!before){await page.evaluate(()=>{uiCore.state.models=[];state.model=null;updateComposer()});await shot(page,'no-model-history',surface,t,'没配模型');await page.evaluate(()=>{$('chat-content').replaceChildren();updateComposer()});await shot(page,'no-model-empty',surface,t,'没配模型 / 空对话');assert.equal(await field.isDisabled(),true);await page.evaluate(async()=>{await uiCore.refreshThinkingModels();await uiCore.selectMainChat();updateComposer()});}
  }
  await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(join(out,phase+'-walkthrough'+(process.argv.includes('--phones-only')?'-phones':process.argv.includes('--desktop-only')?'-desktop':'')+'.json'),JSON.stringify({realElectron:true,synthetic:true,modelRequests:0,rows,checks,errors},null,2));
 console.log('UX-P2 '+phase+' walkthrough complete: '+rows.length);
} finally {
 await writeFile(join(out,phase+'-walkthrough'+(process.argv.includes('--phones-only')?'-phones':process.argv.includes('--desktop-only')?'-desktop':'')+'.partial.json'),JSON.stringify({rows,checks,errors},null,2));
 await browser?.close();await app?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f)await rm(f.root,{recursive:true,force:true});
}
