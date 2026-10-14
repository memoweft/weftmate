import { evidencePath } from '../helpers/evidence-path.mjs';
/** Shipped mobile assets and production Electron shell, synthetic data only. */
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import {chromium, _electron} from 'playwright';
import {createRequire} from 'node:module';
import {readFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {execFileSync} from 'node:child_process';
import {digestAuthFixture} from '../helpers/memory-digest-auth-fixture.mjs';

const baselineCommit=process.env.WEFTMATE_MOB2_BASELINE||'9d5dc5d69d97bd5f5aaa7096e55af648ed61db92';
const before=process.argv.includes('--before'), out=evidencePath('mob-2', before?'before':'after');
const desktopOnly=process.argv.includes('--desktop-only');
await mkdir(out,{recursive:true});
const authentication=await digestAuthFixture();
let remoteCookie;
const f=await startTimelineCandidate({daily:true,logicalMobile:true,sidebar:true,interactive:true,composer:true,goals:true,historyCount:0,cloudIdentity:authentication.cloudIdentity,authenticate:async input=>{const result=await authentication.authenticate(input);remoteCookie=result.cookie;return result;}}).catch(async error=>{await authentication.close();throw error;});
f.progress.text('已整理好周末的安排。');f.progress.finish();
const browser=await chromium.launch({headless:true});
const report={synthetic:true,assetRevision:before?baselineCommit:'working-tree',realModelRequests:0,systemBars:false,screenshots:[],checks:[],errors:[]};
const allowedOrigins=new Set([f.origin,new URL(f.mobileUrl).origin,new URL(authentication.cloudIdentity.issuer).origin]);
async function isolate(page){await page.route('**/*',route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&!allowedOrigins.has(url.origin)){report.errors.push('Unexpected network origin');return route.abort();}return route.fallback();});}
const settle=p=>p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function shot(p,prefix,name){await settle(p);await p.waitForTimeout(250);const file=`${prefix}-${name}.png`;await p.screenshot({path:join(out,file)});report.screenshots.push(file);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,file);}
let app,profile;
try {
  if(!desktopOnly)for(const [width,height] of [[360,780],[390,844]])for(const theme of ['light','dark']){
    const p=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});p.setDefaultTimeout(15000);p.on('pageerror',error=>report.errors.push(error.message));
    await isolate(p);
    if(before)await p.route(f.mobileUrl+'**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
      if(!/\.(css|js|html)$/.test(name)||name==='bridge.js')return route.fallback();
      try {let body=execFileSync('git',['show',`${baselineCommit}:apps/mobile-ui/www/${name}`]);if(name==='index.html')body=Buffer.from(body.toString().replace('<script defer src="app.js">','<script defer src="bridge.js"></script><script defer src="app.js">'));await route.fulfill({body,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html'});}catch{await route.fallback();}});
    await p.goto(f.mobileUrl);await p.waitForFunction(()=>state.booted&&state.loggedIn&&state.logicalChats);
    await p.evaluate(async theme=>{applyTheme(theme);await uiCore.selectMainChat();closeDrawer();stopSharedPoll();},theme);
    await p.waitForFunction(()=>!uiCore.state.sessionSelecting&&!state.sharedLoading);
    const prefix=`phone-${width}-${theme}`;
    await p.evaluate(()=>{uiCore.state.mainChat.running=false;uiCore.state.chatWindow.events.clear();uiCore.state.chatWindow.loaded=true;mobileEffects.renderMainChat();});
    await shot(p,prefix,'chat-empty');
    // Use the actual timeline renderer for an existing native side conversation.
    await p.evaluate(async id=>{await uiCore.selectLogicalSession(id);await uiCore.state.historyInFlight?.promise;stopSharedPoll();state.sharedEvents=[{seq:1,type:'user.message',data:{text:'周末想放松一下，帮我安排半天。'}},{seq:2,type:'assistant.message',data:{text:'上午去公园走走，午饭后留一点时间读书。\n\n不用把行程排满，留一段随心安排的时间。'}}];state.sharedRunning=false;state.sharedLoading=false;renderSharedConversation();},f.sessionId);
    await shot(p,prefix,'chat-content');
    await p.locator('#conversation-more').click();await shot(p,prefix,'chat-menu');await p.keyboard.press('Escape');
    await p.evaluate(()=>{state.sharedRunning=true;state.sharedEvents.push({seq:3,type:'turn.started',data:{turn:2}},{seq:4,type:'assistant.message',data:{text:'我正在把路线整理成一份简洁的清单…',streaming:true}});renderSharedConversation();updateComposer();});
    await shot(p,prefix,'chat-streaming');
    await p.evaluate(()=>{state.sharedRunning=false;renderSharedConversation();updateComposer();});
    await p.locator('#draft').fill('午饭想吃清淡一点');await shot(p,prefix,'composer-focus');
    await p.locator('#plus-button').click();await shot(p,prefix,'attachment-menu');await p.keyboard.press('Escape');
    await p.evaluate(()=>{document.activeElement.blur();$('draft').value='';});
    await p.evaluate(()=>openDrawer());await shot(p,prefix,'sidebar');await p.evaluate(()=>closeDrawer());
    await p.evaluate(()=>page('settings'));await shot(p,prefix,'settings');
    await p.evaluate(()=>$('generic-page').scrollTop=$('generic-page').scrollHeight);await shot(p,prefix,'settings-bottom');
    await p.evaluate(()=>page('appearance'));await p.getByRole('group',{name:'颜色模式',exact:true}).waitFor();await shot(p,prefix,'appearance');
    await p.evaluate(()=>{page('chat');mobileSessionQuickMenu(state.sharedSessions.find(row=>row.kind!=='main'));});await shot(p,prefix,'bottom-sheet');await p.keyboard.press('Escape');
    await p.evaluate(()=>selectMobileTab('chat'));await p.waitForFunction(()=>!uiCore.state.sessionSelecting);
    for(const tab of ['chat','activity','goals','library']){await p.getByRole('tab',{name:new RegExp('^'+({chat:'聊天',activity:'动态',goals:'目标',library:'成果库'}[tab])+'(?:，|$)')}).click();await p.waitForFunction(tab=>state.page===tab,tab);await p.waitForTimeout(350);await shot(p,prefix,`tab-${tab}`);}
    if(!before){
      await p.evaluate(()=>selectMobileTab('chat'));await p.waitForFunction(()=>!uiCore.state.sessionSelecting);
      const targets=await p.locator('.topbar button:visible,#mobile-bottom-tabs button:visible,.composer-actions button:visible').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>({id:n.id,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
      assert.ok(targets.every(n=>Math.round(n.width)>=44&&Math.round(n.height)>=44),JSON.stringify(targets));report.checks.push({prefix,touchTargets:targets});
      await p.locator('#conversation-more').click();const menu=await p.locator('.wm-menu').boundingBox(),trigger=await p.locator('#conversation-more').boundingBox();assert.ok(menu.y>=trigger.y&&menu.y-trigger.y<80);await p.keyboard.press('Escape');
      await p.evaluate(()=>{$('draft').blur();syncMobileKeyboard();const vv=visualViewport;window.__mobRest=vv.height;Object.defineProperty(vv,'height',{configurable:true,value:innerHeight-300});$('draft').focus();vv.dispatchEvent(new Event('resize'));});assert.equal(await p.locator('#mobile-bottom-tabs').isVisible(),false);await p.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:window.__mobRest});document.activeElement.blur();visualViewport.dispatchEvent(new Event('resize'));});assert.equal(await p.locator('#mobile-bottom-tabs').isVisible(),true);
      report.checks.push({prefix,menuAnchored:true,keyboardYields:true,tabsRestore:true});
    }
    await p.close();
  }
  if(!desktopOnly)for(const [width,height] of [[360,780],[390,844]])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});const at=remoteCookie.indexOf('=');
    await context.addCookies([{name:remoteCookie.slice(0,at),value:remoteCookie.slice(at+1),url:f.origin}]);
    const p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',error=>report.errors.push(error.message));
    await isolate(p);
    await p.route('**/personal/v1/ui/**',async route=>{const name=new URL(route.request().url()).pathname.replace('/personal/v1/ui/','')||'index.html';let body;
      if(!/\.(css|js|html)$/.test(name))return route.fallback();
      if(before){try{body=execFileSync('git',['show',`${baselineCommit}:${name.startsWith('ui-core/')?'src/'+name:'src/personal-access-ui/'+name}`]);}catch{return route.fallback();}}
      else if(name==='app.js')body=await readFile('src/personal-access-ui/app.js');else return route.fallback();
      if(name==='app.js')body=Buffer.from(body.toString().replace('const ui = globalThis.WeftUiComponents.createContext();','const ui = globalThis.WeftUiComponents.createContext();globalThis.__mobui=ui;').replace('ui.loadAttachmentHasher =','globalThis.__mobcore=core;ui.loadAttachmentHasher =').replace('ui[mount]();','{if(mount==="mountShell"){const mobLoad=core.load;core.load=(...args)=>(globalThis.__mobLoaded=mobLoad(...args));}ui[mount]();}'));
      await route.fulfill({body,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html'});
    });
    await p.goto(f.origin+'/personal/v1/ui/');await p.waitForFunction(()=>globalThis.__mobLoaded);await p.evaluate(()=>globalThis.__mobLoaded);
    await p.evaluate(async()=>{const me=await(await fetch('/personal/v1/auth/me')).json();if(me.device.authKind!=='cloud')throw Error('Cloud phone fixture required');__mobcore.acceptSession(me);Object.assign(__mobcore.state.cloudAuth,{mode:'offline',localSession:false,modal:false});await __mobcore.enterAssistant();});
    await p.locator('#assistant-view:not([hidden])').waitFor();await p.waitForFunction(()=>__mobcore.state.mainChat&&!__mobcore.state.refreshing);await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const prefix=`remote-${width}-${theme}`;await shot(p,prefix,'chat-empty');
    await p.evaluate(async id=>{await __mobcore.selectLogicalSession(id);},f.sessionId);await p.waitForTimeout(400);await shot(p,prefix,'chat-content');
    await p.getByRole('button',{name:'对话操作',exact:true}).click();await shot(p,prefix,'chat-menu');await p.keyboard.press('Escape');
    await p.locator('#message-text').fill('午饭想吃清淡一点');await shot(p,prefix,'composer-focus');await p.locator('#message-text').blur();
    await p.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await shot(p,prefix,'sidebar');await p.evaluate(()=>__mobui.closeRail());
    for(const [id,action] of [['chat','selectMainChat'],['activity','openActivity'],['goals','openGoals'],['library','openLibrary']]){await p.evaluate(async({id,action})=>{await(id==='chat'?__mobcore[action]():__mobui[action]());},{id,action});await shot(p,prefix,'tab-'+id);}
    await p.evaluate(()=>__mobui.openSettings('general'));await p.locator('#settings-dialog[open]').waitFor();await shot(p,prefix,'settings');
    await p.evaluate(()=>__mobui.openSettings('appearance'));await shot(p,prefix,'appearance');
    if(!before){assert.equal(await p.locator('.remote-mobile-tabs').count(),1);report.checks.push({prefix,cloudPhone:true,bottomTabs:true});}
    await context.close();
  }
  profile=await mkdtemp(join(tmpdir(),'weftmate-mob2-electron-'));const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,WEFTMATE_TEST_HOST_NAME:'synthetic-host',REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken,REVIEW_THEME:'light'}});
  const p=await app.firstWindow();p.setDefaultTimeout(20000);p.on('pageerror',error=>report.errors.push(error.message));await p.waitForURL(f.origin+'/personal/v1/ui');
  await p.route('**/personal/v1/ui**',async route=>{const name=new URL(route.request().url()).pathname.replace(/^\/personal\/v1\/ui\/?/,'')||'index.html';let body;
    if(!/\.(css|js|html)$/.test(name))return route.fallback();
    if(before){try{body=execFileSync('git',['show',`${baselineCommit}:${name.startsWith('ui-core/')?'src/'+name:'src/personal-access-ui/'+name}`]).toString();}catch{return route.fallback();}}
    else if(name==='app.js')body=await readFile('src/personal-access-ui/app.js','utf8');else return route.fallback();
    if(name==='app.js'){body=body.replace('const ui = globalThis.WeftUiComponents.createContext();','const ui = globalThis.WeftUiComponents.createContext();globalThis.__mobui=ui;');body=body.replace('ui.loadAttachmentHasher =','globalThis.__mobcore=core;ui.loadAttachmentHasher =').replace('ui[mount]();','{if(mount==="mountShell"){const mobLoad=core.load;core.load=(...args)=>(globalThis.__mobLoaded=mobLoad(...args));}ui[mount]();}');}
    await route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html',body});});await p.reload();
  await p.waitForFunction(()=>globalThis.__mobcore?.state.account&&__mobcore.state.device?.authKind==='desktop'&&__mobcore.state.modelsKnown);
  for(const width of [1200,480])for(const theme of ['light','dark']){
    await app.evaluate(({BrowserWindow,nativeTheme},{width,theme})=>{BrowserWindow.getAllWindows()[0].setContentSize(width,800);nativeTheme.themeSource=theme;},{width,theme});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await p.evaluate(()=>{document.querySelector('#settings-dialog')?.close();__mobcore.selectMainChat();});await shot(p,`electron-${width}-${theme}`,'chat');
    await p.evaluate(()=>__mobui.openSettings('general'));await p.locator('#settings-dialog[open]').waitFor();await shot(p,`electron-${width}-${theme}`,'settings');
  }
  assert.deepEqual(report.errors,[]);if(!desktopOnly)await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(out,'desktop-verification.json'),JSON.stringify({...report,screenshots:report.screenshots.filter(file=>file.startsWith('electron-')),checks:[]},null,2)+'\n');console.log(JSON.stringify({screenshots:report.screenshots.length,checks:report.checks.length,errors:report.errors}));
} finally {await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await browser.close();await f.close();await authentication.close();if(profile)await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
