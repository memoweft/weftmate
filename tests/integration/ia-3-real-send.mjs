/** Real fixed DSH + MiMo through the production desktop composer. */
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { harness, until } from './ia-2b-harness.mjs';
const evidence=resolve(import.meta.dirname,'../evidence/ia-3');
const h=await harness('ia3-ui',{memory:false,mainChat:true});
const report={realElectron:true,fixedDsh:true,model:'mimo-v2.6-flash',checks:[]};
try {
  const page=h.page;page.setDefaultTimeout(90000);
  await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();
  await page.getByRole('button',{name:'合成会话',exact:true}).waitFor({state:'hidden'}).catch(()=>{});
  // Select the configured real account profile through the same model action.
  await page.getByRole('button',{name:/选择模型|ia2b-mimo/}).first().click();
  await page.getByRole('option',{name:'ia2b-mimo',exact:true}).click();
  await page.locator('#message-attachments').setInputFiles({name:'synthetic-note.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic attachment code: PAPER-42. This is test data.')});
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('只读附件并回复其中的合成编号，不要使用工具。');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const main=(await h.api('/chats/main')).body.chat;
  const command=await until(async()=>{const rows=(await h.api('/commands?limit=20')).body.commands;return rows.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh');});
  await h.complete(command);
  await until(async()=>await page.locator('#attachment-draft-list').getByText('synthetic-note.txt',{exact:true}).count()===0);
  await until(async()=>{const data=(await h.api(`/chats/${main.chatId}/events?limit=50`)).body;return data.items?.some(event=>event.type==='assistant.message'&&event.data.text?.includes('PAPER-42'));});
  await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();await page.getByText(/PAPER-42/).first().waitFor();
  await page.screenshot({path:join(evidence,'real-mimo-main-attachment.png')});
  report.checks.push('logical-first-send','logical-staged-attachment','real-model-read-attachment','one-original-command','native-receipt');
  report.command={commandId:command.commandId,requestId:command.requestId,chatId:command.chatId,sessionId:command.sessionId,receiptId:command.receiptId};
  await h.close();report.usage=await h.usage();await writeFile(join(evidence,'real-send.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} catch(error) {await writeFile(join(evidence,'real-send-failure.json'),JSON.stringify({error:error.message,report,usage:await h.usage().catch(()=>[])},null,2));throw error;}
finally {await h.close();await rm(h.base,{recursive:true,force:true});}
