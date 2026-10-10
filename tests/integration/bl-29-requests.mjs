/** Route × caller census, using the STREAM-1b isolated fixture and real Electron. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const stage = process.argv.includes('--before') ? 'before' : 'after';
const latencyOnly=process.argv.includes('--latency');
const logical=process.argv.includes('--logical'),reportName=latencyOnly?'responsiveness':stage+(logical?'-main':'');
const baseline='ec3ab4996609a6d81181bc178f024d5e5158c577';
const out = resolve('tests/evidence/bl-29'); mkdirSync(out,{recursive:true});
const pause = ms => new Promise(done=>setTimeout(done,ms));
const f = await startTimelineCandidate({interactive:true,daily:true,logicalMobile:logical,inlineProgress:true,sidebar:true,composerMenu:true,historyCount:0,baseTime:Date.now()});
const profile = mkdtempSync(join(tmpdir(),'weftmate-bl29-'));
let app, browser, timer;
const report = {synthetic:true,realModelRequests:0,stage,logical,baseline,surfaces:[],checks:[]};
const source=path=>stage==='before'?execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'}):readFileSync(path,'utf8');
function instrument() {
  Error.stackTraceLimit=35;
  globalThis.__census=[];globalThis.__wire=[];
  const normalize=path=>path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id');
  const record=(route,stack)=>__census.push({at:Date.now(),route:normalize(route),caller:stack.split('\n').slice(2).map(line=>line.trim().replace(/https?:\/\/[^/]+/g,'')).join(' ← ')});
  const original=globalThis.fetch;
  globalThis.fetch=function(url,options){if(String(url).includes('/personal/v1'))record(new URL(url,location.href).pathname,new Error().stack);
    const promise=original.call(this,url,options);
    if(String(url)==='/bridge'){const input=JSON.parse(options.body);void promise.then(async response=>__wire.push({at:Date.now(),route:normalize(input.method+(input.params?.path?' '+new URL(input.params.path,location.href).pathname:'')),requestBodyBytes:new TextEncoder().encode(options.body).length,responseBodyBytes:new TextEncoder().encode(await response.clone().text()).length,status:response.status})).catch(()=>{});}
    return promise;};
  if(window.weftNative){const post=weftNative.postMessage;weftNative.postMessage=function(raw){const input=JSON.parse(raw);record(input.method+(input.params?.path?' '+new URL(input.params.path,location.href).pathname:''),new Error().stack);return post.call(this,raw);};}
}
try {
  if(logical){
    const chat=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
    const created=await f.request('/commands',{requestId:'bl29-main-warm',kind:'chat.message',chatId:chat.chatId,modelProfileId:'local',targetDeviceId:host,text:'合成主对话'});
    for(let n=0;n<100;n++){const command=(await f.request('/commands/'+created.command.commandId)).command;if(command.state==='accepted_by_dsh'){f.sessionId=command.sessionId;break;}await pause(20);}
  }
  f.progress.text('已完成的合成回复。'); f.progress.finish();
  const entry=join(profile,'desktop.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const desktop=createPersonalDesktop({origin:${JSON.stringify(f.origin)},isQuitting:()=>quitting});await desktop.ready;desktop.window.setContentSize(1120,800);});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});
  const desktop=await app.firstWindow();
  desktop.setDefaultTimeout(15000);
  await desktop.route('**/personal/v1/ui/**/*.js',route=>{const path=new URL(route.request().url()).pathname.split('/ui/')[1];const file=path.startsWith('ui-core/')?'src/'+path:'src/personal-access-ui/'+path;
    return route.fulfill({contentType:'text/javascript',body:source(file).replace('ui.loadAttachmentHasher =','globalThis.__streamCore=core;globalThis.__streamUi=ui;ui.loadAttachmentHasher =')});});
  await localUiSession(desktop,f.credentials,'BL-29',{interceptLegacyStatus:false});
  console.log('desktop logged in');
  await desktop.waitForFunction(()=>globalThis.__streamCore?.state.mainChat&&!__streamCore.state.refreshing&&!__streamCore.state.sessionSelecting);
  await desktop.evaluate(id=>__streamCore.selectSession(id),f.sessionId);
  browser=await chromium.launch({headless:true});const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  if(stage==='before')await mobile.route('**/*.js',route=>{const path=new URL(route.request().url()).pathname.slice(1);if(path==='bridge.js')return route.continue();return route.fulfill({contentType:'text/javascript',body:source('apps/mobile-ui/www/'+path)});});
  await mobile.goto(f.mobileUrl);await mobile.waitForFunction(()=>state.booted&&state.loggedIn);await mobile.evaluate(id=>selectSharedSession(id),f.sessionId);
  const pages=[['electron',desktop],['mobile',mobile]];
  for(const [surface,p] of pages){await p.evaluate(instrument);report.surfaces.push({surface,windows:[]});}
  async function measure(name,duration){
    const starts=await Promise.all(pages.map(async([,p])=>p.evaluate(()=>({at:Date.now(),index:__census.length,visibility:document.visibilityState}))));
    await pause(duration);
    for(let i=0;i<pages.length;i++){
      const [,p]=pages[i],start=starts[i],end=await p.evaluate(()=>({at:Date.now(),rows:__census,wire:__wire}));
      const rows=end.rows.slice(start.index),seconds=(end.at-start.at)/1000,counts=new Map();
      for(const row of rows){const key=JSON.stringify([row.route,row.caller]);const item=counts.get(key)||{route:row.route,caller:row.caller,count:0};item.count++;counts.set(key,item);}
      const groups=[...counts.values()].map(row=>({...row,perMinute:row.count/seconds*60})).sort((a,b)=>b.count-a.count);
      report.surfaces[i].windows.push({name,seconds,visibility:start.visibility,total:rows.length,perSecond:rows.length/seconds,groups,wire:end.wire.filter(row=>row.at>=start.at&&row.at<=end.at)});
      console.log(stage,pages[i][0],name,rows.length,(rows.length/seconds).toFixed(3));
    }
    writeFileSync(join(out,reportName+'.json'),JSON.stringify(report,null,2)+'\n');
  }
  if(latencyOnly){
    await pause(1500);
    const host=(await f.request('/status')).hostId,chat=(await f.request('/chats/main')).chat;
    const send=async(text,requestId)=>{const value=await f.request('/commands',{requestId,kind:'chat.message',chatId:chat.chatId,modelProfileId:'local',targetDeviceId:host,text});
      for(let n=0;n<100;n++){const cmd=(await f.request('/commands/'+value.command.commandId)).command;if(cmd.state==='accepted_by_dsh'){f.sessionId=cmd.sessionId;return cmd;}await pause(20);}};
    const at=Date.now();await send('另一台设备的新消息','bl29-other-message');
    for(const [surface,p] of pages){await p.getByText('另一台设备的新消息',{exact:true}).first().waitFor({state:'visible',timeout:6000});report.checks.push({name:'other-device-message',surface,ms:Date.now()-at});}
    await pause(300);
    let start=Date.now();const approval=await f.progress.approve('bl29-approval','Write-Output synthetic');
    await mobile.locator('#approval-bar').getByRole('button',{name:'批准',exact:true}).waitFor({state:'visible',timeout:2000});
    report.checks.push({name:'approval-visible',surface:'mobile',ms:Date.now()-start});start=Date.now();
    await mobile.locator('#approval-bar').getByRole('button',{name:'批准',exact:true}).click();
    await mobile.waitForFunction(()=>document.querySelector('#approval-bar').hidden,{timeout:2000});
    const approvals=(await f.request(`/sessions/${f.sessionId}/approvals?limit=100`)).approvals;
    assert.equal(approvals.find(row=>row.approvalId===approval.approvalId)?.status,'answered');report.checks.push({name:'approval-accepted',ms:Date.now()-start});
    await f.progress.resolve(approval,'allowed-once');
    f.progress.result('bl29-approval','Synthetic command completed.');
    start=Date.now();f.progress.ask([{id:'format',question:'合成问题：请填写一个词',multiSelect:false,options:[]}]);
    await mobile.getByRole('textbox',{name:'你的回答',exact:true}).waitFor({state:'visible',timeout:2000});report.checks.push({name:'question-visible',surface:'mobile',ms:Date.now()-start});
    await mobile.getByRole('textbox',{name:'你的回答',exact:true}).fill('合成答案');start=Date.now();await mobile.getByRole('button',{name:'提交回答',exact:true}).click();
    await mobile.waitForFunction(()=>document.querySelector('#question-bar').hidden,{timeout:2000});report.checks.push({name:'question-accepted',ms:Date.now()-start});
    f.progress.finish();
    const createAt=Date.now(),created=await f.request('/commands',{requestId:'bl29-new-session',kind:'session.create',modelProfileId:'local',targetDeviceId:host});
    let newId;
    for(let n=0;n<100;n++){const cmd=(await f.request('/commands/'+created.command.commandId)).command;if(cmd.state==='accepted_by_dsh'){newId=cmd.sessionId;break;}await pause(20);}
    assert.ok(newId,'new session receives native entity receipt');await f.request(`/sessions/${newId}/metadata`,{title:'跨设备新会话'},'PATCH');
    for(const [surface,p]of pages){await p.waitForFunction(({surface,id})=>(surface==='mobile'?uiCore:__streamCore).state.sessions.some(row=>row.sessionId===id&&row.title==='跨设备新会话'),{surface,id:newId},{timeout:6000});report.checks.push({name:'new-session',surface,ms:Date.now()-createAt});}
    start=Date.now();await f.request(`/sessions/${newId}/metadata`,{title:'跨设备改名'},'PATCH');
    for(const [surface,p]of pages){await p.waitForFunction(({surface,id})=>(surface==='mobile'?uiCore:__streamCore).state.sessions.some(row=>row.sessionId===id&&row.title==='跨设备改名'),{surface,id:newId},{timeout:6000});report.checks.push({name:'rename-session',surface,ms:Date.now()-start});}
    for(const [surface,p]of pages){await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      const text='后台恢复'+surface;await send(text,'bl29-background-'+surface);await pause(200);f.progress.text('恢复到最新'+surface);f.progress.finish();start=Date.now();
      await p.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
      await p.getByText('恢复到最新'+surface,{exact:true}).first().waitFor({state:'visible',timeout:1000});report.checks.push({name:'foreground-recovery',surface,ms:Date.now()-start});
      await p.evaluate(({surface})=>{const c=surface==='mobile'?uiCore:__streamCore;c.connectionNetwork(false);},{surface});
      assert.match(await p.locator('.presence-copy').innerText(),/网络不可用/);start=Date.now();
      await p.evaluate(({surface})=>(surface==='mobile'?uiCore:__streamCore).connectionNetwork(true),{surface});
      await p.waitForFunction(({surface})=>(surface==='mobile'?uiCore:__streamCore).connectionView().kind==='online',{surface},{timeout:2000});report.checks.push({name:'connection-recovery',surface,ms:Date.now()-start});
      await p.screenshot({path:join(out,`${surface}-recovered.png`)});
    }
  }else{
  await pause(6500);await measure('foreground-idle',61000);
  let total='';timer=setInterval(()=>{const text='合成正文持续增长。';total+=text;f.progress.chunk(text);},220);
  // Start a fresh native turn so both projections know the reply is running.
  await f.request('/commands',{requestId:'bl29-stream',kind:logical?'chat.message':'session.message',...(logical?{chatId:(await f.request('/chats/main')).chat.chatId,modelProfileId:'local'}:{sessionId:f.sessionId}),targetDeviceId:(await f.request('/status')).hostId,text:'合成流式回复'});
  await pause(6500);await measure('streaming',30000);clearInterval(timer);timer=null;f.progress.completeStream(total);f.progress.finish();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
  report.checks.push({name:'electron-minimized',minimized:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),visibility:await desktop.evaluate(()=>document.visibilityState)});
  await pause(2000);await measure('electron-minimized',30000);
  // Windows can retain visible with an attached debugger; exercise hidden separately too.
  await desktop.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await mobile.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await pause(2000);await measure('background',30000);
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.restore();win.show();});
  await desktop.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
  await mobile.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
  await pause(6500);
  await desktop.evaluate(()=>__streamUi.openSettings('appearance'));await mobile.evaluate(()=>page('appearance'));await pause(2000);await measure('settings',30000);
  await desktop.evaluate(()=>document.querySelector('#settings-dialog').close());
  for(const name of ['activity','goals','library']){
    await desktop.evaluate(name=>__streamUi[name==='activity'?'openActivity':name==='goals'?'openGoals':'openLibrary'](),name);
    await mobile.evaluate(name=>page(name),name);await pause(2000);await measure(name,12000);
  }
  }
  if(stage==='after'&&!latencyOnly)for(const row of report.surfaces){
    assert.ok(row.windows.find(w=>w.name==='foreground-idle').perSecond<=2,row.surface+' idle budget');
    assert.ok(row.windows.find(w=>w.name==='background').total<=3,row.surface+' background 30s budget');
    if(row.surface==='electron')assert.ok(row.windows.find(w=>w.name==='electron-minimized').total<=3,'native minimized 30s budget');
  }
} catch(error){report.failure=error.message;report.desktopDebug=await (await app?.firstWindow())?.evaluate(()=>({text:document.body.innerText,core:!!globalThis.__streamCore,state:globalThis.__streamCore?{view:__streamCore.state.currentView,main:__streamCore.state.mainChat,refreshing:__streamCore.state.refreshing}:null})).catch(()=>null);throw error;}
finally{clearInterval(timer);writeFileSync(join(out,reportName+'.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await app?.close();await f.close();rmSync(profile,{recursive:true,force:true});rmSync(f.root,{recursive:true,force:true});}
