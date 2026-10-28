import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT ??=resolve('.local/ui01-phone');
let fixture,browser;const errors=[];
try {
  fixture=await startTimelineCandidate({historyCount:0,interactive:true,inlineProgress:true});
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(fixture.origin+'/personal/v1/ui');await localUiSession(page,fixture.credentials);
  await page.locator('body.phone-unified').waitFor();
  const input=page.getByRole('textbox',{name:'输入消息',exact:true});await input.fill('手机草稿');
  await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'工作面板',exact:true});
  assert.equal(await panel.locator('[data-panel-kind]').count(),6);
  assert.ok((await panel.boundingBox()).width>=388);
  await panel.locator('[data-panel-kind=files]').click();await panel.locator('.files-resource-group summary').filter({hasText:/^成果 ·/}).waitFor();
  await page.getByRole('button', {name:'收起右侧面板',exact:true}).click();assert.equal(await input.inputValue(),'手机草稿');
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.WEFTMATE_EVIDENCE_DIR) {await mkdir(process.env.WEFTMATE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.WEFTMATE_EVIDENCE_DIR,`remote-phone-${theme}.png`)});}
  }
  fixture.progress.finish();
  await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{memoryMode:'off'},'PATCH');
  const desktop=await browser.newPage({viewport:{width:1280,height:800}});desktop.setDefaultTimeout(12000);
  await desktop.goto(fixture.origin+'/personal/v1/ui');await localUiSession(desktop,fixture.credentials);
  const current=desktop.locator(`.session-row[data-session-id="${fixture.sessionId}"]`);
  await current.locator('.session-more').click();
  const rootMenu=desktop.getByRole('menu',{name:'对话操作',exact:true});
  await rootMenu.getByRole('menuitem',{name:'记忆与保留',exact:true}).click();
  await desktop.getByRole('menuitem',{name:/自动删除：/}).click();
  const retention=desktop.getByRole('menu',{name:'自动删除期限',exact:true});await retention.waitFor();
  const parentBox=await rootMenu.boundingBox(),childBox=await retention.boundingBox();
  assert.ok(childBox.x>=parentBox.x+parentBox.width-4,'retention submenu stays anchored to its live parent');
  await retention.getByRole('menuitemradio',{name:'7 天后自动删除',exact:true}).click();
  await retention.waitFor({state:'hidden'});
  assert.equal((await fixture.request('/sessions?archived=all')).sessions.find(row=>row.sessionId===fixture.sessionId).autoDeleteDays,7);
  assert.deepEqual(errors,[]);console.log('UI-01 touch phone: panel full page, return, draft and no overflow passed.');
} finally {await browser?.close();await fixture?.close();}
