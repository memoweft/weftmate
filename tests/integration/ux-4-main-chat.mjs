import { evidencePath } from '../helpers/evidence-path.mjs';
import { managedMkdtempSync as mkdtempSync, managedTempRoot as tmpdir } from '../helpers/managed-temp.mjs';
// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

import { join, resolve } from 'node:path';
import { startFixture } from './ux-4-fixture.mjs';
import { checkMainHistoryActions, observeHistoryCore } from '../helpers/history-message-scenarios.mjs';
const fixture=await startFixture({auth1:true}),root=mkdtempSync(join(tmpdir(),'weftmate-ux4-main-')),evidence=evidencePath('ux-p2/main-actions');mkdirSync(evidence,{recursive:true});let app,page;
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
async function accepted(command){while(['pending','dispatching','preflight'].includes(command.state)){await new Promise(resolve=>setTimeout(resolve,50));command=(await fixture.request('/commands/'+command.commandId)).command;}assert.equal(command.state,'accepted_by_dsh');return command;}
try {
  const main=(await fixture.request('/chats/main')).chat;
  await accepted((await fixture.request('/commands',{requestId:'main-original',kind:'chat.message',targetDeviceId:fixture.hostId,chatId:main.chatId,modelProfileId:'synthetic',text:'主对话原始合成目标。',mode:'queue'})).command);
  const before=(await fixture.request('/chats/'+main.chatId+'/events?limit=200')).items;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:root,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light'}});
  page=await app.firstWindow();page.setDefaultTimeout(20000);await page.addInitScript(observeHistoryCore);await page.reload();await page.waitForFunction(()=>globalThis.historyScenarioCore?.state.mainChat);await page.evaluate(()=>historyScenarioCore.selectMainChat());await page.getByText('主对话原始合成目标。',{exact:true}).waitFor();
  const reply=page.getByRole('group',{name:/^助手消息：/}).last();await reply.focus();await checkMainHistoryActions(page,reply);
  assert.equal(await page.getByRole('button',{name:/编辑并重发|从这里开旁聊并重发/,includeHidden:true}).count(),0);
  await reply.evaluate(row=>{const body=row.querySelector('.message-text');const range=document.createRange();range.selectNodeContents(body);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup'));});
  await page.getByRole('button',{name:'引用选中文字',exact:true}).click();assert.match(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),/^> /);await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`main-${theme}-actions.png`)});}
  assert.deepEqual(await page.evaluate(async id=>(await historyScenarioCore.accessApi(`/chats/${id}/events?limit=200`)).items,main.chatId),before);assert.equal(fixture.calls.length,0);
  const chats=await page.evaluate(async()=>(await historyScenarioCore.accessApi('/chats?limit=50')).items);
  assert.equal(chats.filter(chat=>chat.kind==='side'&&chat.originChatId===main.chatId).length,0);
  writeFileSync(join(evidence,'main-chat-checks.json'),JSON.stringify({realElectron:true,mainCapabilitiesEnabled:true,mainQuote:true,processedUserCannotEdit:true,noAnchoredSideChat:true,mainHistoryUnchanged:true,noWholeMainFork:true},null,2)+'\n');
  console.log('Main chat processed users have no edit entry; original history and quote behavior verified.');
} catch(error){if(page){console.error(await page.locator('body').innerText());await page.screenshot({path:join(evidence,'main-failure.png')});}throw error;}
finally {if(app)await app.evaluate(async()=>{await globalThis.__reviewDesktop.close();});await app?.close();await fixture.close();rmSync(root,{recursive:true,force:true});}
