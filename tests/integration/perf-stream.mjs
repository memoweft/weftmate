import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const root=resolve(import.meta.dirname,'../..'), out=process.env.WEFTMATE_PERF_STREAM_OUTPUT || await mkdtemp(join(tmpdir(),'weftmate-perf-stream-'));
await mkdir(out,{recursive:true});
process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(out,'fixtures');
let app,fixture,lock;
try {
  if(process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for(let n=1;n<=3;n++) {
      const path=join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);
      try {const file=await open(path,'wx');await file.writeFile('PERF-STREAM '+new Date().toISOString());await file.close();lock=path;break;}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
    assert.ok(lock,'No heavy slot');
  }
  fixture=await startFixture();
  const history=fixture.logs.get(fixture.source);history.length=0;
  for(const [type,data] of [['turn.started',{turn:1}],['user.message',{text:'合成流式问题',receiptId:'perf-stream',turn:1}]])
    history.push({seq:history.length,type,data,sessionId:fixture.source,at:new Date().toISOString()});
  const profile=join(out,'profile');await mkdir(profile,{recursive:true});
  const env={...process.env,PERF_SWITCH_PROFILE:profile,PERF_SWITCH_ORIGIN:fixture.origin,PERF_SWITCH_TOKEN:fixture.libraryDesktopToken};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/perf-switch-electron.mjs'],env,timeout:25000});
  app.process().stdout?.resume();app.process().stderr?.resume();
  const page=await app.firstWindow();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});Object.defineProperty(document,'hidden',{get:()=>false});});
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
  if(process.argv.includes('--original'))for(const file of ['components/main-chat.js','conversation-scroll.js','ui-core/rendering.js','ui-core/reply-motion.js']) {
    const path=file.startsWith('ui-core/')?`src/${file}`:`src/personal-access-ui/${file}`;
    const body=execFileSync('git',['show',`HEAD:${path}`],{cwd:root,encoding:'utf8'});
    await page.route(`**/personal/v1/ui/${file}`,route=>route.fulfill({contentType:'text/javascript',body}));
  }
  await page.waitForURL('**/personal/v1/ui');await localUiSession(page,fixture.credentials,'PERF-STREAM synthetic',{mainChat:true});
  await page.waitForFunction(()=>globalThis.__WeftUiStarted&&testCore.state.sessions.length>0);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.evaluate(async id=>{await testCore.selectSession(id);testCore.stopAssistantRefresh();},fixture.source);
  await page.evaluate(()=>{
    globalThis.streamSamples=[];globalThis.streamIndex=0;
    const sample=()=>{const box=document.getElementById('chat-scroll');streamSamples.push({at:performance.now(),index:streamIndex,top:box.scrollTop,height:box.scrollHeight,gap:box.scrollHeight-box.clientHeight-box.scrollTop,pinned:testUi.conversationScroll.pinned,x:document.getElementById('transcript').getBoundingClientRect().left});globalThis.streamSampleFrame=requestAnimationFrame(sample);};sample();
    globalThis.grow=async count=>{
      for(let n=0;n<count;n++){
        streamIndex++;
        const text=Array.from({length:streamIndex},(_,i)=>`${i+1}. 合成清单第 ${i+1} 项。`).join('\n');
        testCore.appendHistory([],[{seq:2,type:'assistant.delta',sessionId:testCore.state.selectedSessionId,at:new Date().toISOString(),data:{text,streaming:true,turn:1}}],streamIndex);
        await new Promise((resolve,reject)=>requestAnimationFrame(()=>{
          const body=document.querySelector('#transcript .message.assistant .message-text');
          if(body?._renderText!==text)reject(new Error(`Stream snapshot ${streamIndex} missed its first frame`));
          else requestAnimationFrame(resolve);
        }));
      }
    };
  });
  await page.evaluate(()=>grow(100));
  const lefts=await page.evaluate(()=>streamSamples.filter(s=>s.index>0).map(s=>s.x));
  assert.ok(Math.max(...lefts)-Math.min(...lefts)<=.5,`Streaming scrollbar moved the reading column: ${Math.max(...lefts)-Math.min(...lefts)}px`);
  const followed=await page.evaluate(()=>streamSamples.filter(s=>s.index>25));
  await writeFile(join(out,'follow.json'),JSON.stringify(followed,null,2));
  assert.ok(followed.every(s=>Math.abs(s.gap)<=2),`Streaming bottom gap: ${Math.max(...followed.map(s=>s.gap))}`);
  await page.locator('#chat-scroll').hover();await page.mouse.wheel(0,-350);
  await page.waitForFunction(()=>!testUi.conversationScroll.pinned);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const anchor=await page.evaluate(()=>{const box=document.getElementById('chat-scroll').getBoundingClientRect();const row=[...document.querySelectorAll('#transcript .message.assistant li')].find(e=>e.getBoundingClientRect().bottom>box.top);return {text:row.textContent,y:row.getBoundingClientRect().top};});
  await page.evaluate(()=>grow(60));
  const held=await page.evaluate(anchor=>{const row=[...document.querySelectorAll('#transcript .message.assistant li')].find(e=>e.textContent===anchor.text);return {pinned:testUi.conversationScroll.pinned,y:row?.getBoundingClientRect().top};},anchor);
  assert.equal(held.pinned,false);assert.ok(Math.abs(held.y-anchor.y)<=1,JSON.stringify({anchor,held}));
  await page.getByRole('button',{name:'回到底部',exact:true}).click();
  await page.waitForFunction(()=>testUi.conversationScroll.pinned);
  await page.evaluate(()=>grow(5));
  assert.ok(await page.evaluate(()=>{const box=document.getElementById('chat-scroll');return Math.abs(box.scrollHeight-box.clientHeight-box.scrollTop)<=2;}));
  await page.screenshot({path:join(out,'stream.png')});
  await page.evaluate(()=>cancelAnimationFrame(streamSampleFrame));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({followFrames:followed.length,maxGap:Math.max(...followed.map(s=>Math.abs(s.gap))),anchorDrift:held.y-anchor.y,items:165}));
} finally {
  await app?.close();await fixture?.close();if(lock)await unlink(lock);
  if(!process.env.WEFTMATE_PERF_STREAM_OUTPUT)await rm(out,{recursive:true,force:true});
}
