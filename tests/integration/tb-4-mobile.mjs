/** D43 production phone pages, real HTTP transport, synthetic account and facts. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
const out=resolve(import.meta.dirname,'../evidence/tb-4');await mkdir(out,{recursive:true});
const f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,interactive:true,goals:true,historyCount:0});
const browser=await chromium.launch({headless:true}),report={productionMobile:true,realHttp:true,synthetic:true,checks:[],errors:[]};
try{
  for(let n=0;n<20;n++)await f.recordActivity({key:`tb4-memory-${n}`,type:'memory.paused',title:`记忆整理 ${n+1}`,summary:'合成动态，仅用于导航验收。',level:'normal',actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
  for(const size of [{width:390,height:844},{width:360,height:780},{width:480,height:780}]){
    const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(20000);page.on('pageerror',error=>report.errors.push(error.message));
    await page.route('**/bridge.js',route=>route.fulfill({contentType:'text/javascript',body:'// Browser uses authenticated HTTP.'}));
    await page.route('**/personal/v1/**',async route=>{try{const url=new URL(route.request().url());const response=await route.fetch({url:f.origin+url.pathname+url.search,headers:{...route.request().headers(),origin:f.origin}});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
    await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);await page.screenshot({path:join(out,`web-${size.width}-signed-out.png`)});assert.equal(await page.getByRole('tablist').isVisible(),false);
    const login=await page.request.post(f.origin+'/personal/v1/auth/login',{data:f.credentials,headers:{origin:f.origin}});assert.equal(login.status(),200);const identity=await login.json();
    await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);
    await page.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},identity);
    const tab=name=>page.getByRole('tab',{name:new RegExp(`^${name}(?:，|$)`)}),button=name=>page.getByRole('button',{name,exact:true});
    const shot=async name=>{await page.waitForTimeout(450);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.screenshot({animations:'disabled',path:join(out,`web-${size.width}-${name}.png`)});};
    await page.getByRole('tablist',{name:'手机主导航'}).waitFor();assert.equal(await tab('聊天').getAttribute('aria-selected'),'true');
    await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('保留这条主对话草稿');await page.getByRole('textbox',{name:'输入消息',exact:true}).blur();
    for(const theme of ['light','dark']){
      const title=`记忆整理 ${size.width}-${theme}`;await f.recordActivity({key:`tb4-${size.width}-${theme}`,type:'memory.paused',title,summary:'合成动态，仅用于导航验收。',level:'normal',actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
      await page.evaluate(theme=>applyTheme(theme),theme);
      await tab('聊天').click();await shot(`${theme}-chat`);
      await button('打开导航').click();await shot(`${theme}-drawer-open`);assert.equal(await page.getByRole('button',{name:'成果库',exact:true}).count(),0);await button('关闭导航').click();
      await button('个人资料与设置').click();await page.getByRole('heading',{name:'设置',exact:true,level:1}).waitFor();await shot(`${theme}-settings-open`);await button('返回').click();
      await tab('动态').click();await page.evaluate(()=>uiCore.readActivity());await page.getByText(title,{exact:true}).waitFor();assert.equal(await page.getByRole('banner').getByText('动态',{exact:true}).filter({visible:true}).count(),1);await shot(`${theme}-activity`);
      await button(`更多操作 ${title}`).click();await page.getByRole('menuitem',{name:'标为已读',exact:true}).waitFor();await shot(`${theme}-activity-menu-open`);await page.getByRole('menuitem',{name:'标为已读',exact:true}).click();await page.waitForFunction(title=>!uiCore.activity.loading&&uiCore.activity.items.find(row=>row.title===title)?.read===true,title);
      await page.getByRole('navigation',{name:'筛选动态'}).getByRole('button',{name:'记忆',exact:true}).click();await page.waitForFunction(()=>uiCore.activity.filter==='memory'&&!uiCore.activity.loading).catch(async error=>{console.log('filter-failure',await page.evaluate(()=>({filter:uiCore.activity.filter,loading:uiCore.activity.loading,error:uiCore.activity.error,generation:uiCore.activity.generation,page:state.page,owner:state.owner,epoch:state.authEpoch,identity:uiCore.state.identityGeneration,view:!!activityView,notice:document.querySelector('.activity-notice')?.textContent})));throw error;});await page.getByRole('tabpanel',{name:/动态/}).evaluate(node=>{node.parentElement.parentElement.scrollTop=400;});
      const top=await page.evaluate(()=>$('generic-page').scrollTop);assert.ok(top>0);
      await tab('目标').click();await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor();await shot(`${theme}-goals`);assert.equal(await page.getByRole('banner').getByText('目标',{exact:true}).filter({visible:true}).count(),1);
      await tab('动态').click();await page.waitForFunction(()=>!uiCore.activity.loading);assert.equal(await page.evaluate(()=>uiCore.activity.filter),'memory');assert.equal(await page.evaluate(()=>$('generic-page').scrollTop),top);
      await tab('成果库').click();await page.getByRole('button',{name:'预览 项目进度报告.md',exact:true}).waitFor();await shot(`${theme}-library`);
      await page.getByRole('combobox',{name:'按时间筛选',exact:true}).click();await shot(`${theme}-library-time-open`);await page.keyboard.press('Escape');
      await button('更多操作 项目进度报告.md').click();await shot(`${theme}-library-menu-open`);await page.keyboard.press('Escape');
      await button('预览 项目进度报告.md').click();await page.getByRole('heading',{name:'项目进度报告',exact:true}).waitFor();await shot(`${theme}-preview-open`);await button('返回成果库').click();
      await tab('目标').click();await page.getByRole('region',{name:'进行中',exact:true}).getByRole('button',{name:/更多操作/}).click();await shot(`${theme}-goal-menu-open`);await page.getByRole('menuitem',{name:'打开对话与步骤',exact:true}).click();await page.waitForFunction(()=>state.page==='chat');assert.equal(await page.getByRole('tablist').isVisible(),false);await shot(`${theme}-goal-source`);await button('返回').click();await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor();assert.equal(await tab('目标').getAttribute('aria-selected'),'true');
      await page.evaluate(()=>handleBack());await tab('聊天').waitFor();assert.equal(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),'保留这条主对话草稿');
      await tab('聊天').focus();await page.keyboard.press('ArrowRight');await tab('动态').waitFor();assert.equal(await tab('动态').getAttribute('aria-selected'),'true');await tab('聊天').click();
      report.checks.push(`${size.width}-${theme}: four-pages,profile,drawer,activity-menu-read,filters-scroll,library-menus-preview,goal-source-return,back-order,draft,keyboard-tabs`);
    }
    await page.evaluate(()=>processEvent({event:'navigation.activity',data:{activityId:uiCore.activity.items.at(-1).id}}));await page.waitForFunction(()=>state.page==='activity'&&notificationActivityId===null);assert.equal(await page.evaluate(()=>uiCore.activity.filter),'all');await shot('notification-deeplink');report.checks.push(`${size.width}: notification-deeplink-all-filter-focused`);
    await tab('聊天').click();await page.evaluate(()=>{const style=getComputedStyle(document.documentElement);const sizes=[...style].filter(key=>key.startsWith('--wm-font-size-')).map(key=>[key,parseFloat(style.getPropertyValue(key))*1.3]);for(const [key,value]of sizes)document.documentElement.style.setProperty(key,`${value}px`);});await shot('font-130-chat');await tab('成果库').click();await shot('font-130-library');await tab('动态').click();await shot('font-130-activity');await tab('目标').click();await shot('font-130-goals');await tab('成果库').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize({width:844,height:390});await shot('landscape-library');await tab('聊天').click();await shot('landscape-chat');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize(size);await page.evaluate(()=>{const sizes=[...getComputedStyle(document.documentElement)].filter(key=>key.startsWith('--wm-font-size-'));for(const key of sizes)document.documentElement.style.removeProperty(key);});
    await tab('聊天').click();await page.getByRole('textbox',{name:'输入消息',exact:true}).focus();await page.evaluate(()=>{viewportRestHeight=844;Object.defineProperty(visualViewport,'height',{value:450,configurable:true});visualViewport.dispatchEvent(new Event('resize'));});assert.equal(await page.getByRole('tablist').isVisible(),false);assert.ok(await page.evaluate(()=>$('composer-dock').getBoundingClientRect().bottom<=451));await shot('browser-keyboard-geometry');await page.getByRole('textbox',{name:'输入消息',exact:true}).blur();await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});report.checks.push(`${size.width}: simulated-browser-keyboard-geometry`);
    // Connection failures keep account-scoped activity rows, but explain host-only pages.
    await page.route('**/personal/v1/status',route=>route.abort('internetdisconnected'));
    for(const theme of ['light','dark']){await page.evaluate(theme=>applyTheme(theme),theme);for(const name of ['聊天','动态','目标','成果库']){await tab(name).click();await page.waitForTimeout(350);await shot(`${theme}-offline-${{'聊天':'chat','动态':'activity','目标':'goals','成果库':'library'}[name]}`);}assert.ok(await page.evaluate(()=>uiCore.activity.items.length>0));}
    await page.unroute('**/personal/v1/status');await tab('聊天').click();await page.evaluate(()=>{uiCore.state.models=[];uiCore.state.modelProfileId=null;uiCore.state.mainChat.modelDisplayName='';updateComposer();});await shot('no-model-chat');assert.equal(await button('发送').isDisabled(),true);report.checks.push(`${size.width}: cached-offline-activity,host-only-goals-library,no-model-send-disabled`);
    await page.context().close();
  }
  assert.deepEqual(report.errors,[]);await writeFile(join(out,'web-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();await f.close();}

