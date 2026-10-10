/** MOB-P1: isolated real host, synthetic content, shipped phone assets and Electron. */
import assert from 'node:assert/strict';
import {chromium, _electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const before=process.argv.includes('--before'),out=resolve('tests/evidence/mob-p1',before?'before':'after');
await mkdir(out,{recursive:true});
const baseline=new Map();if(before)for(const dir of ['apps/mobile-ui/www','src/personal-access-ui'])for(const name of readdirSync(dir,{recursive:true})){if(/\.(js|css|html)$/.test(name))baseline.set(resolve(dir,name),readFileSync(resolve(dir,name)));}
if(before)for(const name of execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n')){if(baseline.has(resolve(name)))baseline.set(resolve(name),execFileSync('git',['show',`HEAD:${name}`]));}
const f=await startTimelineCandidate({historyCount:0,interactive:true,composer:true,inlineProgress:true,sidebar:true,goals:true});f.progress.text('报告已完成，测试通过。');f.progress.finish();
const owner=(await f.request('/auth/me')).account.ownerId;
function memoryResponse(path){return path.includes('/status')?{ownerId:owner,state:'ready',worldRevision:1,formedMemoryCount:0,pendingBoundaryCount:0,pendingFormationCount:0,capabilities:{list:true,source:true}}:{ownerId:owner,items:[],worldRevision:1,searchScope:'account_snapshot',totalCount:0,hasMore:false,nextCursor:null};}
const browser=await chromium.launch({headless:true}),report={synthetic:true,modelRequests:0,systemBars:false,checks:[],screenshots:[],errors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));let app,profile;
const exposeCore=body=>body.replace('const ui = globalThis.WeftUiComponents.createContext();','const ui = globalThis.WeftUiComponents.createContext();globalThis.__mobui=ui;').replace('ui.loadAttachmentHasher =','globalThis.__mobcore=core;ui.loadAttachmentHasher =');
async function shot(p,prefix,scene){await wait(220);const name=`${prefix}-${scene}.png`;await p.screenshot({path:join(out,name)});report.screenshots.push(name);if(!before)assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name);}
async function capture(p,surface,width,theme){
 const mobile=surface==='android-bundle',prefix=`${surface}-${width}-${theme}`;console.log('Capture',prefix);
 await p.evaluate(mobile=>{const core=mobile?uiCore:globalThis.__mobcore;core.state.hostName='合成执行电脑';},mobile);
 if(!mobile)await p.evaluate(()=>{document.querySelector('#settings-dialog')?.close();WeftPopover.closeMenu();});
 await p.evaluate(({mobile,theme})=>{document.documentElement.dataset.theme=theme;if(mobile)applyTheme(theme);},{mobile,theme});
 const content=mobile?'#chat-content':'#transcript';
 if(mobile)await p.evaluate(()=>{stopSharedPoll();clearInterval(state.sharedPollTimer);clearTimeout(state.sharedPollTimer);});
 // Preserve the actual node trees while demonstrating the empty branch.
 if(mobile)await p.evaluate(()=>{stopSharedPoll();state.sharedEvents=[];state.sharedError='';state.sharedLoading=false;state.sharedRunning=false;renderSharedConversation();});
 else await p.evaluate(()=>{document.querySelector('#transcript').replaceChildren();document.querySelector('#chat-intro').hidden=false;});
 await shot(p,prefix,'01-empty');
 if(!before){assert.equal(await p.getByText('今天想做什么？',{exact:true}).isVisible(),true);report.checks.push(prefix+' welcome');}
 const plus=p.locator(mobile?'#plus-button':'#attachment-add');
 if(await plus.count()){await plus.click();await shot(p,prefix,'02-plus-menu-open');await p.keyboard.press('Escape');await p.evaluate(selector=>{document.documentElement.dataset.inputModality='pointer';document.querySelector(selector).focus();},mobile?'#plus-button':'#attachment-add');await shot(p,prefix,'02-plus-return-focus');
  if(!before){assert.equal(await plus.evaluate(n=>getComputedStyle(n).outlineStyle),'none');await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');assert.equal(await plus.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');await shot(p,prefix,'02-plus-keyboard-focus');report.checks.push(prefix+' pointer/programmatic versus keyboard focus');}await p.evaluate(()=>{document.documentElement.dataset.inputModality='pointer';document.activeElement?.blur();});}
 if(mobile){await p.evaluate(()=>{state.sharedEvents=[{seq:0,type:'user.message',data:{text:'请检查合成报告。'}},{seq:1,type:'assistant.message',data:{text:'报告已完成，测试通过。'}}];renderSharedConversation();});}
 else await p.evaluate(()=>{const list=document.querySelector('#transcript');for(const [role,text]of [['user','请检查合成报告。'],['assistant','报告已完成，测试通过。']]){const row=document.createElement('li');row.className='message '+role;row.textContent=text;list.append(row);}document.querySelector('#chat-intro').hidden=true;});
 // Real shared timeline renderer with several consecutive completed groups.
 await p.evaluate(content=>{const list=document.querySelector(content);for(let n=0;n<3;n++){const row=document.createElement(content==='#transcript'?'li':'div');row.className='timeline-entry';row.dataset.timeline='steps-polish-'+n;const details=document.createElement('details');details.className='execution-block';const summary=document.createElement('summary');summary.className='inline-progress-summary';summary.textContent=['思考','读取了 3 个文件','已运行 2 个命令'][n];details.append(summary);list.insertBefore(row,list.lastElementChild);row.append(details);}},content);
 await p.evaluate(content=>{const list=document.querySelector(content);if(!list.querySelector('.execution-block'))throw Error('Missing process blocks');},content);await shot(p,prefix,'04-collapsed-blocks');
 if(!before){const gaps=await p.evaluate(content=>{const rows=[...document.querySelector(content).querySelectorAll('.timeline-entry:has(>.execution-block:not([open]))')];return rows.slice(1).map((n,i)=>n.getBoundingClientRect().top-rows[i].getBoundingClientRect().bottom);},content);assert.ok(gaps.every(n=>Math.abs(n-8)<=1),`${prefix} compact gaps ${gaps}`);report.checks.push(prefix+' collapsed gaps 8px');}
 if(!before){const gaps=await p.evaluate(content=>{const list=document.querySelector(content);if(content==='#transcript')list.classList.add('is-main-chat');const rows=[...list.querySelectorAll(':scope > .timeline-entry:has(>.execution-block:not([open]))')],wrappers=[];if(content==='#chat-content'){const transcript=document.createElement('ol');transcript.className='main-chat-transcript';rows[0].before(transcript);transcript.append(...rows);}for(const [index,row]of rows.entries()){const wrapper=document.createElement('li');wrapper.className='main-chat-row';row.before(wrapper);if(index===0){wrapper.className+=' message assistant thinking-only';const details=row.firstElementChild;details.className='model-thinking';wrapper.append(details);row.remove();}else{const nested=document.createElement('ol');nested.className='chat-progress';wrapper.append(nested);nested.append(row);}wrappers.push(wrapper);}return wrappers.slice(1).map((n,i)=>n.querySelector('details').getBoundingClientRect().top-wrappers[i].querySelector('details').getBoundingClientRect().bottom);},content);assert.ok(gaps.every(n=>Math.abs(n-8)<=1),`${prefix} main/thinking gaps ${gaps}`);await shot(p,prefix,'04-main-and-thinking-blocks');report.checks.push(prefix+' main virtual row and thinking gaps 8px');await p.evaluate(content=>document.querySelector(content).classList.remove('is-main-chat'),content);}
 await p.evaluate(({mobile,content})=>{const list=document.querySelector(content);for(let n=0;n<20;n++){const row=document.createElement(mobile?'article':'li');row.className='message assistant';row.textContent=`合成历史 ${n+1}：核对纸船计划。`;list.append(row);}globalThis.__mobScroll=mobile?ensureConversationScroll():globalThis.__mobui.conversationScroll;__mobScroll.latest();},{mobile,content});
 if(!before){for(const height of [250,450,300]){await p.evaluate(height=>{document.querySelector('#chat-scroll').style.maxHeight=height+'px';},height);await wait(200);assert.equal(await p.evaluate(()=>__mobScroll.pinned),true);}
  await p.evaluate(content=>{const row=document.createElement('p');row.textContent='新回复已经完成。';document.querySelector(content).append(row);__mobScroll.changed();},content);await wait(240);
  assert.ok(await p.evaluate(()=>{const b=document.querySelector('#chat-scroll');return b.scrollHeight-b.clientHeight-b.scrollTop<=2;}));report.checks.push(prefix+' keyboard/approval/stream layout follow');}
 else await p.evaluate(()=>{const b=document.querySelector('#chat-scroll');b.scrollTop=Math.max(0,b.scrollTop-200);__mobScroll.scrolled();});
 await shot(p,prefix,'03-completed-follow');
 if(!before){await p.locator('#chat-scroll').dispatchEvent('wheel',{deltaY:-200});await p.evaluate(()=>{document.querySelector('#chat-scroll').scrollTop-=200;__mobScroll.scrolled();});assert.equal(await p.evaluate(()=>__mobScroll.pinned),false);await p.evaluate(()=>__mobScroll.changed());await wait(200);await shot(p,prefix,'03-user-scrolled');assert.equal(await p.locator('#jump-latest').isVisible(),true);await p.locator('#jump-latest').click();assert.equal(await p.evaluate(()=>__mobScroll.pinned),true);report.checks.push(prefix+' user upward input holds until latest');}
 await p.evaluate(()=>{document.querySelector('#chat-scroll').style.maxHeight='';});
 if(mobile){await p.evaluate(()=>page('home'));await p.locator('#menu-button').click();await shot(p,prefix,'07-drawer');await p.evaluate(()=>{closeDrawer();page('chat');});
  if(!before){await p.locator('#conversation-more').click();await shot(p,prefix,'06-header-menu-open');assert.equal(await p.getByRole('menuitem',{name:'输出与来源',exact:true}).locator('svg').count(),1);await p.getByRole('menuitem',{name:'输出与来源',exact:true}).click();await p.locator('#resource-page:not([hidden])').waitFor();await shot(p,prefix,'06-output-open');await p.locator('#resource-back').click();await p.locator('#conversation-more').click();await p.getByRole('menuitem',{name:'本对话用量',exact:true}).click();await p.waitForFunction(()=>state.page==='usage');await shot(p,prefix,'06-usage-open');await p.evaluate(()=>page('chat'));report.checks.push(prefix+' header menu icons and both actions');}
  await p.evaluate(()=>page('memory'));await wait(400);await shot(p,prefix,'05-memory');
  if(!before){await p.getByRole('button',{name:'更多记忆操作',exact:true}).click();await shot(p,prefix,'05-memory-menu-open');await p.keyboard.press('Escape');}
  for(const name of ['activity','goals','library','settings','general','personalization','assistant','approvals','resources','models','usage','sync','appearance','updates','about','devices','notifications']){
   await p.evaluate(name=>page(name),name);await wait(200);await shot(p,prefix,'08-'+name);
  }
  await p.evaluate(()=>page('home'));await p.getByRole('button',{name:'打开导航',exact:true}).click();await p.locator('#mobile-search-entry').click();await shot(p,prefix,'08-search-open');await p.getByRole('button',{name:'关闭搜索',exact:true}).click();
  await p.evaluate(()=>{page('chat');stopSharedPoll();});
  await p.evaluate(()=>openTimelinePreview(conversationTaskContext(),async()=>({text:'# 合成文件预览\n\n检查布局、正文和文件大小。\n\n| 项目 | 状态 |\n| --- | --- |\n| 测试 | 通过 |'}),'合成报告.md'));await shot(p,prefix,'08-file-preview-open');await p.locator('#resource-back').click();
 }else {
  if(!before&&surface==='phone-web'){await p.getByRole('button',{name:'对话操作',exact:true}).click();await shot(p,prefix,'06-header-menu-open');await p.getByRole('menuitem',{name:'输出与来源',exact:true}).click();await p.getByRole('dialog',{name:'输出与来源',exact:true}).waitFor();await shot(p,prefix,'06-output-open');await p.getByRole('button',{name:'关闭列表',exact:true}).click();assert.equal(await p.getByRole('button',{name:'对话操作',exact:true}).evaluate(n=>n===document.activeElement),true);await p.getByRole('button',{name:'对话操作',exact:true}).click();await p.getByRole('menuitem',{name:'本对话用量',exact:true}).click();await p.getByRole('dialog',{name:'设置',exact:true}).waitFor();await shot(p,prefix,'06-usage-open');await p.evaluate(()=>document.querySelector('#settings-dialog').close());report.checks.push(prefix+' header menu icons and both actions');}
  await p.getByRole('button',{name:'切换会话侧栏',exact:true}).click().catch(()=>{});await shot(p,prefix,'07-drawer');
  await p.evaluate(()=>WeftSettingsNavigation.open('memory'));await wait(500);await shot(p,prefix,'05-memory');if(!before){await p.getByRole('button',{name:'更多记忆操作',exact:true}).click();await shot(p,prefix,'05-memory-menu-open');await p.keyboard.press('Escape');}
  if(surface==='phone-web')for(const name of ['general','personalization','assistant','approvals','resources','models','usage','appearance','devices','about']){await p.evaluate(name=>WeftSettingsNavigation.open(name),name);await wait(200);await shot(p,prefix,'08-'+name);}
  await p.evaluate(()=>document.querySelector('#settings-dialog')?.close());
  if(surface==='phone-web'){
   await p.evaluate(()=>Object.assign(__mobcore.state.personalCapabilities,{activity:1,taskOverview:1,library:1}));
   for(const [name,method]of [['activity','openActivity'],['goals','openGoals'],['library','openLibrary']]){await p.evaluate(method=>__mobui[method](),method);await shot(p,prefix,'08-'+name);if(!before)assert.equal(await p.getByRole('button',{name:'对话操作',exact:true}).isVisible(),false);}
   await p.evaluate(id=>__mobcore.selectSession(id),f.sessionId);
   await p.evaluate(()=>__mobui.openSearch());await shot(p,prefix,'08-search-open');await p.getByRole('button',{name:'关闭搜索',exact:true}).click();
   await p.evaluate(()=>{const preview=WeftDesktop.openPreview('合成报告.md',document.activeElement);preview.content.replaceChildren(WeftContent.create('# 合成文件预览\n\n检查布局、正文和文件大小。','markdown-body'));});await shot(p,prefix,'08-file-preview-open');await p.evaluate(()=>WeftDesktop.closePreview());
  }
 }
 await p.evaluate(()=>WeftContent.openGallery([{url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#6b806d"/><path d="M30 80h180l-90 70z" fill="#fff"/></svg>'),name:'合成纸船'}],0,document.activeElement));await shot(p,prefix,'08-gallery-open');await p.evaluate(()=>WeftContent.closeGallery(false));
}
try{
 for(const surface of ['phone-web','android-bundle'])for(const [width,height]of [[390,844],[360,780]])for(const theme of ['light','dark']){
  const p=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});p.setDefaultTimeout(8000);p.on('pageerror',e=>report.errors.push(e.message));
  if(surface!=='android-bundle')await p.route('**/personal/v1/ui/app.js',route=>{const file=resolve('src/personal-access-ui/app.js'),body=before?baseline.get(file).toString():readFileSync(file,'utf8');return route.fulfill({contentType:'text/javascript',body:exposeCore(body)});});
  if(before)await p.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;const file=resolve(surface==='android-bundle'?'apps/mobile-ui/www':'src/personal-access-ui',path.replace(/^\/personal\/v1\/ui\/?/,'').replace(/^\//,'')||'index.html');let body=baseline.get(file);if(body&&path!=='/'){if(path==='/personal/v1/ui/app.js')body=exposeCore(body.toString());return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}await route.fallback();});
  if(surface==='android-bundle'){
   await p.route('**/bridge',async route=>{const input=route.request().postDataJSON(),path=input.params?.path||'';if(input.method==='host.business'&&path.includes('/memory/'))return route.fulfill({json:{result:memoryResponse(path)}});if(input.method==='host.status'){const response=await route.fetch(),body=await response.json();body.result.hostName='合成执行电脑';return route.fulfill({json:body});}await route.fallback();});
   await p.goto(f.mobileUrl);await p.waitForFunction(()=>state.booted&&state.loggedIn);await p.evaluate(id=>{selectSharedSession(id);closeDrawer();},f.sessionId);await p.waitForFunction(()=>!state.sharedLoading&&state.sharedEvents.length>0);
  }else {await p.route('**/personal/v1/memory/**',route=>route.fulfill({json:memoryResponse(new URL(route.request().url()).pathname)}));await p.goto(f.origin+'/personal/v1/ui');await localUiSession(p,f.credentials);await p.route('**/personal/v1/status',async route=>{const response=await route.fetch(),body=await response.json();return route.fulfill({json:{...body,hostName:'合成执行电脑',personalCapabilities:{}}});});await p.locator('#message-text:not([disabled])').waitFor();}
  await capture(p,surface,width,theme);await p.close();
 }
 if(!before){profile=await mkdtemp(join(tmpdir(),'weftmate-mobp1-electron-'));const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});const p=await app.firstWindow();p.setDefaultTimeout(8000);await p.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:exposeCore(readFileSync(resolve('src/personal-access-ui/app.js'),'utf8'))}));await p.route('**/personal/v1/memory/**',route=>route.fulfill({json:memoryResponse(new URL(route.request().url()).pathname)}));await localUiSession(p,f.credentials);await p.locator('#message-text:not([disabled])').waitFor();
  for(const width of [1120,480])for(const theme of ['light','dark']){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await capture(p,'electron',width,theme);}
 }
 await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await browser.close();await f.close();if(profile)await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
