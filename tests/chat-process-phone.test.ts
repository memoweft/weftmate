import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,devices} from 'playwright';
import {startTimelineCandidate} from './integration/timeline-ui-candidate.mjs';
import {localUiSession} from './helpers/local-ui-session.mjs';

test('phone web coarse-pointer entry keeps questions, receipts and applied change review usable',{timeout:60000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-ui02-phone-'));if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(root,'managed');
 const host=await startTimelineCandidate({historyCount:0,inlineProgress:true,interactive:true,baseTime:Date.now()});
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})});
 try {
  const page=await browser.newPage({...devices['Pixel 7']});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set(value){api=value;const create=value.create;value.create=(...args)=>{globalThis.ui02Core=create(...args);return globalThis.ui02Core;};}});});
  await page.goto(host.origin+'/personal/v1/ui/');await localUiSession(page,host.credentials);
  await page.waitForFunction(()=>WeftPhoneUnify.isPhone() && document.body.classList.contains('phone-unified') && !!globalThis.ui02Core?.state.selectedSessionId);
  const refresh=()=>page.evaluate(async()=>{await ui02Core.refreshHistory();await ui02Core.refreshConversationTasks();await ui02Core.refreshConversationQuestions();});
  host.progress.ask([{id:'phone',question:'手机合成提问',options:[{label:'保留结论',description:'便于快速阅读'},{label:'保留细节',description:'显示每一步依据'},{label:'两者都要',description:'先结论再细节'}]}]);await refresh();
  const bar=page.getByRole('region',{name:'待回答问题'});await bar.waitFor();await bar.scrollIntoViewIfNeeded();
  await bar.getByRole('radio',{name:'保留细节',exact:true}).click();
  assert.equal(await bar.getByRole('radio',{name:'保留细节',exact:true}).getAttribute('aria-checked'),'true');
  if(process.env.WEFTMATE_UI02_EVIDENCE){await mkdir(process.env.WEFTMATE_UI02_EVIDENCE,{recursive:true});for(const theme of ['light','dark']){
    await page.evaluate(async theme=>{WeftDesktop.setAppearance({theme});await document.fonts.ready;for(const a of document.getAnimations())if(a.effect?.getTiming().iterations!==Infinity){try{a.finish();}catch{}}await new Promise(requestAnimationFrame);},theme);
    await page.screenshot({path:join(process.env.WEFTMATE_UI02_EVIDENCE,`phone-coarse-question-${theme}.png`)});
  }}
  const receipt=page.waitForResponse(response=>response.request().method()==='POST'&&/\/questions\//.test(response.url()));
  await bar.getByRole('button',{name:'确认',exact:true}).click();assert.equal((await receipt).status(),200);await bar.waitFor({state:'hidden'});
  await page.locator('.question-record').filter({hasText:'手机合成提问'}).filter({hasText:'保留细节'}).waitFor();
  host.progress.call('edit','phone-edit',{file_path:'phone.md',old_string:'old',new_string:'new'});
  host.progress.result('phone-edit','Updated.',false,{diffs:[{path:'phone.md',oldText:'old',newText:'new'}]});host.progress.text('手机上的最终回答。');host.progress.finish('completed');await refresh();
  await page.getByLabel('增加 1 行，删除 1 行').waitFor();await page.getByRole('button',{name:'审阅 phone.md',exact:true}).click();
  await page.getByRole('heading',{name:'改动前',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await host.close();await rm(root,{recursive:true,force:true});}
});
