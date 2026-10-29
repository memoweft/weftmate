// Actual native desktop, isolated synthetic account and profile. Evidence survives cleanup.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,open,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startFixture} from './ux-4-fixture.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {managedMkdtempSync,disposeManagedTemp} from '../helpers/managed-temp.mjs';
import {measureUi} from '../helpers/ui-smoothness.mjs';

const root=resolve(import.meta.dirname,'../..'),before=process.argv.includes('--before');
const dialogsOnly=process.argv.includes('--dialogs-only');
const bootOnly=process.argv.includes('--boot-only');
const out=resolve(process.env.WEFTMATE_MOTION2_OUTPUT||'.local/evidence/ui-motion-2');
await mkdir(out,{recursive:true});
const report={before,commit:null,dirty:null,phase:'module-loaded',phases:[],checks:[],samples:[],performance:[],errors:[],console:[]};
const phase=async name=>{report.phase=name;report.phases.push({name,at:new Date().toISOString()});await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));};
const check=(name,value,details)=>{report.checks.push({name,pass:!!value,details});if(!before)assert.ok(value,`${name}: ${JSON.stringify(details)}`);};
let app,page,fixture,scope,lock,cdp,recording=false;
const screencast=[],frameWrites=[];
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Diagnostic deadline ${ms}ms`)),ms);})]);}finally{clearTimeout(timer);}}
const nativeState=()=>app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),zoom:w.webContents.getZoomFactor(),bounds:w.getContentBounds()};});
async function capture(name){
  const png=await bounded(app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64')),8000);
  await writeFile(join(out,name),Buffer.from(png,'base64'));
}
try{
  await phase('source-metadata');
  report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  report.dirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  await phase('fixture');
  if(process.env.WEFTMATE_HEAVY_LOCK_DIR){for(const n of [1,2,3]){const path=join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);try{const f=await open(path,'wx');await f.writeFile(`UI-MOTION-2 ${new Date().toISOString()}`);await f.close();lock=path;break;}catch(e){if(e.code!=='EEXIST')throw e;}}assert.ok(lock,'No heavy slot');}
  scope=managedMkdtempSync('weftmate-motion2-',{prune:false});fixture=await startFixture();
  await phase('electron-launch');
  const env={...process.env,REVIEW_PROFILE:join(scope,'profile'),REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/ui-motion-2-electron.mjs'],env,timeout:30000});
  for(const stream of [app.process().stdout,app.process().stderr])stream?.resume();
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')report.console.push(message.text());});
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
  if(before)for(const source of execFileSync('git',['diff','--name-only','825edad9e','--','src/personal-access-ui','src/ui-core'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(file=>/\.(js|css)$/.test(file))){
    const asset=source.replace('src/personal-access-ui/','').replace('src/ui-core/','ui-core/');
    await page.route(`**/personal/v1/ui/${asset}`,route=>route.fulfill({contentType:source.endsWith('.css')?'text/css':'text/javascript',body:execFileSync('git',['show',`825edad9e:${source}`],{cwd:root,encoding:'utf8'})}));
  }
  await phase('initial-navigation');await page.waitForURL('**/personal/v1/ui',{timeout:12000});
  await phase('login');await localUiSession(page,fixture.credentials,'UI-MOTION-2 synthetic',{mainChat:true});
  await phase('ui-boot');
  await page.waitForFunction(()=>globalThis.__WeftUiStarted&&globalThis.testCore?.state.sessions.length>0);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.showInactive();w.webContents.setBackgroundThrottling(false);});
  await page.evaluate(()=>WeftReplyMotion.setVisibility(false));
  report.windowAtStart=await nativeState();
  // Recording starts after native navigation and login so capture setup
  // cannot gate startup or hide a native-window bootstrap failure.
  cdp=await page.context().newCDPSession(page);recording=true;
  cdp.on('Page.screencastFrame',event=>{
    if(recording){const file=`capture-${String(screencast.length).padStart(5,'0')}.jpg`;screencast.push({file,timestamp:event.metadata.timestamp,width:event.metadata.deviceWidth,height:event.metadata.deviceHeight});frameWrites.push(writeFile(join(out,file),Buffer.from(event.data,'base64')).catch(error=>{report.errors.push(`screencast: ${error.message}`);}));}
    void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
  });
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:72,maxWidth:1280,maxHeight:800,everyNthFrame:3});
  await phase('native-acceptance');
  if(!bootOnly){
  const settle=()=>page.waitForTimeout(380);
  async function sample(name,action){
    await page.evaluate(()=>{globalThis.motion2Frames=[];const tick=()=>{const d=document.querySelector('#transcript .execution-block'),s=d?.querySelector(':scope > summary'),b=d?.querySelector('.execution-records');motion2Frames.push({at:performance.now(),height:d?.getBoundingClientRect().height,y:s?.getBoundingClientRect().y,body:b?.getBoundingClientRect().height,scroll:document.getElementById('chat-scroll').scrollTop,open:d?.open,animations:d?.getAnimations().map(a=>({state:a.playState,frames:a.effect.getKeyframes()}))});globalThis.motion2Raf=requestAnimationFrame(tick);};motion2Raf=requestAnimationFrame(tick);});
    await action();await page.waitForTimeout(720);
    const frames=await page.evaluate(()=>{cancelAnimationFrame(motion2Raf);return motion2Frames;});
    await writeFile(join(out,`${name}-frames.json`),JSON.stringify(frames,null,2));report.samples.push({name,frames:frames.length,native:await nativeState(),document:await page.evaluate(()=>({visibility:document.visibilityState,focused:document.hasFocus()}))});return frames;
  }
  async function thinking(lines,streaming=false){
    await page.evaluate(async({id,lines,streaming})=>{
      await testCore.selectSession(id);testCore.stopAssistantRefresh();testCore.refreshConversationFacts=async()=>{};testCore.state.historyGeneration++;
      testCore.state.personalization={...testCore.state.personalization,thinkingDisplay:'collapsed'};
      testCore.state.historyEvents.clear();testCore.state.seenSeq.clear();testCore.state.liveMessageSeq=-1;testUi.resetMainChatView();
      const at=new Date().toISOString(),ev=(seq,type,data)=>({seq,type,data,at,sessionId:id});
      const text=Array.from({length:lines},(_,i)=>`第 ${i+1} 段合成思考，核对展开与阅读位置。`).join('\n\n');
      testCore.appendHistory([ev(0,'turn.started',{turn:1}),ev(1,'user.message',{text:'合成问题',turn:1}),...(!streaming?[ev(2,'assistant.message',{text:'合成回答，正文保留。',modelThinking:text,thinkingMs:2000,turn:1}),ev(3,'turn.ended',{turn:1,reason:'completed'})]:[])],streaming?[ev(2,'assistant.delta',{text:'',modelThinking:text,thinkingActive:true,streaming:true,turn:1})]:[],4);
    },{id:fixture.source,lines,streaming});await settle();
    await page.locator('#transcript .execution-block > summary').first().scrollIntoViewIfNeeded();
  }
  if(!dialogsOnly){
  for(const theme of ['light','dark']){
    await app.evaluate(({nativeTheme},t)=>nativeTheme.themeSource=t,theme);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    for(const [name,lines,streaming]of [['short',3,false],['long',35,false],['stream',12,true]]){
      await thinking(lines,streaming);
      const frames=await sample(`${theme}-${name}-open`,async()=>{await page.locator('#transcript .execution-block > summary').first().click();if(streaming){await page.waitForTimeout(40);await page.evaluate(id=>{const text=Array.from({length:24},(_,i)=>`第 ${i+1} 段合成思考，核对展开与阅读位置。`).join('\n\n');testCore.appendHistory([],[{seq:2,type:'assistant.delta',sessionId:id,at:new Date().toISOString(),data:{text:'',modelThinking:text,thinkingActive:true,streaming:true,turn:1}}],5);},fixture.source);}});
      const visible=frames.filter(f=>f.open&&f.height>0),end=visible.at(-1)?.height;
      const jumps=visible.slice(1).map((f,i)=>Math.abs(f.height-visible[i].height));
      check(`${theme}/${name}: expands continuously without a final height jump`,visible.length>4&&Math.max(0,...jumps)<Math.max(32,end*.4),{end,maxJump:Math.max(0,...jumps)});
      check(`${theme}/${name}: summary stays anchored`,Math.max(...frames.map(f=>f.y))-Math.min(...frames.map(f=>f.y))<=2);
      check(`${theme}/${name}: full thinking remains readable`,await page.locator('#transcript .thinking-body p').textContent().then(t=>t.includes(`第 ${lines} 段`)));
      await sample(`${theme}-${name}-interrupt`,async()=>{const s=page.locator('#transcript .execution-block > summary').first();await s.click();await page.waitForTimeout(35);await s.click();await page.waitForTimeout(25);await s.click();});
      check(`${theme}/${name}: interrupted close releases sizing`,await page.locator('#transcript .execution-block').first().evaluate(d=>!d.open&&!d.style.height&&!d.style.overflow));
    }
    for(const [width,height,zoom]of [[1280,800,1],[900,700,1.25],[720,650,1.5]]){
      await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(width,height);w.webContents.setZoomFactor(zoom);},{width,height,zoom});
      await page.evaluate(()=>testUi.openActivity());await settle();
      const caption=await page.getByRole('button',{name:'全部已读',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(document.documentElement),safe=parseFloat(s.getPropertyValue('--desktop-caption-height'))||44;return {top:r.top,safe,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),drag:getComputedStyle(el).webkitAppRegion};});
      check(`${theme}/${width}/${zoom}: activity action clears native caption`,caption.top>=caption.safe&&caption.hit&&caption.drag!=='drag',caption);
      await capture(`${theme}-${width}-${zoom}-activity.png`);
      await page.evaluate(()=>testCore.startNewConversation());await settle();
      const text=await page.evaluate(()=>{const b=document.querySelector('.thinking-badge');b.hidden=false;b.textContent='深入思考';const m=document.getElementById('model-label');m.textContent='合成模型名字很长以核对省略';const range=e=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect().toJSON();};return {badge:range(b),model:range(m),badgeBox:b.getBoundingClientRect().toJSON(),font:getComputedStyle(b).fontSize,modelFont:getComputedStyle(m).fontSize,send:document.getElementById('send-message').getBoundingClientRect().toJSON(),width:innerWidth};});
      check(`${theme}/${width}/${zoom}: thinking label aligns and is not clipped`,text.font===text.modelFont&&Math.abs(text.badge.y-text.model.y)<=2&&text.badgeBox.width>=text.badge.width-1&&text.send.right<=text.width,text);
      await capture(`${theme}-${width}-${zoom}-composer.png`);
    }
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setContentSize(1280,800);});
  }
  await page.evaluate(async()=>{await testUi.openGoals();await testCore.readGoals();});await settle();
  await page.evaluate(()=>{
    testCore.resetGoals();testCore.state.personalCapabilities={...testCore.state.personalCapabilities,taskOverview:1,scheduleEditing:1,goals:1};
    globalThis.motion2Api=testCore.accessApi;globalThis.motion2Pending={};testCore.accessApi=path=>['/tasks','/schedules','/goals','/sessions'].includes(path)?new Promise((resolve,reject)=>motion2Pending[path]={resolve,reject}):motion2Api(path);
    testCore.readGoals();
  });await page.waitForFunction(()=>Object.keys(motion2Pending).length===4);
  await page.evaluate(()=>motion2Pending['/schedules'].resolve({items:[]}));
  await page.getByRole('tab',{name:'提醒与定时任务',exact:true}).click();await settle();
  check('fast empty schedules do not wait for slow sibling requests',await page.locator('#goals-panel-schedules .goals-state-empty').count()===1);
  await page.evaluate(()=>{for(const [path,p]of Object.entries(motion2Pending))p.resolve(path==='/tasks'?{items:[],recent:[]}:{items:[]});});await settle();
  await page.evaluate(()=>{void testCore.readGoals();});await page.waitForTimeout(80);
  check('background refresh preserves confirmed empty state',await page.locator('#goals-panel-schedules .goals-state-empty').count()===1&&await page.locator('#goals-panel-schedules .goals-state-loading').count()===0);
  await page.evaluate(()=>{motion2Pending['/schedules'].reject(Error('合成读取失败'));for(const [path,p]of Object.entries(motion2Pending))if(path!=='/schedules')p.resolve(path==='/tasks'?{items:[],recent:[]}:{items:[]});});await settle();
  check('failed read exposes retry',await page.locator('#goals-panel-schedules').getByRole('button',{name:'重试',exact:true}).count()===1);
  await capture('goals-failed.png');
  await page.locator('#goals-panel-schedules').getByRole('button',{name:'重试',exact:true}).click();await page.waitForTimeout(80);
  await page.evaluate(()=>{for(const [path,p]of Object.entries(motion2Pending))p.resolve(path==='/tasks'?{items:[],recent:[]}:{items:[]});});await settle();
  check('retry clears the real error',await page.locator('#goals-panel-schedules .goals-state-error').count()===0);
  await capture('goals-recovered.png');
  await page.evaluate(()=>{testCore.accessApi=motion2Api;});
  }
  if(!before||dialogsOnly){
    await phase('switch-inventory');
    // Exercise actual entry controls, retaining their live content, draft and focus.
    if(!dialogsOnly)for(const theme of ['light','dark']){
      await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
      await page.evaluate(()=>WeftDesktop.toggleRail(false));await settle();
      await page.locator('.goals-entry').click();
      for(const id of ['tasks','schedules','goals','tasks','goals']){
        await page.locator(`#goals-tab-${id}`).click();
        check(`${theme}: goal tab ${id} owns visible content`,await page.locator(`#goals-panel-${id}`).isVisible()&&await page.locator(`#goals-tab-${id}`).getAttribute('aria-selected')==='true');
      }
      await page.locator('#goals-tab-tasks').focus();await page.keyboard.press('ArrowRight');
      check(`${theme}: goal keyboard selection`,await page.locator('#goals-tab-schedules').getAttribute('aria-selected')==='true');
      report.performance.push({...await measureUi(page,`${theme}-goal-switch`,()=>page.locator('#goals-tab-goals').click(),{}),native:await nativeState()});
      await page.locator('.activity-entry').click();
      for(const id of ['all','actionable','task','reminder','memory','all']){
        await page.locator(`.activity-filters [data-filter="${id}"]`).click();
        await page.waitForFunction(id=>testCore.activity.filter===id&&!testCore.activity.loading,id);
        check(`${theme}: activity ${id} selected`,await page.locator(`.activity-filters [data-filter="${id}"]`).getAttribute('aria-current')==='true');
      }
      await page.locator('.library-entry').click();
      for(const id of ['','document','spreadsheet','image','code','other','']){
        const control=page.locator(`.library-type[data-type="${id}"]`);
        await control.click();await page.waitForFunction(id=>testCore.library.type===id&&!testCore.library.loading,id);
        check(`${theme}: library ${id||'all'} selected`,await control.getAttribute('aria-pressed')==='true');
      }
      for(const view of ['grid','list','grid']){
        await page.locator(`[data-view="${view}"]`).click();
        check(`${theme}: library ${view} content`,await page.locator('.library-list').evaluate((el,view)=>el.classList.contains('is-grid')===(view==='grid'),view));
      }
      await page.getByRole('combobox',{name:'按时间筛选',exact:true}).click();await page.getByRole('option',{name:/最近 7 天/}).click();
      await page.waitForFunction(()=>!testCore.library.loading&&testCore.library.time==='7');
      check(`${theme}: library time filter committed`,await page.locator('select[aria-label="按时间筛选"]').inputValue()==='7');
      await page.evaluate(()=>{
        globalThis.motion2LibraryApi=testCore.accessApi;globalThis.motion2LibraryReads=[];
        testCore.accessApi=path=>path.startsWith('/library?')?new Promise(resolve=>motion2LibraryReads.push({path,resolve})):motion2LibraryApi(path);
      });
      await page.locator('.library-type[data-type="code"]').click();await page.locator('.library-type[data-type="image"]').click();
      await page.waitForFunction(()=>motion2LibraryReads.length===2);
      await page.evaluate(()=>motion2LibraryReads[1].resolve({items:[],projects:[],total:0,nextCursor:null}));await page.waitForFunction(()=>!testCore.library.loading);
      await page.evaluate(()=>motion2LibraryReads[0].resolve({items:[],projects:[],total:99,nextCursor:null}));await page.waitForTimeout(40);
      check(`${theme}: late filter response stays with its original request`,await page.evaluate(()=>testCore.library.type==='image'&&testCore.library.total===0));
      await page.evaluate(()=>{testCore.accessApi=motion2LibraryApi;});
      await page.locator('.health-entry').click();await page.locator('.health-surface').waitFor({state:'visible'});
      check(`${theme}: health navigation retains surface`,await page.locator('.health-surface').isVisible());
      await page.evaluate(()=>{void testUi.openHelp();});await page.locator('.help-surface').waitFor({state:'visible'});
      const help=page.locator('.help-surface details > summary').first();if(await help.count()){await help.click();check(`${theme}: help disclosure`,await help.evaluate(el=>el.parentElement.open));}
      await page.evaluate(()=>{void testCore.startNewConversation();});await settle();
      await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('UI-MOTION-2 保留的合成草稿');
      for(const mode of ['工作','对话']){
        await page.getByRole('tab',{name:`新对话：${mode}`,exact:true}).click();
        check(`${theme}: draft survives ${mode} switch`,await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue()==='UI-MOTION-2 保留的合成草稿');
      }
      const entries=await page.evaluate(()=>WeftPanels.entries.map(({kind,title})=>({kind,title})));
      for(const {kind,title}of entries){
        await page.evaluate(kind=>{WeftPanels.open(kind);},kind);
        await page.getByRole('tab',{name:title,exact:true}).waitFor();
        check(`${theme}: ${kind} panel selected`,await page.getByRole('tab',{name:title,exact:true}).getAttribute('aria-selected')==='true');
      }
      const tabs=page.locator('.preview-tab-select');await tabs.first().focus();await page.keyboard.press('End');
      check(`${theme}: panel keyboard focus selected`,await tabs.last().getAttribute('aria-selected')==='true');
      await page.keyboard.press('Escape');await settle();
      check(`${theme}: panel close keeps draft`,await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue()==='UI-MOTION-2 保留的合成草稿');
      await page.evaluate(()=>WeftPanels.reset());
      for(const collapsed of [true,false,true,false]){await page.evaluate(value=>WeftDesktop.toggleRail(value),collapsed);check(`${theme}: sidebar ${collapsed}`,await page.locator('body').evaluate((el,value)=>el.classList.contains('rail-collapsed')===value,collapsed));}
      await page.locator('#attachment-add').click();check(`${theme}: attachment menu opens`,await page.locator('.composer-menu').isVisible());await page.keyboard.press('Escape');
      await page.locator('#model-trigger').click();check(`${theme}: model menu opens`,await page.locator('#model-popover').isVisible());await page.keyboard.press('Escape');
      await page.locator('#account-menu-trigger').click();check(`${theme}: account menu opens`,await page.locator('#account-menu').isVisible());await page.keyboard.press('Escape');
      await page.locator('#search-entry').click();
      for(const id of ['all','chats','projects','library','schedules','memory','all']){
        await page.locator(`.search-type[data-type="${id}"]`).click();await page.waitForFunction(id=>testCore.search.type===id&&!testCore.search.loading,id);
        check(`${theme}: search ${id} selected`,await page.locator(`.search-type[data-type="${id}"]`).getAttribute('aria-selected')==='true');
      }
      await page.keyboard.press('Escape');await page.locator('.search-palette').waitFor({state:'hidden'});
      await page.locator('#rail-memory').click();await page.locator('#memory-view').waitFor({state:'visible'});
      for(const kind of await page.locator('.memory-type-filter').evaluateAll(nodes=>nodes.map(n=>n.dataset.kind))){
        await page.locator(`.memory-type-filter[data-kind="${kind}"]`).click();
        check(`${theme}: memory ${kind} selected`,await page.locator(`.memory-type-filter[data-kind="${kind}"]`).getAttribute('aria-pressed')==='true');
      }
      await page.evaluate(()=>{void testCore.startNewConversation();});await settle();
      await capture(`${theme}-switch-inventory.png`);
    }
    await phase('layered-overlays');const layered=await page.evaluate(async()=>{
      const content=document.createElement('div'),trigger=document.createElement('button');trigger.textContent='打开合成子弹窗';content.append(trigger);
      const parent=WeftControls.dialog({title:'合成父弹窗',content,actions:[]});parent.openPanel();trigger.focus();
      const child=WeftControls.dialog({title:'合成子弹窗',content:document.createTextNode('子层内容'),actions:[]});child.openPanel();
      const before=parent.getBoundingClientRect().toJSON();child.close();
      const copy=document.querySelector('.motion-dialog-copy'),backdrop=document.querySelector('.motion-dialog-backdrop');
      const result={childClosed:!child.open,parentOpen:parent.open,visibleCopy:!!copy?.matches(':popover-open')&&copy.getBoundingClientRect().width>0,visibleBackdrop:!!backdrop?.matches(':popover-open'),parentY:parent.getBoundingClientRect().y-before.y,focus:document.activeElement===trigger};
      await Promise.all([copy,backdrop].flatMap(el=>el?.getAnimations().map(a=>a.finished.catch(()=>{}))||[]));result.cleaned=!document.querySelector('.motion-dialog-copy,.motion-dialog-backdrop');parent.close();child.remove();parent.remove();return result;
    });
    check('nested dialog exit stays above parent, restores focus, and releases visual copies',layered.childClosed&&layered.parentOpen&&layered.visibleCopy&&layered.visibleBackdrop&&layered.parentY===0&&layered.focus&&layered.cleaned,layered);
    await page.route('**/personal/v1/ui/motion2-native-test.css',route=>route.fulfill({contentType:'text/css',body:'dialog.motion2-native { animation:none; opacity:0; transition:opacity var(--dur-2),display var(--dur-2) allow-discrete,overlay var(--dur-2) allow-discrete; } dialog.motion2-native[open] {display:block;opacity:1;}'}));
    const nativeExitStyle=await page.addStyleTag({url:fixture.origin+'/personal/v1/ui/motion2-native-test.css'});
    const nativeLayered=await page.evaluate(async()=>{
      for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await new Promise(requestAnimationFrame);
      const content=document.createElement('button');content.textContent='合成父层焦点';const parent=WeftControls.dialog({title:'原生退出父层',content});parent.openPanel();content.focus();
      const child=WeftControls.dialog({title:'原生退出子层',content:document.createTextNode('合成原生退出')});child.classList.add('motion2-native');child.setAttribute('data-motion-native-close','');child.openPanel();await new Promise(r=>setTimeout(r,250));
      for(const a of parent.getAnimations())a.finish();await new Promise(requestAnimationFrame);
      const y=parent.getBoundingClientRect().y;child.close();await new Promise(requestAnimationFrame);
      const frames=[];for(let i=0;i<10;i++){frames.push({opacity:Number(getComputedStyle(child).opacity),display:getComputedStyle(child).display,overlay:getComputedStyle(child).overlay,parentY:parent.getBoundingClientRect().y-y,focus:document.activeElement===content,copies:document.querySelectorAll('.motion-dialog-copy').length});await new Promise(requestAnimationFrame);}
      child.openPanel();child.close();child.openPanel();child.close();await new Promise(r=>setTimeout(r,300));
      const result={frames,noResidue:getComputedStyle(child).overlay==='none'&&getComputedStyle(child).display==='none'&&!document.querySelector('.motion-dialog-copy'),parentOpen:parent.open,focus:document.activeElement===content};
      parent.setAttribute('data-motion-native-close','');parent.close();parent.remove();child.remove();return result;
    });
    await nativeExitStyle.evaluate(el=>el.remove());
    await writeFile(join(out,'nested-native-exit-frames.json'),JSON.stringify(nativeLayered,null,2));
    check('marked native dialog has a visible exit, stable parent and correct rapid-close cleanup',nativeLayered.frames.some(f=>f.opacity>0&&f.display!=='none'&&f.overlay==='auto')&&nativeLayered.frames.every(f=>f.parentY===0&&f.copies===0)&&nativeLayered.noResidue&&nativeLayered.parentOpen&&nativeLayered.focus,nativeLayered);
    const menuLayered=await page.evaluate(async()=>{
      const source=document.createElement('select');source.setAttribute('aria-label','合成层内选择');for(const [value,text]of [['0','合成选项一'],['1','合成选项二']])source.append(new Option(text,value));
      const parent=WeftControls.dialog({title:'合成菜单父层',content:source});parent.openPanel();WeftControls.select(source);
      for(const a of parent.getAnimations())a.finish();await new Promise(requestAnimationFrame);
      const trigger=parent.querySelector('[role=combobox]');trigger.click();const menu=parent.querySelector('.settings-select-menu'),y=parent.getBoundingClientRect().y;
      menu.querySelectorAll('[role=option]')[1].click();const copy=document.querySelector('.motion-copy');
      const result={visibleCopy:!!copy?.matches(':popover-open')&&copy.getBoundingClientRect().width>0,value:source.value,parentOpen:parent.open,parentY:parent.getBoundingClientRect().y-y,focus:document.activeElement===trigger};
      await Promise.all(copy?.getAnimations().map(a=>a.finished.catch(()=>{}))||[]);result.cleaned=!copy?.isConnected;
      parent.setAttribute('data-motion-native-close','');parent.close();parent.remove();return result;
    });
    check('select-menu exit remains above its parent dialog and restores focus',menuLayered.visibleCopy&&menuLayered.value==='1'&&menuLayered.parentOpen&&menuLayered.parentY===0&&menuLayered.focus&&menuLayered.cleaned,menuLayered);
    await page.evaluate(()=>{globalThis.motion2ReadConnectors=testCore.readConnectors;testCore.readConnectors=async()=>({connectors:[],builtinConnectors:[],canManageConnectors:true});document.getElementById('account-menu-trigger').focus();testUi.openSettings('connectors');});
    await page.getByRole('button',{name:'添加自定义连接器',exact:true}).click();
    const connector=page.locator('dialog.connector-editor');await connector.waitFor({state:'visible'});
    await page.evaluate(()=>{globalThis.motion2Connector=document.querySelector('dialog.connector-editor');globalThis.motion2Settings=document.getElementById('settings-dialog');for(const a of motion2Settings.getAnimations())a.finish();globalThis.motion2ParentRect=motion2Settings.getBoundingClientRect().toJSON();});
    await connector.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>new Promise(requestAnimationFrame));
    const dynamic=await page.evaluate(async()=>{
      const copy=document.querySelector('.motion-dialog-copy'),rect=motion2Settings.getBoundingClientRect();const result={removed:!motion2Connector.isConnected,parentOpen:motion2Settings.open,parentStable:['x','y','width','height'].every(key=>Math.abs(rect[key]-motion2ParentRect[key])<1),copies:document.querySelectorAll('.motion-dialog-copy').length,visibleCopy:!!copy?.matches(':popover-open')&&copy.getBoundingClientRect().width>0&&copy.inert,focus:document.activeElement?.textContent==='添加自定义连接器'};
      await Promise.all(copy?.getAnimations().map(a=>a.finished.catch(()=>{}))||[]);result.cleaned=!document.querySelector('.motion-dialog-copy');return result;
    });
    check('actual connector editor can remove its source DOM while the exit remains visible above settings',dynamic.removed&&dynamic.parentOpen&&dynamic.parentStable&&dynamic.copies===1&&dynamic.visibleCopy&&dynamic.focus&&dynamic.cleaned,dynamic);
    await page.evaluate(()=>{testCore.readConnectors=motion2ReadConnectors;testUi.openSettings('models');});
    await page.locator('#account-model-add').click();await page.locator('#account-model-dialog').waitFor({state:'visible'});
    await page.evaluate(()=>{for(const a of motion2Settings.getAnimations())a.finish();globalThis.motion2ParentRect=motion2Settings.getBoundingClientRect().toJSON();});
    await page.keyboard.press('Escape');
    const settingsNative=await page.evaluate(async()=>{
      const editor=document.getElementById('account-model-dialog'),frames=[];
      for(let i=0;i<10;i++){const style=getComputedStyle(editor),rect=motion2Settings.getBoundingClientRect();frames.push({open:editor.open,display:style.display,overlay:style.overlay,opacity:Number(style.opacity),copies:document.querySelectorAll('.motion-dialog-copy').length,parentStable:['x','y','width','height'].every(key=>Math.abs(rect[key]-motion2ParentRect[key])<1)});await new Promise(requestAnimationFrame);}
      await new Promise(r=>setTimeout(r,180));return {marked:editor.hasAttribute('data-motion-native-close'),parentMarked:motion2Settings.hasAttribute('data-motion-native-close'),frames,focus:document.activeElement.id==='account-model-add',cleaned:getComputedStyle(editor).overlay==='none'&&!document.querySelector('.motion-dialog-copy')};
    });
    await writeFile(join(out,'settings-native-editor-frames.json'),JSON.stringify(settingsNative,null,2));
    check('combined account-model native exit is visible without a second copy or parent movement',settingsNative.marked&&settingsNative.parentMarked&&settingsNative.frames.some(f=>!f.open&&f.display!=='none'&&f.opacity>0&&f.overlay==='auto')&&settingsNative.frames.every(f=>f.copies===0&&f.parentStable)&&settingsNative.focus&&settingsNative.cleaned,settingsNative);
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    const settingsRoot=await page.evaluate(async()=>{const frames=[];for(let i=0;i<10;i++){const s=getComputedStyle(motion2Settings);frames.push({open:motion2Settings.open,display:s.display,overlay:s.overlay,opacity:Number(s.opacity),copies:document.querySelectorAll('.motion-dialog-copy').length});await new Promise(requestAnimationFrame);}await new Promise(r=>setTimeout(r,180));return {frames,focus:document.activeElement.id==='account-menu-trigger',cleaned:getComputedStyle(motion2Settings).overlay==='none'&&!document.querySelector('.motion-dialog-copy')};});
    await writeFile(join(out,'settings-native-root-frames.json'),JSON.stringify(settingsRoot,null,2));
    check('combined settings native exit remains visible and returns focus without a visual duplicate',settingsRoot.frames.some(f=>!f.open&&f.display!=='none'&&f.opacity>0&&f.overlay==='auto')&&settingsRoot.frames.every(f=>f.copies===0)&&settingsRoot.focus&&settingsRoot.cleaned,settingsRoot);
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>WeftReplyMotion.setPreference('system'));
    const reduced=await page.evaluate(()=>{const el=document.getElementById('message-form');WeftMotion.content(el,Symbol());return {reduced:WeftMotion.reduced,frames:el.getAnimations().flatMap(a=>a.effect.getKeyframes())};});
    check('reduced motion retains opacity feedback without spatial movement',reduced.reduced&&reduced.frames.some(f=>f.opacity)&&reduced.frames.every(f=>!f.transform&&!f.height),reduced);
    await page.emulateMedia({reducedMotion:'no-preference'});
  }
  }
  check('no page errors',report.errors.length===0,report.errors);
  await phase('complete');
}catch(error){report.failure=error.stack;report.pageUrl=page?.url();await phase('failure');if(page)report.failureState=await bounded(page.evaluate(()=>({url:location.pathname,started:globalThis.__WeftUiStarted,view:globalThis.testCore?.state.currentView,account:!!globalThis.testCore?.state.account,sessions:globalThis.testCore?.state.sessions.length,csrf:!!globalThis.testCore?.state.csrfToken,cloudError:globalThis.testCore?.state.cloudAuth?.error,body:document.body?.innerText.slice(-1800)})),3000).catch(()=>null);if(app)await capture('failure.png').catch(()=>{});throw error;}
finally{
  recording=false;
  if(cdp){await bounded(cdp.send('Page.stopScreencast'),3000).catch(()=>{});await bounded(cdp.detach(),3000).catch(()=>{});}
  await Promise.all(frameWrites);report.screencastFrames=screencast.length;await writeFile(join(out,'screencast.json'),JSON.stringify(screencast,null,2));
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  if(page)await bounded(page.unrouteAll({behavior:'wait'}),5000).catch(()=>{});
  if(app){const child=app.process();try{await bounded(app.close(),10000);}catch{if(child.exitCode===null&&child.signalCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000});}}
  if(fixture)await fixture.close();
  if(scope)disposeManagedTemp(scope);if(lock)await unlink(lock);
}
assert.equal(report.errors.length,0,JSON.stringify(report.errors));
if(!bootOnly)assert.ok(report.screencastFrames>10,'continuous native frames must survive the test');
console.log(JSON.stringify({out,checks:report.checks.length,failures:report.checks.filter(c=>!c.pass)}));
