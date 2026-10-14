// Real desktop shell and mobile web, sharing an isolated completed goal.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startTimelineCandidate } from './bl29-rework/fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const repo=resolve(import.meta.dirname,'../..');
const out=resolve(process.env.WEFTMATE_FIX43_EVIDENCE_DIR || join(repo,'tests/evidence/fix-43'));
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(out,'electron-profile-'));
const fixture=await startTimelineCandidate({goals:true,logicalMobile:true,inlineProgress:true,historyCount:0});
const desktopToken=fixture.debug.service.libraryDesktopToken;
const report={realElectron:true,syntheticGoal:true,checks:[],errors:[]};
let app,browser;
try {
  const created=await fixture.request('/goals',{requestId:'fix43-ui-create',sessionId:fixture.sessionId,title:'整理周报'});
  await fixture.request(`/goals/${fixture.sessionId}/complete`,{requestId:'fix43-ui-complete',ref:created.ref});
  const receipt='goal revision 2, phase: complete, disarmed';
  fixture.progress.call('update_goal','fix43-ui-goal',{id:created.ref.id,revision:1,phase:'complete'});
  fixture.progress.result('fix43-ui-goal',receipt);
  fixture.progress.text(`目标「整理周报」已完成（${receipt}）。\n\n**核对了 3 份资料**，保存了 \`C:/Temp/weekly/report.md\` 和 [清单](file:///C:/Temp/weekly/checklist.txt)。`);
  fixture.progress.finish();
  const snapshot=await fixture.request('/activity?type=task');
  const item=snapshot.items.find(row=>row.type==='task.completed');
  assert.ok(item);assert.equal((await fixture.request('/goals')).items[0].phase,'complete');
  await fixture.request('/onboarding',{step:'first',completed:true},'PATCH');
  await writeFile(join(out,'activity-snapshot.json'),JSON.stringify({title:item.title,summary:item.summary,type:item.type,actions:item.actions.map(action=>action.kind)},null,2)+'\n');
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-host',REVIEW_PROFILE:profile,REVIEW_THEME:'light',REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:desktopToken});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'scripts/review-gallery/electron.mjs'),'--force-device-scale-factor=1'],env,timeout:90000});
  const desktop=await app.firstWindow();desktop.setDefaultTimeout(30000);desktop.on('pageerror',error=>report.errors.push(error.message));
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.restore();window.show();});
  await desktop.goto(fixture.origin+'/personal/v1/ui/');
  await localUiSession(desktop,fixture.credentials,'FIX-43 desktop',{mainChat:true});
  await desktop.getByRole('button',{name:/^动态(?:，|$)/}).click();
  await desktop.getByRole('heading',{name:'动态',exact:true}).waitFor();
  async function verify(page,selector,label){
    await page.getByText(item.summary,{exact:true}).waitFor();
    const text=await page.locator(selector).textContent();
    assert.match(text,/目标「整理周报」已完成/);assert.match(text,/核对了 3 份资料/);
    assert.match(text,/report.md/);assert.match(text,/checklist.txt/);
    assert.doesNotMatch(text,/goal revision|phase:|disarmed|C:\/Temp|file:\/\/|\*\*|`/);
    assert.ok(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth));
    report.checks.push(label);
    await page.screenshot({path:join(out,`${label}.png`)});
  }
  await verify(desktop,'.activity-surface','desktop-light');
  await desktop.evaluate(()=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme:'dark',accent:'neutral',fontSize:'15'})));
  await desktop.reload();await desktop.getByRole('button',{name:/^动态(?:，|$)/}).click();
  await verify(desktop,'.activity-surface','desktop-dark');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const phone=await browser.newPage({viewport:{width:390,height:844}});phone.setDefaultTimeout(30000);phone.on('pageerror',error=>report.errors.push(error.message));
  await phone.goto(fixture.mobileUrl);await phone.getByRole('tab',{name:/^动态(?:，|$)/}).click();
  await phone.getByRole('heading',{name:'动态',exact:true}).waitFor();
  await verify(phone,'#page-content','mobile-light');
  await phone.evaluate(()=>document.documentElement.dataset.theme='dark');
  await verify(phone,'#page-content','mobile-dark');
  assert.deepEqual(report.errors,[]);
  await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} catch(error) {
  await writeFile(join(out,'verification-failure.json'),JSON.stringify({...report,failure:error.message},null,2)+'\n');
  const window=await app?.firstWindow().catch(()=>null);
  if(window){await writeFile(join(out,'desktop-failure.txt'),await window.locator('body').innerText());await window.screenshot({path:join(out,'desktop-failure.png'),timeout:5000}).catch(()=>{});}
  throw error;
} finally {
  await browser?.close();await app?.close();await fixture.close();
  // This directory was created by this runner, under the supplied evidence root.
  assert.equal(profile.startsWith(out+'\\')||profile.startsWith(out+'/'),true);
  await rm(profile,{recursive:true,force:true});
}
