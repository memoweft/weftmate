/** UX-2: real production Electron shell, touch web and Android UI bundle; synthetic host only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'tests/evidence/ux-2');
mkdirSync(evidence, {recursive:true});
const env = {...process.env};
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let fixture, app, browser, profile;
const errors = [], checks = [];
const button = (page, name) => page.getByRole('button', {name, exact:true});
async function shot(page, surface, theme, scene) {
  await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
  await page.screenshot({path:join(evidence, `${surface}-${theme}-${scene}.png`)});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
}
try {
  fixture = await startTimelineCandidate({daily:true, sidebar:true, interactive:true, inlineProgress:true, usageSamples:true, historyCount:0, baseTime:Date.now()-15000});
  const me = await fixture.request('/auth/me'), hostId = me.hostId;
  async function settled(command) {
    for (let n=0;n<100;n++) { const row = (await fixture.request(`/commands/${command.commandId}`)).command;
      if (row.state === 'accepted_by_dsh') return row;
      assert.notEqual(row.state, 'rejected', JSON.stringify(row)); await new Promise(done=>setTimeout(done,20)); }
    throw Error('synthetic command timed out');
  }
  const projects = [], ids = [];
  for (const [index, count] of [[1,8],[2,7]]) {
    const folder = join(fixture.root, `project-${index}`); mkdirSync(folder);
    const {project} = await fixture.request('/projects', {requestId:randomUUID(), name:`合成项目${index}`, rootPath:folder}); projects.push(project);
    for(let n=1;n<=count;n++) {
      const command = await settled((await fixture.request(`/projects/${project.projectId}/sessions`, {requestId:randomUUID(), modelProfileId:'local'})).command);
      const title = `项目${index}对话${n}${n===count?'：用于验证完整标题与悬停详情的合成长标题，包含项目背景和交付安排':''}`;
      await fixture.request(`/sessions/${command.sessionId}/metadata`, {title}, 'PATCH'); ids.push({id:command.sessionId,title});
    }
  }
  await fixture.request('/settings/usage', {monthlyLimit:1}, 'PATCH');
  const summary = await fixture.request('/usage?'+new URLSearchParams({timeZone:'Asia/Shanghai'}));
  const expected = `上限剩余 ${Math.max(0,Math.round((1-summary.total.cost)*100))}%`;
  profile = mkdtempSync(join(tmpdir(),'weftmate-ux2-electron-'));
  app = await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light',TZ:'Asia/Shanghai'}});
  const desktop = await app.firstWindow(); desktop.on('pageerror',e=>errors.push(e.message)); desktop.setDefaultTimeout(20000);
  await localUiSession(desktop,fixture.credentials);
  const recent = ids[7];
  for(const theme of ['light','dark']) {
    await desktop.evaluate(t=>{document.documentElement.dataset.theme=t;const preferences=WeftUiCore.createAppearance(localStorage);preferences.set({...preferences.value,theme:t});},theme);
    const more = button(desktop, `更多操作 ${recent.title}`);
    await more.waitFor();
    await button(desktop, recent.title).hover();
    await button(desktop, `置顶 ${recent.title}`).waitFor({state:'visible'});
    await desktop.getByRole('tooltip',{name:'对话详情'}).waitFor();
    await desktop.getByRole('tooltip').getByText(recent.title,{exact:true}).waitFor();
    await desktop.getByRole('tooltip').getByText('所属项目 / 分组：合成项目1',{exact:true}).waitFor();
    await shot(desktop,'desktop',theme,'hover');
    await button(desktop, `置顶 ${recent.title}`).click();
    await button(desktop, `取消置顶 ${recent.title}`).waitFor({state:'visible'});
    await button(desktop, recent.title).focus();
    await desktop.keyboard.press('Tab');
    assert.equal(await button(desktop, `取消置顶 ${recent.title}`).evaluate(node=>node===document.activeElement),true);
    await desktop.keyboard.press('Enter');
    await button(desktop, recent.title).hover();
    await button(desktop, `归档 ${recent.title}`).click();
    await button(desktop,'撤销归档').waitFor(); await shot(desktop,'desktop',theme,'archived-undo');
    await button(desktop,'撤销归档').click(); await more.waitFor();
    await button(desktop, '展开显示（3） 合成项目1').click();
    await button(desktop, ids[0].title).waitFor();
    assert.equal(await button(desktop,ids[8].title).count(),0,'second project remains capped independently');
    await shot(desktop,'desktop',theme,'project-expanded');
    await desktop.reload(); await button(desktop,ids[0].title).waitFor();
    await button(desktop,'收起对话 合成项目1').click();
    await button(desktop,'账户菜单').click();
    const menu = desktop.getByRole('region',{name:'账户选项'});
    await menu.getByText(new RegExp(expected)).waitFor(); await shot(desktop,'desktop',theme,'account-menu');
    await button(desktop,'帮助与反馈').click(); await desktop.getByText('描述问题时请勿包含密码或私人对话。',{exact:true}).waitFor();
    await button(desktop,'关闭设置').click(); await desktop.keyboard.press('Control+,'); await desktop.getByRole('dialog',{name:'设置',exact:true}).waitFor(); await button(desktop,'关闭设置').click();
    await button(desktop,'账户菜单').click(); await button(desktop,'退出登录').click();
    await desktop.getByRole('dialog',{name:'退出登录',exact:true}).waitFor(); await shot(desktop,'desktop',theme,'logout-confirm'); await button(desktop,'取消').click();
    checks.push({theme,hoverButtons:true,hoverCard:true,keyboardPin:true,archiveUndo:true,projectPersistence:true,independentProjects:true,accountBudget:true,help:true,settingsShortcut:true,logoutCancel:true});
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(720,600));
  await button(desktop,'账户菜单').click(); await shot(desktop,'desktop','dark','narrow-menu'); await desktop.keyboard.press('Escape');
  browser = await chromium.launch({headless:true});
  for(const surface of ['mobile-web','android-ui']) {
    console.log('verify',surface);
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
    page.setDefaultTimeout(20000); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(surface==='mobile-web'?fixture.origin+'/personal/v1/ui':fixture.mobileUrl);
    if(surface==='mobile-web') { await localUiSession(page,fixture.credentials); await button(page,'切换会话侧栏').click(); }
    else { await page.waitForFunction(()=>state.booted&&state.loggedIn); await page.evaluate(()=>{page('home');}); await button(page,'打开导航').click(); }
    const conversations = surface==='android-ui' ? page.getByRole('navigation',{name:'主导航',exact:true}) : page;
    for(const theme of ['light','dark']) {
      console.log('verify',surface,theme,await page.getByRole('button',{name:/展开显示|收起对话/}).allTextContents());
      await page.evaluate(({theme,surface})=>{if(surface==='android-ui')applyTheme(theme);else document.documentElement.dataset.theme=theme},{theme,surface});
      await button(conversations,'展开显示（3） 合成项目1').click(); await button(conversations,ids[0].title).waitFor();
      await shot(page,surface,theme,'projects');
      if(surface==='mobile-web') {
        assert.equal(await button(page,`置顶 ${recent.title}`).isVisible(),false,'touch has no hover actions');
        await button(page,recent.title).dispatchEvent('pointerdown',{pointerType:'touch'}); await page.getByRole('menu',{name:'对话操作'}).waitFor();
        await button(page,recent.title).dispatchEvent('pointerup',{pointerType:'touch'}); await page.keyboard.press('Escape');
        await button(page,'账户菜单').click(); await button(page,'设置').click();
      } else {
        const openActions = async () => { await button(conversations,recent.title).dispatchEvent('pointerdown',{pointerType:'touch'});
          await page.getByRole('dialog',{name:'对话操作',exact:true}).waitFor(); await button(conversations,recent.title).dispatchEvent('pointerup',{pointerType:'touch'});
          return page.getByRole('dialog',{name:'对话操作',exact:true}); };
        let menu = await openActions(); await button(menu,'置顶').click(); await menu.waitFor({state:'hidden'});
        assert.equal((await fixture.request('/sessions')).sessions.find(row=>row.sessionId===recent.id).pinned,true);
        await button(page,'打开导航').click(); menu = await openActions(); await button(menu,'取消置顶').click(); await menu.waitFor({state:'hidden'});
        await button(page,'打开导航').click(); menu = await openActions(); await button(menu,'归档').click(); await menu.waitFor({state:'hidden'});
        await button(page,'撤销归档').waitFor(); await shot(page,surface,theme,'archive-undo'); await button(page,'撤销归档').click();
        await button(page,'撤销归档').waitFor({state:'hidden'});
        assert.equal((await fixture.request('/sessions?archived=all')).sessions.find(row=>row.sessionId===recent.id).archived,false);
        await button(page,'打开导航').click(); await button(page,'关闭导航').click(); await page.evaluate(()=>page('settings'));
      }
      await button(page,'用量详情').filter({visible:true}).waitFor(); await page.getByText(new RegExp(expected)).filter({visible:true}).waitFor(); await shot(page,surface,theme,'settings-usage');
      if(surface==='mobile-web') { await button(page,'关闭设置').click(); await button(page,'切换会话侧栏').click(); }
      else { await page.evaluate(()=>page('home')); await button(page,'打开导航').click(); }
      await button(conversations,'收起对话 合成项目1').click();
      checks.push({surface,theme,projectLimit:true,usageStrip:true,touchNoHover:true,...(surface==='android-ui'?{longPressPin:true,longPressArchiveUndo:true}:{longPressMenu:true})});
    }
    await page.close();
  }
  await fixture.request('/settings/usage',{monthlyLimit:null},'PATCH');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  await button(desktop,'账户菜单').click(); await desktop.getByText(`本月 ¥${Number(summary.total.cost).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:8})} · 3 次请求`,{exact:true}).waitFor();
  await button(desktop,'退出登录').click(); await button(desktop,'确认退出').click(); await desktop.getByRole('textbox',{name:'邮箱',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  writeFileSync(join(evidence,'checks.json'),JSON.stringify({syntheticOnly:true,realElectron:true,androidUiBundle:true,androidNativeShell:false,unlimitedRequests:true,logoutConfirmed:true,checks,errors},null,2)+'\n');
  console.log('UX-2 Electron, phone web and Android UI bundle passed.');
} finally {
  await browser?.close(); await app?.close(); await fixture?.close();
  if(fixture)rmSync(fixture.root,{recursive:true,force:true});if(profile)rmSync(profile,{recursive:true,force:true});
}
