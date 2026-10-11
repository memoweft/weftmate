process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {digestAuthFixture} from '../helpers/memory-digest-auth-fixture.mjs';
import {digestMemoryFixture} from '../helpers/memory-digest-fixture.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/mem-3');await mkdir(out,{recursive:true});
const memory=digestMemoryFixture();memory.setReady(false);let now;
const authentication=await digestAuthFixture();
const fixture=await startTimelineCandidate({logicalMobile:true,inlineProgress:true,historyCount:0,memoryManager:memory.manager,clock:()=>now??Date.now(),cloudIdentity:authentication.cloudIdentity,authenticate:authentication.authenticate}).catch(async error=>{await authentication.close();throw error;});
now=Date.parse('2026-10-11T12:00:00Z');
await fixture.request('/memory/items/cognition/previous-week/correct',{requestId:'seed-correction',expectedWorldRevision:memory.revision,text:'摄影课改在周六上午上。'});
await fixture.request('/memory/items/cognition/obsolete',{requestId:'seed-forget',expectedWorldRevision:memory.revision},'DELETE');
memory.setReady(true);now=Date.parse('2026-10-11T14:00:00Z');
const profile=await mkdtemp(join(tmpdir(),'weftmate-mem3-desktop-'));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-host',REVIEW_PROFILE:profile,REVIEW_THEME:'light',REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken});
let app,browser,phone;const report={realElectron:true,syntheticHost:true,modelRequests:0,mobileSystemBars:'Browser content screenshots only; native shell excluded by package scope.',checks:[],errors:[]};
const activity=page=>page.getByRole('button',{name:/^动态(?:，|$)/}).click();
const menu=async(page,text)=>{await page.getByRole('button',{name:`记忆操作 ${text}`,exact:true}).click();};
try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'scripts/review-gallery/electron.mjs'),'--force-device-scale-factor=1'],env,timeout:90000});
  const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForURL(fixture.origin+'/personal/v1/ui',{waitUntil:'load',timeout:30000});await page.locator('#assistant-view').waitFor({state:'visible'});
  const nativeIdentity=await page.evaluate(async()=>{const response=await fetch('/personal/v1/auth/me');if(!response.ok)throw Error('Synthetic native authentication failed');return response.json();});
  assert.equal(nativeIdentity.device.authKind,'desktop');assert.equal(nativeIdentity.account.ownerId,(await fixture.request('/auth/me')).account.ownerId);assert.equal((await fixture.mobileBridge({method:'auth.me'})).device.authKind,'cloud');assert.equal(await page.locator('#login-view').isVisible(),false);report.checks.push('native-owner-direct-entry-and-verified-cloud-phone');await activity(page);
  await page.getByRole('heading',{name:'这周我记住了什么',exact:true}).waitFor();
  await page.getByRole('button',{name:'查看设备',exact:true}).first().click();await page.locator('#cloud-devices-panel').waitFor({state:'visible'});await page.keyboard.press('Escape');await activity(page);report.checks.push('desktop-activity-device-settings-action-retained');
  assert.equal((await fixture.request('/activity')).items.filter(row=>row.memoryDigest).length,1);
  const seeded=(await fixture.request('/activity')).items.find(row=>row.memoryDigest).memoryDigest;assert.equal(seeded.correctedCount,1);assert.equal(seeded.forgottenCount,1);assert.equal(seeded.corrected[0].text,'摄影课改在周六上午上。');
  for(const theme of ['light','dark'])for(const width of [1200,480]){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},theme);
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
    await page.getByRole('heading',{name:'这周我记住了什么',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));
    await page.screenshot({path:join(out,`electron-${width}-${theme}-report.png`)});
    await page.getByRole('button',{name:'还对',exact:true}).last().scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`electron-${width}-${theme}-review.png`)});await page.locator('.activity-surface').evaluate(node=>node.scrollTop=0);
    assert.ok(await page.locator('.activity-surface').evaluate(node=>node.scrollWidth<=node.clientWidth));
  }
  const original=(await fixture.request('/activity')).items.find(row=>row.memoryDigest).memoryDigest.added[0].text;
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await menu(page,original);await page.screenshot({path:join(out,`electron-${theme}-memory-menu.png`)});await page.keyboard.press('Escape');}
  await menu(page,original);await page.getByRole('menuitem',{name:'不对，改一下',exact:true}).click();
  await page.getByRole('button',{name:'保存纠正',exact:true}).waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(out,`electron-${theme}-correction-open.png`)});}
  await page.locator('#memory-correct-text').fill('我旅行时更喜欢乘火车，也会提前留出转车时间。');await page.getByRole('button',{name:'保存纠正',exact:true}).click();
  await page.getByText('我旅行时更喜欢乘火车，也会提前留出转车时间。',{exact:true}).waitFor();report.checks.push('desktop-direct-correction-and-live-report');
  const next=(await fixture.request('/activity')).items.find(row=>row.memoryDigest).memoryDigest.added[1].text;
  await menu(page,next);await page.getByRole('menuitem',{name:'忘掉',exact:true}).click();await page.getByRole('button',{name:'确认忘掉',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.getElementById('memory-confirm-action').disabled);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(out,`electron-${theme}-forget-open.png`)});}
  await page.getByRole('button',{name:'确认忘掉',exact:true}).click();await page.getByText('已忘掉',{exact:true}).waitFor();report.checks.push('desktop-direct-forget-and-live-report');
  await page.getByRole('button',{name:'还对',exact:true}).first().click();await page.getByText('已确认，90 天内不再询问',{exact:true}).waitFor();report.checks.push('review-confirmation-and-quiet-period');
  await page.getByRole('button',{name:'还有 2 条',exact:true}).click();await page.getByRole('button',{name:'正在查看这一周的记忆 · 查看全部',exact:true}).waitFor();
  assert.equal(await page.getByText('上周我报名了摄影课。',{exact:true}).count(),0);assert.equal(await page.getByText(next,{exact:true}).count(),0);report.checks.push('desktop-memory-page-week-filter');
  await page.keyboard.press('Escape');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,900));await activity(page);
  browser=await chromium.launch({channel:'msedge',headless:true});phone=await browser.newPage({viewport:{width:390,height:844}});phone.setDefaultTimeout(20000);phone.on('pageerror',error=>report.errors.push(error.message));
  await phone.goto(fixture.mobileUrl);await phone.waitForFunction(()=>state.booted&&state.loggedIn);await phone.getByRole('tab',{name:/^动态(?:，|$)/}).click();await phone.getByRole('heading',{name:'这周我记住了什么',exact:true}).waitFor();
  await phone.getByRole('button',{name:'更多操作 有一台新设备登录',exact:true}).first().click();await phone.getByRole('menuitem',{name:'查看设备',exact:true}).click();await phone.waitForFunction(()=>state.page==='devices');await phone.evaluate(()=>page('activity'));report.checks.push('phone-activity-device-settings-action-retained');
  for(const theme of ['light','dark'])for(const [width,height]of [[360,780],[390,844]]){
    await phone.setViewportSize({width,height});await phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await phone.getByRole('heading',{name:'这周我记住了什么',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));
    await phone.screenshot({path:join(out,`phone-web-${width}-${theme}-report.png`)});
    await phone.getByRole('button',{name:'还对',exact:true}).scrollIntoViewIfNeeded();await phone.screenshot({path:join(out,`phone-web-${width}-${theme}-review.png`)});await phone.locator('#generic-page').evaluate(node=>node.scrollTop=0);
    assert.ok(await phone.locator('#page-content').evaluate(node=>node.scrollWidth<=node.clientWidth));
  }
  const phoneTarget=(await fixture.request('/activity')).items.find(row=>row.memoryDigest).memoryDigest.added.find(row=>['current','corrected'].includes(row.status)).text;
  for(const theme of ['light','dark']){await phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await menu(phone,phoneTarget);await phone.screenshot({path:join(out,`phone-web-${theme}-memory-menu.png`)});await phone.keyboard.press('Escape');}
  await menu(phone,phoneTarget);await phone.getByRole('menuitem',{name:'不对，改一下',exact:true}).click();await phone.getByRole('button',{name:'保存纠正',exact:true}).waitFor();
  for(const theme of ['light','dark']){await phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await phone.screenshot({path:join(out,`phone-web-${theme}-correction-open.png`)});}
  await phone.locator('.memory-correction').fill('手机端纠正：我旅行时愿意多留半小时。');await phone.getByRole('button',{name:'保存纠正',exact:true}).click();
  await phone.waitForFunction(()=>!state.memory.activeOperation&&!state.memory.pendingMarker);
  await phone.getByRole('button',{name:'返回动态',exact:true}).click();await phone.getByText('手机端纠正：我旅行时愿意多留半小时。',{exact:true}).waitFor();report.checks.push('phone-direct-correction-and-returned-report');
  const forgetText=(await fixture.request('/activity')).items.find(row=>row.memoryDigest).memoryDigest.added.find(row=>row.status==='current'&&!row.text.startsWith('手机')).text;
  await menu(phone,forgetText);await phone.getByRole('menuitem',{name:'忘掉',exact:true}).click();await phone.getByRole('button',{name:'确认永久删除记忆',exact:true}).waitFor();
  for(const theme of ['light','dark']){await phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await phone.screenshot({path:join(out,`phone-web-${theme}-forget-open.png`)});}
  await phone.getByLabel('输入“删除”以确认',{exact:true}).fill('删除');await phone.getByRole('button',{name:'确认永久删除记忆',exact:true}).click();
  await phone.waitForFunction(()=>!state.memory.activeOperation&&!state.memory.pendingMarker);
  await phone.getByRole('button',{name:'返回动态',exact:true}).click();await phone.getByText(forgetText,{exact:true}).waitFor({state:'hidden'});report.checks.push('phone-existing-forget-confirmation');
  await phone.getByRole('button',{name:'还对',exact:true}).click();await phone.waitForFunction(()=>document.querySelectorAll('.digest-memory-copy small').length>=2&&[...document.querySelectorAll('.digest-memory-copy small')].filter(node=>node.textContent==='已确认，90 天内不再询问').length===2);report.checks.push('phone-review-confirmation');
  await phone.getByRole('button',{name:'还有 2 条',exact:true}).click();await phone.getByRole('button',{name:'正在查看这一周的记忆 · 查看全部',exact:true}).waitFor();assert.equal(await phone.getByText('上周我报名了摄影课。',{exact:true}).count(),0);report.checks.push('phone-week-filter');
  await page.keyboard.press('Control+,');await page.getByRole('button',{name:'通知',exact:true}).click();
  await page.getByRole('switch',{name:'每周生成记忆周报',exact:true}).waitFor();await page.waitForFunction(()=>!document.getElementById('notifications-memoryDigestEnabled').disabled);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.getByRole('switch',{name:'每周生成记忆周报',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`electron-${theme}-digest-settings.png`)});
    await page.getByRole('combobox',{name:'每周哪一天',exact:true}).click();await page.screenshot({path:join(out,`electron-${theme}-weekday-open.png`)});await page.keyboard.press('Escape');}
  await page.getByRole('combobox',{name:'每周哪一天',exact:true}).click();await page.getByRole('option',{name:'星期六',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('notifications-memoryDigestEnabled').disabled);
  await page.locator('#notifications-memoryDigestTime').fill('20:30');await page.locator('#notifications-memoryDigestTime').dispatchEvent('change');await page.waitForFunction(()=>!document.getElementById('notifications-memoryDigestEnabled').disabled);
  await page.getByRole('switch',{name:'每周生成记忆周报',exact:true}).uncheck();await page.waitForFunction(()=>!document.getElementById('notifications-memoryDigestEnabled').disabled);
  const settings=(await fixture.request('/settings/notifications')).settings;assert.equal(settings.memoryDigestEnabled,false);assert.equal(settings.memoryDigestWeekday,6);assert.equal(settings.memoryDigestTime,'20:30');report.checks.push('saved-weekday-time-and-disabled-setting');
  await phone.evaluate(()=>page('notifications'));await phone.getByRole('switch',{name:'每周生成记忆周报',exact:true}).waitFor();await phone.waitForFunction(()=>!document.getElementById('notifications-memoryDigestEnabled').disabled);
  for(const theme of ['light','dark']){await phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await phone.getByRole('switch',{name:'每周生成记忆周报',exact:true}).scrollIntoViewIfNeeded();await phone.screenshot({path:join(out,`phone-web-${theme}-digest-settings.png`)});
    await phone.getByRole('combobox',{name:'每周哪一天',exact:true}).click();await phone.screenshot({path:join(out,`phone-web-${theme}-weekday-open.png`)});await phone.keyboard.press('Escape');}
  const beforeRestart=(await fixture.request('/activity')).items.find(row=>row.memoryDigest);await app.close();app=null;await browser.close();browser=null;
  await fixture.restartWithCloud(authentication.cloudIdentity);const afterRestart=(await fixture.request('/activity')).items.filter(row=>row.memoryDigest);assert.equal(afterRestart.length,1);assert.equal(afterRestart[0].id,beforeRestart.id);assert.equal(afterRestart[0].memoryDigest.review[0].status,'confirmed');assert.equal((await fixture.request('/settings/notifications')).settings.memoryDigestEnabled,false);report.checks.push('durable-host-restart-report-and-settings');
  assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){if(phone){console.log(await phone.evaluate(()=>({page:state.page,memory:state.memory&&{view:state.memory.view,loading:state.memory.loading,error:state.memory.error,status:state.memory.statusState,detailError:state.memory.detailError,capabilities:state.memory.capabilities,detail:state.memory.detail,detailRevision:state.memory.detailRevision,worldRevision:state.memory.worldRevision,activeOperation:state.memory.activeOperation,pendingMarker:state.memory.pendingMarker,storedMarker:savedMemoryMarker(),confirmation:state.memory.confirmation}})));await phone.screenshot({path:join(out,'phone-debug.png')});}throw error;}
finally{await app?.close();await browser?.close();await fixture.close();await authentication.close();await rm(profile,{recursive:true,force:true});await rm(fixture.root,{recursive:true,force:true});}
