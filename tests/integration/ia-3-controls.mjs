// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startMainChatCandidate } from './main-chat-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'tests/evidence/ia-3'),fixture=await startMainChatCandidate(80),profile=await mkdtemp(join(tmpdir(),'weftmate-ia3-controls-'));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app;const errors=[];
const button=(page,name)=>page.getByRole('button',{name,exact:true});
try {
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
  const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await localUiSession(page,fixture.credentials,'Synthetic controls',{mainChat:true});
  await button(page,'搜索主对话').focus();await page.keyboard.press('Enter');await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('纸船');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-event-id'));
  await button(page,'关闭主对话搜索').focus();await page.keyboard.press('Enter');
  assert.equal(await button(page,'搜索主对话').evaluate(node=>node===document.activeElement),true);
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('合成主对话控制验证');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#message-text').value==='');
  const registered=await fixture.progress.approve('main-controls','echo synthetic');console.log('synthetic approval registration',JSON.stringify(registered.registration));
  const native=(await fixture.request('/chats/main')).chat.activeSessionId;console.log('synthetic approval list',JSON.stringify(await fixture.request(`/sessions/${native}/approvals?limit=100`)).slice(0,1500));
  await button(page,'批准').waitFor();await page.screenshot({path:join(evidence,'desktop-main-approval.png')});
  await button(page,'批准').focus();await page.keyboard.press('Enter');await button(page,'批准').waitFor({state:'hidden'});
  fixture.progress.ask([{id:'format',question:'合成确认：采用哪种格式？',options:[{label:'简要报告'},{label:'完整记录'}]}]);
  await page.getByRole('region',{name:'待回答问题'}).waitFor();await page.getByRole('radio',{name:'简要报告',exact:true}).click();
  await page.screenshot({path:join(evidence,'desktop-main-question.png')});
  const submit=page.getByRole('region',{name:'待回答问题'}).getByRole('button',{name:/提交|回答/});await submit.focus();await page.keyboard.press('Enter');
  await page.getByRole('region',{name:'待回答问题'}).waitFor({state:'hidden'});
  await button(page,'停止回复').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#send-message').dataset.action==='send');
  await writeFile(join(evidence,'accessibility-tree.txt'),await page.locator('body').ariaSnapshot());
  assert.deepEqual(errors,[]);await writeFile(join(evidence,'controls.json'),JSON.stringify({realElectron:true,synthetic:true,keyboardSearch:true,focusReturns:true,mainApproval:true,mainQuestion:true,stopSameButton:true,errors},null,2)+'\n');
  console.log('IA-3 keyboard, approval, question and stop passed.');
} catch(error) {const page=await app?.firstWindow();if(page){console.log((await page.locator('body').innerText()).slice(-2000));await page.screenshot({path:join(evidence,'controls-failure.png')});}await writeFile(join(evidence,'controls-failure.json'),JSON.stringify({error:error.message,errors},null,2));throw error;}
finally {await app?.close();await fixture.close();await rm(profile,{recursive:true,force:true});await rm(fixture.root,{recursive:true,force:true});}
