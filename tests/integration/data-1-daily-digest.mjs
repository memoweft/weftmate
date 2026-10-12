process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {captureDailyDigestPhone} from '../helpers/daily-digest-phone.mjs';
import {digestAuthFixture} from '../helpers/memory-digest-auth-fixture.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/data-1');await mkdir(out,{recursive:true});
const authentication=await digestAuthFixture();let now=Date.now(),modelCalls=0;
const fixture=await startTimelineCandidate({digest:true,daily:true,logicalMobile:true,inlineProgress:true,historyCount:0,s3a:true,clock:()=>now,cloudIdentity:authentication.cloudIdentity,authenticate:authentication.authenticate,
  digestModel:async input=>{if(input.priority!=='background')return new Response(JSON.stringify({choices:[{message:{content:'{"suggestions":[]}'}}]}));modelCalls++;assert.equal(input.priority,'background');assert.ok(!JSON.stringify(input).includes('PRIVATE-SYNTHETIC-BODY'));throw Error('Synthetic background model unavailable');}});
const profile=await mkdtemp(join(tmpdir(),'weftmate-data1-desktop-')),health={version:1,status:'available',steps:6500,sleepMinutes:450,restingHeartRateBpm:63,exerciseMinutes:30,workouts:[{type:'步行',minutes:30}]};
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-host',REVIEW_PROFILE:profile,REVIEW_THEME:'light',REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken});
let app,browser,phone;const report={realElectron:true,syntheticHost:true,realModelRequests:0,mimoRequests:0,syntheticWeeklyRequests:0,checks:[],screenshots:[],mobileSystemBars:'Windows Chromium phone web viewports; native OS status/navigation bars are not present and are not claimed as verified.',errors:[]};
const themes=async(page,theme)=>page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},theme);
const shot=async(page,name)=>{await page.screenshot({path:join(out,name)});report.screenshots.push(name);};
const activity=page=>page.getByRole('button',{name:/^动态(?:，|$)/}).click();
async function exercise(){try{
  fixture.progress.finish('completed');
  // Real accepted commands and verified native file receipts across ten synthetic local days.
  const topics=['季度报告','整理项目资料','周末旅行安排','季度报告','项目测试','季度报告','整理项目资料','旅行清单','项目测试','季度报告'];
  for(let n=0;n<10;n++){
    now=Date.parse(`2026-10-${String(n+1).padStart(2,'0')}T17:30:00Z`);
    const source=await fixture.newOutputSource(topics[n]);
    const file=join(fixture.root,`合成-${topics[n]}-${n+1}.md`);await writeFile(file,`# ${topics[n]}\nPRIVATE-SYNTHETIC-BODY\n`);await fixture.registerOutput(file,source);
    fixture.finishOutputSource(source);fixture.deliverReminder(n%2?'检查项目进度':'提交季度报告');
    const scope=await fixture.digestService().beginUsage({sessionId:source.sessionId,profileId:'local'});now+=60000;await fixture.digestService().finishUsage({...scope,usage:{prompt_tokens:1200,completion_tokens:300}});
    await fixture.request('/sessions');await fixture.request('/activity');
  }
  now=Date.now();let days=(await fixture.request('/daily-summaries')).items;
  assert.ok(days.length>=10);assert.equal(days.filter(row=>row.day>='2026-10-02'&&row.day<='2026-10-11').length,10);
  assert.ok(days.some(row=>row.outputs.count));assert.ok(days.some(row=>row.tasks.completed));assert.ok(days.some(row=>row.schedule.count));assert.ok(days.some(row=>Object.keys(row.usage.models).length));
  assert.ok(!JSON.stringify(days).includes('PRIVATE-SYNTHETIC-BODY'));report.checks.push('ten-days-conversations-tasks-verified-outputs-reminders-usage-no-bodies');
  const stored=JSON.stringify(days);await fixture.request('/daily-summaries');assert.equal(JSON.stringify((await fixture.request('/daily-summaries')).items),stored);report.checks.push('daily-generation-idempotence');
  await fixture.request('/daily-summaries/2026-10-11/health',health,'PUT');assert.deepEqual((await fixture.request('/daily-summaries')).items.find(row=>row.day==='2026-10-11').health,health);report.checks.push('health-summary-write-receipt');
  await new Promise(resolve=>setTimeout(resolve,50));const insight=(await fixture.request('/activity')).items.find(row=>row.weeklyInsight);assert.ok(insight);assert.equal(insight.weeklyInsight.mode,'statistics');report.checks.push('background-unavailable-statistical-weekly-fallback');
  if(process.env.WEFTMATE_DATA1_PHONE_ONLY==='1'){report.realElectron=false;await captureDailyDigestPhone(fixture,out,report);report.completed=true;await writeFile(join(out,'phone-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));return;}
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'scripts/review-gallery/electron.mjs'),'--force-device-scale-factor=1'],env,timeout:90000});
  const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>report.errors.push(error.message));await page.waitForURL(fixture.origin+'/personal/v1/ui',{waitUntil:'load'});await page.locator('#assistant-view').waitFor({state:'visible'});
  assert.equal(await page.locator('#login-view').isVisible(),false);assert.equal((await page.evaluate(async()=>fetch('/personal/v1/auth/me').then(r=>r.json()))).device.authKind,'desktop');report.checks.push('native-owner-direct-entry');
  await activity(page);await page.getByRole('heading',{name:'这周回顾',exact:true}).waitFor();
  for(const theme of ['light','dark'])for(const width of [1200,480]){await themes(page,theme);await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);await page.getByRole('heading',{name:'这周回顾',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));await shot(page,`electron-${width}-${theme}-weekly.png`);assert.ok(await page.locator('.activity-surface').evaluate(node=>node.scrollWidth<=node.clientWidth));}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,900));
  await page.locator('.weekly-insight-sources button').first().click();await page.locator('#transcript').waitFor({state:'visible'});report.checks.push('desktop-weekly-source-jump');
  // Synthetic model consumes the same owner/receipt-checked background API as production IPC.
  const question='我这周都在忙什么',main=(await fixture.request('/chats/main')).chat,host=(await fixture.request('/status')).hostId;
  let source=(await fixture.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:main.chatId,targetDeviceId:host,modelProfileId:'local',text:question})).command;
  while(source.state!=='accepted_by_dsh'){await new Promise(resolve=>setTimeout(resolve,20));source=(await fixture.request(`/commands/${source.commandId}`)).command;assert.notEqual(source.state,'rejected');}await fixture.request('/sessions');
  const modelInput=await fixture.digestContext({sessionId:source.sessionId,turn:1,step:1,receiptId:source.receiptId,messageHash:createHash('sha256').update(question).digest('hex')});
  assert.match(modelInput.recentContextText,/季度报告/);assert.ok(modelInput.recentContextText.length<=3600);assert.ok(!modelInput.recentContextText.includes('PRIVATE-SYNTHETIC-BODY'));
  const link=/#weftmate:session:[A-Za-z0-9_-]+/.exec(modelInput.recentContextText)[0];fixture.progress.text(`从最近七天的摘要看，你主要在做季度报告、整理项目资料和准备旅行；报告已经有成果。可以回到[季度报告的对话](${link})继续。`);fixture.progress.finish('completed');
  await page.getByRole('button',{name:/^WeftMate/}).click();await page.getByText(/从最近七天的摘要看/).waitFor();await shot(page,'electron-answer-from-digests.png');await page.getByRole('link',{name:'季度报告的对话',exact:true}).click();await page.waitForFunction(id=>!!document.querySelector(`[data-session-id="${id}"] button.is-current`),link.slice('#weftmate:session:'.length));report.checks.push('main-assistant-synthetic-model-background-answer-and-clickable-source');
  browser=await chromium.launch({channel:'msedge',headless:true});phone=await browser.newPage({viewport:{width:390,height:844}});phone.setDefaultTimeout(20000);phone.on('pageerror',error=>report.errors.push(error.message));await phone.goto(fixture.mobileUrl);await phone.waitForFunction(()=>state.booted&&state.loggedIn);await phone.getByRole('tab',{name:/^动态(?:，|$)/}).click();await phone.getByRole('heading',{name:'这周回顾',exact:true}).waitFor();
  for(const theme of ['light','dark'])for(const [width,height]of [[360,780],[390,844]]){await phone.setViewportSize({width,height});await themes(phone,theme);await phone.getByRole('heading',{name:'这周回顾',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));await shot(phone,`phone-web-${width}-${theme}-weekly.png`);assert.ok(await phone.locator('#page-content').evaluate(node=>node.scrollWidth<=node.clientWidth));}
  await phone.locator('.weekly-insight-sources button').first().click();await phone.waitForFunction(()=>state.page==='chat');report.checks.push('cloud-phone-weekly-visible-and-source-jump');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,900));await page.keyboard.press('Control+,');await page.getByRole('button',{name:'通知',exact:true}).click();await page.getByRole('switch',{name:'回顾与洞察',exact:true}).waitFor();await page.waitForFunction(()=>!document.getElementById('notifications-reviewEnabled').disabled);
  for(const theme of ['light','dark']){await themes(page,theme);await page.getByRole('switch',{name:'回顾与洞察',exact:true}).scrollIntoViewIfNeeded();await shot(page,`electron-${theme}-settings.png`);await page.getByRole('combobox',{name:'保留多久',exact:true}).click();await shot(page,`electron-${theme}-retention-open.png`);await page.keyboard.press('Escape');await page.getByRole('button',{name:'清空回顾',exact:true}).click();await shot(page,`electron-${theme}-clear-confirm.png`);await page.getByRole('button',{name:'取消',exact:true}).click();}
  await phone.evaluate(()=>page('notifications'));await phone.getByRole('switch',{name:'回顾与洞察',exact:true}).waitFor();await phone.waitForFunction(()=>!document.getElementById('notifications-reviewEnabled').disabled);
  for(const theme of ['light','dark']){await themes(phone,theme);await phone.getByRole('switch',{name:'回顾与洞察',exact:true}).scrollIntoViewIfNeeded();await shot(phone,`phone-web-${theme}-settings.png`);await phone.getByRole('combobox',{name:'保留多久',exact:true}).click();await shot(phone,`phone-web-${theme}-retention-open.png`);await phone.keyboard.press('Escape');await phone.getByRole('button',{name:'清空回顾',exact:true}).click();await shot(phone,`phone-web-${theme}-clear-confirm.png`);await phone.getByRole('button',{name:'取消',exact:true}).click();}
  await phone.getByRole('switch',{name:'回顾与洞察',exact:true}).uncheck();await phone.waitForFunction(()=>!document.getElementById('notifications-reviewEnabled').disabled);assert.equal((await fixture.digestContext({sessionId:source.sessionId,turn:1,step:1,receiptId:source.receiptId,messageHash:createHash('sha256').update(question).digest('hex')})).recentContextText,'');await phone.getByRole('switch',{name:'回顾与洞察',exact:true}).check();await phone.waitForFunction(()=>!document.getElementById('notifications-reviewEnabled').disabled);report.checks.push('phone-setting-default-enabled-off-stops-background');
  await app.close();app=null;await browser.close();browser=null;
  if(process.env.WEFTMATE_DATA1_SYSTEM_BARS==='1')await captureDailyDigestPhone(fixture,out,report);
  await fixture.restartWithCloud(authentication.cloudIdentity);const after=(await fixture.request('/daily-summaries')).items;assert.equal(after.length,days.length);assert.equal((await fixture.request('/activity')).items.filter(row=>row.weeklyInsight).length,1);report.checks.push('host-restart-no-duplicate-days-or-weekly-inference');
  await fixture.request('/settings/notifications',{reviewClear:true},'PATCH');assert.equal((await fixture.request('/daily-summaries')).items.length,0);assert.equal((await fixture.request('/activity')).items.filter(row=>row.weeklyInsight).length,0);assert.equal((await fixture.digestContext({sessionId:source.sessionId,turn:1,step:1,receiptId:source.receiptId,messageHash:createHash('sha256').update(question).digest('hex')})).recentContextText,'');report.checks.push('clear-removes-days-insights-and-following-context');
  report.syntheticWeeklyRequests=modelCalls;assert.equal(modelCalls,1);assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(error.stack);await writeFile(join(out,'verification.json'),JSON.stringify({...report,completed:false,syntheticWeeklyRequests:modelCalls,failure:error.message},null,2)+'\n');if(app){const page=await app.firstWindow();await shot(page,'failure-electron.png');}if(phone&&!phone.isClosed())await shot(phone,'failure-phone.png');throw error;}
finally{await app?.close();await browser?.close();await fixture.close();await authentication.close();await rm(profile,{recursive:true,force:true});await rm(fixture.root,{recursive:true,force:true});}

}
await exercise();
