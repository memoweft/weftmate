// Run from the repository root: node design/ios/prototype/verify.mjs <private-evidence-directory>
// Uses only the prototype and synthetic text; never connects to product services.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const evidence=path.resolve(process.argv[2] || '.local/ios-ui-design');
const screens=path.resolve(here,'../screens');
await fs.mkdir(evidence,{recursive:true});await fs.mkdir(screens,{recursive:true});
const url=pathToFileURL(path.join(here,'index.html')).href;
const browser=await chromium.launch({headless:true});
const errors=[], checks=[], overflows=[];
const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1,recordVideo:{dir:path.join(evidence,'video'),size:{width:393,height:852}}});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith('file:')&&!r.url().startsWith('blob:'))errors.push('Unexpected remote request');});
const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>document.getAnimations().filter(a=>a.playState==='running' && a.animationName!=='ink-in' && a.effect?.getTiming().iterations!==Infinity).length===0);};
const click=async selector=>{await page.locator(selector).click();await settle();};
const route=()=>page.locator('.page[aria-hidden="false"]').getAttribute('data-page');
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try {
  await page.goto(url);await settle();
  check('浅色聊天使用系统纯白',await page.locator('.page[aria-hidden="false"]').evaluate(n=>getComputedStyle(n).backgroundColor)==='rgb(255, 255, 255)');
  await click('.composer [data-panel="attachments"]');
  check('加号打开小菜单而非底部弹层',await page.locator('#popover-layer').isVisible()&&!await page.locator('#sheet-layer').isVisible());
  const attachmentAnchor=await page.locator('.composer [data-panel="attachments"]').boundingBox();
  const attachmentMenu=await page.locator('#popover').boundingBox();
  check('附件菜单贴着加号上方',Math.abs(attachmentMenu.y+attachmentMenu.height-attachmentAnchor.y)<=10 && attachmentMenu.width<320);
  await page.keyboard.press('Escape');await settle();
  check('小菜单关闭后焦点回加号',await page.locator('.composer [data-panel="attachments"]').evaluate(n=>n===document.activeElement));
  await click('.composer [data-panel="attachments"]');
  await click('#popover [data-action="add-attachment"] >> nth=0');
  check('小菜单选择文件后进入草稿',await page.locator('.attachment-chip').isVisible()&&!await page.locator('#popover-layer').isVisible());
  await click('.model-button');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await settle();
  check('键盘选择模型并更新输入区',await page.locator('.model-button').innerText().then(s=>s.includes('示例轻量模型')));
  await click('.model-button');await page.mouse.click(380,300);await settle();
  check('点菜单外关闭且不触发背景',!await page.locator('#popover-layer').isVisible()&&await route()==='chat');
  await click('.composer [data-panel="attachments"]');await page.keyboard.press('ArrowUp');
  check('菜单向上键定位末项',await page.evaluate(()=>document.activeElement.textContent.trim()==='照片'));
  await page.keyboard.press('Tab');
  check('菜单末项 Tab 回到首项',await page.evaluate(()=>document.activeElement.textContent.trim()==='文件'));
  await page.keyboard.press('Escape');await settle();
  await page.goto(url+'?page=settings');await settle();
  check('设置使用系统分组浅灰底',await page.locator('.page[aria-hidden="false"]').evaluate(n=>getComputedStyle(n).backgroundColor)==='rgb(242, 242, 247)');
  check('浅色分组卡片纯白',await page.locator('.page[aria-hidden="false"] .group').first().evaluate(n=>getComputedStyle(n).backgroundColor)==='rgb(255, 255, 255)');
  await click('.page[aria-hidden="false"] [data-action="theme"]');
  check('深色分组底为系统黑',await page.locator('.page[aria-hidden="false"]').evaluate(n=>getComputedStyle(n).backgroundColor)==='rgb(0, 0, 0)');
  check('深色分组卡片为系统灰',await page.locator('.page[aria-hidden="false"] .group').first().evaluate(n=>getComputedStyle(n).backgroundColor)==='rgb(28, 28, 30)');
  await page.goto(url+'?page=conversations');await settle();
  await click('.page[aria-hidden="false"] [data-action="page-options"]');await click('#popover [data-panel="filter"]');await click('#popover [data-filter="工作"]');
  check('筛选菜单实际筛出工作对话',await page.locator('[data-chat-kind]:visible').count()===2&&await page.locator('[data-chat-kind="对话"]:visible').count()===0);
  await click('.page[aria-hidden="false"] [data-action="page-options"]');await click('#popover [data-panel="sort"]');await click('#popover [data-sort="名称"]');
  check('排序菜单实际改变列表顺序',await page.locator('[data-chat-kind] strong').allTextContents().then(names=>JSON.stringify(names)===JSON.stringify([...names].sort((a,b)=>a.localeCompare(b,'zh-CN')))));
  await click('.page[aria-hidden="false"] [data-panel="conversation"]:visible >> nth=0');await click('#popover [data-panel="group"]');await click('#popover [data-panel="new-group"]');
  check('新建分组表单仍为底部弹层',await page.locator('#sheet input').isVisible()&&!await page.locator('#popover-layer').isVisible());
  await page.keyboard.press('Escape');await settle();
  check('嵌套菜单转表单后回原按钮',await page.evaluate(()=>document.activeElement.matches('[data-panel="conversation"]')));
  await page.goto(url+'?page=search');await settle();await click('[data-panel="date"]');
  check('日期保持按钮旁浮窗',await page.locator('#popover input[type="date"]').isVisible()&&!await page.locator('#sheet-layer').isVisible());
  await page.keyboard.press('Escape');await settle();
  await page.goto(url+'?page=health');await settle();await click('.page[aria-hidden="false"] [data-action="drawer"]');await click('#drawer [data-panel="new-chat"]');
  check('侧栏新建使用小菜单',await page.locator('#popover-layer').isVisible());await page.keyboard.press('Escape');await settle();
  check('侧栏菜单关闭后回原按钮',await page.evaluate(()=>document.activeElement.matches('#drawer [data-panel="new-chat"]'))&&await page.locator('#drawer-layer').isVisible());
  await click('#drawer [data-panel="new-chat"]');await click('#popover [data-action="temporary"]');
  check('从健康侧栏开临时对话关闭两层',await route()==='chat'&&!await page.locator('#drawer-layer').isVisible()&&!await page.locator('#popover-layer').isVisible());
  await page.goto(url);await settle();
  check('三项底部导航',await page.locator('.tabs button').count()===3);
  await page.locator('.composer textarea').fill('保留这份草稿');
  await click('[data-tab="health"]');await click('[data-metric="sleep"]');check('健康推进到趋势',await route()==='health-detail');
  await click('[data-tab="activity"]');await click('[data-tab="health"]');check('标签保留子页',await route()==='health-detail');
  await click('.page[aria-hidden="false"] [data-action="back"]');await click('[data-tab="chat"]');
  check('切换标签保留草稿',await page.locator('.composer textarea').inputValue()==='保留这份草稿');
  await click('.page[aria-hidden="false"] [data-action="drawer"]');
  check('侧栏没有重复动态健康标签',await page.locator('#drawer [data-tab="activity"],#drawer [data-tab="health"]').count()===0);
  await click('#drawer [data-go="memory"]');check('侧栏进入记忆',await route()==='memory');
  await click('.page[aria-hidden="false"] [data-kind="偏好"]');await click('.page[aria-hidden="false"] [data-panel="correct-memory"]');
  await page.locator('#sheet textarea').fill('只在最近的周末喜欢留白。');await click(':is(#sheet,#popover) [data-action="correct-memory"]');
  await click('.page[aria-hidden="false"] [data-panel="memory-actions"]');await click(':is(#sheet,#popover) [data-panel="forget-memory"]');check('遗忘先展示具体范围',await page.locator('#sheet').innerText().then(s=>s.includes('2 条原话来源')));await click(':is(#sheet,#popover) [data-action="forget"]');
  check('确认遗忘后列表更新',await page.locator('.page[aria-hidden="false"] .memory-item').count()===2);
  await page.goto(url);await settle();await page.locator('.composer textarea').fill('模拟一段长回复');await click('.page[aria-hidden="false"] [data-action="send"]');
  await page.waitForFunction(()=>document.querySelector('.streaming')?.textContent.length>30);
  await page.locator('.chat-content').hover();await page.mouse.wheel(0,-420);await page.waitForTimeout(180);
  const scroll=await page.locator('.chat-content').evaluate(n=>n.scrollTop);
  await page.waitForTimeout(400);check('上滚停止自动跟随',Math.abs(await page.locator('.chat-content').evaluate(n=>n.scrollTop)-scroll)<3);
  check('显示回到最新入口',await page.locator('.new-content').isVisible());await click('.new-content');
  await page.locator('.composer textarea').fill('这条排队');await click('.page[aria-hidden="false"] [data-action="send"]');
  await click('.page[aria-hidden="false"] [data-action="send"]');check('停止保留文字',await page.locator('.stream-turn .answer').innerText().then(s=>s.length>30));
  await click('.page[aria-hidden="false"] [data-panel="voice"]');
  const sheetBox=await page.locator('.sheet-grip').boundingBox();await page.mouse.move(sheetBox.x+100,sheetBox.y+10);await page.mouse.down();await page.mouse.move(sheetBox.x+100,sheetBox.y+160,{steps:12});await page.mouse.up();await settle();
  await page.locator('#sheet-layer').waitFor({state:'hidden',timeout:2000});check('弹层下拉关闭',!await page.locator('#sheet-layer').isVisible());
  await page.mouse.move(2,320);await page.mouse.down();await page.mouse.move(250,322,{steps:16});await page.mouse.up();await settle();check('左缘手势打开侧栏',await page.locator('#drawer-layer').isVisible());
  await page.mouse.move(260,400);await page.mouse.down();await page.mouse.move(90,400,{steps:12});await page.mouse.up();await settle();await page.locator('#drawer-layer').waitFor({state:'hidden',timeout:2000});check('侧栏左滑收起',!await page.locator('#drawer-layer').isVisible());
  await click('.page[aria-hidden="false"] [data-action="drawer"]');await click('#drawer [data-go="goals"]');
  await page.mouse.move(2,320);await page.mouse.down();await page.mouse.move(210,322,{steps:16});await page.mouse.up();await settle();check('子页边缘手势返回',await route()==='chat');
  await click('[data-tab="activity"]');await click('.page[aria-hidden="false"] [data-panel="approval"]');await page.keyboard.press('Escape');await settle();await page.locator('#sheet-layer').waitFor({state:'hidden',timeout:2000});check('Escape 关闭并恢复焦点',!await page.locator('#sheet-layer').isVisible());
  await page.goto(url+'?page=login');await settle();await page.locator('input[type=email]').fill('demo@example.com');await click('.page[aria-hidden="false"] [data-action="login-code"]');await page.locator('.page[aria-hidden="false"] input').fill('123456');await click('.page[aria-hidden="false"] [data-action="verify"]');await click('.page[aria-hidden="false"] [data-action="pair-scan"]');await click('.page[aria-hidden="false"] [data-action="pair-confirm"]');check('登录验证配对全流程',await route()==='devices');
  await page.goto(url+'?page=login');await settle();await click('[data-segment="登录方式"]:has-text("密码")');check('密码登录输入可见',await page.locator('.password-login input').isVisible());
  await click('.page[aria-hidden="false"] [data-go="recovery"]');await page.locator('input[type=email]').last().fill('demo@example.com');await click('.page[aria-hidden="false"] [data-action="login-code"]');
  await page.clock.install();await click('[data-action="resend-code"]');await page.clock.fastForward(61000);check('验证码冷却后恢复重发',await page.locator('[data-action="resend-code"]').isEnabled());await page.clock.resume();
  await page.locator('.page[aria-hidden="false"] input').fill('123456');await click('.page[aria-hidden="false"] [data-action="verify"]');check('找回密码进入改密而非配对',await route()==='change-password');
  await page.goto(url+'?page=health');await settle();await click('[data-metric="heart"]');await click('[data-action="chart-point"]');check('心率读值单位正确',await page.locator('#chart-selection').innerText().then(s=>s.includes('次 / 分')&&!s.includes('小时')));await click('[data-segment="趋势范围"]:has-text("30 天")');check('30天范围更新日期轴',await page.locator('.chart-labels').innerText().then(s=>s.includes('9/28')));
  await page.goto(url+'?page=reminders');await settle();await click('[data-reminder="1"]');await click(':is(#sheet,#popover) [data-panel="reminder"]');await page.locator('#sheet input[aria-label="提醒内容"]').fill('带两瓶水出门');await click(':is(#sheet,#popover) [data-action="reminder-save"]');check('修改提醒不增加条数',await page.locator('.reminder-list .list-row').count()===2);check('修改提醒显示新内容',await page.locator('.reminder-list').innerText().then(s=>s.includes('带两瓶水')));await click('[data-reminder="1"]');await click(':is(#sheet,#popover) [data-panel="reminder-delete"]');await click(':is(#sheet,#popover) [data-action="reminder-delete"]');check('删除提醒实际移除',await page.locator('.reminder-list .list-row').count()===1);
  await page.goto(url+'?page=goal-detail');await settle();await click('.page[aria-hidden="false"] [data-panel="goal-actions"]');await click(':is(#sheet,#popover) [data-panel="goal-archive"]');await click(':is(#sheet,#popover) [data-action="archive-goal"]');check('移出目标不标为完成',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>s.includes('已移出')&&!s.includes('「每周留一个上午给自己」已完成')));
  await page.goto(url+'?page=resources');await settle();await page.evaluate(()=>go('memory'));await settle();await click('.page[aria-hidden="false"] [data-memory="preference"]');await click('.page[aria-hidden="false"] [data-panel="memory-actions"]');await click(':is(#sheet,#popover) [data-panel="forget-memory"]');await click(':is(#sheet,#popover) [data-action="forget"]');
  await page.evaluate(()=>go('search'));await settle();check('遗忘后搜索不再呈现同一内容',!await page.locator('.page[aria-hidden="false"] [data-memory="preference"]').count());await page.evaluate(()=>go('memory'));await settle();await click('.page[aria-hidden="false"] [data-memory="fact"]');check('无关记忆仍有独立内容',await page.locator('.page[aria-hidden="false"] h2').innerText()==='最近在读的书');
  await click('.page[aria-hidden="false"] [data-panel="memory-actions"]');await click(':is(#sheet,#popover) [data-panel="mute-memory"]');await click(':is(#sheet,#popover) [data-action="mute-memory"]');check('停用显示停用状态',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>s.includes('已停用')));
  check('无关记忆不含已遗忘来源',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>!s.includes('少安排一点')&&!s.includes('不赶时间的上午')));
  await page.evaluate(()=>go('memory'));await settle();await click('.page[aria-hidden="false"] [data-memory="review"]');check('停用状态不串到其他记忆',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>!s.includes('已停用')));
  await page.evaluate(()=>go('resources'));await settle();check('遗忘使已缓存来源页失效',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>!s.includes('周末喜欢留出空白')&&s.includes('已遗忘')));
  await page.goto(url+'?page=health-settings');await settle();await click('[data-toggle="health-cloud"]');await click(':is(#sheet,#popover) [data-action="health-cloud-confirm"]');check('健康云确认后开关开启',await page.locator('[data-toggle="health-cloud"]').getAttribute('aria-checked')==='true');
  await click('.page[aria-hidden="false"] [data-panel="health-delete"]');await click(':is(#sheet,#popover) [data-action="health-delete"]');await page.evaluate(()=>go('health-settings'));await settle();check('删除摘要后读取开关关闭',await page.locator('[data-toggle="读取健康数据"]').getAttribute('aria-checked')==='false');
  await page.goto(url+'?page=models');await settle();await click('.page[aria-hidden="false"] [data-go="model-edit"] >> nth=0');await click('.page[aria-hidden="false"] [data-panel="delete-service"]');await click(':is(#sheet,#popover) [data-action="delete-service"]');check('删除模型服务更新列表',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>s.includes('示例服务已移除')&&!s.includes('已配置 · 2 个模型')));
  await page.goto(url+'?page=schedules');await settle();await click('.page[aria-hidden="false"] [data-panel="schedule-delete"]');await click(':is(#sheet,#popover) [data-action="delete-schedule"]');check('删除定时任务更新列表',await page.locator('.page[aria-hidden="false"]').innerText().then(s=>s.includes('没有待运行的定时任务')));
  await page.goto(url);await settle();await click('.answer-actions [data-action="copy"]');check('复制绑定回答正文',await page.evaluate(()=>getSelection().toString().startsWith('那就把上午留给散步')));await click('.page[aria-hidden="false"] .process');check('过程实际展开',await page.locator('.process-detail').isVisible());
  await page.goto(url+'?panel=health-analysis-result');await settle();await click(':is(#sheet,#popover) [data-fill]');check('弹层建议回到聊天草稿',await route()==='chat'&&!await page.locator('#sheet-layer').isVisible()&&await page.locator('.composer textarea').inputValue()!=='');
  await page.goto(url+'?panel=queue');await settle();await click(':is(#sheet,#popover) [data-action="queue-add"]');check('列表增加示例消息',await page.locator('.queue-row').count()===1);await click(':is(#sheet,#popover) [data-action="queue-remove"]');await page.locator('.queue-row').waitFor({state:'detached'});check('列表删除动画后移除',await page.locator('.queue-row').count()===0);
  await page.goto(url+'?page=health-settings');await settle();check('开关有44点触控高度',await page.locator('.switch').first().evaluate(n=>n.getBoundingClientRect().height>=44));
  const video=page.video();await page.close();await context.close();await video.saveAs(path.join(evidence,'interaction.webm'));
  console.log(`Interaction checks: ${checks.length} passed`);
  if(process.argv.includes('--behavior-only')){await fs.writeFile(path.join(evidence,'behavior-verification.json'),JSON.stringify({checks,errors},null,2));check('无脚本异常',errors.length===0);await browser.close();process.exit(0);}
  const captureContext=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1});
  const capture=await captureContext.newPage();capture.on('pageerror',e=>errors.push(e.message));
  await capture.goto(url);const fixtures=await capture.evaluate(()=>window.prototypeFixtures);
  let captured=0;
  for(const theme of ['light','dark']){
    for(const id of fixtures.pages){
      await capture.goto(url+`?page=${id}&theme=${theme}`);await capture.waitForFunction(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).length===0);
      await capture.locator('.phone').screenshot({path:path.join(screens,`${id}-${theme}.png`)});
      const overflow=await capture.locator('.page[aria-hidden="false"] .page-content').evaluate(n=>n.scrollWidth>n.clientWidth+1);if(overflow)overflows.push(id+'-'+theme);
      check(`画面 ${id}-${theme} 有内容`,(await capture.locator('.page[aria-hidden="false"] .page-content').innerText()).length>5);
      captured++;if(captured%20===0)console.log(`Captured ${captured} screens`);
    }
    await capture.goto(url+`?drawer=1&theme=${theme}`);await capture.waitForTimeout(450);await capture.locator('.phone').screenshot({path:path.join(screens,`sidebar-${theme}.png`)});
    for(const name of fixtures.sheets){
      await capture.goto(url+`?panel=${name}&theme=${theme}`);await capture.waitForTimeout(450);await capture.locator('.phone').screenshot({path:path.join(screens,`${fixtures.compact.includes(name)?'popover':'sheet'}-${name}-${theme}.png`)});
      check(`浮层 ${name}-${theme} 标题正确`,(await capture.locator(fixtures.compact.includes(name)?'#popover-title':'#sheet-title').innerText()).length>0);captured++;
      if(fixtures.compact.includes(name)){
        const geometry=await capture.evaluate(()=>{const p=document.querySelector('#popover'),r=p.getBoundingClientRect(),a=panelAnchor.getBoundingClientRect(),phone=document.querySelector('#phone').getBoundingClientRect();return {fits:r.left>=phone.left+11&&r.right<=phone.right-11&&r.top>=phone.top+54&&r.bottom<=phone.bottom-24,near:Math.min(Math.abs(r.bottom-a.top),Math.abs(r.top-a.bottom))<=9,overflow:p.scrollWidth>p.clientWidth+1};});
        check(`小菜单 ${name}-${theme} 贴按钮且未越界`,geometry.fits&&geometry.near&&!geometry.overflow);
        check(`小菜单 ${name}-${theme} 未打开上拉栏`,!await capture.locator('#sheet-layer').isVisible());
      }
    }
    for(const state of ['offline','empty','error','loading']){
      await capture.goto(url+`?page=health&state=${state}&theme=${theme}`);await capture.waitForTimeout(100);await capture.locator('.phone').screenshot({path:path.join(screens,`state-${state}-${theme}.png`)});
    }
  }
  await capture.emulateMedia({reducedMotion:'reduce'});await capture.goto(url+'?drawer=1');await capture.waitForTimeout(30);check('减少动态效果仍可显示侧栏',await capture.locator('#drawer').evaluate(n=>getComputedStyle(n).transform==='matrix(1, 0, 0, 1, 0, 0)'));
  await capture.setViewportSize({width:1100,height:960});await capture.goto(url);await capture.screenshot({path:path.join(evidence,'desktop.png')});
  for(const viewport of [{width:320,height:568},{width:1100,height:960}]){
    await capture.setViewportSize(viewport);await capture.goto(url+'?panel=attachments');await capture.waitForTimeout(250);
    check(`窄屏与宽屏菜单边界 ${viewport.width}`,await capture.evaluate(()=>{const p=document.querySelector('#popover').getBoundingClientRect(),f=document.querySelector('#phone').getBoundingClientRect();return p.left>=f.left&&p.right<=f.right&&p.bottom<=f.bottom;}));
    await capture.locator('.phone').screenshot({path:path.join(evidence,`attachments-${viewport.width}.png`)});
  }
  check('无横向溢出',overflows.length===0);check('无脚本异常',errors.length===0);
  const report={viewport:'393×852',pages:fixtures.pages.length,sheets:fixtures.sheets.length,checks,errors,overflows,captured:captured+10};
  await fs.writeFile(path.join(evidence,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pages:report.pages,sheets:report.sheets,checks:checks.length,captured:report.captured,errors,overflows}));
  await captureContext.close();
} finally {await browser.close();}
