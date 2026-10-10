/** D50 / UX-P3: production Electron and touch bundles against synthetic isolated hosts. */
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p3');await mkdir(out,{recursive:true});
const before=process.argv.includes('--before'),prefix=before?'before':'after';
const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE')delete env[k];
const errors=[],checks=[],shots=[],scrollSurfaces=[];let f,app,browser,profile;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const b=(p,name)=>p.getByRole('button',{name,exact:true}).filter({visible:true});
async function shot(p,s,t,name){await wait(140);const file=`${prefix}-${s}-${t}-${name}.png`;await p.screenshot({path:join(out,file)});shots.push(file);scrollSurfaces.push({file,...await p.evaluate(()=>({selectorSupported:CSS.supports('selector(::-webkit-scrollbar)'),webkitSupported:CSS.supports('(-webkit-appearance:none)'),surfaces:[...document.querySelectorAll('#chat-scroll,#session-list,.settings-navigation,.settings-content,[role=menu],dialog,.timeline-preview,.library-surface,.goals-surface,.activity-surface,.model-options')].map(n=>({tag:n.tagName,id:n.id,class:String(n.className),width:getComputedStyle(n).scrollbarWidth,color:getComputedStyle(n).scrollbarColor,button:getComputedStyle(n,'::-webkit-scrollbar-button').display,buttonHeight:getComputedStyle(n,'::-webkit-scrollbar-button').height}))}))});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,file+' no horizontal overflow');console.log(file);}
async function oldAssets(p){if(!before)return;await p.route('**/personal/v1/ui/**',async r=>{const pathname=new URL(r.request().url()).pathname;let name=decodeURIComponent(pathname.split('/ui/')[1]||'index.html');if(!name||name==='index.html'||name.startsWith('ui-core/'))return r.fallback();if(name==='controls.css')return r.fulfill({body:'',contentType:'text/css'});try{const body=execFileSync('git',['show',`82c62fce183e068717369d5a4f6de55b91d74910:src/personal-access-ui/${name}`],{cwd:root});await r.fulfill({body,contentType:name.endsWith('.css')?'text/css':'text/javascript'});}catch{await r.fallback();}});}
try{
 f=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,inlineProgress:true,usageSamples:true,historyCount:0,baseTime:Date.now()-17*60000});
 const hoverTime=new Date(Date.now()-17*60000).toISOString(),oldActivity=new Date(Date.now()-3*3600000).toISOString();
 const owner=(await f.request('/auth/me')).account.ownerId;
 const projects=[],sessions=[];
 for(const [index,name]of [[1,'合成资料项目'],[2,'合成项目长名称用于验证收窄侧栏时图标位置与标题截断']]){
  const folder=join(f.root,`ux-p3-project-${index}`);await mkdir(folder);const {project}=await f.request('/projects',{requestId:randomUUID(),name,rootPath:folder});projects.push(project);
  for(let n=1;n<=4;n++){let {command}=await f.request(`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'local'});while(command.state!=='accepted_by_dsh'){assert.notEqual(command.state,'rejected');await wait(20);command=(await f.request(`/commands/${command.commandId}`)).command;}
   const title=n===4?`合成项目${index}长标题：整理项目说明与交付安排，核对所有设备的侧栏对齐和菜单行为`:`合成${index===1?'资料':'长名'}对话${n}`;
   await f.request(`/sessions/${command.sessionId}/metadata`,{title,...(n===2?{pinned:true}:{}),...(n===3?{unread:true}:{})},'PATCH');sessions.push({id:command.sessionId,title,project:project.projectId});
  }
 }
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p3-electron-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(12000);p.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message)});await oldAssets(p);
 await p.route('**/personal/v1/memory/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/status')?{ownerId:owner,state:'ready',worldRevision:1,capabilities:{list:true,source:true},formedMemoryCount:0}:{ownerId:owner,worldRevision:1,searchScope:'account_snapshot',items:[],totalCount:0,hasMore:false,nextCursor:null}}));
 await p.route('**/personal/v1/sessions?*',async r=>{const res=await r.fetch();const data=await res.json();for(const s of data.sessions||[]){if(sessions.some(row=>row.id===s.sessionId))s.updatedAt=oldActivity;if(s.sessionId===sessions[0].id){s.running=true;s.unread=true;s.updatedAt=hoverTime;}if(s.sessionId===sessions[2].id)s.unread=true;if(s.sessionId===sessions[3].id)s.updatedAt=hoverTime;}await r.fulfill({json:data});});
 await p.route('**/personal/v1/chats?*',async r=>{const res=await r.fetch();const data=await res.json();for(const c of data.items||[]){if(sessions.some(row=>row.id===c.activeSessionId))c.updatedAt=oldActivity;if(c.activeSessionId===sessions[0].id){c.running=true;c.unread=true;}if(c.activeSessionId===sessions[2].id)c.unread=true;if(c.activeSessionId===sessions[3].id)c.updatedAt=hoverTime;if(c.activeSessionId===sessions[4].id)c.memoryMode='off';}await r.fulfill({json:data});});
 await localUiSession(p,f.credentials,undefined,{mainChat:true});await b(p,sessions[3].title).click();
 for(const t of ['light','dark']){
  await p.evaluate(t=>document.documentElement.dataset.theme=t,t);await p.mouse.move(1000,700);await p.evaluate(()=>document.activeElement?.blur());await (before?p.getByRole('button',{name:new RegExp('^'+sessions[0].title)}).filter({visible:true}):b(p,sessions[0].title)).scrollIntoViewIfNeeded();
  await shot(p,'electron-1200',t,'sidebar-idle');
  if(!before)for(const [index,state] of [[0,'running'],[2,'unread'],[1,'pinned'],[4,'temporary']]){await b(p,sessions[index].title).scrollIntoViewIfNeeded();await p.mouse.move(1000,700);await p.evaluate(()=>document.activeElement?.blur());await shot(p,'electron-1200',t,'sidebar-'+state);const status=await b(p,sessions[index].title).evaluate(n=>({slots:n.parentElement.querySelectorAll('.session-status').length,labels:[...n.parentElement.querySelectorAll('.session-status [aria-label]')].map(s=>s.getAttribute('aria-label'))}));assert.equal(status.slots,1);assert.ok(status.labels.length<=1);if(state==='running'){assert.deepEqual(status.labels,['正在运行']);const circle=await b(p,sessions[index].title).evaluate(n=>{const s=n.parentElement.querySelector('.session-running-dot');return {width:getComputedStyle(s).width,height:getComputedStyle(s).height,flex:getComputedStyle(s).flexShrink}});assert.equal(circle.width,circle.height);assert.equal(circle.flex,'0');}if(state==='unread')assert.deepEqual(status.labels,['未读']);checks.push({state,theme:t,status});}
  const project=b(p,projects[0].name);await project.hover();await shot(p,'electron-1200',t,'project-hover-selected');
  if(!before){const geom=await project.evaluate(n=>{const h=n.parentElement.getBoundingClientRect(),c=n.closest('li').querySelector('.session-row:has(.is-current)').getBoundingClientRect();return {left:Math.abs(h.left-c.left),right:Math.abs(h.right-c.right),gap:c.top-h.bottom}});assert.ok(geom.left<1&&geom.right<1&&geom.gap>=2&&geom.gap<=4,JSON.stringify(geom));checks.push({theme:t,aligned:geom});}
  if(!before){await b(p,`项目菜单 ${projects[0].name}`).click();await shot(p,'electron-1200',t,'project-menu');await p.keyboard.press('Escape');}
  await project.focus();await p.mouse.move(1000,700);await shot(p,'electron-1200',t,'project-keyboard');
  await b(p,sessions[3].title).hover();await wait(650);if(!before)await p.getByRole('tooltip',{name:'对话详情'}).waitFor();await shot(p,'electron-1200',t,'chat-hover-card');
  await b(p,`置顶 ${sessions[3].title}`).hover();await shot(p,'electron-1200',t,'pin-tooltip');
  await b(p,`归档 ${sessions[3].title}`).hover();await shot(p,'electron-1200',t,'archive-tooltip');
  await b(p,sessions[1].title).hover();await shot(p,'electron-1200',t,'pinned-hover');
  await b(p,sessions[3].title).focus();await p.mouse.move(1000,700);await shot(p,'electron-1200',t,'chat-keyboard');
  await p.keyboard.press('Shift+F10');if(before){await b(p,sessions[3].title).click({button:'right'});}await p.getByRole('menu',{name:'对话操作'}).waitFor();await shot(p,'electron-1200',t,'chat-menu');await p.keyboard.press('Escape');
  await b(p,projects[1].name).hover();await shot(p,'electron-1200',t,'long-project');
  await b(p,projects[0].name).click();await p.mouse.move(1000,700);await p.evaluate(()=>document.activeElement?.blur());await shot(p,'electron-1200',t,'project-collapsed');await b(p,projects[0].name).click();
  await b(p,'账户菜单').click();await shot(p,'electron-1200',t,'account-menu');await b(p,'设置').click();await shot(p,'electron-1200',t,'settings-general');
  await p.getByRole('button',{name:'记忆',exact:true}).filter({visible:true}).click();await b(p,before?'刷新':'刷新记忆').waitFor();await shot(p,'electron-1200',t,'settings-memory');
  await b(p,'更多记忆操作').click();await shot(p,'electron-1200',t,'memory-menu');await p.keyboard.press('Escape');await b(p,'关闭设置').click();
  for(const name of ['动态','目标','成果库']){await b(p,name).click();await wait(200);await shot(p,'electron-1200',t,{'动态':'activity','目标':'goals','成果库':'library'}[name]);}
  await b(p,sessions[3].title).click();
  await p.evaluate(()=>{document.querySelector('#session-rail').style.width='210px';document.querySelector('#session-rail').style.minWidth='210px'});await b(p,projects[0].name).hover();await shot(p,'electron-1200',t,'narrow-sidebar');await p.evaluate(()=>{document.querySelector('#session-rail').style.width='';document.querySelector('#session-rail').style.minWidth=''});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,800));await b(p,'切换会话侧栏').click();await shot(p,'electron-480',t,'sidebar');if(!before){await b(p,sessions[3].title).hover();await p.getByRole('tooltip',{name:'对话详情'}).waitFor();await shot(p,'electron-480',t,'chat-hover-card');const path=await b(p,sessions[3].title).evaluate(n=>{const r=n.parentElement.getBoundingClientRect(),c=document.querySelector('.session-hover-card').getBoundingClientRect();return {clear:c.left>=r.right||c.right<=r.left,inside:c.left>=0&&c.right<=innerWidth}});assert.deepEqual(path,{clear:true,inside:true});const flipped=await b(p,sessions[3].title).evaluate(n=>{const card=document.querySelector('.session-hover-card'),edge=document.createElement('span');Object.assign(edge.style,{position:'fixed',right:'8px',top:'100px',width:'100px',height:'38px'});document.body.append(edge);WeftPopover.position(card,edge,{side:'right'});const result=card.dataset.popoverSide==='left'&&card.getBoundingClientRect().right<=edge.getBoundingClientRect().left;edge.remove();WeftPopover.position(card,n.parentElement,{side:'right'});return result});assert.equal(flipped,true);await p.mouse.move(460,60);}await b(p,'账户菜单').click();await b(p,'设置').click();await shot(p,'electron-480',t,'settings-general');await p.getByRole('combobox',{name:'设置分类'}).click();await p.getByRole('option',{name:/记忆/}).click();await shot(p,'electron-480',t,'settings-memory');await b(p,'关闭设置').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
 }
 if(!before){
  const scrolling=await p.evaluate(()=>[...document.querySelectorAll('*')].filter(n=>n.scrollHeight>n.clientHeight&&['auto','scroll'].includes(getComputedStyle(n).overflowY)).map(n=>({tag:n.tagName,class:n.className,width:getComputedStyle(n).scrollbarWidth,color:getComputedStyle(n).scrollbarColor,button:getComputedStyle(n,'::-webkit-scrollbar-button').display,buttonHeight:getComputedStyle(n,'::-webkit-scrollbar-button').height})));assert.ok(scrolling.every(s=>s.width==='auto'&&s.color==='auto'&&s.button==='none'));checks.push({scrolling});
 }
 browser=await chromium.launch({channel:'chrome',headless:true});
 if(!before)for(const surface of ['phone-web','android-bundle'])for(const size of [{width:390,height:844},{width:360,height:780}]){
  const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(surface==='phone-web'?f.origin+'/personal/v1/ui':f.mobileUrl);
  if(surface==='phone-web'){await localUiSession(page,f.credentials,undefined,{mainChat:true});await page.getByRole('button',{name:sessions[3].title,exact:true,includeHidden:true}).waitFor({state:'attached'});await wait(500);await b(page,'切换会话侧栏').click();}else{await page.waitForFunction(()=>state.booted&&state.loggedIn);await page.evaluate(()=>page('home'));await b(page,'打开导航').click();}
  const nav=surface==='android-bundle'?page.getByRole('navigation',{name:'主导航',exact:true}):page;
  for(const t of ['light','dark']){
   if(surface==='phone-web'&&await b(page,'切换会话侧栏').getAttribute('aria-expanded')!=='true')await b(page,'切换会话侧栏').click();
   await page.evaluate(({t,surface})=>{if(surface==='android-bundle')applyTheme(t);else document.documentElement.dataset.theme=t},{t,surface});
   await shot(page,surface+'-'+size.width,t,'drawer');const row=b(nav,sessions[3].title);await row.dispatchEvent('pointerdown',{pointerType:'touch'});await wait(550);await row.dispatchEvent('pointerup',{pointerType:'touch'});await shot(page,surface+'-'+size.width,t,'long-press-menu');assert.equal(await page.getByRole('tooltip',{name:'对话详情'}).count(),0);
   await page.keyboard.press('Escape');if(surface==='android-bundle'){await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());page('settings');closeDrawer()});await page.getByRole('navigation',{name:'设置分类',exact:true}).getByRole('button',{name:/^通知/}).click();await shot(page,surface+'-'+size.width,t,'notifications');await page.evaluate(()=>{page('home');openDrawer()});}else{await b(page,'账户菜单').click();await b(page,'设置').click();await shot(page,surface+'-'+size.width,t,'settings');await b(page,'关闭设置').click();}
  }await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(join(out,prefix+'-checks.json'),JSON.stringify({synthetic:true,realElectron:true,modelRequests:0,shots,checks,scrollSurfaces,errors},null,2));
}finally{await writeFile(join(out,prefix+'-partial.json'),JSON.stringify({shots,checks,scrollSurfaces,errors},null,2));await browser?.close();await app?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f)await rm(f.root,{recursive:true,force:true});}
