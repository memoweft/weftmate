import assert from 'node:assert/strict';

// Exercise the actual timeline and step components, including native <details>.
export async function verifyFailureGroup(page, capture) {
  const preference=await page.evaluate(()=>globalThis.WeftReplyMotion?.preference);
  try {
    await page.evaluate(async()=>{
      globalThis.WeftReplyMotion?.setPreference('reduce');
      const list=document.createElement('ol');list.id='failure-group-probe';
      (document.getElementById('chat-scroll') || document.body).prepend(list);
      const at='2026-10-26T01:00:00Z';
      globalThis.failureGroupEvents=[
        {seq:0,at,type:'turn.started',data:{turn:41}},
        {seq:1,at,type:'step.completed',data:{taskId:'turn-41',stepId:'read-a',toolName:'read',arguments:{path:'synthetic-a.txt'},state:'completed'}},
        {seq:2,at,type:'step.started',data:{taskId:'turn-41',stepId:'read-b',toolName:'read',arguments:{path:'synthetic-b.txt'},state:'running'}}
      ];
      globalThis.renderFailureGroup=options=>WeftTimeline.render(failureGroupEvents,list,{readDetail:async()=>({text:'合成工具的失败详情'}),...options});
      renderFailureGroup();
      list.querySelector('.execution-block').open=true;
      await new Promise(resolve=>setTimeout(resolve,0));
      const group=list.querySelector('.execution-step-group');group.open=false;
      globalThis.savedFailureGroup=group;globalThis.savedFailureStep=list.querySelector('[data-step="read-b"]');
    });
    const before=await page.evaluate(()=>{
      const summary=savedFailureGroup.querySelector('summary');summary.focus();renderFailureGroup({waiting:'正在读取… 2 秒'});
      return {closed:!savedFailureGroup.open,focus:document.activeElement===summary,same:savedFailureGroup===document.querySelector('#failure-group-probe .execution-step-group')};
    });
    assert.deepEqual(before,{closed:true,focus:true,same:true},'ordinary polling retains a collapsed group and its focused summary');
    await page.evaluate(()=>{
      failureGroupEvents.push({seq:3,at:'2026-10-26T01:00:01Z',type:'step.completed',data:{taskId:'turn-41',stepId:'read-b',toolName:'read',arguments:{path:'synthetic-b.txt'},state:'failed',detailRef:{seq:3}}});
      renderFailureGroup();
    });
    assert.equal(await page.evaluate(()=>savedFailureStep.dataset.state),'issue','a nonterminal failure is still presented as continuing');
    await page.evaluate(()=>{
      failureGroupEvents.push({seq:4,at:'2026-10-26T01:00:02Z',type:'turn.ended',data:{turn:41,reason:'error'}});
      renderFailureGroup();
    });
    await page.waitForFunction(()=>document.querySelector('#failure-group-probe [data-step="read-b"] .step-detail-content')?.textContent.includes('合成工具的失败详情'));
    await capture?.('terminal-failure-group');
    const failed=await page.evaluate(()=>({
      process:document.querySelector('#failure-group-probe .execution-block').open,
      group:savedFailureGroup.open,step:savedFailureStep.open,
      sameGroup:savedFailureGroup===document.querySelector('#failure-group-probe .execution-step-group'),
      sameStep:savedFailureStep===document.querySelector('#failure-group-probe [data-step="read-b"]')
    }));
    assert.deepEqual(failed,{process:true,group:true,step:true,sameGroup:true,sameStep:true},'a new terminal failure opens its existing same-tool group');
    assert.equal(await page.locator('#failure-group-probe [data-step="read-b"] .step-detail-content').isVisible(),true,'the failed tool detail is visible through every disclosure level');
    const after=await page.evaluate(async()=>{
      savedFailureGroup.open=false;savedFailureStep.open=false;
      await new Promise(resolve=>setTimeout(resolve,0));
      const summary=savedFailureGroup.querySelector('summary');summary.focus();
      renderFailureGroup();renderFailureGroup({waiting:'正在读取… 3 秒'});
      await new Promise(resolve=>setTimeout(resolve,0));
      return {groupClosed:!savedFailureGroup.open,stepClosed:!savedFailureStep.open,focus:document.activeElement===summary,
        sameGroup:savedFailureGroup===document.querySelector('#failure-group-probe .execution-step-group')};
    });
    assert.deepEqual(after,{groupClosed:true,stepClosed:true,focus:true,sameGroup:true},'polling an unchanged failure preserves deliberate collapse and keyboard focus');
    await capture?.('terminal-failure-collapsed-poll');
  } finally {
    await page.evaluate(preference=>{
      document.getElementById('failure-group-probe')?.remove();
      if(preference!==undefined)globalThis.WeftReplyMotion?.setPreference(preference);
    },preference);
  }
}
