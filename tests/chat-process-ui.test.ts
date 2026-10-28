import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright';
import {startTimelineCandidate} from './integration/timeline-ui-candidate.mjs';
import {localUiSession} from './helpers/local-ui-session.mjs';

test('UI02 real page: process, failed retry, applied diff, questions and streaming scroll', {timeout:180000}, async t=>{
  const evidence=process.env.WEFTMATE_UI02_EVIDENCE;
  if(evidence)await mkdir(evidence,{recursive:true});
  const profile=await mkdtemp(join(tmpdir(),'weftmate-ui02-'));
  let host,app;
  t.after(async()=>{await app?.close();await host?.close();await rm(profile,{recursive:true,force:true});});
  if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'managed');
  host=await startTimelineCandidate({historyCount:0,inlineProgress:true,interactive:true,baseTime:Date.now()-70000});
  const env={...process.env,UI02_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve('tests/helpers/chat-process-electron.cjs'),host.origin+'/personal/v1/ui/'],env});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];
  async function scrollHistory(edge) {
    await page.locator('#chat-scroll').evaluate((box,edge)=>{
      box.dispatchEvent(new WheelEvent('wheel',{deltaY:edge==='start'?-100:100,bubbles:true}));
      box.scrollTop=edge==='start'?0:box.scrollHeight;
    },edge);
    await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  }
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    let api;
    Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set(value){api=value;const create=value.create;value.create=(...args)=>{const core=create(...args);globalThis.ui02Core=core;return core;};}});
  });
  await localUiSession(page,host.credentials);
  await page.waitForFunction(()=>!!globalThis.ui02Core?.state.selectedSessionId);
  const refresh=()=>page.evaluate(async()=>{await ui02Core.refreshHistory();await ui02Core.refreshSessions();await ui02Core.refreshConversationTasks();await ui02Core.refreshConversationQuestions();});
  await refresh();
  await page.locator('.execution-block').first().waitFor();
  assert.equal(await page.locator('.execution-block').first().evaluate(el=>el.open),true,'running process opens');
  host.progress.text('我先检查项目，再整理报告。');
  host.progress.call('pwsh','fail',{command:'npm test',description:'检查项目'});
  host.progress.result('fail','First attempt failed.',true);
  host.progress.text('第一次检查没有通过，我会调整命令再试。');
  host.progress.call('pwsh','retry',{command:'npm test -- --run',description:'重新检查项目'});
  host.progress.result('retry','Pass\n'.repeat(20000));
  host.progress.text('检查已通过，现在更新报告。');
  host.progress.call('edit','edit-report',{file_path:'report.md',old_string:'old',new_string:'new'});
  host.progress.result('edit-report','Updated file.',false,{diffs:[{path:'report.md',oldText:'heading\nold\nkeep\nold2\nend',newText:'heading\nnew\nkeep\nnew2\nextra\nend'}]});
  for(const kind of ['choice','custom','skip']) {
    const questionText={choice:'报告需要保留哪些内容？',custom:'还有什么要补充？',skip:'需要附上参考资料吗？'}[kind];
    host.progress.ask([{id:kind,question:questionText,options:[{label:'简要说明',description:'只保留结论'},{label:'详细说明',description:'包含每一步的依据'}]}]);
    await refresh();const bar=page.getByRole('region',{name:'待回答问题'});await bar.waitFor();
    assert.equal(await bar.evaluate(el=>!el.closest('#transcript')),true,'question stays above composer');
    await bar.getByRole('button',{name:'收起问题',exact:true}).click();
    await bar.getByRole('button',{name:'展开问题',exact:true}).click();
    if(evidence && kind==='choice'){for(const [width,height] of [[1280,800],[900,700],[390,844]])for(const theme of ['light','dark']){
      await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
      await page.evaluate(({theme,width})=>{WeftDesktop.setAppearance({theme});if(width<640)WeftDesktop.toggleRail(true);},{theme,width});
      await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(a.effect?.getTiming().iterations!==Infinity){try{a.finish();}catch{}}await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
      await page.screenshot({path:join(evidence,`question-${width}-${theme}.png`)});
    }await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,800));}
    if(kind==='choice'){await bar.getByRole('radio',{name:'简要说明',exact:true}).focus();await page.keyboard.press('2');await bar.getByRole('radio',{name:'详细说明',exact:true,checked:true}).waitFor();}
    if(kind==='custom')await bar.getByRole('textbox',{name:'其他回答',exact:true}).fill('使用我写的说明');
    const receipt=page.waitForResponse(response=>response.request().method()==='POST'&&/\/questions\//.test(response.url()));
    await bar.getByRole('button',{name:kind==='skip'?'跳过':'提交回答',exact:true}).click();
    assert.equal((await receipt).status(),200);await bar.waitFor({state:'hidden'});
    await page.locator('.question-record').filter({hasText:questionText}).filter({hasText:kind==='choice'?'详细说明':kind==='custom'?'使用我写的说明':'已跳过'}).waitFor();
  }
  host.progress.text('项目已检查完毕，报告已更新。');host.progress.finish('completed');
  await refresh();
  await page.waitForFunction(()=>document.querySelector('.execution-block')?.dataset.terminal==='true');
  assert.equal(await page.locator('.execution-block').first().evaluate(el=>el.open),false,'completed process folds');
  await page.getByText('项目已检查完毕，报告已更新。',{exact:true}).waitFor();
  await scrollHistory('start');
  await page.locator('.execution-block > summary').first().click();
  assert.deepEqual(await page.locator('.execution-step').evaluateAll(nodes=>nodes.map(el=>[el.dataset.step,el.dataset.state])),[['fail','failed'],['retry','completed'],['edit-report','completed']]);
  assert.deepEqual(await page.locator('.execution-records > .execution-note,.execution-records > .execution-step').evaluateAll(nodes=>nodes.map(el=>el.dataset.step || el.textContent)),['我先检查项目，再整理报告。','fail','第一次检查没有通过，我会调整命令再试。','retry','检查已通过，现在更新报告。','edit-report']);
  assert.equal(await page.locator('.step-type-icon[data-icon="terminal"] svg').count(),2);
  assert.equal(await page.locator('.step-type-icon[data-icon="edit"] svg').count(),1);
  assert.equal(await page.locator('.step-state').count(),0);
  assert.equal(await page.locator('.execution-step-group .execution-step').count(),0,'commands are individual rows');
  await page.locator('[data-step="retry"] > summary').click();
  await page.locator('[data-step="retry"] .step-output').waitFor();
  await page.getByRole('button',{name:'继续读取输出',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-step="retry"] .step-output')?.textContent.length===100000);
  assert.equal(await page.locator('[data-step="retry"] .step-title').textContent(),'重新检查项目');
  assert.equal(await page.locator('[data-step="retry"] .step-output').evaluate(el=>el.clientHeight<=221 && el.scrollHeight>el.clientHeight),true);
  for (const [width,height] of [[1280,800],[900,700]]) {
    await app.evaluate(({BrowserWindow},[width,height])=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),[width,height]);
    await scrollHistory('end');
    await page.locator('.file-change-title').waitFor();
    assert.equal(await page.locator('.question-answer-card').count(),3);
    assert.equal(await page.locator('.file-change-title').textContent(),'已编辑report.md');
    assert.equal(await page.locator('.file-changes').count(),1);
    assert.equal(await page.getByLabel('增加 3 行，删除 2 行').count(),1);
    assert.equal(await page.locator('.file-changes').evaluate(el=>el.compareDocumentPosition([...document.querySelectorAll('.message.assistant')].at(-1))&Node.DOCUMENT_POSITION_PRECEDING),2);
  }
  await page.getByRole('button',{name:'审阅 report.md',exact:true}).click();
  await page.getByRole('complementary',{name:'工作面板'}).getByRole('heading',{name:'改动前',exact:true}).waitFor();
  if(evidence)await page.screenshot({path:join(evidence,'review-diff.png')});
  await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();

  console.log('UI02 functional interactions passed');
  const metrics=await page.evaluate(async()=>{
    // Measure the scroll helper independently of the live virtual-list owner.
    const host=document.getElementById('chat-scroll'),box=host.cloneNode(false),list=document.getElementById('transcript').cloneNode(false);
    box.removeAttribute('id');list.removeAttribute('id');
    Object.assign(box.style,{position:'fixed',left:'0',top:'0',width:`${host.clientWidth}px`,height:`${host.clientHeight}px`,overflow:'auto'});
    box.append(list);document.body.append(box);
    const row=document.createElement('li');row.className='message assistant';const body=WeftContent.create('稳定前文\n\n','message-text markdown-body');row.append(body);list.append(row);
    const scroll=WeftConversationScroll(box,list,document.createElement('button'));
    scroll.latest();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    let readingStart=Infinity;const frames=[],longTasks=[],shifts=[];let prior=performance.now(),active=true;
    const loop=now=>{frames.push(now-prior);prior=now;if(active)requestAnimationFrame(loop);};requestAnimationFrame(loop);
    const long=new PerformanceObserver(batch=>longTasks.push(...batch.getEntries().map(e=>e.duration)));long.observe({type:'longtask'});
    const shift=new PerformanceObserver(batch=>shifts.push(...batch.getEntries().filter(e=>!e.hadRecentInput).map(e=>({at:e.startTime,value:e.value}))));shift.observe({type:'layout-shift'});
    const first=body.querySelector('p').firstChild;
    let text='稳定前文\n\n';
    for(let i=0;i<60;i++){text+='这是正在生成的合成长回复，包含**重点**和代码 `value`。\n\n'.repeat(3);WeftContent.update(body,text,{streaming:true});await new Promise(requestAnimationFrame);}
    WeftContent.update(body,text,{streaming:false});await new Promise(requestAnimationFrame);scroll.latest();await new Promise(requestAnimationFrame);
    const follows=box.scrollHeight-box.clientHeight-box.scrollTop<3,stable=body.querySelector('p').firstChild===first;
    readingStart=performance.now();box.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));box.scrollTop-=160;const top=box.scrollTop;
    WeftContent.update(body,text+'追加的内容'.repeat(300),{streaming:true});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const held=Math.abs(box.scrollTop-top)<2;scroll.latest();
    active=false;long.disconnect();shift.disconnect();frames.sort((a,b)=>a-b);
    box.remove();
    return {stable,follows,held,p95:frames[Math.floor(frames.length*.95)],maxFrame:frames.at(-1),longTasks:longTasks.length,streamCls:shifts.filter(e=>e.at<readingStart).reduce((a,b)=>a+b.value,0),readingCls:shifts.filter(e=>e.at>=readingStart).reduce((a,b)=>a+b.value,0)};
  });
  assert.equal(metrics.stable,true,JSON.stringify(metrics));assert.equal(metrics.follows,true,JSON.stringify(metrics));assert.equal(metrics.held,true,JSON.stringify(metrics));
  if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'weftmate-metrics.json'),JSON.stringify(metrics,null,2));
    for(const [width,height] of [[1280,800],[900,700],[390,844]])for(const theme of ['light','dark']){
      await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
      await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
      await page.evaluate(()=>{if(innerWidth<640)WeftDesktop.toggleRail(true);document.querySelectorAll('.execution-step').forEach(el=>el.open=false);const box=document.getElementById('chat-scroll');box.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));box.scrollTop=0;});
      await page.evaluate(async()=>{for(const a of document.getAnimations())if(a.effect?.getTiming().iterations!==Infinity){try{a.finish();}catch{}}await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
      await page.screenshot({path:join(evidence,`weftmate-${width}-${theme}.png`)});
      if(width===1280){
        for(const [selector,name] of [['.execution-block','process'],['.question-answer-card','answered'],['.file-changes','changes']]){
          await scrollHistory(name==='process'?'start':'end');
          const target=page.locator(selector).first();
          if(name==='changes'){if(await page.locator('#jump-latest').isVisible())await page.locator('#jump-latest').click();}
          else await target.evaluate(el=>{const box=document.getElementById('chat-scroll');box.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));box.scrollTop+=el.getBoundingClientRect().top-box.getBoundingClientRect().top-24;});
          await page.evaluate(async()=>{await new Promise(requestAnimationFrame);for(const a of document.getAnimations())if(a.effect?.getTiming().iterations!==Infinity){try{a.finish();}catch{}}await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
          if(name==='changes')await writeFile(join(evidence,`changes-capture-${theme}.json`),JSON.stringify(await target.evaluate(el=>({card:el.getBoundingClientRect().toJSON(),scroll:document.getElementById('chat-scroll').scrollTop,scrollHeight:document.getElementById('chat-scroll').scrollHeight,clientHeight:document.getElementById('chat-scroll').clientHeight,jump:[...document.querySelectorAll('button')].filter(button=>button.textContent.includes('回到底部')).map(button=>({hidden:button.hidden,classes:button.className,rect:button.getBoundingClientRect().toJSON()}))})),null,2));
          await target.screenshot({path:join(evidence,`${name}-detail-${theme}-1x.png`)});
        }
        await scrollHistory('start');
        const disclosure=page.locator('.execution-block').first();
        if(!await disclosure.evaluate(el=>el.open))await disclosure.locator(':scope > summary').click();
        await page.locator('.execution-note').first().waitFor();
        const typography=await page.evaluate(()=>({devicePixelRatio,body:getComputedStyle(document.querySelector('.execution-note')).fontSize,step:getComputedStyle(document.querySelector('.step-title')).fontSize,rowHeight:document.querySelector('.execution-step > summary').getBoundingClientRect().height}));
        await writeFile(join(evidence,`typography-${theme}.json`),JSON.stringify(typography,null,2));
      }
      if(width!==390){await scrollHistory('start');await page.locator('.execution-block').first().evaluate(el=>el.open=false);await page.screenshot({path:join(evidence,`collapsed-${width}-${theme}.png`)});await page.locator('.execution-block').first().evaluate(el=>el.open=true);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
  }
  assert.deepEqual(errors,[]);console.log('UI02 metrics',JSON.stringify(metrics));
  await page.evaluate(()=>{
    const step=WeftTimelineCards.step({stepId:'paged-read',toolName:'read',state:'completed',summary:'读取合成文件',detailRef:{seq:123}},null,false,{
      readDetail:async()=>({text:'{}',output:'a'.repeat(64000),nextOutputOffset:64000}),
      readOutput:async()=>({output:'b'.repeat(1000),nextOutputOffset:null})
    });const probe=document.createElement('ol');probe.className='chat-progress';probe.style.position='absolute';document.getElementById('conversation-pane').append(probe);probe.append(step);step.open=true;
  });
  await page.locator('[data-step="paged-read"]').getByRole('button',{name:'继续读取输出',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-step="paged-read"] .step-output')?.textContent.length===65000);
});

