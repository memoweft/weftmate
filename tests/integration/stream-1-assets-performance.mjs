import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/stream-1/assets');mkdirSync(out,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),'weftmate-stream1-perf-'));let app,browser;
const fixture=await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,sidebar:true,historyCount:0});
await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{title:'项目进度报告'},'PATCH');
const report={synthetic:true,androidNativeDevice:false,systemBarsVerified:false,surfaces:[]};
try{
 const entry=join(profile,'desktop.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const desktop=createPersonalDesktop({origin:${JSON.stringify(fixture.origin)},isQuitting:()=>quitting});await desktop.ready;desktop.window.setContentSize(1200,800);});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});const desktop=await app.firstWindow();desktop.setDefaultTimeout(15000);await localUiSession(desktop,fixture.credentials,'STREAM-1 performance',{interceptLegacyStatus:false});
 browser=await chromium.launch({headless:true});const phone=await browser.newPage({viewport:{width:390,height:844}});await phone.goto(fixture.origin+'/personal/v1/ui');await localUiSession(phone,fixture.credentials,'STREAM-1 performance phone',{interceptLegacyStatus:false});
 const android=await browser.newPage({viewport:{width:390,height:844}});await android.goto(fixture.mobileUrl);await android.waitForFunction(()=>state.booted&&state.loggedIn);
 const select=async(p,surface)=>{if(surface==='android-ui'){await p.evaluate(()=>listSharedSessions());await p.getByRole('button',{name:'打开导航',exact:true}).click();}const button=p.getByRole('button',{name:'项目进度报告',exact:true,includeHidden:true});await button.waitFor({state:'attached'});if(surface==='phone'&&!await button.isVisible())await p.locator('#rail-open').click();await button.click();};
 for(const [surface,p] of [['desktop',desktop],['phone',phone],['android-ui',android]]){
  await select(p,surface);await p.waitForFunction(()=>!!globalThis.WeftContent);
  for(const theme of ['light','dark']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.screenshot({path:join(out,`${surface}-before-${theme}.png`)});}
  const perf=await p.evaluate(async()=>{
   const text='# 万字性能样张\n\n'+('中文 English 内容用于测试换行与高度。'.repeat(400))+'\n\n'+Array.from({length:20},(_,i)=>'```javascript\n'+`const code${i} = "value";\n`.repeat(12)+'```').join('\n\n')+'\n\n'+Array.from({length:5},()=> '| 项目 | 数量 |\n| --- | ---: |\n| A | 12 |\n| B | 32 |').join('\n\n');
   const host=WeftContent.create(text);host.style.cssText='position:fixed;left:0;top:0;width:390px;height:300px;overflow:hidden;z-index:5';document.body.append(host);WeftReplyMotion.indicator(host,true);
   const code=host.querySelector('.render-code'),updates=[],gaps=[];let last;
   try{for(let n=1;n<=120;n++){const frame=await new Promise(requestAnimationFrame);if(last!==undefined)gaps.push(frame-last);last=frame;const at=performance.now();WeftContent.update(host,text+'\n\n正在输出 '+n+'。',{streaming:true});host.getBoundingClientRect();updates.push(performance.now()-at);}const p95=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length*.95)];return {characters:text.length,codeBlocks:20,tables:5,updates,gaps,updateP95Ms:p95(updates),frameGapP95Ms:p95(gaps),stableCodeNode:code===host.querySelector('.render-code')};}finally{host.remove();}
  });assert.equal(perf.stableCodeNode,true);report.surfaces.push({surface,perf});
 }
 const frames=[];await android.evaluate(()=>{globalThis.stream1Frames=[];function read(){const body=document.querySelector('.message.assistant .markdown');stream1Frames.push({at:Date.now(),length:body?.textContent.length||0,dot:!!body?.querySelector('.reply-indicator')});stream1Raf=requestAnimationFrame(read);}read();});
 let text='';for(let n=0;n<14;n++){const chunk=`第${n+1}段：先分类，再整理，最后核对备份。\n\n`;text+=chunk;fixture.progress.chunk(chunk);await android.waitForTimeout(310);await android.screenshot({path:join(out,`android-frame-${String(n).padStart(2,'0')}.png`)});}
 fixture.progress.completeStream(text);fixture.progress.finish();await android.waitForTimeout(700);
 report.android=await android.evaluate(()=>({frames:stream1Frames,remainingDots:document.querySelectorAll('.reply-indicator').length,rows:document.querySelectorAll('.message.assistant').length}));
 assert.ok(new Set(report.android.frames.map(x=>x.length)).size>8);assert.ok(report.android.frames.some(x=>x.dot));assert.equal(report.android.remainingDots,0);assert.equal(report.android.rows,1);
 for(const [surface,p]of [['desktop',desktop],['phone',phone],['android-ui',android]])for(const theme of ['light','dark']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.screenshot({path:join(out,`${surface}-stream-final-${theme}.png`)});}
 report.narrow=[];
 for(const [surface,p,width,height]of [['desktop',desktop,480,800],['phone',phone,360,780],['android-ui',android,360,780]]){
  if(surface==='desktop')await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});else await p.setViewportSize({width,height});
  for(const theme of ['light','dark']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.screenshot({path:join(out,`${surface}-${width}-${theme}.png`)});report.narrow.push({surface,width,height,theme,...await p.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,composer:!!document.querySelector('textarea')}))});}
 }
 writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.surfaces.map(x=>({surface:x.surface,p95:x.perf.updateP95Ms,frameP95:x.perf.frameGapP95Ms}))));
}catch(e){report.failure=e.message;console.error(e.message);throw e;}finally{writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await app?.close();await fixture.close();rmSync(profile,{recursive:true,force:true});rmSync(fixture.root,{recursive:true,force:true});}
