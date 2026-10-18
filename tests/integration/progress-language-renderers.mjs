// Exercise production renderer bundles in real DOMs with explicit synthetic events.
import assert from 'node:assert/strict';
import { chromium, _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, writeFile, mkdtemp, rm, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const root = resolve(import.meta.dirname, '../..'), evidence = process.env.WEFTMATE_EVIDENCE_DIR;
const useElectron = process.argv.includes('--electron');
const events = [
  {seq:0,type:'turn.started',sessionId:'synthetic',data:{turn:1}},
  {seq:1,type:'user.message',sessionId:'synthetic',data:{text:'Please list the saved reminders.'}},
  {seq:2,type:'step.started',sessionId:'synthetic',data:{taskId:'turn-1',stepId:'schedule',toolName:'schedule_list',state:'running'}},
  {seq:3,type:'step.completed',sessionId:'synthetic',data:{taskId:'turn-1',stepId:'schedule',toolName:'schedule_list',state:'completed',detailRef:{seq:3}}},
  {seq:4,type:'assistant.message',sessionId:'synthetic',data:{text:'There are no saved reminders.'}},
  {seq:5,type:'turn.ended',sessionId:'synthetic',data:{turn:1,reason:'completed'}}
];
let browser, browserServer, app, profile, lock, watchdog; const results = [];
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
  else child.kill('SIGKILL');
}
async function check(name, run) {
  try { await run(); results.push({name,passed:true}); console.log('PASS '+name); }
  catch(error) { results.push({name,passed:false,error:error.message}); console.error('FAIL '+name+': '+error.message); }
}
async function prepare(page, surface) {
  page.setDefaultTimeout(4000);
  await page.setContent('<!doctype html><html><head><title>WeftMate progress renderer check</title></head><body><ol id="timeline"></ol></body></html>');
  await page.addStyleTag({path:join(root,'src/personal-access-ui/styles.css')});
  await page.evaluate(() => {
    globalThis.WeftUiCore={factories:{}};
    globalThis.WeftIcons={create:()=>document.createElement('span')};
  });
  await page.addScriptTag({path:join(root,'src/ui-core/timeline-model.js')});
  await page.addScriptTag({path:join(root,'src/ui-core/tasks.js')});
  if(surface==='desktop') await page.addScriptTag({path:join(root,'src/personal-access-ui/components/steps.js')});
  await page.addScriptTag({path:join(root,surface==='desktop'?'src/personal-access-ui/timeline.js':'apps/mobile-ui/www/timeline.js')});
}
async function capture(page, name) {
  if (!evidence) return;
  for (const theme of ['light','dark']) {
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    await page.screenshot({path:join(evidence,name+'-'+theme+'.png'),fullPage:true});
  }
}
try {
  watchdog=setTimeout(()=>{killTree(app?.process());killTree(browserServer?.process());process.exit(1);},90000);
  if(evidence) await mkdir(evidence,{recursive:true});
  browserServer=await chromium.launchServer({headless:true,timeout:15000});
  browser=await chromium.connect(browserServer.wsEndpoint(),{timeout:15000});
  let desktop;
  if(useElectron) {
    const locks=process.env.WEFTMATE_HEAVY_LOCK_DIR;if(!locks)throw Error('Heavy lock directory required');
    for(const number of [1,2,3]) {const candidate=join(locks,'heavy-'+number+'.lock');try{const fd=await open(candidate,'wx');await fd.writeFile('538 review renderer '+new Date().toISOString());await fd.close();lock=candidate;break;}catch(error){if(error.code!=='EEXIST')throw error;}}
    if(!lock)throw Error('No heavy slot');
    profile=await mkdtemp(join(tmpdir(),'weftmate-progress-renderer-'));
    const env={...process.env,PROGRESS_RENDERER_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[join(root,'tests/helpers/progress-language-window.cjs')],env,timeout:15000});
    app.process().stdout?.resume();app.process().stderr?.resume();desktop=await app.firstWindow();
  } else desktop=await browser.newPage();
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await prepare(desktop,'desktop');await prepare(mobile,'mobile');
  await check('mobile waiting label uses the turn language',async()=>{
    await mobile.evaluate(rows=>WeftTimeline.render(rows,document.querySelector('#timeline'),{waiting:'等待模型回复… 14 秒'}),events.slice(0,2));
    assert.equal(await mobile.locator('.inline-progress-text').innerText(),'Waiting for the model… 14 s');
    await capture(mobile,'mobile-waiting');
  });
  await check('mobile completed steps keep translated waiting and disclosure labels',async()=>{
    await mobile.evaluate(rows=>WeftTimeline.render(rows,document.querySelector('#timeline'),{waiting:'等待模型回复… 14 秒'}),events.slice(0,4));
    assert.match(await mobile.locator('.inline-progress-text').innerText(),/Waiting for the model… 14 s/);
    await mobile.evaluate(rows=>WeftTimeline.render(rows,document.querySelector('#timeline')),events);
    await mobile.getByRole('button',{name:'Handled 1 scheduling action, collapsed',exact:true}).click();
    await mobile.getByRole('button',{name:'Handled 1 scheduling action, expanded',exact:true}).waitFor();
  });
  await check('mobile step detail controls, loading, result, copy and retry are English',async()=>{
    await mobile.evaluate(rows=>{
      document.querySelector('#timeline').replaceChildren();
      globalThis.detailMode='pending';globalThis.copied='';
      WeftTimeline.render(rows,document.querySelector('#timeline'),{
        readDetail:()=>new Promise((resolve,reject)=>{globalThis.finishDetail=()=>globalThis.detailMode==='error'?reject(Error('synthetic')):resolve({text:JSON.stringify({arguments:{query:'合成原文'},output:[{type:'text',text:'Synthetic output'}]}),truncated:true});}),
        copyText:async text=>{if(globalThis.failCopy)throw Error('synthetic');globalThis.copied=text;},
        openStep:()=>{globalThis.openedSources=true;}
      });
    },events);
    await mobile.locator('.execution-block > summary').click();
    await mobile.locator('.execution-step > summary').click();
    await mobile.getByRole('button',{name:'View sources used',exact:true}).waitFor();
    await mobile.getByRole('button',{name:'View sources used',exact:true}).click();
    assert.equal(await mobile.evaluate(()=>openedSources),true);
    await mobile.getByText('Loading…',{exact:true}).waitFor();
    await mobile.evaluate(()=>finishDetail());
    await mobile.getByText(/Parameters\n/).waitFor();
    const output=await mobile.locator('.timeline-raw').innerText();
    assert.match(output,/Output\nSynthetic output/);assert.match(output,/\[Content truncated\]/);assert.ok(output.includes('合成原文'));
    await mobile.getByRole('button',{name:'Copy',exact:true}).click();
    await mobile.getByRole('button',{name:'Copied',exact:true}).waitFor();
    assert.equal(await mobile.evaluate(()=>copied),output);await capture(mobile,'mobile-detail');
    await mobile.evaluate(()=>{globalThis.failCopy=true;});
    await mobile.getByRole('button',{name:'Copied',exact:true}).click();
    await mobile.getByRole('button',{name:'Could not copy',exact:true}).waitFor();
    await mobile.evaluate(()=>{const step=document.querySelector('.execution-step');step.open=false;delete step.dataset.loaded;globalThis.detailMode='error';});
    await mobile.locator('.execution-step > summary').click();
    await mobile.getByText('Loading…',{exact:true}).waitFor();await mobile.evaluate(()=>finishDetail());
    await mobile.getByText('Could not load. Collapse and reopen to retry.',{exact:true}).waitFor();
  });
  await check('desktop pending Stop is English including repeated renders',async()=>{
    await desktop.evaluate(rows=>{
      const context={ownerId:'synthetic',identity:'synthetic',sessionId:'synthetic'};
      const core={conversationTaskContext:()=>context,conversationTaskCurrent:()=>true,timelineEventsForContext:()=>rows,
        conversationTasks:{...context,entries:new Map([['synthetic',{sessionId:'synthetic',payload:{source:{receiptId:'synthetic',dshTurn:1},control:{state:'stop_requested'}}}]])}};
      const stop=WeftUiCore.factories.tasks(core,{},{}).taskStopView(1);
      globalThis.stopFixture={rows,options:{stopViews:{'turn-1':stop}}};
      WeftTimeline.render(rows,document.querySelector('#timeline'),stopFixture.options);
    },events.slice(0,4));
    assert.equal(await desktop.locator('.inline-progress-text').innerText(),'Handled 1 scheduling action · Stopping…');
    await desktop.evaluate(()=>WeftTimeline.render(stopFixture.rows,document.querySelector('#timeline'),stopFixture.options));
    assert.doesNotMatch(await desktop.locator('.execution-block > summary').getAttribute('aria-label'),/\p{Script=Han}/u);
    await capture(desktop,'desktop-stopping');
  });
  await check('Chinese progress labels stay Chinese on desktop and mobile',async()=>{
    const chinese=events.map(row=>row.type==='user.message'?{...row,data:{text:'请查看已有提醒。'}}:row.type==='assistant.message'?{...row,data:{text:'没有已保存的提醒。'}}:row);
    for(const page of [mobile,desktop]){
      await page.evaluate(rows=>{document.querySelector('#timeline').replaceChildren();WeftTimeline.render(rows,document.querySelector('#timeline'));},chinese);
      assert.equal(await page.locator('.inline-progress-text').innerText(),'处理了 1 次定时安排');
      assert.match(await page.locator('.execution-block > summary').getAttribute('aria-label'),/已收起/);
    }
  });
} finally {
  if(evidence)await writeFile(join(evidence,'renderer-report.json'),JSON.stringify({electron:useElectron,syntheticEvents:true,results},null,2));
  for(const [session,child] of [[browser,browserServer?.process()],[browserServer,browserServer?.process()],[app,app?.process()]]){
    let deadline;try{await Promise.race([session?.close(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('CloseTimeout')),5000);})]);}catch{killTree(child);}finally{clearTimeout(deadline);}
  }
  clearTimeout(watchdog);
  if(profile)await rm(profile,{recursive:true,force:true});if(lock)await unlink(lock);
}
if(results.some(result=>!result.passed))process.exitCode=1;
