// Production Electron shell, isolated account/host. No external models or user data.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile,rm,open,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';
import {nativeFixtureFetchOptions} from '../helpers/local-ui-session.mjs';
import {measureUi} from '../helpers/ui-smoothness.mjs';
const output=process.env.WEFTMATE_UI08_OUTPUT;assert.ok(output,'Set an external evidence directory');
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'weftmate-ui08-')),bootstrap=join(profile,'ui08-shell.mjs');
if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
await writeFile(bootstrap,`import {createRequire} from 'node:module';const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate UI08 Test');app.setAppUserModelId('com.memoweft.weftmate.test.ui08');app.disableHardwareAcceleration();await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app,page,fixture,lock,mimo;
const report={checks:[],performance:[],errors:[],boundaryFixtures:['offline provenance on a real queued task','device cleanup summary','memory list/detail/source payloads'],screenshots:[]};
const watchdog=setTimeout(()=>{const child=app?.process();if(child?.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});process.exitCode=1;},280000);
const capture=async name=>{
  await page.evaluate(async()=>{for(const animation of document.getAnimations())if(Number.isFinite(animation.effect.getTiming().iterations))animation.finish();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));report.screenshots.push(name+'.png');
};
const show=async name=>{
  if(name==='memory')await page.evaluate(()=>__feedbackSessionCore.openMemory());
  else if(['data','connectors','devices','schedules','backups','system','about'].includes(name))await page.evaluate(name=>__ui08.openSettings(name),name);
  else await page.evaluate(name=>__ui08[{activity:'openActivity',goals:'openGoals',health:'openHealth',library:'openLibrary',help:'openHelp'}[name]](),name);
};
try{
  if(process.env.WEFTMATE_HEAVY_LOCK_DIR){for(const n of [1,2,3]){const path=join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);try{const file=await open(path,'wx');await file.writeFile('UI-08-OWN-FEATURES '+new Date().toISOString());await file.close();lock=path;break;}catch(error){if(error.code!=='EEXIST')throw error;}}assert.ok(lock,'No heavy slot available');}
  fixture=await startFixture();let stopCalls=0;
  fixture.backend.sendMessage=async()=>({accepted:true,receiptId:'ui08-queue-receipt'});
  fixture.backend.stopTask=async({receiptIds})=>{stopCalls++;return {outcomes:receiptIds.map(receiptId=>({receiptId,status:'queue_removed'}))};};
  fixture.backend.schedules=async()=>({items:[]});fixture.backend.goals=async()=>({goal:null});
  fixture.backend.listSlashCommands=async()=>({items:[{kind:'skill',name:'document-reader',description:'阅读指定文档并核对出处。'}],tools:[{name:'read_file',description:'读取工作目录中的文件。'}]});
  const queued=(await fixture.request('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:fixture.hostId,sessionId:fixture.source,text:'整理手机上的合成清单',mode:'queue'})).command;
  // Wait for the real host to record the queued command before projecting its provenance.
  for(let n=0;n<100;n++){const row=(await fixture.request('/commands/'+queued.commandId)).command;if(row.state==='accepted_by_dsh')break;await new Promise(done=>setTimeout(done,30));}
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-ui08'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(new URL('../../src/personal-access-ui/app.js',import.meta.url),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.__ui08=ui;ui.loadAttachmentHasher =')}));
  await page.route(/\/personal\/v1\/commands\?/,async route=>{const response=await route.fetch(nativeFixtureFetchOptions(route,fixture)),payload=await response.json();for(const row of payload.commands??[])if(row.commandId===queued.commandId)row.offlineSource={id:'ui08-phone-task',submittedAt:row.createdAt,receivedAt:row.createdAt};await route.fulfill({response,json:payload});});
  let acknowledged=false,deviceFailure=false;
  await page.route('**/personal/v1/devices/sync',route=>route.fulfill({status:deviceFailure?503:200,json:deviceFailure?{error:{code:'UNAVAILABLE'}}:{devices:[{deviceId:'synthetic-phone',sync:{receivedOriginals:3,lastReceivedAt:'2026-10-27T03:00:00Z',memoryState:'completed',replicaPublishedAt:'2026-10-27T03:01:00Z',cleanup:{state:acknowledged?'acknowledged':'waiting_device',requestedAt:'2026-10-27T04:00:00Z'}}}]}}));
  const memoryItem={id:'ui08-memory',kind:'cognition',text:'周末喜欢留出一段空闲时间。',currentState:'current',sourceCount:1};
  await page.route('**/personal/v1/memory/status',route=>route.fulfill({json:{ownerId:fixture.auth.account.ownerId,state:'ready',capabilities:{list:true,source:true,correct:true,mute:true,deleteWorldItem:true}}}));
  await page.route(/\/personal\/v1\/memory\/items\?/,route=>{const query=new URL(route.request().url()).searchParams.get('query');return route.fulfill({json:{ownerId:fixture.auth.account.ownerId,items:!query||memoryItem.text.includes(query)?[memoryItem]:[],worldRevision:1,searchScope:'account_snapshot',hasMore:false,nextCursor:null}});});
  await page.route('**/personal/v1/memory/items/cognition/ui08-memory',route=>route.fulfill({json:{ownerId:fixture.auth.account.ownerId,item:memoryItem,worldRevision:1,availableActions:{correct:true,mute:true,deleteWorldItem:true}}}));
  await page.route('**/personal/v1/memory/items/cognition/ui08-memory/sources',route=>route.fulfill({json:{ownerId:fixture.auth.account.ownerId,worldRevision:1,sources:[{evidenceId:'ui08-evidence',summary:'周末希望安排得宽松一些。',rawContent:'这个周末想给自己留一段空闲时间。',contentAvailable:true,currentnessState:'current'}]}}));
  await feedbackUiSession(page,fixture,{native:true});
  await page.locator('#transcript .message.user,#transcript .main-chat-row').first().waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await page.unroute('**/personal/v1/status');
  await page.evaluate(async()=>{const c=__feedbackSessionCore;await c.enterAssistant();__ui08.renderGoals();WeftReplyMotion.setVisibility(false);});
  await show('goals');const task=page.getByRole('article',{name:'整理手机上的合成清单',exact:true});await task.waitFor();assert.match(await task.innerText(),/手机离线交代/);
  await task.getByRole('button',{name:'展开进展 整理手机上的合成清单',exact:true}).click();await task.getByText('电脑已收到',{exact:false}).waitFor();
  report.performance.push(await measureUi(page,'task-collapse',()=>task.getByRole('button',{name:'展开进展 整理手机上的合成清单',exact:true}).click(),{}));
  await capture('offline-task-before-cancel');
  // This fixture lacks native queue evidence, so the honest state is
  // unconfirmed and the existing stop control must remain available.
  await task.getByRole('button',{name:'停止',exact:true}).click();await page.waitForFunction(()=>__feedbackSessionCore.goalsPage.recent.some(row=>row.status==='stopped'));
  assert.equal(stopCalls,1);report.checks.push('phone provenance, task detail, actual host stop endpoint and queue_removed receipt');
  await page.getByRole('tab',{name:'提醒与定时任务',exact:true}).click();await page.getByRole('button',{name:'新建定时任务',exact:true}).click();await page.getByRole('form',{name:'新建定时任务',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('tab',{name:'长期目标',exact:true}).click();await page.getByRole('button',{name:'新建长期目标',exact:true}).click();await page.getByRole('form',{name:'新建长期目标',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索目标与安排'}).fill('不存在的安排');await page.getByText('没有匹配的内容，试试其他关键词。',{exact:true}).last().waitFor();await page.getByRole('searchbox',{name:'搜索目标与安排'}).fill('');
  await page.getByRole('tab',{name:'长期目标',exact:true}).focus();await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'进行中',exact:true}).getAttribute('aria-selected'),'true');
  report.checks.push('goal and reminder editors reach existing business; search and keyboard tabs');
  await show('memory');await page.locator('.memory-device-cleanup').getByText('等待设备回执',{exact:true}).waitFor();
  assert.equal(await page.locator('#settings-dialog').evaluate(el=>el.open),false,'memory has its own workspace, outside technical settings');
  assert.equal(await page.locator('#rail-memory').isVisible(),true,'memory stays a fixed navigation entry');
  await page.locator('.memory-item-button').first().click();await page.locator('#memory-detail-dialog').getByText('这个周末想给自己留一段空闲时间。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭记忆详情',exact:true}).click();
  await page.locator('#memory-query').fill('没有匹配');await page.locator('#memory-search-form').evaluate(el=>el.requestSubmit());await page.getByText('这一类记忆中没有匹配的内容。',{exact:true}).waitFor();
  await page.locator('#memory-query').fill('');await page.locator('#memory-search-form').evaluate(el=>el.requestSubmit());await page.locator('.memory-item-button').first().waitFor();
  report.checks.push('fixed memory workspace, list/search/detail/raw sources through existing memory client');
  deviceFailure=true;await page.getByRole('button',{name:'检查状态',exact:true}).click();await page.getByText('设备清理状态暂时无法读取',{exact:true}).waitFor();
  deviceFailure=false;acknowledged=true;await page.getByRole('button',{name:'检查状态',exact:true}).click();await page.getByText('设备已确认清理',{exact:true}).waitFor();acknowledged=false;
  await page.getByRole('button',{name:'检查状态',exact:true}).click();report.checks.push('memory cleanup waiting, read failure and retry, acknowledged state');
  const settings=()=>page.getByRole('dialog',{name:'设置',exact:true});
  for(const [width,height]of [[1280,800],[900,700]])for(const theme of ['light','dark']){
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    for(const name of ['memory','activity','goals','health','library','help','data','connectors','devices']){
      if(await settings().isVisible())await page.keyboard.press('Escape');
      await show(name);
      if(name==='goals'){await page.getByRole('tab',{name:'提醒与定时任务',exact:true}).click();}
      if(name==='connectors')await page.getByRole('tab',{name:'技能',exact:true}).click();
      await capture(`${width}-${theme}-${name}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} page overflow`);
    }
    await page.keyboard.press('Escape');
    await page.evaluate(async sessionId=>{const core=__feedbackSessionCore;await core.selectSession(sessionId);core.state.projects=[{projectId:'synthetic-project',name:'合成资料',hostId:core.state.hostId,permission:'read-only'}];const target=document.createElement('div');target.id='ui08-switch';document.querySelector('#message-form').before(target);__ui08.renderWorkSwitch(core.approvalContext(),{approvalId:'synthetic-switch',taskId:'synthetic-task'},target);},fixture.source);
    await page.locator('#ui08-switch').scrollIntoViewIfNeeded();await capture(`${width}-${theme}-work-switch`);await page.locator('#ui08-switch').evaluate(el=>el.remove());
  }
  if(await settings().isVisible())await page.keyboard.press('Escape');
  report.performance.push(await measureUi(page,'open-goals',()=>page.locator('.goals-entry').click(),{}));
  report.performance.push(await measureUi(page,'switch-goal-tab',()=>page.getByRole('tab',{name:'长期目标',exact:true}).click(),{}));
  report.performance.push(await measureUi(page,'open-health',()=>page.locator('.health-entry').click(),{}));
  // Independent profile only. If the vendor's singleton or login blocks it,
  // retain the supplied private references and report that timing is unmeasured.
  try{
    mimo=await _electron.launch({executablePath:'D:\\Software\\Xiaomi MiMo\\Xiaomi MiMo.exe',args:[`--user-data-dir=${join(output,'mimo-profile')}`],env,timeout:12000});
    const reference=await mimo.firstWindow({timeout:12000});
    await reference.waitForFunction(()=>document.body?.innerText?.trim().length>30,{},{timeout:15000});
    await reference.screenshot({path:join(output,'mimo-isolated.png')});
    const preparing=await reference.getByText('正在准备 MiMo',{exact:true}).count()>0;
    report.mimo={status:preparing?'independent startup remained at resource preparation':'isolated content opened',loginRequired:await reference.getByText(/登录|Sign in/i).count()>0,performance:'unmeasured; supplied private screenshots used'};
  }catch{report.mimo={status:'independent launch did not provide a usable content window',performance:'unmeasured; supplied private screenshots used'};}
  assert.deepEqual(report.errors,[]);report.checks.push('all own-feature pages at 1280x800 / 900x700 in light / dark');
  console.log(JSON.stringify(report));
}catch(error){if(page){await capture('failure').catch(()=>{});await writeFile(join(output,'failure.txt'),(await page.locator('body').innerText()).slice(-7000));}throw error;}
finally{clearTimeout(watchdog);await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));await mimo?.close();await app?.close();await fixture?.close();await rm(profile,{recursive:true,force:true});if(lock)await unlink(lock);}
