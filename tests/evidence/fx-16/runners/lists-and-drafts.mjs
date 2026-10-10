import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './candidate.mjs';
import {localUiSession} from '../../../../tests/helpers/local-ui-session.mjs';
const out=resolve(process.env.FX16_DRAFT_OUT||'tests/evidence/fx-16'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
const report={startedAt:new Date().toISOString(),syntheticRecords:true,realPersonalApi:true,realElectron:true,budgets:{listP95Ms:150,createInputP95Ms:1000},populations:[],drafts:[]};
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let f,app,browser,profile;
const save=()=>writeFile(join(out,'lists-and-drafts.json'),JSON.stringify(report,null,2));
try{
 await mkdir(out,{recursive:true});
 f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,interactive:true,inlineProgress:true,historyCount:0});
 profile=await mkdtemp(join(tmpdir(),'weftmate-fx16-ui-'));
 browser=await chromium.launch();
 for(const count of process.env.FX16_MERGE_RECHECK ? [500] : [500,2000]){
  await f.seedPopulation(count);
  const times={sessions:[],chats:[]};
  for(let n=0;n<30;n++)for(const route of ['sessions','chats']){const t=performance.now();const result=await f.request('/'+route+'?archived=all&limit=100');times[route].push(performance.now()-t);assert.equal((result.sessions||result.items).length,100);assert.equal(result.hasMore,true);}
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
  let page=await app.firstWindow();await page.route('**/personal/v1/onboarding',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({onboarding:{step:'first',completed:true,started:true}})}));page.setDefaultTimeout(15000);await localUiSession(page,f.credentials,'FX16 synthetic',{mainChat:true});await page.locator('#assistant-view').waitFor({state:'visible'});
  const creates=[];
  for(let n=0;n<10;n++){
   const prior=await page.locator('#session-list [data-session-id]:has(button.is-current)').first().getAttribute('data-session-id').catch(()=>null);const t=performance.now();await page.getByRole('button',{name:/^(新对话|新旁聊) Ctrl N$/,exact:true}).click();
   await page.waitForFunction(prior=>{const row=document.querySelector('#session-list [data-session-id]:has(button.is-current)');return row&&row.dataset.sessionId!==prior&&!document.getElementById('message-text').disabled;},prior);
   creates.push(performance.now()-t);console.log(count,n,creates.at(-1));await pause(250);
  }
  const rows=await page.locator('#session-list [data-session-id]').count();assert.ok(rows<=102);
  await page.screenshot({path:join(out,'desktop-'+count+'.png')});
  const result={count,sessionsP95Ms:p95(times.sessions),chatsP95Ms:p95(times.chats),createInputP95Ms:p95(creates),renderedRows:rows,listSamples:times,createSamples:creates};
  report.populations.push(result);await save();
  if(count===500){assert.ok(result.sessionsP95Ms<150,JSON.stringify(result));assert.ok(result.chatsP95Ms<150,JSON.stringify(result));assert.ok(result.createInputP95Ms<1000,JSON.stringify(result));}
  if(count===500){
   await app.close();app=null;await f.seedPopulation(2);
   app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
   page=await app.firstWindow();await localUiSession(page,f.credentials,'FX16 draft isolation',{mainChat:true});await page.locator('#assistant-view').waitFor();await page.locator('#session-list [data-session-id]').first().waitFor();
   const original=execFileSync('git',['show','a086c3964d84906cfb0228f332b1f16ef3fac009:src/ui-core/main-chat.js'],{encoding:'utf8',windowsHide:true});
   const current=readFileSync('src/ui-core/main-chat.js','utf8');
   const originalSelection=original.slice(original.indexOf('    async function selectSession('),original.indexOf('    async function readPage('));
   const oldSource=current.slice(0,current.indexOf('    async function selectSession('))+originalSelection+current.slice(current.indexOf('    async function readPage('));
   for(const [surface,width,height]of [['electron',1200,800],['phone-web',390,844]]){
    const target=surface==='electron'?page:await browser.newPage({viewport:{width,height}});
    if(surface!=='electron') {await target.goto(f.origin+'/personal/v1/ui');await localUiSession(target,f.credentials,'FX16 synthetic phone',{mainChat:true});await target.waitForFunction(()=>globalThis.__WeftUiStarted===true);await target.locator('#session-list [data-session-id]').first().waitFor({state:'attached'});}
    const select=async()=>{f.setHistoryDelay(2000);const row=target.locator('#session-list [data-session-id] > button').first();await row.waitFor({state:'attached'});if(!await row.isVisible())await target.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await row.click();};
    if(surface==='electron'&&!process.env.FX16_MERGE_RECHECK){
     await target.route('**/ui-core/main-chat.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:oldSource}));await target.reload();await target.locator('#assistant-view').waitFor();await target.locator('#session-list [data-session-id]').first().waitFor();
     f.setHistoryDelay(2000);await target.locator('#session-list [data-session-id] > button').first().click();
     const draft=target.locator('#message-text');await draft.fill('QA4_B01_SYNTHETIC_'.repeat(7));const entered=await draft.inputValue();await pause(2300);const retained=await draft.inputValue();
     report.before={baseline:'a086c396',injectedOriginalSelection:true,enteredLength:entered.length,retainedLength:retained.length};assert.equal(retained.length,0);await target.screenshot({path:join(out,'before-draft-cleared.png')});await target.unroute('**/ui-core/main-chat.js');f.setHistoryDelay(0);await target.reload();await target.locator('#assistant-view').waitFor();
    }
    await select();assert.equal(await target.locator('#message-text').isDisabled(),true);assert.equal(await target.locator('#send-message').isDisabled(),true);await pause(2200);
    await target.locator('#message-text').fill('FX16首次输入文字与附件草稿保留');await pause(2200);assert.equal(await target.locator('#message-text').inputValue(),'FX16首次输入文字与附件草稿保留');assert.equal(await target.locator('#send-message').isEnabled(),true);
    await target.screenshot({path:join(out,surface+'-delay-draft.png')});report.drafts.push({surface,width,height,delayMs:2000,lostCharacters:0,firstInputSendEnabled:true});f.setHistoryDelay(0);await save();if(surface!=='electron')await target.close();
   }
  }
  await app.close();app=null;
 }
}catch(error){report.error=error.stack;await save();if(app){const p=await app.firstWindow();await p.screenshot({path:join(out,'lists-failure.png'),timeout:3000}).catch(()=>{});report.dom=await p.locator('body').innerText({timeout:3000}).catch(()=>null);}report.error=error.stack;throw error;}finally{await app?.close();await browser?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f?.root)await rm(f.root,{recursive:true,force:true});report.cleaned=true;await save();}
