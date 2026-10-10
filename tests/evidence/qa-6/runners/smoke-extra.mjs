import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {pause,until} from './harness.mjs';
const btn=(p,name)=>p.getByRole('button',{name,exact:true});
async function dismiss(p){await p.keyboard.press('Escape');if(await p.locator('#settings-dialog').isVisible())await btn(p,'关闭设置').click();}
export async function selectSide(h,p){
 await dismiss(p);const rows=(await h.api('/sessions?limit=100')).body.sessions;const row=rows.find(x=>!x.temporary);assert.ok(row,'existing side chat');
 const target=p.locator(`[data-session-id="${row.sessionId}"] > button`).first();if(!await target.isVisible()){const rail=btn(p,'切换会话侧栏');if(await rail.isVisible())await rail.click();}
 await target.click();await p.waitForFunction(()=>!document.getElementById('message-text').disabled);
}
export async function beforeFiles({h,check,shot,say,active,folder,report}){
 const p=h.page;
 await check('12-rendering-motion',async()=>{
  const samples=[];let finished=false;const task=say('请输出一个简短 Markdown 样张，依次包含：三行 JavaScript 代码块、两行三列表格、独立公式 $$E=mc^2$$、mermaid flowchart TD 流程图 A[开始]-->B[完成]。四种都必须使用正确围栏，不用工具。').finally(()=>finished=true);
  let captured=false;
  while(!finished){const sample=await p.evaluate(()=>({at:Date.now(),indicator:document.querySelectorAll('.reply-indicator').length,status:document.querySelectorAll('.reply-sheen').length,animations:document.getAnimations().filter(a=>a.playState==='running').length,inputY:document.getElementById('message-text').getBoundingClientRect().y}));samples.push(sample);if(!captured&&(sample.indicator||sample.status)){await shot('rendering-stream-motion');captured=true;}await pause(150);}
  const reply=await task;const body=p.locator('.message.assistant').last();await body.scrollIntoViewIfNeeded();
  const counts=await body.evaluate(el=>({code:el.querySelectorAll('.render-code').length,table:el.querySelectorAll('table').length,math:el.querySelectorAll('.katex').length,mermaid:el.querySelectorAll('.render-mermaid').length,actions:el.querySelectorAll('button').length}));
  for(const key of ['code','table','math','mermaid'])assert.ok(counts[key]>0,key+' missing');
  const code=body.locator('.render-code').first();await code.scrollIntoViewIfNeeded();await code.hover();await code.getByRole('button',{name:'复制代码',exact:true}).click();const clipboard=await h.app.evaluate(({clipboard})=>clipboard.readText());assert.ok(clipboard.length>0);await shot('rendering-code-copy');
  await body.locator('.render-mermaid').scrollIntoViewIfNeeded();await body.locator('.render-diagram img').waitFor({timeout:15000});await shot('rendering-diagram');
  report.motionSamples=samples;return {...reply,counts,clipboardNonempty:true,streamFrames:samples.length,streamMotionSeen:captured};
 });
 await check('13-suggestions',async()=>{
  await p.locator('.next-suggestion-chip').first().waitFor({state:'visible',timeout:30000});await shot('suggestions-open');const count=(await h.api('/commands?limit=100')).body.commands.length;const text=await p.locator('.next-suggestion-chip').first().textContent();await p.locator('.next-suggestion-chip').first().click();assert.equal(await p.locator('#message-text').inputValue(),text);assert.equal((await h.api('/commands?limit=100')).body.commands.length,count);
  await p.locator('#message-text').fill('请把刚才的样张');await p.locator('.composer-completion:not([hidden])').waitFor({timeout:30000});await shot('completion-gray');const completion=await p.locator('.composer-completion-text').textContent();await p.locator('#message-text').press('Tab');assert.equal(await p.locator('#message-text').inputValue(),'请把刚才的样张'+completion);await p.locator('#message-text').fill('');return {fillOnly:true,tabAccepted:true};
 });
 await check('14-search-title-body-menu',async()=>{
  const id=await active();await h.api(`/sessions/${id}/metadata`,{title:'QA6渲染样张'},'PATCH');await btn(p,'搜索').click();await p.getByRole('combobox',{name:'搜索内容'}).fill('QA6渲染样张');await p.locator('.search-result-row').first().waitFor();await shot('search-title-open');await p.locator('.search-result-more').first().click();await shot('search-row-menu-open');await p.keyboard.press('Escape');await p.getByRole('combobox',{name:'搜索内容'}).fill('第951种花茶');await p.locator('.search-result-snippet').first().waitFor();await shot('search-body-open');await p.locator('.search-result-row').filter({has:p.locator('.search-result-snippet')}).first().click();await p.locator('dialog[aria-label="搜索"]').waitFor({state:'hidden'});await shot('search-message-located');await p.keyboard.press('Control+k');await p.getByRole('combobox',{name:'搜索内容'}).waitFor();await shot('search-ctrl-k');await btn(p,'关闭搜索').click();return {title:true,body:true,ctrlK:true};
 });
 await check('15-folder-project',async()=>{
  await dismiss(p);await btn(p,'新旁聊 Ctrl N').click();await p.locator('.folder-start:not([hidden])').waitFor();assert.equal(await p.locator('.folder-start button').count(),3);await shot('folder-three-pills');await btn(p,'选择文件夹').click();await shot('folder-recent-empty-open');await p.keyboard.press('Escape');
  await h.app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await btn(p,'添加文件夹').click();await p.getByRole('region',{name:'在文件夹里工作'}).waitFor();await shot('folder-confirm-open');
  await p.getByRole('button',{name:'文件权限，只读',exact:true}).click().catch(async()=>{await p.getByLabel('文件权限',{exact:true}).selectOption('write',{force:true});});
  if(await p.getByRole('menuitemradio',{name:'可读写'}).isVisible().catch(()=>false))await p.getByRole('menuitemradio',{name:'可读写'}).click();
  await p.getByLabel('文件权限',{exact:true}).selectOption('write',{force:true});await btn(p,'在这个文件夹里工作').click();await p.locator('.folder-confirm').waitFor({state:'detached'});await p.getByRole('button',{name:/^选择文件夹，当前/}).click();await shot('folder-recent-open');await p.keyboard.press('Escape');const projects=(await h.api('/projects')).body.projects;return {projects:projects?.map(x=>({name:x.name,permission:x.permission})),systemDialogSubstituted:true};
 });
}
export async function afterPhone({h,check,shot,say,active,folder,report,phone}){
 const p=h.page;
 await check('22-drag-folder',async()=>{
  await dismiss(p);await btn(p,'新旁聊 Ctrl N').click();const dropped=join(h.root,'dragged-project');mkdirSync(dropped);writeFileSync(join(dropped,'notes.txt'),'QA6_DRAGGED_FOLDER');const cdp=await p.context().newCDPSession(p);const box=await p.locator('#message-text').boundingBox();const data={items:[],files:[dropped],dragOperationsMask:1};for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:box.x+30,y:box.y+15,data});await p.locator('.folder-confirm').waitFor({timeout:10000});await shot('folder-drag-confirm');await p.getByLabel('文件权限',{exact:true}).selectOption('write',{force:true});await btn(p,'在这个文件夹里工作').click();await p.locator('.folder-confirm').waitFor({state:'detached'});await cdp.detach();return {nativeFolderDrag:true};
 });
 await check('16-settings-categories',async()=>{
  await dismiss(p);await p.keyboard.press('Control+,');const categories=await p.locator('.settings-nav-item').evaluateAll(xs=>xs.map(x=>({id:x.dataset.category,name:x.textContent})));for(const c of categories){await p.locator(`.settings-nav-item[data-category="${c.id}"]`).click();await pause(150);await shot('settings-'+c.id);}await btn(p,'关闭设置').click();return {categories};
 });
 await check('17-reduce-motion-and-disable-suggestions',async()=>{
  await p.keyboard.press('Control+,');await p.locator('button[data-category="appearance"]').click();await p.getByLabel('减少动态效果',{exact:true}).selectOption('reduce',{force:true});await shot('reduce-motion-open');await p.locator('button[data-category="assistant"]').click();await p.getByRole('switch',{name:'下一步建议',exact:true}).uncheck().catch(async()=>{const c=p.getByLabel('下一步建议',{exact:true});await c.uncheck();});await shot('suggestions-disabled-open');await btn(p,'关闭设置').click();const r=await say('请用一句话说明合成测试的作用，不用工具。');await pause(1500);const state=await p.evaluate(()=>({reduced:WeftReplyMotion.reduced,running:document.getAnimations().filter(a=>a.playState==='running').map(a=>a.animationName),suggestions:!document.getElementById('next-suggestions').hidden}));assert.ok(state.reduced);assert.equal(state.suggestions,false);return {...r,state};
 });
 for(const name of ['动态','目标','成果库'])await check('18-page-'+name,async()=>{await btn(p,name).click();await pause(400);return {heading:await p.locator('h1').allTextContents()};});
 await check('19-offline-reconnect',async()=>{
  await selectSide(h,p);await p.locator('#message-text').fill('QA6断线期间保留的草稿');
  const port=Number(new URL(h.origin).port);await h.app.evaluate(async(_,port)=>{globalThis.qa6Listener=process._getActiveHandles().find(x=>typeof x.address==='function'&&x.address()?.port===port&&typeof x.listen==='function');if(!qa6Listener)throw Error('owned content listener missing');qa6Listener.closeAllConnections();await new Promise(r=>qa6Listener.close(r));},port);
  try{await p.locator('.presence-badge[data-state="host_offline"]').waitFor({timeout:35000});await shot('desktop-offline');await shot('phone-offline',phone);const geometry=await p.evaluate(()=>({bars:[...document.querySelectorAll('.presence-bar')].filter(e=>!e.hidden).length,bottom:document.querySelector('.presence-bar').getBoundingClientRect().bottom,input:document.getElementById('message-text').getBoundingClientRect().top}));assert.equal(geometry.bars,1);assert.ok(geometry.bottom<=geometry.input);report.offlineGeometry=geometry;}
  finally{await h.app.evaluate(async(_,port)=>{await new Promise(r=>qa6Listener.listen(port,'127.0.0.1',r));},port);}
  const retry=p.locator('.presence-bar').getByRole('button',{name:'重试',exact:true});if(await retry.isVisible())await retry.click();await p.locator('.presence-badge[data-state="online"]').waitFor({timeout:35000});await shot('desktop-restored');assert.equal(await p.locator('#message-text').inputValue(),'QA6断线期间保留的草稿');await p.locator('#message-text').fill('');return {draftPreserved:true,toasts:await p.evaluate(()=>qa6Toasts)};
 });
 for(const [surface,page] of [['desktop',p],['phone',phone]])await check('20-'+surface+'-reject',async()=>{
  await dismiss(page);const id=await active(page);await h.api(`/sessions/${id}/approval-mode`,{mode:'ask'},'PATCH');const path=join(folder,surface+'-must-not-exist.txt').replaceAll('\\','/');const before=(await h.events(id)).length;await page.locator('#message-text').fill(`请写入 ${path}，内容QA6_REJECTION。若我拒绝操作，直接停止，不要换工具重试。`);await btn(page,'发送').click();await btn(page,'拒绝').waitFor({timeout:45000});await shot(surface+'-reject-pending',page);await btn(page,'拒绝').click();await btn(page,'拒绝').waitFor({state:'hidden',timeout:15000});await until(async()=>(await h.events(id)).slice(before).some(e=>e.type==='turn.ended'),45000);assert.equal(existsSync(path),false);await shot(surface+'-rejected',page);return {singleClick:true,fileAbsent:true};
 });
 for(const [surface,page] of [['desktop',p],['phone',phone]])await check('23-'+surface+'-approval-races',async()=>{
  await dismiss(page);await selectSide(h,page);const main={activeSessionId:await active(page)};await h.api(`/sessions/${main.activeSessionId}/approval-mode`,{mode:'ask'},'PATCH');const file=join(folder,surface+'-race.txt').replaceAll('\\','/');const prior=(await h.events(main.activeSessionId)).filter(e=>e.type==='turn.ended').length;
  await page.locator('#message-text').fill(`请写入 ${file}，内容QA6_RACE，然后读回核对。`);await btn(page,'发送').click();const samples=[];
  for(let n=0;n<5;n++){
   const available=await until(async()=>{if(await btn(page,'批准').isVisible().catch(()=>false))return 'approval';if((await h.events(main.activeSessionId)).filter(e=>e.type==='turn.ended').length>prior)return 'done';return false;},60000);if(available==='done')break;
   const status=(await h.api('/sessions?limit=100')).body;writeFileSync(join(h.out,`${surface}-race-status-${n}.json`),JSON.stringify(status,null,2));
   if(n===0){await page.reload();await page.locator('#assistant-view').waitFor();}
   if(n===1){const port=Number(new URL(h.origin).port);await h.app.evaluate(async(_,port)=>{globalThis.qa6Listener=process._getActiveHandles().find(x=>typeof x.address==='function'&&x.address()?.port===port&&typeof x.listen==='function');qa6Listener.closeAllConnections();await new Promise(r=>qa6Listener.close(r));},port);try{await page.locator('.presence-badge[data-state="host_offline"]').waitFor({timeout:35000});await shot(surface+'-approval-offline',page);}finally{await h.app.evaluate(async(_,port)=>new Promise(r=>qa6Listener.listen(port,'127.0.0.1',r)),port);}await page.locator('.presence-badge[data-state="online"]').waitFor({timeout:35000});}
   await btn(page,'批准').waitFor();await shot(surface+'-race-pending-'+n,page);const at=Date.now();await btn(page,'批准').click();await btn(page,'批准').waitFor({state:'hidden',timeout:12000});samples.push({after:n===0?'reload':n===1?'reconnect':'normal',ackMs:Date.now()-at});
  }
  assert.ok(samples.length);assert.equal(existsSync(file),true);await shot(surface+'-race-complete',page);return {samples};
 });
 await check('21-responsive-light-dark',async()=>{for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await phone.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot('desktop-'+theme);await shot('phone-390-'+theme,phone);await phone.setViewportSize({width:360,height:780});await shot('phone-360-'+theme,phone);await phone.setViewportSize({width:390,height:844});await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,800));await shot('desktop-480-'+theme);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1120,800));}return {phoneSystemBars:'not covered by emulated viewport'};});
}
