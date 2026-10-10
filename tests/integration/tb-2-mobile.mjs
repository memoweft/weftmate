import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
const fixture=await startTimelineCandidate({logicalMobile:true,interactive:true,historyCount:0,goals:true}),out=resolve(import.meta.dirname,'../evidence/tb-2');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),report={viewport:{width:390,height:844},checks:[],errors:[]};
try{
  const page=await browser.newPage({viewport:report.viewport});page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(20000);
  await fixture.request('/goals',{requestId:'mobile-goal',sessionId:fixture.sessionId,title:'推进每周学习计划',description:'在原对话里查看每次进展。'});
  await page.goto(fixture.mobileUrl);await page.waitForFunction(()=>state.booted&&state.loggedIn);await page.getByRole('tab',{name:/^目标(?:，|$)/}).click();await page.getByRole('heading',{name:'目标',exact:true}).waitFor();
  await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor();await page.getByRole('article',{name:'推进每周学习计划',exact:true}).waitFor();
  const task=(await fixture.request('/tasks')).items[0];assert.ok(Number.isSafeInteger(task.source.seq));
  await page.getByRole('article',{name:task.title,exact:true}).getByRole('button',{name:/更多操作/}).click();await page.getByRole('menuitem',{name:'打开对话与步骤',exact:true}).click();
  await page.waitForFunction(()=>state.page==='chat'&&!state.sharedLoading&&state.sharedEvents.length>0);await page.getByText('写入文件',{exact:true}).first().waitFor();report.checks.push('mobile-original-step-anchor');
  await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('tab',{name:/^目标(?:，|$)/}).click();await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor();
  assert.ok(await page.locator('#page-content').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:join(out,'mobile-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:join(out,'mobile-dark.png')});report.checks.push('menu-goals-three-sections','mobile-light-dark-no-overflow');
  const schedule=page.getByRole('article',{name:'提交合成报告',exact:true});await schedule.getByRole('switch').click();await page.waitForFunction(()=>!!document.querySelector('article[aria-label="提交合成报告"] input:not(:disabled)'));await schedule.getByRole('switch').click();await page.waitForFunction(()=>!!document.querySelector('article[aria-label="提交合成报告"] input:not(:disabled)'));
  await page.getByRole('button',{name:'新建定时任务',exact:true}).click();const form=page.getByRole('form',{name:'新建定时任务'});await form.getByLabel('要做什么',{exact:true}).fill('每周一核对计划');const repeat=form.getByRole('combobox',{name:'重复',exact:true});await repeat.click();await page.getByRole('option',{name:'每周',exact:true}).click();await form.getByRole('combobox',{name:'时间 · 小时',exact:true}).click();await page.getByRole('option',{name:'08',exact:true}).click();await form.getByRole('combobox',{name:'时间 · 分钟',exact:true}).click();await page.getByRole('option',{name:'00',exact:true}).click();await form.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('article',{name:'每周一核对计划',exact:true}).waitFor();report.checks.push('mobile-native-path-create-pause-resume');
  const goal=page.getByRole('article',{name:'推进每周学习计划',exact:true});await goal.getByRole('button',{name:/更多操作/}).click();await page.getByRole('menuitem',{name:'完成目标',exact:true}).click();await goal.getByText(/已完成/).waitFor();await goal.getByRole('button',{name:/更多操作/}).click();await page.getByRole('menuitem',{name:'归档目标',exact:true}).click();await goal.waitFor({state:'hidden'});report.checks.push('mobile-goal-complete-archive');
  await schedule.getByRole('button',{name:/更多操作/}).click();await page.getByRole('menuitem',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'删除这个定时任务？'}).getByRole('button',{name:'取消',exact:true}).click();report.checks.push('mobile-confirmation-cancel');
  assert.deepEqual(report.errors,[]);await writeFile(join(out,'mobile.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();await fixture.close();await rm(fixture.root,{recursive:true,force:true});}
