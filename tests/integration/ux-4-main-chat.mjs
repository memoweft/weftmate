import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const fixture=await startFixture(),root=mkdtempSync(join(tmpdir(),'weftmate-ux4-main-')),evidence=resolve('tests/evidence/ux-4');mkdirSync(evidence,{recursive:true});let app,page;
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
async function accepted(command){while(['pending','dispatching','preflight'].includes(command.state)){await new Promise(resolve=>setTimeout(resolve,50));command=(await fixture.request('/commands/'+command.commandId)).command;}assert.equal(command.state,'accepted_by_dsh');return command;}
try {
  const main=(await fixture.request('/chats/main')).chat;
  await accepted((await fixture.request('/commands',{requestId:'main-original',kind:'chat.message',targetDeviceId:fixture.hostId,chatId:main.chatId,modelProfileId:'synthetic',text:'主对话原始合成目标。',mode:'queue'})).command);
  const before=(await fixture.request('/chats/'+main.chatId+'/events?limit=200')).items;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:root,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
  page=await app.firstWindow();page.setDefaultTimeout(20000);await localUiSession(page,fixture.credentials,'UX-4 main fixture',{mainChat:true});
  await page.getByRole('button',{name:'从这里开旁聊并重发',exact:true}).waitFor();
  await page.getByRole('button',{name:'更多回复操作',exact:true}).last().evaluate(node=>{const row=node.closest('.message'),body=row.querySelector('.message-text');const range=document.createRange();range.selectNodeContents(body);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup'));});
  await page.getByRole('button',{name:'引用选中文字',exact:true}).click();assert.match(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),/^> /);await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`main-${theme}-actions.png`)});}
  await page.getByRole('button',{name:'从这里开旁聊并重发',exact:true}).click();const dialog=page.getByRole('dialog',{name:'从这里开旁聊并重发',exact:true});
  await dialog.getByRole('textbox',{name:'修改消息'}).fill('主对话修改后的合成目标。');await dialog.getByRole('button',{name:'从这里开旁聊并重发',exact:true}).click();
  await page.getByText('主对话修改后的合成目标。',{exact:true}).waitFor();
  assert.deepEqual((await fixture.request('/chats/'+main.chatId+'/events?limit=200')).items,before);assert.equal(fixture.calls.length,0,'main creates a source-referenced side chat instead of a history fork');
  await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();
  await page.getByRole('button',{name:'更多回复操作',exact:true}).last().click();await page.getByRole('menuitem',{name:'开旁聊重新生成',exact:true}).click();
  await page.getByText('主对话原始合成目标。',{exact:true}).waitFor();
  assert.deepEqual((await fixture.request('/chats/'+main.chatId+'/events?limit=200')).items,before);assert.equal(fixture.calls.length,0);
  const chats=(await fixture.request('/chats?limit=50')).items,side=chats.find(chat=>chat.title==='重新讨论');assert.ok(side);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`main-${theme}-side-resend.png`)});}
  writeFileSync(join(evidence,'main-chat-checks.json'),JSON.stringify({realElectron:true,mainCapabilitiesEnabled:true,mainQuote:true,editCreatesReferencedSide:true,regenerateCreatesReferencedSide:true,mainHistoryUnchanged:true,noWholeMainFork:true,sourceChatId:main.chatId,sideChatId:side.chatId},null,2)+'\n');
  console.log('Main chat edit creates a referenced side chat; original history and quote behavior verified.');
} catch(error){if(page){console.error(await page.locator('body').innerText());await page.screenshot({path:join(evidence,'main-failure.png')});}throw error;}
finally {await app?.close();await fixture.close();rmSync(root,{recursive:true,force:true});}
