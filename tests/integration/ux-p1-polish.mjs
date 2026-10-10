/** UX-P1: production Electron shell and phone assets, isolated synthetic API. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'), out=join(root,'tests/evidence/ux-p1');
const phase=process.argv.includes('--before')?'before':'after';
await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let f,app,browser,profile;const errors=[],checks=[];
const b=(p,name)=>p.getByRole('button',{name,exact:true}).filter({visible:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
 f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,composerMenu:true,interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-15000});
 const host=(await f.request('/status')).hostId, main=(await f.request('/chats/main')).chat;
 async function command(body){let row=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,...body})).command;for(let n=0;n<100;n++){if(row.state==='accepted_by_dsh')return row;assert.notEqual(row.state,'rejected',JSON.stringify(row));await wait(20);row=(await f.request(`/commands/${row.commandId}`)).command;}throw Error('command timeout');}
 const first=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成主对话'});
 f.seedMainHistory(first.sessionId,3200,{total:3200});f.progress.finish('completed');
 const side=await command({kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId:'local',title:'合成旁聊'});
 await f.request(`/sessions/${side.sessionId}/metadata`,{title:'合成旁聊',memoryMode:'off',autoDeleteDays:30},'PATCH');
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p1-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 await localUiSession(p,f.credentials,'UX-P1 synthetic',{mainChat:true});
 await p.waitForFunction(()=>document.querySelector('#transcript .message'));
 async function shot(page,ids,suffix='desktop-light'){if(!suffix.includes('hover'))await page.mouse.move(0,0);await wait(180);for(const id of ids)await page.screenshot({path:join(out,`${phase}-${String(id).padStart(2,'0')}-${suffix}.png`)});}
 await shot(p,[1,2,3,4]);
 if(phase==='after'){await p.getByRole('button',{name:'加载更早内容',exact:true}).evaluate(n=>n.scrollIntoView({block:'start'}));await shot(p,[3],'desktop-earlier');await b(p,'回到底部').click().catch(()=>p.evaluate(()=>document.querySelector('#chat-scroll').scrollTop=document.querySelector('#chat-scroll').scrollHeight));}
 if(phase==='after'){
  const name=await p.evaluate(()=>{const viewport=document.querySelector('#chat-scroll').getBoundingClientRect();return [...document.querySelectorAll('.message.assistant[aria-label]')].find(row=>{const box=row.getBoundingClientRect();return box.top>=viewport.top&&box.bottom<viewport.bottom-50&&!row.classList.contains('is-last-assistant')}).getAttribute('aria-label')});const firstMessage=p.getByRole('group',{name,exact:true});await p.mouse.move(0,0);
  assert.equal(await firstMessage.getByRole('group',{name:'回复操作',includeHidden:true}).evaluate(n=>getComputedStyle(n).visibility),'hidden');
  await firstMessage.hover();await firstMessage.getByRole('group',{name:'回复操作'}).waitFor();await shot(p,[1],'desktop-hover');
  await p.mouse.move(0,0);await firstMessage.focus();await firstMessage.getByRole('group',{name:'回复操作'}).waitFor();await shot(p,[1],'desktop-keyboard');await p.getByRole('textbox',{name:'输入消息',exact:true}).focus();checks.push('message-hover-focus-last-reply');
  await b(p,'选择新对话类型').click();await p.getByRole('menuitem',{name:'临时对话'}).waitFor();await shot(p,[4],'desktop-dropdown');await p.keyboard.press('Escape');
 }
 await b(p,'添加图片或文件').click();await shot(p,[2],'desktop-menu');await p.keyboard.press('Escape');
 await p.getByRole('button',{name:/更多操作 合成旁聊/}).click();await shot(p,[5]);
 if(phase==='after'){await p.getByRole('menuitemcheckbox',{name:'此对话不形成记忆'}).waitFor();assert.equal(await p.getByRole('menuitemcheckbox',{name:'此对话不形成记忆'}).getAttribute('aria-checked'),'true');await p.getByRole('menuitem',{name:/自动删除：/}).click();await p.getByRole('menuitemradio',{name:'30 天后自动删除'}).waitFor();await shot(p,[5],'desktop-submenu');checks.push('checked-memory-and-retention-submenu');}
 await p.keyboard.press('Escape');await p.keyboard.press('Escape');
 // Synthetic memory responses exercise UI without a model, real memory service or user data.
 const owner=(await f.request('/auth/me')).account.ownerId;
 let job=null, unhealthy=false;
 await p.route('**/personal/v1/memory/**',async route=>{
  const url=new URL(route.request().url()), path=url.pathname.split('/memory')[1];let data;
  if(path==='/status')data={state:unhealthy?'degraded':'ready',worldRevision:1,formedMemoryCount:4,pendingBoundaryCount:unhealthy?8:0,reasonCode:unhealthy?'MEMORY_MODEL_UNAVAILABLE':null,capabilities:{list:true,source:true},backfill:job};
  else if(path==='/backfill'){if(route.request().method()==='POST'){const body=route.request().postDataJSON();job={id:'synthetic-job',state:body.action==='pause'?'paused':body.action==='cancel'?'cancelled':'running',submittedTurns:2,skippedTurns:0,totalTurns:6};}data={previewId:'synthetic-preview',sessionCount:3,turnCount:6,estimatedUsage:{inputTokens:4200,outputTokens:600},...job};}
  else if(path.includes('/sources'))data={worldRevision:1,sources:[{sessionId:side.sessionId,currentnessState:'current',summary:'合成来源对话',contentAvailable:true,rawContent:'喜欢清晰简短的回答'}]};
  else if(path==='/items'){const kind=url.searchParams.get('kind');data={worldRevision:1,totalCount:4,searchScope:'account_snapshot',items:['entity','relationship','cognition','event'].map((k,i)=>({kind:k,id:'synthetic-'+k,text:['小林是我的同事','小林和我一起做项目','我喜欢清晰简短的回答','下周一讨论纸船计划'][i],currentState:'current',updatedAt:'2026-10-10T01:00:00Z',sourceSessionId:side.sessionId})).filter(item=>!kind||kind==='all'||item.kind===kind),hasMore:false,nextCursor:null};}
  else data={worldRevision:1,item:{id:'synthetic-cognition',kind:'cognition',text:'合成理解',currentState:'current'}};
  await route.fulfill({json:{ownerId:owner,...data}});
 });
 await b(p,'账户菜单').click().catch(()=>p.locator('#account-menu-trigger').click());await b(p,'记忆').click();await p.waitForFunction(()=>document.querySelector('#memory-list').children.length);
 await shot(p,[6,7]);if(phase==='after'){await p.evaluate(()=>document.documentElement.dataset.theme='dark');await shot(p,[6,7],'desktop-dark');await p.evaluate(()=>document.documentElement.dataset.theme='light')};await b(p,'整理过去的对话').click();await b(p,'确认开始整理').waitFor();await shot(p,[8]);
 if(phase==='after'){assert.equal(await p.getByRole('button',{name:'全部',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await p.getByRole('list',{name:'记忆列表'}).locator('li').count(),4);checks.push('default-all-four-types');}
 if(phase==='after'){await b(p,'取消').click();await b(p,'整理过去的对话').click();await b(p,'确认开始整理').click();await b(p,'暂停整理').waitFor();await shot(p,[8],'desktop-progress');await b(p,'暂停整理').click();await b(p,'继续整理').waitFor();await b(p,'取消整理').click();checks.push('backfill-preview-cancel-start-pause-cancel');}
 unhealthy=true;await b(p,'刷新').click();await wait(300);await shot(p,[7],'desktop-warning');
 await b(p,'关闭设置').click();await p.locator('#account-menu-trigger').click();await b(p,'设置').click();await shot(p,[9]);
 // Replay uses persistent journey endpoint; replace only its server state in this isolated scene.
 let step='welcome',completed=false;await p.route('**/personal/v1/onboarding',async route=>{if(route.request().method()==='PATCH'){step=route.request().postDataJSON().step;completed=!!route.request().postDataJSON().completed;}await route.fulfill({json:{onboarding:{step,started:true,completed}}});});
 await b(p,'常规').click();await b(p,'重新查看引导').click();await b(p,'继续').click();await b(p,'继续').click();await shot(p,[10,12]);
 if(phase==='after'){
  assert.equal(await b(p,'继续').isDisabled(),true);assert.equal(await b(p,'保存并使用这个模型').count(),0);
  await p.getByRole('textbox',{name:'补充服务地址（可选）'}).evaluate(n=>n.scrollIntoView({block:'end'}));await shot(p,[10],'desktop-scrolled');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));await shot(p,[10],'desktop-480');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  let saves=0;await p.route('**/personal/v1/account/models/check',r=>r.fulfill({json:{modelListed:true,address:'reachable',authentication:'accepted',catalog:'available',model:'listed'}}));
  await p.route('**/personal/v1/account/models',async r=>{if(r.request().method()==='POST'){saves++;await r.fulfill({json:{operation:{status:'succeeded'},model:{profileId:'local'}}})}else await r.continue()});
  await p.route('**/personal/v1/account/models/by-request/*',r=>r.fulfill({json:{operation:{status:'succeeded'},model:{profileId:'local'}}}));
  await b(p,'测试连接').click();await p.waitForFunction(()=>!document.querySelector('.onboarding-footer button:last-child').disabled);await b(p,'继续').click();await p.getByRole('heading',{name:'越聊，越了解你',exact:true}).waitFor();assert.equal(saves,1);checks.push('tested-continue-saves-once-and-advances');
 }
 if(phase==='before')await b(p,'跳过这步').click();await b(p,'跳过这步').click();await b(p,'跳过这步').click();await b(p,'跳过这步').click();await shot(p,[11]);
 await app.evaluate(({nativeTheme})=>nativeTheme.themeSource='dark');await p.evaluate(()=>{document.documentElement.dataset.theme='dark'});await shot(p,[10,11,12],'desktop-dark');
 await b(p,'开始聊天').click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));await shot(p,[1,3,4,12],'desktop-480-dark');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
 await b(p,'搜索主对话').click();await p.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('纸船');await p.getByRole('searchbox',{name:'主对话搜索关键词'}).press('Enter');await p.waitForFunction(()=>document.querySelector('mark'));await shot(p,[15],'desktop-dark');
 browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const size of [{width:390,height:844},{width:360,height:780}])for(const web of [true,false]){
  const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  if(web){await page.route('**/bridge.js',r=>r.fulfill({contentType:'text/javascript',body:'// browser transport'}));await page.route('**/personal/v1/**',async r=>{const u=new URL(r.request().url()),response=await r.fetch({url:f.origin+u.pathname+u.search,headers:{...r.request().headers(),origin:f.origin}});await r.fulfill({response});});
   const login=await page.request.post(f.origin+'/personal/v1/auth/login',{data:f.credentials,headers:{origin:f.origin}}),identity=await login.json();await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);await page.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},identity);
  }else await page.goto(f.mobileUrl);
  await page.waitForFunction(()=>uiCore.inMainChat()&&document.querySelector('.main-chat-row.message'));
  const suffix=`${web?'web':'android-chromium'}-${size.width}`;
  for(const theme of ['light','dark']){await page.evaluate(t=>applyTheme(t),theme);await shot(page,[13],suffix+'-'+theme);
   await page.evaluate(()=>{$('chat-status').textContent='请先绑定云账户并批准这台设备。'});await shot(page,[16],suffix+'-'+theme);await page.evaluate(()=>{$('chat-status').textContent=''});
   await b(page,'搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('纸船');await page.getByRole('searchbox',{name:'主对话搜索关键词'}).press('Enter');await page.waitForFunction(()=>document.querySelector('mark'));await shot(page,[14,15],suffix+'-'+theme);await b(page,'下一条搜索结果').click();await b(page,'上一条搜索结果').click();
   if(phase==='after'){const geometry=await page.getByRole('form',{name:'主对话内搜索'}).evaluate(form=>{const nodes=[...form.children].filter(n=>getComputedStyle(n).position!=='absolute'&&!n.hidden);return nodes.map(n=>n.getBoundingClientRect().top)});assert.ok(Math.max(...geometry)-Math.min(...geometry)<20);checks.push('single-row-'+suffix+'-'+theme);}
   await b(page,'关闭主对话搜索').click();}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();checks.push(suffix);
 }
 assert.deepEqual(errors,[]);await writeFile(join(out,phase+'-checks.json'),JSON.stringify({realElectron:true,synthetic:true,modelRequests:0,checks,errors},null,2));console.log('UX-P1 '+phase+' passed');
} finally {await browser?.close();await app?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f)await rm(f.root,{recursive:true,force:true});}
