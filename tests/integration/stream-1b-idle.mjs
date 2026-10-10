/** STREAM-1b: real Electron and shipped mobile UI, isolated synthetic host. */
import assert from 'node:assert/strict';
import { _electron,chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/stream-1/rework');mkdirSync(out,{recursive:true});
const f=await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,sidebar:true,composerMenu:true,historyCount:0,baseTime:Date.now()});
const profile=mkdtempSync(join(tmpdir(),'weftmate-stream1b-'));let app,browser,timer;
const mobileOnly=false;const previous=mobileOnly?JSON.parse(readFileSync(join(out,'idle-desktop.json'),'utf8')):null;const report={synthetic:true,systemBarsVerified:false,surfaces:previous?previous.surfaces.filter(row=>row.surface==='electron'):[],errors:[]};
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const folder=join(f.root,'synthetic-folder');mkdirSync(folder);
const registered=await f.request('/projects',{requestId:'stream1b-folder',name:'合成文件夹',rootPath:folder,permission:'read-only'});
const source=await f.newOutputSource('读取项目资料，运行测试，并保存一份进度报告。',registered.project.projectId);f.sessionId=source.sessionId;
await f.request(`/sessions/${f.sessionId}/metadata`,{title:'流式交互回归'},'PATCH');
f.progress.text('这是一条已经完成的回复，用来验证消息菜单。');f.progress.call('read','stream1b-read',{paths:['synthetic.md']});f.progress.result('stream1b-read','Synthetic read complete.');
try{
 const entry=join(profile,'desktop.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const desktop=createPersonalDesktop({origin:${JSON.stringify(f.origin)},isQuitting:()=>quitting});await desktop.ready;desktop.window.setContentSize(1120,800);});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});const desktop=await app.firstWindow();
 await desktop.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.__streamCore=core;globalThis.__streamUi=ui;ui.loadAttachmentHasher =')}));
 await desktop.route('**/personal/v1/status',async route=>{try{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,personalCapabilities:{...body.personalCapabilities,replyStreaming:1}}});}catch{await route.abort().catch(()=>{});}});await localUiSession(desktop,f.credentials,'STREAM-1b',{interceptLegacyStatus:false});await desktop.waitForFunction(()=>globalThis.__streamCore?.state.mainChat&&!__streamCore.state.refreshing&&!__streamCore.state.sessionSelecting);await desktop.evaluate(id=>__streamCore.selectSession(id),f.sessionId);
 browser=await chromium.launch({headless:true});const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(f.mobileUrl);await mobile.waitForFunction(()=>state.booted&&state.loggedIn);await mobile.evaluate(id=>selectSharedSession(id),f.sessionId);
 const requests=[];desktop.on('request',r=>{if(r.url().includes('/personal/v1/'))requests.push({at:Date.now(),path:new URL(r.url()).pathname});});f.progress.finish();await pause(1600);const start=Date.now(),before=requests.length;await pause(6100);report.surfaces.push({surface:'electron',idleWindow:{start,end:Date.now(),requests:requests.slice(before)},idleRequestsPerSecond:(requests.length-before)/((Date.now()-start)/1000)});
 assert.deepEqual(report.errors,[]);console.log('STREAM-1b interactions passed');
}catch(error){report.failure=error.message;report.buttons=await (await app.firstWindow()).locator('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean));report.hostEvents=await f.request(`/sessions/${f.sessionId}/events?limit=100`);for(const p of await app?.windows()||[])await p.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.error(error);throw error;}
finally{clearInterval(timer);writeFileSync(join(out,'idle-desktop.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await app?.close();await f.close();rmSync(profile,{recursive:true,force:true});rmSync(f.root,{recursive:true,force:true});}
