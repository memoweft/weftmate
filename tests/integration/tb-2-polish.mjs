/** Production Electron window and mobile bundle; synthetic account, random ports, no model. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/tb-2/polish');await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const report={realElectron:true,noModel:true,syntheticAccounts:true,randomPorts:true,checks:[],screenshots:[],errors:[]};
const choose=async(page,form,name,value)=>{await form.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();};
const more=async(page,row,name)=>{await row.getByRole('button',{name:/更多操作/}).click();if(name)await page.getByRole('menuitem',{name,exact:true}).click();};

for(const theme of ['light','dark']){
 const fixture=await startTimelineCandidate({interactive:true,historyCount:0,goals:true,baseTime:Date.now()-10000});
 const profile=await mkdtemp(join(tmpdir(),'weftmate-tb-2b-'));let app,browser;
 try{
  await fixture.request('/goals',{requestId:randomUUID(),sessionId:fixture.sessionId,title:'推进每周学习计划',description:'每周核对资料，让进展留在原对话。'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:theme}});
  const desktop=await app.firstWindow();await localUiSession(desktop,fixture.credentials,'TB-2b synthetic',{interceptLegacyStatus:false});desktop.setDefaultTimeout(15000);await desktop.evaluate(theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'})),theme);await desktop.reload();await desktop.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
  browser=await chromium.launch({headless:true});
  const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
  phone.setDefaultTimeout(15000);await phone.goto(fixture.mobileUrl);await phone.waitForFunction(()=>state.booted&&state.loggedIn);await phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  desktop.on('pageerror',error=>report.errors.push(error.message));phone.on('pageerror',error=>report.errors.push(error.message));
  const open=async(page,mobile)=>{if(mobile)await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'目标',exact:true}).click();await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor();};
  const shot=async(page,name)=>{const file=`${name}-${theme}.png`;await page.screenshot({path:join(out,file)});report.screenshots.push(file);if(name.endsWith('-form')){const form=page.getByRole('form');if(await form.count()){const formFile=`${name}-full-${theme}.png`;await form.screenshot({path:join(out,formFile)});report.screenshots.push(formFile);}}};
  for(const [page,mobile,prefix]of [[desktop,false,'desktop'],[phone,true,'mobile-390']]){
   await open(page,mobile);await shot(page,prefix);
   if(!mobile){assert.equal(await page.locator('#assistant-title').textContent(),'目标');assert.equal(await page.getByRole('button',{name:'输出与来源',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'本对话用量',exact:true}).count(),0);}
   const schedule=page.getByRole('article',{name:'提交合成报告',exact:true}),goal=page.getByRole('article',{name:'推进每周学习计划',exact:true}),task=page.getByRole('region',{name:'进行中',exact:true}).getByRole('article').first();
   assert.equal(await schedule.getByRole('button').count(),2);assert.equal(await schedule.getByRole('switch').count(),1);
   assert.ok(!/Asia\/|:\d\d:\d\d|\d{4}\/\d/.test(await schedule.textContent()));
   await more(page,task);await shot(page,`${prefix}-task-menu`);await page.keyboard.press('Escape');
   await more(page,schedule);await shot(page,`${prefix}-schedule-menu`);await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
   await schedule.getByRole('button',{name:'编辑 提交合成报告',exact:true}).click();await shot(page,`${prefix}-edit-form`);await page.getByRole('form').getByRole('button',{name:'取消',exact:true}).click();
   await schedule.getByRole('switch').uncheck();await page.waitForFunction(()=>!!document.querySelector('article[aria-label="提交合成报告"] input:not(:disabled):not(:checked)'));await schedule.getByRole('switch').check();await page.waitForFunction(()=>!!document.querySelector('article[aria-label="提交合成报告"] input:not(:disabled):checked'));
   await more(page,schedule,'删除');const dialog=page.getByRole('dialog',{name:'删除这个定时任务？',exact:true});await shot(page,`${prefix}-delete-confirm`);await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.ok(await schedule.getByRole('switch').isChecked());
   await more(page,goal);await shot(page,`${prefix}-goal-menu`);await page.keyboard.press('Escape');await goal.getByRole('button',{name:'查看 推进每周学习计划',exact:true}).click();await shot(page,`${prefix}-goal-details`);await page.getByRole('form').getByRole('button',{name:'取消',exact:true}).click();
   await page.getByRole('button',{name:'新建长期目标',exact:true}).click();await shot(page,`${prefix}-goal-form`);await page.getByRole('form').getByRole('button',{name:'取消',exact:true}).click();
   await page.getByRole('button',{name:'新建定时任务',exact:true}).click();const form=page.getByRole('form',{name:'新建定时任务',exact:true});await shot(page,`${prefix}-schedule-form`);
   for(const [name,value]of [['所属对话',null],['到点做什么','让助手执行'],['重复','一次性'],['日期 · 年',null],['日期 · 月',null],['日期 · 日',null],['时间 · 小时','09'],['时间 · 分钟','00']]){
    await form.getByRole('combobox',{name,exact:true}).click();await shot(page,`${prefix}-select-${name.replaceAll(' · ','-')}`);if(value)await page.getByRole('option',{name:value,exact:true}).click();else await page.keyboard.press('Escape');
   }
   await shot(page,`${prefix}-once-form`);await choose(page,form,'重复','每周');await form.getByRole('combobox',{name:'星期',exact:true}).click();await shot(page,`${prefix}-select-weekday`);await page.getByRole('option',{name:'星期一',exact:true}).click();
   await shot(page,`${prefix}-weekly-form`);await choose(page,form,'重复','每月');await shot(page,`${prefix}-monthly-form`);await choose(page,form,'重复','固定间隔');await shot(page,`${prefix}-interval-form`);
   await choose(page,form,'重复','每天');await form.getByLabel('要做什么',{exact:true}).fill(`${prefix} 合成提醒`);await choose(page,form,'到点做什么','提醒我');await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});await shot(page,`${prefix}-saved-toast`);
   const saved=page.getByRole('article',{name:`${prefix} 合成提醒`,exact:true});await more(page,saved,'删除');await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();await saved.waitFor({state:'hidden'});
   assert.equal(await page.locator('.goals-page input[type=date],.goals-page input[type=time]').count(),0); // legacy main-chat picker stays outside this page
   assert.equal(await page.locator('.goals-page details').count(),0);
   report.checks.push(`${prefix}-${theme}: menus, row edit, toggle, delete cancel/confirm, all form controls, save toast, date/time, no native controls`);
   if(!mobile){await page.getByRole('button',{name:/^动态/}).click();await page.getByRole('heading',{name:'动态',exact:true}).waitFor();assert.equal(await page.locator('#assistant-title').textContent(),'动态');await shot(page,`${prefix}-activity-header`);await page.getByRole('button',{name:'目标',exact:true}).click();}
  }
  await desktop.waitForTimeout(3500);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));await shot(desktop,'desktop-480');
  assert.ok(await desktop.locator('.goals-surface').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await phone.setViewportSize({width:360,height:780});await shot(phone,'mobile-360');assert.ok(await phone.locator('#page-content').evaluate(el=>el.scrollWidth<=el.clientWidth));
  // Verify designed loading/error/empty states through API responses, not DOM stubs.
  for(const [page,prefix]of [[desktop,'desktop-480'],[phone,'mobile-360']]){
   const paths=['tasks','schedules','goals'];
   async function intercept(gate,kind){
    if(page===phone){await page.route('**/bridge',async route=>{
        const input=route.request().postDataJSON(),path=input.params?.path?.replace('/personal/v1/','');
        if(input.method!=='host.business'||input.params.method!=='GET'||!paths.includes(path))return route.continue();
        await gate;if(kind==='error')return route.fulfill({json:{error:{code:'UNAVAILABLE'}}});
        const response=await route.fetch(),body=await response.json();body.result.items=[];if(path==='tasks')body.result.recent=[];await route.fulfill({response,json:body});
    });}else for(const path of paths)await page.route(`**/personal/v1/${path}`,async route=>{
        if(route.request().method()!=='GET')return route.continue();await gate;
        if(kind==='error')return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});
        const response=await route.fetch(),body=await response.json();body.items=[];if(path==='tasks')body.recent=[];await route.fulfill({response,json:body});
    });
   }
   let release;const gate=new Promise(r=>release=r);await intercept(gate,'empty');
   await page.getByRole('button',{name:'刷新目标',exact:true}).click();release();await page.getByText('现在没有进行中的任务',{exact:true}).waitFor();await shot(page,`${prefix}-empty`);
   let nextRelease;const nextGate=new Promise(r=>nextRelease=r);await page.unrouteAll({behavior:'wait'});await intercept(nextGate,'error');
   await page.getByRole('button',{name:'刷新目标',exact:true}).click();await page.getByRole('status',{name:'正在读取进行中任务',exact:true}).waitFor();await shot(page,`${prefix}-loading`);nextRelease();await page.getByRole('alert').first().waitFor();await shot(page,`${prefix}-error`);await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'重试',exact:true}).first().click();await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor();
  }
  await fixture.complete();await desktop.getByRole('button',{name:'刷新目标',exact:true}).click();await desktop.getByRole('button',{name:'最近完成 · 保留 7 天',exact:true}).click();await shot(desktop,'desktop-480-recent-expanded');
  report.checks.push(`${theme}: Electron 1200/480, phone 390×844/360×780, page titles, errors/empty/loading/retry, recent collapse`);
 }catch(error){await app?.firstWindow().then(page=>page.screenshot({path:join(out,`failure-${theme}.png`)})).catch(()=>{});throw error;}
 finally{await browser?.close();await app?.close();await fixture.close();await rm(profile,{recursive:true,force:true});await rm(fixture.root,{recursive:true,force:true});}
}
assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:report.checks,screenshots:report.screenshots.length,errors:report.errors}));
