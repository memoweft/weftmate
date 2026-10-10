/** Remaining task/overlay states on production Electron and the phone bundle. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p2');await mkdir(out,{recursive:true});
const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE')delete env[k];
const rows=[],errors=[];let app,browser,f,profile;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const b=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true});
async function capture(p,surface,t,scene,state='正常'){
 await p.evaluate(t=>document.documentElement.dataset.theme=t,t);await wait(120);
 const screenshot=`after-${surface}-${t}-${scene}.png`;await p.screenshot({path:join(out,screenshot)});
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 rows.push({surface,theme:t,scene,state,screenshot,defects:overflow?['横向溢出']:[],checklist:Array(8).fill(!overflow)});console.log(screenshot);
}
async function dismiss(p){await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));}
try{
 f=await startTimelineCandidate({historyCount:0,interactive:true,composer:true,sidebar:true,riskApproval:true});
 const artifact=await f.progress.artifact();
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p2-states-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));await localUiSession(p,f.credentials);
 for(const width of [1200,480])for(const t of ['light','dark']){
  await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,800),width);const s='electron-'+width;
  await capture(p,s,t,'side-running-approval-question','运行中 / 审批 / 提问');
  if(await b(p,'详情').count()){await b(p,'详情').first().click();await capture(p,s,t,'approval-details');await b(p,'详情').first().click();}
  await b(p,'背景信息窗口：86% 已用').click();await capture(p,s,t,'context-tooltip');await p.keyboard.press('Escape');
  await p.evaluate(()=>{WeftComposerSubtasks.paint(document.getElementById('composer-subtasks'),[{key:'synthetic-1',name:'检查项目资料',state:'running',durationMs:3200,callId:'synthetic-call'},{key:'synthetic-2',name:'整理文档',state:'completed',durationMs:8000,callId:'synthetic-done'}],{scope:'synthetic',root:document.getElementById('transcript')});});
  await b(p,'2 个子任务').click();await capture(p,s,t,'subtask-menu');await p.keyboard.press('Escape');
  if(width<720)await b(p,'切换会话侧栏').click();
  await p.getByRole('button',{name:/^更多操作 项目进度报告/}).click();await capture(p,s,t,'session-menu');
  for(const name of ['重命名','删除']){await p.getByRole('menuitem',{name:new RegExp('^'+name)}).click();await capture(p,s,t,'session-'+(name==='重命名'?'rename':'delete')+'-dialog');await dismiss(p);await p.getByRole('button',{name:/^更多操作 项目进度报告/}).click();}
  await p.keyboard.press('Escape');
  await b(p,'新建项目').click();await capture(p,s,t,'project-new-dialog');await p.getByRole('textbox',{name:'项目说明',exact:true}).fill('这是较长的项目说明。'.repeat(90));await capture(p,s,t,'project-long-dialog','超长文本');await dismiss(p);
  if(width<720&&await b(p,'收起会话侧栏').isVisible())await b(p,'收起会话侧栏').click();
  await b(p,'输出与来源').click();await capture(p,s,t,'outputs-empty','空列表');await p.keyboard.press('Escape');
  // Existing loading/error surfaces use their real production containers.
  await p.evaluate(()=>{const n=document.getElementById('timeline-status');n.hidden=false;n.textContent='正在读取对话…';});await capture(p,s,t,'history-loading','加载中');
  await p.evaluate(()=>{const n=document.getElementById('timeline-status');n.hidden=false;n.textContent='对话暂时无法读取，请检查连接后重试。';});await capture(p,s,t,'history-error','出错');
  await p.reload();await wait(300);
 }
 f.progress.text('合成任务已完成，成果已保存。');f.progress.finish('completed');await p.reload();await wait(400);
 for(const t of ['light','dark']){await b(p,'输出与来源').click();await capture(p,'electron-480',t,'outputs-sources');
  const output=p.getByRole('button',{name:new RegExp(artifact.fileName)}).filter({visible:true});if(await output.count()){await output.first().click();await capture(p,'electron-480',t,'output-preview');await p.keyboard.press('Escape');}await p.keyboard.press('Escape');}
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const size of [{width:360,height:780},{width:390,height:844}]){
  const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/bridge',async r=>{const input=r.request().postDataJSON();if(input.method==='host.status')return r.fulfill({json:{result:await f.request('/status')}});await r.fallback();});await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);await page.evaluate(async id=>{await selectSharedSession(id);closeDrawer()},f.sessionId);
  for(const t of ['light','dark']){await page.evaluate(async id=>{await selectSharedSession(id);page('chat');closeDrawer()},f.sessionId);await page.evaluate(t=>applyTheme(t),t);const s='android-bundle-'+size.width;
   await capture(page,s,t,'side-completed');await b(page,'添加图片或文件').click();await capture(page,s,t,'attachment-menu');await page.keyboard.press('Escape');
   await page.evaluate(()=>page('activity'));await capture(page,s,t,'activity');await page.evaluate(()=>page('goals'));await wait(200);await capture(page,s,t,'goals');
   await page.evaluate(()=>page('things'));await capture(page,s,t,'things');
   await page.evaluate(()=>page('home'));await capture(page,s,t,'projects-list');
   await page.evaluate(()=>{page('chat');state.sharedHostAvailable=false;updateComposer();status('电脑离线，只能聊天和使用记忆。',true)});await capture(page,s,t,'computer-offline','电脑离线');
   await page.evaluate(()=>{state.sharedHostAvailable=true;page('settings')});
   const dialogs=await page.locator('dialog[id]').evaluateAll(ns=>ns.map(n=>n.id));for(const id of dialogs){await page.evaluate(id=>document.getElementById(id).showModal(),id);await capture(page,s,t,'dialog-'+id,'打开态（结构验收）');await dismiss(page);}
  }
  await page.close();
 }
 // Unauthenticated entry is captured in real Electron with its own isolated cookie jar.
 await p.context().clearCookies();await p.reload();await wait(400);
 for(const t of ['light','dark']){await capture(p,'electron-480',t,'login','未登录');const local=b(p,'本机应急登录');if(await local.count()){await local.click();await capture(p,'electron-480',t,'local-login');await p.reload();await wait(250);}}
 assert.deepEqual(errors,[]);await writeFile(join(out,'states-checks.json'),JSON.stringify({synthetic:true,modelRequests:0,rows,errors},null,2));
}finally{await writeFile(join(out,'states.partial.json'),JSON.stringify({rows,errors},null,2));await browser?.close();await app?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f)await rm(f.root,{recursive:true,force:true});}
