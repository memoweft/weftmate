import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {verifyFailureGroup} from './helpers/fe-chat-failure-group.mjs';

test('FE-CHAT process and in-place question controls', {timeout:30000}, async t=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})});
  try {
    const page=await browser.newPage();
    await page.setContent('<ol id="transcript"></ol><section id="approval-bar" hidden></section>');
    await page.evaluate(()=>{Object.assign(globalThis,{WeftUiCore:{},WeftIcons:{create:()=>document.createElement('span')}});});
    for(const file of ['ui-core/timeline-model.js','personal-access-ui/timeline.js','personal-access-ui/components/steps.js','personal-access-ui/components/question-bar.js'])
      await page.addScriptTag({path:fileURLToPath(new URL('../src/'+file,import.meta.url))});
    await t.test('elapsed hover and focus information follows waiting updates on the same process node',async()=>{
      const result=await page.evaluate(()=>{
        const scope=globalThis as any,events=[{seq:0,type:'turn.started',data:{turn:1}}],list=document.getElementById('transcript');
        scope.WeftTimeline.render(events,list,{waiting:'等待模型回复… 1 秒'});const summary=list.querySelector('summary') as HTMLElement;summary.focus();
        scope.WeftTimeline.render(events,list,{waiting:'等待模型回复… 2 秒'});
        return {same:summary===list.querySelector('summary'),focus:summary===document.activeElement,title:summary.title,elapsed:list.querySelector('.progress-elapsed').textContent};
      });
      assert.equal(result.same,true);assert.equal(result.focus,true);assert.equal(result.elapsed,'2 秒');assert.match(result.title,/2 秒/);
    });
    await t.test('a failed reply opens a readable explanation beside its process',async()=>{
      const result=await page.evaluate(()=>{
        const scope=globalThis as any,list=document.getElementById('transcript');
        scope.WeftTimeline.render([{seq:0,type:'turn.started',data:{turn:1}},{seq:1,type:'turn.ended',data:{turn:1,reason:'error'}}],list);
        return {open:(list.querySelector('.execution-block') as HTMLDetailsElement).open,message:list.querySelector('.execution-failure')?.textContent};
      });
      assert.equal(result.open,true);assert.match(result.message,/未能完成|回复未完成/);
    });
    await t.test('new terminal failure opens a reused collapsed same-tool group, while unchanged polls retain user collapse and focus',async()=>{
      await verifyFailureGroup(page);
    });
    await t.test('question choices and submit keep their exact callback and lock through in-place movement',async()=>{
      const result=await page.evaluate(()=>{
        const scope=globalThis as any,bar=scope.WeftQuestionBar.ensure(document.getElementById('approval-bar'));
        let submits=0;const draft={answers:[{selected:[],custom:''}]};
        const config={row:{questionRpcId:'synthetic-question',questions:[{question:'选择接下来做什么',options:[{label:'整理内容'},{label:'继续解释'}]}]},draft,
          locked:false,current:()=>true,focusComposer:()=>{},choose:(_index:number,label:string)=>draft.answers[0]={selected:[label],custom:''},custom:()=>draft.answers[0],submit:()=>submits++};
        bar.dataset.scope='synthetic-scope';scope.WeftQuestionBar.paint(bar,config);bar.hidden=false;
        scope.WeftTimeline.placeDecisions();const atComposer=bar.parentElement===document.getElementById('approval-bar').parentElement && !bar.closest('#transcript');
        bar.querySelector('.question-choice').click();const submit=bar.querySelector('[data-question-control=submit]');submit.click();
        scope.WeftQuestionBar.paint(bar,{...config,locked:true,submitting:true});submit.click();
        scope.WeftTimeline.placeDecisions(document.getElementById('transcript'),true);scope.WeftTimeline.placeDecisions();
        return {atComposer,submits,selected:draft.answers[0].selected,locked:submit.disabled,same:submit===bar.querySelector('[data-question-control=submit]')};
      });
      assert.deepEqual(result,{atComposer:true,submits:1,selected:['整理内容'],locked:true,same:true});
    });
  } finally { await browser.close(); }
});
