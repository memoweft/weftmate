/** D53: production Electron and shipped mobile assets, isolated real host APIs. */
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-6');await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report={checks:[],screenshots:[],errors:[],modelRequests:0};let f,app,browser,profile;
const b=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true});
async function shot(page,surface,theme,scene){await wait(180);const file=`${surface}-${theme}-${scene}.png`;await page.screenshot({path:join(out,file)});report.screenshots.push(file);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,file);console.log(file);}
async function ready(page){await page.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');}
try{
  f=await startTimelineCandidate({daily:true,logicalMobile:true,sidebar:true,interactive:true,inlineProgress:true,goals:true,historyCount:0,baseTime:Date.now()-1000});
  const host=(await f.request('/status')).hostId,owner=(await f.request('/auth/me')).account.ownerId;
  async function command(body){let row=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,...body})).command;while(['pending','dispatching','preflight'].includes(row.state)){await wait(20);row=(await f.request(`/commands/${row.commandId}`)).command;}assert.equal(row.state,'accepted_by_dsh');return row;}
  const main=(await f.request('/chats/main')).chat;
  const first=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成主对话：周末纸船计划'});f.seedMainHistory(first.sessionId,30);
  const projectPath=join(f.root,'synthetic-project');await mkdir(projectPath);const project=(await f.request('/projects',{requestId:randomUUID(),name:'周末研究',rootPath:projectPath})).project;
  const side=await f.newOutputSource('周末纸船：正文定位验收。',project.projectId);await f.request(`/sessions/${side.sessionId}/metadata`,{title:'周末旅行计划'},'PATCH');
  const filePath=join(f.root,'周末计划.md');await writeFile(filePath,'# 周末计划\n\n合成内容。');const artifact=await f.registerOutput(filePath,side);
  await f.request('/schedules',{requestId:randomUUID(),sessionId:side.sessionId,text:'周末核对报告',kind:'reminder',repeat:{kind:'daily',time:'09:00:00'}});
  const temp=await command({kind:'session.create',modelProfileId:'local',temporary:true});await f.request(`/sessions/${temp.sessionId}/metadata`,{title:'周末临时秘密'},'PATCH');
  profile=await mkdtemp(join(tmpdir(),'weftmate-ux6-electron-'));
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
  const p=await app.firstWindow();p.setDefaultTimeout(15000);p.on('pageerror',error=>{report.errors.push(error.message);console.log(error.stack);});
  await p.route('**/personal/v1/memory/**',route=>{const url=new URL(route.request().url());const item={id:'synthetic-memory',kind:'cognition',text:'周末喜欢安静的地方',currentState:'current',sourceCount:0,updatedAt:new Date().toISOString()};return route.fulfill({json:url.pathname.endsWith('/status')?{ownerId:owner,state:'ready',worldRevision:1,capabilities:{list:true,source:true},formedMemoryCount:1}:url.pathname.includes('/items/')?{ownerId:owner,item,worldRevision:1,availableActions:{}}:{ownerId:owner,items:url.searchParams.get('query')&&!item.text.includes(url.searchParams.get('query'))?[]:[item],worldRevision:1,totalCount:1,hasMore:false,nextCursor:null}});});
  await localUiSession(p,f.credentials,undefined,{mainChat:true});await b(p,'WeftMate 主对话').waitFor();
  if(!process.argv.includes('--phones')){
  for(const width of [1200,480]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);
    for(const theme of ['light','dark']){
      await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await p.evaluate(()=>WeftDesktop.toggleRail(false));await shot(p,`electron-${width}`,theme,'sidebar-expanded');
      const expanded=await p.locator('#rail-open').boundingBox();await p.keyboard.press('Control+b');const collapsed=await p.locator('#rail-open').boundingBox();assert.deepEqual(expanded,collapsed);assert.equal(await p.locator('button:has(use[href$="#sidebar"])').count(),1);await shot(p,`electron-${width}`,theme,'sidebar-collapsed');
      await p.keyboard.press('Control+k');await p.getByRole('dialog',{name:'搜索',exact:true}).waitFor();await ready(p);await shot(p,`electron-${width}`,theme,'empty');
      assert.ok(await p.getByRole('heading',{name:'最近使用',exact:true}).count());assert.ok(await p.getByRole('heading',{name:'操作',exact:true}).count());
      await p.getByRole('combobox',{name:'搜索内容',exact:true}).fill('周末');await ready(p);await p.locator('.search-highlight').first().waitFor();await shot(p,`electron-${width}`,theme,'grouped-results');assert.equal(await p.getByRole('option').filter({hasText:'临时秘密'}).count(),0);
      for(const type of ['对话','项目','成果','定时任务','记忆']){await p.getByRole('tab',{name:type,exact:true}).click();await ready(p);await shot(p,`electron-${width}`,theme,'type-'+type);}
      await p.getByRole('tab',{name:'对话',exact:true}).click();await ready(p);const row=p.getByRole('option').filter({hasText:'周末旅行计划'}).first();await row.hover();await row.getByRole('button',{name:'操作 周末旅行计划',exact:true}).click();await p.getByRole('menu').waitFor();await shot(p,`electron-${width}`,theme,'row-menu-open');await p.keyboard.press('Escape');
      await p.getByRole('combobox',{name:'搜索内容'}).fill('zz-no-result');await ready(p);await p.getByText('没有找到相关内容',{exact:true}).waitFor();await shot(p,`electron-${width}`,theme,'no-results');
      await p.keyboard.press('Escape');await wait(180);await p.evaluate(()=>WeftDesktop.toggleRail(false));await b(p,'选择新对话类型').click();await shot(p,`electron-${width}`,theme,'new-chat-menu-open');await p.keyboard.press('Escape');
    }
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  for(const theme of ['light','dark']){
    await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.keyboard.press('Control+k');await ready(p);
    await p.getByRole('combobox',{name:'搜索内容'}).fill('纸船');await ready(p);
    const mainHit=p.getByRole('option').filter({hasText:'WeftMate'}).filter({has:p.locator('.search-result-snippet')}).first();await mainHit.click();
    await p.locator('.main-chat-row[data-event-id]:focus').waitFor();await shot(p,'electron-1200',theme,'main-body-located');
    await p.keyboard.press('Control+k');await ready(p);await p.getByRole('combobox',{name:'搜索内容'}).fill('正文定位');await ready(p);await p.getByRole('option').filter({has:p.locator('.search-result-snippet')}).first().click();
    await p.locator('#transcript [data-seq]:focus').waitFor();await shot(p,'electron-1200',theme,'side-body-located');
    await p.keyboard.press('Control+k');await ready(p);const input=p.getByRole('combobox',{name:'搜索内容'});await input.fill('周末');await ready(p);await input.press('ArrowRight');await ready(p);assert.equal(await p.getByRole('tab',{name:'对话',exact:true}).getAttribute('aria-selected'),'true');
    await input.press('ArrowDown');await input.press('ArrowUp');await input.press('Alt+Enter');await p.getByRole('menu').waitFor();await shot(p,'electron-1200',theme,'keyboard-menu-open');await p.keyboard.press('Escape');await input.focus();await input.press('Escape');await wait(180);
    await p.keyboard.press('Control+k');await ready(p);await input.fill('loading-check');await p.route('**/personal/v1/chats?*',async route=>{await wait(500);await route.fallback();});await input.fill('周末');await p.locator('.search-skeleton').first().waitFor();await shot(p,'electron-1200',theme,'loading-skeleton');await ready(p);await p.unroute('**/personal/v1/chats?*');await input.press('Escape');await wait(180);
  }
  }
  browser=await chromium.launch({headless:true});
  for(const surface of ['phone-web','android-bundle'])for(const [width,height] of [[390,844],[360,780]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>{report.errors.push(error.message);console.log(error.stack);});
    // Execute the shipped native bridge contract on Android's real UI bundle.
    // Web uses the same isolated bridge fixture with the native browser flag absent.

    await page.route('**/bridge',async route=>{const input=route.request().postDataJSON(),path=input.params?.path??'';if(input.method==='host.business'&&path.includes('/memory/')){
      const item={id:'synthetic-memory',kind:'cognition',text:'周末喜欢安静的地方',currentState:'current',sourceCount:0,updatedAt:new Date().toISOString()};const url=new URL(path,'http://synthetic');
      const result=url.pathname.endsWith('/status')?{ownerId:owner,state:'ready',worldRevision:1,capabilities:{list:true,source:true}}:url.pathname.endsWith('/sources')?{ownerId:owner,worldRevision:1,sources:[]}:url.pathname.includes('/items/')?{ownerId:owner,worldRevision:1,item,availableActions:[]}:{ownerId:owner,items:url.searchParams.get('query')&&!item.text.includes(url.searchParams.get('query'))?[]:[item],worldRevision:1,totalCount:1,hasMore:false,nextCursor:null};await route.fulfill({json:{id:input.id,ok:true,result}});return;}await route.fallback();});
    if(surface==='phone-web'){
      await page.route('**/personal/v1/memory/**',route=>{const url=new URL(route.request().url()),item={id:'synthetic-memory',kind:'cognition',text:'周末喜欢安静的地方',currentState:'current',sourceCount:0,updatedAt:new Date().toISOString()};return route.fulfill({json:url.pathname.endsWith('/status')?{ownerId:owner,state:'ready',worldRevision:1,capabilities:{list:true,source:true}}:{ownerId:owner,items:url.searchParams.get('query')&&!item.text.includes(url.searchParams.get('query'))?[]:[item],worldRevision:1,totalCount:1,hasMore:false,nextCursor:null}});});
      await page.goto(f.origin+'/personal/v1/ui');await localUiSession(page,f.credentials,undefined,{mainChat:true});await page.getByRole('button',{name:'WeftMate 主对话',exact:true,includeHidden:true}).waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#transcript .main-chat-row')&&!document.querySelector('#message-text').disabled);
    }else{await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted&&state.loggedIn);await page.waitForFunction(()=>state.logicalChats);}
    for(const theme of ['light','dark']){
      if(surface==='android-bundle')await page.evaluate(()=>uiCore.selectMainChat());
      await page.evaluate(({theme,surface})=>{if(surface==='android-bundle')applyTheme(theme);else document.documentElement.dataset.theme=theme;},{theme,surface});await b(page,surface==='android-bundle'?'打开导航':'切换会话侧栏').click();await shot(page,`${surface}-${width}`,theme,'sidebar');await b(page,'搜索').click();await ready(page);await shot(page,`${surface}-${width}`,theme,'empty');
      const input=page.getByRole('combobox',{name:'搜索内容'});await input.fill('周末');await ready(page);await shot(page,`${surface}-${width}`,theme,'grouped-results');
      for(const [type,expected] of [['对话','周末旅行计划'],['项目','周末研究'],['成果','周末计划.md'],['定时任务','周末核对报告'],['记忆','周末喜欢安静的地方']]){await page.getByRole('tab',{name:type,exact:true}).click();await ready(page);assert.ok(await page.getByRole('option').filter({hasText:expected}).count(),`${surface} ${type} returns its real fixture result`);await shot(page,`${surface}-${width}`,theme,'type-'+type);}
      await page.getByRole('tab',{name:'对话',exact:true}).click();await ready(page);await page.getByRole('option').filter({hasText:'周末旅行计划'}).first().getByRole('button',{name:'操作 周末旅行计划',exact:true}).click();await page.getByRole('menu').waitFor();await shot(page,`${surface}-${width}`,theme,'row-menu-open');await page.keyboard.press('Escape');
      await input.fill('zz-no-result');await ready(page);await page.getByText('没有找到相关内容',{exact:true}).waitFor();await shot(page,`${surface}-${width}`,theme,'no-results');await b(page,'关闭搜索').click();await wait(180);
      await page.keyboard.press('Control+k');await ready(page);await input.fill('正文定位');await ready(page);await page.getByRole('option').filter({has:page.locator('.search-result-snippet')}).first().click();await page.locator(surface==='phone-web'?'#transcript [data-seq]:focus':'#chat-content [data-seq]:focus').waitFor();await shot(page,`${surface}-${width}`,theme,'body-located');
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.checks.push('fixed-single-toggle','sidebar-order','six-types','title-and-body-highlight','temporary-filter','row-menu','no-results','main-and-side-body-location','keyboard-navigation-and-alt-enter','loading-skeleton','phone-and-shipped-android-assets');
  await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await browser?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f?.root)await rm(f.root,{recursive:true,force:true});}
