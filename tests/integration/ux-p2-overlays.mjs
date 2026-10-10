// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Open-state inventory, goals, temporary/project and phone auth surfaces. */
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p2');await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const rows=[],errors=[];let app,browser,f,profile;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const b=(p,name)=>p.getByRole('button',{name,exact:true}).filter({visible:true});
const slug=s=>s.replace(/[^\p{L}\p{N}]+/gu,'-');
async function shot(p,s,t,scene,state='打开态'){
 await p.evaluate(t=>document.documentElement.dataset.theme=t,t);await wait(100);const screenshot=`after-${s}-${t}-${scene}.png`;await p.screenshot({path:join(out,screenshot)});
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);rows.push({surface:s,theme:t,scene,state,screenshot,defects:overflow?['横向溢出']:[],checklist:Array(8).fill(!overflow)});console.log(screenshot);
}
async function selects(p,container,s,t,prefix){
 const names=await container.getByRole('combobox').filter({visible:true}).evaluateAll(ns=>ns.filter(n=>!n.disabled).map(n=>n.getAttribute('aria-label')));
 for(const name of [...new Set(names)]){if(!name)continue;const control=container.getByRole('combobox',{name,exact:true}).filter({visible:true}).first();await control.click();await shot(p,s,t,prefix+'-select-'+slug(name));await p.keyboard.press('Escape');if(container.getByRole&&!(await p.getByRole('dialog',{name:'设置',exact:true}).isVisible().catch(()=>false))&&prefix.startsWith('settings-')){await b(p,'账户菜单').click();await b(p,'设置').click();}}
}
try{
 f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,composerMenu:true,interactive:true,inlineProgress:true,historyCount:0,schedules:true});f.progress.finish('completed');
 await mkdir(join(f.root,'project'));const project=(await f.request('/projects',{requestId:randomUUID(),name:'合成资料项目',rootPath:join(f.root,'project'),permission:'read-only'})).project;
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p2-overlays-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.route('**/personal/v1/status',async r=>{const response=await r.fetch(),data=await response.json();await r.fulfill({json:{...data,personalCapabilities:{...data.personalCapabilities,goals:1,scheduleEditing:1,taskOverview:1}}})});await localUiSession(p,f.credentials,'UX-P2 overlays',{mainChat:true});
 await p.route('**/personal/v1/tasks',r=>r.fulfill({json:{items:[],recent:[],timeZone:'Asia/Shanghai'}}));
 await p.route('**/personal/v1/goals',r=>r.fulfill({json:{items:[]}}));
 for(const t of ['light','dark']){
  await b(p,'账户菜单').click();await b(p,'设置').click();const settings=p.getByRole('dialog',{name:'设置',exact:true}),nav=settings.getByRole('navigation',{name:'设置分类'});
  for(const name of ['常规','个性化','助手','外观','审批','模型','关于']){await nav.getByRole('button',{name,exact:true}).click();await wait(160);await selects(p,settings,'electron-1200',t,'settings-'+slug(name));}
  await nav.getByRole('button',{name:'模型',exact:true}).click();await b(p,'添加模型').click();await shot(p,'electron-1200',t,'model-editor');await selects(p,p.getByRole('dialog',{name:'添加模型',exact:true}),'electron-1200',t,'model-editor');await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  await b(p,'目标').click();await wait(250);await shot(p,'electron-1200',t,'goals-empty','空列表');
  for(const [name,scene]of [['新建定时任务','goal-schedule-form'],['新建长期目标','goal-long-form']]){await b(p,name).click();await shot(p,'electron-1200',t,scene);await selects(p,p.getByRole('form',{name,exact:true}),'electron-1200',t,scene);await b(p,'取消').click();}
  await b(p,'WeftMate 主对话').click();await b(p,'选择新对话类型').click();await shot(p,'electron-1200',t,'new-chat-menu');await p.getByRole('menuitem',{name:'临时对话',exact:true}).click();await shot(p,'electron-1200',t,'temporary-empty','空对话');
  await p.getByRole('button',{name:'项目设置 合成资料项目',exact:true}).click();await shot(p,'electron-1200',t,'project-edit-dialog');await b(p,'移除项目').click();await shot(p,'electron-1200',t,'project-remove-dialog');await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  await b(p,'在项目 合成资料项目 新建对话').click();await shot(p,'electron-1200',t,'project-conversation-empty','空对话');
 }
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const size of [{width:360,height:780},{width:390,height:844}]){
  const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.route('**/bridge.js',r=>r.fulfill({contentType:'text/javascript',body:'// unauthenticated browser transport'}));
  await page.route('**/personal/v1/**',async r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/tasks'))return r.fulfill({json:{items:[],recent:[],timeZone:'Asia/Shanghai'}});if(u.pathname.endsWith('/goals'))return r.fulfill({json:{items:[]}});if(u.pathname.endsWith('/status')){const value=await f.request('/status');return r.fulfill({json:{...value,personalCapabilities:{...value.personalCapabilities,goals:1,scheduleEditing:1,taskOverview:1}}});}const res=await r.fetch({url:f.origin+u.pathname+u.search,headers:{...r.request().headers(),origin:f.origin}});await r.fulfill({response:res}).catch(()=>{});});
  await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);
  for(const t of ['light','dark']){await page.evaluate(t=>applyTheme(t),t);await shot(page,'phone-web-'+size.width,t,'login','未登录');}
  const login=await page.request.post(f.origin+'/personal/v1/auth/login',{data:f.credentials,headers:{origin:f.origin}}),identity=await login.json();
  await page.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();},identity);
  for(const t of ['light','dark']){await page.evaluate(()=>page('goals'));await wait(250);await shot(page,'phone-web-'+size.width,t,'goals-empty','空列表');for(const [name,scene]of [['新建定时任务','goal-schedule-form'],['新建长期目标','goal-long-form']]){await b(page,name).click();await shot(page,'phone-web-'+size.width,t,scene);await selects(page,page.getByRole('form',{name,exact:true}),'phone-web-'+size.width,t,scene);await b(page,'取消').click();}}
  await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(join(out,'overlays-checks.json'),JSON.stringify({rows,errors,synthetic:true,modelRequests:0},null,2));
}finally{await writeFile(join(out,'overlays.partial.json'),JSON.stringify({rows,errors},null,2));await browser?.close();await app?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f)await rm(f.root,{recursive:true,force:true});}
