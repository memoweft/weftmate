// Recheck only the reload/switch/reconnect gap. Never press Escape while a task is running:
// Escape is the real product's Stop shortcut, not a harmless drawer dismissal.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {harness,pause,until} from './harness.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
export async function recheckApprovals(executable){
 const migrationRoot=dirname(dirname(dirname(resolve(executable))));
 if(basename(migrationRoot).startsWith('weftmate-qa6-migration-')){
  assert.equal(existsSync(join(migrationRoot,'profile')),false,'Private backup profile must be deleted before synthetic inference');
  const sibling=resolve(migrationRoot,'Backups');assert.ok(sibling.startsWith(migrationRoot+process.getBuiltinModule('node:path').sep));rmSync(sibling,{recursive:true,force:true});
 }
 const h=await harness('approval-recheck',{mimo:true,installed:executable}),p=h.page,report={startedAt:new Date().toISOString(),installed:true,fixtureCorrection:'No Escape in select: it cancels native tasks',checks:[],posts:[]};let browser;
 const save=()=>writeFileSync(join(h.out,'results.json'),JSON.stringify(report,null,2)),button=(page,name)=>page.getByRole('button',{name,exact:true});
 const shot=(page,name)=>page.screenshot({path:join(h.out,name+'.png')});
 const watch=page=>page.on('requestfinished',async request=>{if(request.method()!=='POST'||!new URL(request.url()).pathname.includes('/approvals/'))return;const response=await request.response();report.posts.push({path:new URL(request.url()).pathname,status:response?.status(),at:new Date().toISOString()});save();});watch(p);
 async function select(page,id){await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);await page.locator(`[data-session-id="${id}"]`).waitFor({state:'attached'});await page.evaluate(()=>WeftDesktop.toggleRail(false));await page.locator(`[data-session-id="${id}"] > button`).first().click();await page.waitForFunction(id=>!!document.querySelector(`[data-session-id="${id}"] > button.is-current`)&&!document.getElementById('message-text').disabled,id);}
 async function listener(on){const port=Number(new URL(h.origin).port);await h.app.evaluate(async(_,v)=>{if(!v.on){globalThis.qa6Listener=process._getActiveHandles().find(x=>typeof x.address==='function'&&x.address()?.port===v.port&&typeof x.listen==='function');qa6Listener.closeAllConnections();await new Promise(r=>qa6Listener.close(r));}else await new Promise(r=>qa6Listener.listen(v.port,'127.0.0.1',r));},{port,on});}
 try{
  await h.api('/settings/models',{defaultModelProfileId:h.modelId},'PATCH');const other=await h.session();browser=await chromium.launch({channel:'msedge',headless:true});const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await phone.goto(h.origin+'/personal/v1/ui');await localUiSession(phone,h.credentials,'QA6 approval phone',{mainChat:true});watch(phone);
  const folder=join(h.root,'approval-files');mkdirSync(folder);const source=join(folder,'source.txt');writeFileSync(source,'QA6_APPROVAL_SOURCE');
  for(const [surface,page] of [['desktop',p],['phone',phone]]){
   const row={surface,decisions:[]};report.checks.push(row);save();
   try{
    const id=await h.session();row.sessionId=id;await h.api(`/sessions/${id}/approval-mode`,{mode:'ask'},'PATCH');await page.reload();await select(page,id);const targets=[join(folder,surface+'.txt'),join(folder,surface+'-2.txt'),join(folder,surface+'-3.txt')],target=targets[0];
    const seq=Math.max(-1,...(await h.events(id)).map(e=>e.seq));await page.locator('#message-text').fill(`请依次用文件读取工具读取 ${source.replaceAll('\\','/')}，分别用文件写入工具把原文写入三个文件：${targets.map(x=>x.replaceAll('\\','/')).join('、')}。每次写一个文件，不用shell。最后读回第一个文件核对。只操作这些文件。`);await button(page,'发送').click();
    for(let n=0;n<6;n++){
     const pending=await until(async()=>{const approvals=(await h.api(`/sessions/${id}/approvals`)).body.approvals;const item=approvals?.find(x=>x.status==='pending');if(item)return item;return (await h.events(id)).some(e=>e.type==='turn.ended'&&e.seq>seq)?'done':false;},75000);if(pending==='done')break;
     await button(page,'批准').waitFor();await shot(page,`${surface}-${n}-before`);
     if(n===0){await page.reload();await select(page,id);}
     else if(n===1){await select(page,other);await select(page,id);}
     else if(n===2){await listener(false);try{await page.locator('.presence-badge[data-state="host_offline"]').waitFor({timeout:35000});await shot(page,`${surface}-offline-pending`);}finally{await listener(true);}await page.locator('.presence-badge[data-state="online"]').waitFor({timeout:40000});}
     await button(page,'批准').waitFor();const at=Date.now();await button(page,'批准').click();await until(async()=>{const values=(await h.api(`/sessions/${id}/approvals`)).body.approvals;return !values?.some(x=>x.approvalId===pending.approvalId&&x.status==='pending');},12000);row.decisions.push({after:['reload','switch','reconnect'][n]||'normal',approvalId:pending.approvalId,ackMs:Date.now()-at});save();
    }
    await until(async()=>(await h.events(id)).some(e=>e.type==='turn.ended'&&e.seq>seq),60000);for(const file of targets)assert.equal(readFileSync(file,'utf8').trim(),'QA6_APPROVAL_SOURCE');assert.ok(row.decisions.length>=3,'Need three actual approvals to cover all boundaries');await shot(page,`${surface}-complete`);row.passed=true;
   }catch(e){row.passed=false;row.error=e.message;await shot(page,`${surface}-failed`).catch(()=>{});if(row.sessionId)writeFileSync(join(h.out,surface+'-events.json'),JSON.stringify(await h.events(row.sessionId).catch(()=>[]),null,2));}save();console.log('approval-recheck',surface,row.passed);
  }
  const motion={name:'short-natural-reply-motion',samples:[]};report.uiRecheck=motion;
  try{
   await select(p,other);await p.bringToFront();const seq=Math.max(-1,...(await h.events(other)).map(e=>e.seq));await p.locator('#message-text').fill('请直接写几小段关于整理合成文件的说明，顺便提出可以继续做什么。不用工具，也不用凑字数。');await button(p,'发送').click();const deadline=Date.now()+45000;let done=false,captured=false;
   while(Date.now()<deadline){const sample=await p.evaluate(()=>({at:Date.now(),hidden:document.hidden,paused:WeftReplyMotion.paused,reduced:WeftReplyMotion.reduced,dot:!!document.querySelector('.reply-indicator'),sheen:[...document.querySelectorAll('.reply-sheen')].some(e=>e.getBoundingClientRect().height>0),inputY:document.getElementById('message-text').getBoundingClientRect().y}));motion.samples.push(sample);if(sample.dot&&!captured){await shot(p,'natural-reply-breathing-dot');captured=true;}if((await h.events(other)).some(e=>e.type==='turn.ended'&&e.seq>seq)){done=true;break;}await pause(100);}
   motion.completed=done;motion.dotSeen=captured;motion.sheenSeen=motion.samples.some(x=>x.sheen);await shot(p,'natural-reply-final');save();
   if(!done)await h.api('/commands',{requestId:crypto.randomUUID(),kind:'session.cancel',targetDeviceId:h.hostId,sessionId:other});
   if(done){try{await p.locator('.next-suggestion-chip').first().waitFor({timeout:9000});await shot(p,'natural-suggestions');const expected=await p.locator('.next-suggestion-chip').first().textContent(),count=(await h.api('/commands?limit=100')).body.commands.length;await p.locator('.next-suggestion-chip').first().click();motion.suggestionFilledWithoutSend=await p.locator('#message-text').inputValue()===expected&&(await h.api('/commands?limit=100')).body.commands.length===count;}catch{motion.suggestionFilledWithoutSend=false;}
    await p.locator('#message-text').fill('请把刚才的整理建议');try{await p.locator('.composer-completion:not([hidden])').waitFor({timeout:9000});await shot(p,'natural-gray-completion');const expected='请把刚才的整理建议'+await p.locator('.composer-completion-text').textContent();await p.locator('#message-text').press('Tab');motion.completionAccepted=await p.locator('#message-text').inputValue()===expected;}catch{motion.completionAccepted=false;}await p.locator('#message-text').fill('');}
  }catch(error){motion.error=error.message;}save();
 }finally{report.finishedAt=new Date().toISOString();save();await browser?.close();await h.close();}
 return report;
}
