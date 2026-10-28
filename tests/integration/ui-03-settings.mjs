// Actual hidden Electron, isolated identity, synthetic host, no model requests.
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';
const baseline=process.argv.includes('--baseline'),output=process.env.WEFTMATE_UI03_OUTPUT;
assert.ok(output,'Set an external evidence directory');await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'weftmate-ui03-')),bootstrap=join(profile,'ui03-shell.mjs');
if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
await writeFile(bootstrap,`import {createRequire} from 'node:module';const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate UI03 Test');app.setAppUserModelId('com.memoweft.weftmate.test.ui03');app.disableHardwareAcceleration();await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app,page,fixture,browser,mobileFixture;const report={baseline,checks:[],performance:[],errors:[]};
const deadline=setTimeout(()=>{const child=app?.process();if(child?.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});process.exitCode=1;},220000);
const capture=async name=>{
  await page.evaluate(async()=>{for(const animation of document.getAnimations())if(Number.isFinite(animation.effect.getTiming().iterations))animation.finish();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));
};
const open=async id=>{await page.evaluate(id=>WeftSettingsNavigation.open(id),id);await page.locator(`.settings-category[data-category="${id}"]`).waitFor();};
async function launch(){
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-ui03'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));
  if(baseline)for(const path of ['settings.css','components/settings-navigation.js','components/settings-appearance.js','components/settings.js','components/cloud-settings.js','ui-core/appearance.js','ui-core/settings-registry.js','ui-core/settings.js','ui-core/connector-view.js','ui-core/connectors.css']){
    const source=execFileSync('git',['show','HEAD:src/'+(path.startsWith('ui-core/')?path:'personal-access-ui/'+path)],{encoding:'utf8',windowsHide:true});
    await page.route('**/personal/v1/ui/'+path,route=>route.fulfill({body:source,contentType:path.endsWith('.css')?'text/css':'text/javascript'}));
  }
  await feedbackUiSession(page,fixture,{native:true});await page.locator('#transcript .message.user,#transcript .main-chat-row').first().waitFor();
  await page.evaluate(()=>WeftReplyMotion.setVisibility(false));
}
try{
  fixture=await startFixture();fixture.backend.listSlashCommands=async()=>({items:[{kind:'skill',name:'document-reader',description:'阅读指定文档并核对出处。'},{kind:'command',name:'status',description:'查看当前对话状态。'}]});
  await launch();await open('general');
  assert.equal(await page.locator('.settings-navigation button').count(),21);
  if(!baseline){
    await page.getByRole('combobox',{name:'语言',exact:true}).click();await page.getByRole('searchbox',{name:'搜索语言',exact:true}).fill('简体');
    assert.equal(await page.getByRole('option',{name:'简体中文',exact:true}).getAttribute('aria-selected'),'true');await capture('language-menu');await page.keyboard.press('Escape');
    const search=page.getByRole('searchbox',{name:'搜索设置',exact:true});await search.fill('指针光标');await page.locator('.settings-category[data-category=appearance]').waitFor();await page.locator('[data-search-hit]').waitFor();await search.fill('');
    await page.getByRole('switch',{name:'使用指针光标',exact:true}).check();assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-pointer-cursor')),true);
    const size=page.getByRole('spinbutton',{name:'界面字号',exact:true});await size.fill('30');await size.blur();await page.waitForFunction(()=>WeftDesktop.getAppearance().uiFontSize==='24');
    await size.fill('13.7');await size.blur();await page.waitForFunction(()=>WeftDesktop.getAppearance().uiFontSize==='14');
    const code=page.getByRole('spinbutton',{name:'代码字号',exact:true});await code.fill('');await code.blur();assert.equal(await code.inputValue(),'12');
    const motion=page.getByRole('group',{name:'减少动态效果',exact:true});await motion.getByRole('button',{name:'开启',exact:true}).click();assert.equal(await page.evaluate(()=>WeftReplyMotion.reduced),true);
    await motion.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.evaluate(()=>WeftReplyMotion.reduced),false);
    await motion.getByRole('button',{name:'系统',exact:true}).click();
    await page.getByRole('group',{name:'差异标记',exact:true}).getByRole('button',{name:'+/−',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.diffStyle),'symbols');
    await page.evaluate(()=>{globalThis.__ui03SetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='weftmate.desktop.appearance.v1')throw new Error('synthetic storage failure');return __ui03SetItem.call(this,key,value);};});
    await page.getByRole('switch',{name:'使用指针光标',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'使用指针光标',exact:true}).isChecked(),true);
    await page.evaluate(()=>{Storage.prototype.setItem=__ui03SetItem;});report.checks.push('five appearance controls, normalization, persistence failure rollback');
    await open('models');await page.waitForFunction(()=>document.querySelector('#default-model-select').options.length>1);
    const previous=await page.locator('#default-model-select').inputValue();await page.evaluate(()=>{__feedbackSessionCore.saveDefaultModel=async()=>{throw new Error('synthetic host failure');};});
    const nextModel=await page.locator('#default-model-select').evaluate(el=>[...el.options].find(option=>option.value!==el.value).textContent);
    await page.getByRole('combobox',{name:'对话默认模型',exact:true}).click();await page.getByRole('option',{name:nextModel,exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#default-model-select').disabled);assert.equal(await page.locator('#default-model-select').inputValue(),previous);report.checks.push('host save failure restores model selection');
    await open('connectors');await page.locator('.capabilities-tabs').waitFor();await page.getByRole('tab',{name:'技能',exact:true}).click();await page.getByRole('button',{name:'document-reader',exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'搜索能力',exact:true}).fill('does-not-exist');await page.getByText('没有匹配的能力，试试其他名称或筛选条件。',{exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'搜索能力',exact:true}).fill('document');await page.getByRole('button',{name:'document-reader的更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'查看技能说明',exact:true}).click();
    await page.getByRole('dialog',{name:'document-reader',exact:true}).getByRole('button',{name:'关闭',exact:true}).last().click();
    await open('appearance');await open('connectors');assert.equal(await page.getByRole('searchbox',{name:'搜索能力',exact:true}).inputValue(),'document');report.checks.push('real DSH catalog, search, filters, menus and retained mounted browser');
    await page.getByRole('searchbox',{name:'搜索能力',exact:true}).fill('');
    await page.evaluate(()=>{
      const core=__feedbackSessionCore;globalThis.__ui03LocalDirectory=core.localDeviceDirectory;
      core.localDeviceDirectory=async()=>{const directory=await __ui03LocalDirectory();return {...directory,devices:directory.devices.map(d=>d.isCurrent?d:{...d,type:'ios'})};};
      core.readDeviceSync=async()=>({devices:core.state.device?[{deviceId:'synthetic-phone',sync:null}]:[]});
      const read=core.localDeviceDirectory;core.localDeviceDirectory=async()=>{const value=await read();value.devices=value.devices.filter(device=>device.isCurrent);value.devices.push({id:'synthetic-phone',name:'合成手机',type:'ios',isCurrent:false,lastUsedAt:new Date().toISOString()});return value;};
      core.readDeviceSync=async()=>({devices:[{deviceId:'synthetic-phone',sync:{receivedOriginals:3,lastReceivedAt:'2026-10-27T03:00:00Z',memoryState:'running',replicaPublishedAt:'2026-10-27T03:01:00Z'}}]});
    });
    await open('devices');await page.getByRole('group',{name:'合成手机',exact:true}).waitFor();const phone=page.getByRole('group',{name:'合成手机',exact:true});assert.match(await phone.innerText(),/3 条/);assert.match(await phone.innerText(),/正在整理/);assert.match(await phone.innerText(),/电脑已提供/);
    await phone.getByRole('button',{name:'合成手机的更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'修改名称',exact:true}).waitFor();await page.getByRole('menuitem',{name:'移除设备',exact:true}).waitFor();await page.keyboard.press('Escape');report.checks.push('device sync copy and adjacent rename/remove menu');
    await page.evaluate(()=>{let first=true;WeftSettingsNavigation.register({id:'ui03Retry',name:'合成重试',group:'测试',keywords:[],mount:({target})=>{if(first){first=false;throw new Error('synthetic page failure');}target.textContent='页面已恢复';}});WeftSettingsNavigation.open('ui03Retry');});
    await page.locator('.settings-load-error').getByRole('button',{name:'重试',exact:true}).click();await page.getByText('页面已恢复',{exact:true}).waitFor();report.checks.push('category load boundary and retry');
    await page.evaluate(()=>{let read=0;WeftSettingsNavigation.register({id:'ui03Late',name:'合成迟到',group:'测试',keywords:[],mount:({target})=>{if(++read===1)return new Promise((_resolve,reject)=>{globalThis.__ui03LateReject=reject;});target.textContent='新页面已就绪';}});WeftSettingsNavigation.open('ui03Late');WeftSettingsNavigation.open('ui03Late',{refresh:true});__ui03LateReject(new Error('late failure'));});
    assert.equal(await page.locator('.settings-category[data-category=ui03Late] .settings-load-error').count(),0);report.checks.push('late category failure cannot replace newer mounted content');
  }
  for(const [width,height]of [[1280,800],[900,700]])for(const theme of ['light','dark']){
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    for(const id of ['general','appearance','connectors','devices']){await open(id);await capture(`${baseline?'before':'after'}-${width}-${theme}-${id}`);assert.ok(await page.locator('#settings-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));}
  }
  const performance=await page.evaluate(async()=>{
    const longTasks=[],frames=[],shifts=[];const observers=[];
    for(const [type,list]of [['longtask',longTasks],['layout-shift',shifts]]){const observer=new PerformanceObserver(items=>list.push(...items.getEntries().map(e=>type==='longtask'?e.duration:e.value)));observer.observe({type,buffered:false});observers.push(observer);}
    let last=performance.now(),active=true;const frame=time=>{frames.push(time-last);last=time;if(active)requestAnimationFrame(frame);};requestAnimationFrame(frame);
    const costs=[],start=performance.now();for(let n=0;n<12;n++){const tick=performance.now();WeftSettingsNavigation.open(n%2?'appearance':'general');document.querySelector('#settings-dialog').getBoundingClientRect();costs.push(performance.now()-tick);await new Promise(requestAnimationFrame);}
    active=false;await new Promise(requestAnimationFrame);for(const observer of observers)observer.disconnect();
    return {switches:12,elapsed:performance.now()-start,maxSwitchWork:Math.max(...costs),medianSwitchWork:costs.sort((a,b)=>a-b)[6],longTasks:longTasks.length,maxLongTask:Math.max(0,...longTasks),maxFrame:Math.max(0,...frames.slice(1)),visibility:document.visibilityState,layoutShift:shifts.reduce((a,b)=>a+b,0)};
  });report.performance.push(performance);
  if(!baseline){const saved=await page.evaluate(()=>WeftDesktop.getAppearance());await app.close();app=null;await launch();assert.deepEqual(await page.evaluate(()=>WeftDesktop.getAppearance()),saved);report.checks.push('actual Electron restart preserves appearance');}
  if(!baseline){
    await app.close();app=null;mobileFixture=await startFixture({auth1:true});browser=await chromium.launch({channel:'chrome',headless:true});
    page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(mobileFixture.origin+'/personal/v1/ui');await feedbackUiSession(page,mobileFixture);await page.waitForFunction(()=>!!globalThis.WeftSettingsNavigation);
    for(const theme of ['light','dark'])for(const id of ['appearance','connectors','devices']){
      await page.evaluate(({theme,id})=>{WeftDesktop.setAppearance({theme});WeftSettingsNavigation.open(id);},{theme,id});await page.locator(`.settings-category[data-category=${id}]`).waitFor();
      await page.evaluate(async()=>{for(const animation of document.getAnimations())if(Number.isFinite(animation.effect.getTiming().iterations))animation.finish();await new Promise(requestAnimationFrame);});
      assert.ok(await page.locator('#settings-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.screenshot({path:join(output,`mobile-${theme}-${id}.png`)});
    }
    report.checks.push('authenticated phone web at 390 px in both themes has no horizontal overflow');
  }
  assert.deepEqual(report.errors,[]);await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){await capture('failure').catch(()=>{});await writeFile(join(output,'failure.txt'),(await page.locator('body').innerText()).slice(-6000));}throw error;}
finally{clearTimeout(deadline);await browser?.close();await app?.close();await mobileFixture?.close();await fixture?.close();await rm(profile,{recursive:true,force:true});}
