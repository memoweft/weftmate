import assert from 'node:assert/strict';
import { _electron,chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/tb-1');await mkdir(out,{recursive:true});
let erasedEvidence=0;
const memoryManager={enabled:true,peek:()=> 'ready',status:async()=>({state:'ready',capabilities:{deleteEvidence:true}}),
  query:async(_owner,operation)=>operation==='query_jobs'?{jobs:[]}:operation==='preview_forget'?{world_revision:1,evidence_ids:['synthetic-tb1-evidence']}:{world_revision:1},
  submitCommand:async()=>{erasedEvidence++;return {result_state:'applied',after_revision:2,storage_cleanup:{state:'complete'}};},
  receiptByRequest:async()=>{throw Object.assign(new Error('command_receipt_not_found'),{code:'command_receipt_not_found'});},
  retryCleanupByRequest:async()=>({result_state:'applied',storage_cleanup:{state:'complete'}}),
  eraseConversationContext:async()=>({result_state:'applied',storage_cleanup:{state:'complete'},erased_evidence_count:0})};
const fixture=await startTimelineCandidate({interactive:true,historyCount:0,memoryManager});
const profile=await mkdtemp(join(tmpdir(),'weftmate-tb-1-desktop-'));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_THEME:'light',REVIEW_ORIGIN:fixture.origin});
let app,browser,mobileFixture;const report={realElectron:true,checks:[],errors:[]};
const wait=async check=>{const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('TB-1 condition timeout');};
try{
  await fixture.recordActivity({key:'paused',type:'memory.paused',title:'记忆已暂停',summary:'记忆暂时无法更新，可在记忆页查看状态。',level:'normal',actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
  fixture.progress.notice({kind:'plugin',plugin:'weftmate-reminder'},'提醒：核对合成周末计划');
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'scripts/review-gallery/electron.mjs'),'--force-device-scale-factor=1'],env,timeout:90000});
  const page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
  await app.evaluate(({app})=>{globalThis.tb1Notices=[];app.on('weftmate-desktop-notification',event=>globalThis.tb1Notices.push(event));});
  await localUiSession(page,fixture.credentials,'TB-1 synthetic',{mainChat:true});
  const activity=()=>page.getByRole('button',{name:/^动态(?:，|$)/}).click();
  await activity();await page.getByRole('heading',{name:'动态',exact:true}).waitFor();
  await page.getByText('记忆已暂停',{exact:true}).waitFor();await page.getByText('需要回答',{exact:true}).waitFor();await page.getByText('提醒：核对合成周末计划',{exact:true}).waitFor();
  await page.screenshot({path:join(out,'desktop-light.png')});report.checks.push('reminder','pending-question','memory-paused');
  const approval=(await fixture.request('/activity')).items.find(row=>row.type==='approval.pending');
  await page.getByRole('button',{name:'批准',exact:true}).click();
  await wait(async()=> (await fixture.request('/activity')).items.find(row=>row.id===approval.id).state==='completed');
  assert.equal((await fixture.request(`/sessions/${fixture.sessionId}/approvals`)).approvals.find(row=>row.approvalId===approval.actions[0].target.approvalId).decisionOutcome,'allowed-once');
  const answered=(await fixture.request(`/sessions/${fixture.sessionId}/approvals`)).approvals.find(row=>row.approvalId===approval.actions[0].target.approvalId);
  const replay=await fixture.request(`/sessions/${fixture.sessionId}/approvals/${answered.approvalId}`,{requestId:answered.decisionRequestId,outcome:'allowed-once'});
  assert.equal(replay.requestId,answered.decisionRequestId);assert.equal((await fixture.request('/activity')).items.filter(row=>row.id===approval.id).length,1);report.checks.push('native-approval-one-receipt');
  await page.getByRole('button',{name:'回答',exact:true}).click();
  await page.getByRole('region',{name:'待回答问题'}).getByRole('radio',{name:'简要报告',exact:true}).click();
  await page.getByRole('region',{name:'待回答问题'}).getByRole('button',{name:/提交|回答/}).click();
  await page.getByRole('region',{name:'待回答问题'}).waitFor({state:'hidden'});await activity();report.checks.push('answer-opens-original-question-and-receipt');
  await page.getByRole('button',{name:'全部已读',exact:true}).click();await wait(async()=> (await fixture.request('/activity/unread')).unreadCount===0);report.checks.push('unread-to-zero');
  await fixture.complete(true);await page.getByRole('button',{name:'全部',exact:true}).click();await page.getByText('任务完成',{exact:true}).first().waitFor();report.checks.push('side-task-completed');
  await page.evaluate(()=>{localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme:'dark',accent:'neutral',fontSize:'15'}));});await page.reload();await activity();await page.screenshot({path:join(out,'desktop-dark.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,600));await page.screenshot({path:join(out,'desktop-narrow.png')});
  assert.ok(await page.locator('.activity-surface').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.getByRole('button',{name:'记忆',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('记忆已暂停',{exact:true}).waitFor();report.checks.push('keyboard-filter','narrow-no-overflow');
  const rows=(await fixture.request('/activity')).items.map(row=>row.id);await app.close();app=null;
  env.REVIEW_ORIGIN=await fixture.restartWithCloud(null);
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'scripts/review-gallery/electron.mjs')],env,timeout:90000});
  const restarted=await app.firstWindow();await localUiSession(restarted,fixture.credentials,'TB-1 restart',{mainChat:true});await restarted.getByRole('button',{name:/^动态(?:，|$)/}).click();
  const retained=(await fixture.request('/activity')).items.map(row=>row.id);assert.deepEqual(retained,rows);report.checks.push('restart-stable-identities');
  await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{memoryMode:'off'},'PATCH');fixture.progress.text('TB1-TEMPORARY-SECRET-42');fixture.progress.finish();
  await restarted.getByRole('button',{name:'全部',exact:true}).click();await restarted.getByText('临时对话中的任务已完成',{exact:true}).waitFor();
  assert.equal((await restarted.locator('.activity-surface').textContent()).includes('TB1-TEMPORARY-SECRET-42'),false);
  const store=JSON.parse(await readFile(join(fixture.root,'store.json'),'utf8'));assert.equal(JSON.stringify(Object.values(store.accounts).map(row=>row.activity)).includes('TB1-TEMPORARY-SECRET-42'),false);
  await restarted.screenshot({path:join(out,'desktop-temporary.png')});report.checks.push('temporary-window-and-persisted-feed-redacted');
  browser=await chromium.launch({channel:'msedge',headless:true});const phone=await browser.newPage({viewport:{width:390,height:844}});
  await phone.goto(fixture.mobileUrl);await phone.getByRole('button',{name:'打开导航',exact:true}).click();
  await phone.getByRole('button',{name:'动态',exact:true}).click();await phone.getByRole('heading',{name:'动态',exact:true}).waitFor();await phone.getByText('记忆已暂停',{exact:true}).waitFor();
  assert.ok(await phone.locator('#page-content').evaluate(el=>el.scrollWidth<=el.clientWidth));await phone.screenshot({path:join(out,'mobile-light.png')});
  await phone.evaluate(()=>document.documentElement.dataset.theme='dark');await phone.screenshot({path:join(out,'mobile-dark.png')});report.checks.push('mobile-390x844');
  mobileFixture=await startTimelineCandidate({interactive:true,historyCount:0});
  const decisions=await browser.newPage({viewport:{width:390,height:844}});decisions.setDefaultTimeout(15000);
  await decisions.goto(mobileFixture.mobileUrl);await decisions.waitForFunction(()=>state.booted&&state.loggedIn);await decisions.getByRole('button',{name:'打开导航',exact:true}).click();await decisions.getByRole('button',{name:'动态',exact:true}).click();
  await decisions.getByRole('button',{name:'批准',exact:true}).click();
  await wait(async()=>!(await mobileFixture.request('/activity?filter=actionable')).items.some(row=>row.type==='approval.pending'));
  await decisions.getByRole('heading',{name:'动态',exact:true}).waitFor();report.checks.push('mobile-direct-approval-native-receipt');
  await decisions.getByRole('button',{name:'回答',exact:true}).click();
  await decisions.getByRole('region',{name:'待回答问题'}).getByRole('radio',{name:'简要报告',exact:true}).click();
  await decisions.getByRole('region',{name:'待回答问题'}).getByRole('button',{name:/提交|回答/}).click();
  await wait(async()=>!(await mobileFixture.request('/activity?filter=actionable')).items.some(row=>row.type==='question.pending'));report.checks.push('mobile-original-question-receipt');
  await mobileFixture.close();mobileFixture=null;
  await fixture.request(`/sessions/${fixture.sessionId}`,{forgetMemories:true,deleteConversationSnippets:true,memoryWorldRevision:1},'DELETE');assert.equal(erasedEvidence,1);
  assert.equal((await fixture.request('/activity')).items.some(row=>row.source.sessionId===fixture.sessionId),false);
  await restarted.getByRole('button',{name:'全部',exact:true}).click();assert.equal(await restarted.getByText('临时对话中的任务已完成',{exact:true}).count(),0);report.checks.push('forget-evidence-and-source-cleanup-in-electron');
  assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({message:error.message,report},null,2));throw error;}
finally{await app?.close();await browser?.close();await mobileFixture?.close();await fixture.close();await rm(profile,{recursive:true,force:true});}
