// Isolated production web surface: a pressed send target must not move.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';
let fixture,browser;
const profile=await mkdtemp(join(tmpdir(),'weftmate-fe-chat-press-'));
process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
const deadline=setTimeout(()=>{void browser?.close();process.exitCode=1;},45000);
try {
  fixture=await startFixture({auth1:true});browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(10000);await page.goto(fixture.origin+'/personal/v1/ui');
  await feedbackUiSession(page,fixture,{native:false});
  await page.evaluate(async()=>{await __feedbackSessionCore.startNewConversation();WeftReplyMotion.setVisibility(false);});
  await page.locator('#message-text').fill('合成的首次输入');
  await page.waitForFunction(()=>!document.getElementById('send-message').disabled);
  const button=page.locator('#send-message');await button.scrollIntoViewIfNeeded();
  const before=await button.boundingBox();
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();
  await page.evaluate(async()=>{await __feedbackSessionCore.refreshSessions();await new Promise(resolve=>setTimeout(resolve,420));});
  const during=await button.boundingBox();await page.mouse.move(1,1);await page.mouse.up();
  assert.ok(Math.abs(before.x-during.x)<1&&Math.abs(before.y-during.y)<1,JSON.stringify({before,during}));
  assert.equal(await page.locator('#message-text').inputValue(),'合成的首次输入');
  console.log('PASS pressed send target stays in place during a composer refresh');
} finally {clearTimeout(deadline);await browser?.close();await fixture?.close();assert.ok(profile.startsWith(join(tmpdir(),'weftmate-fe-chat-press-')));await rm(profile,{recursive:true,force:true});}
