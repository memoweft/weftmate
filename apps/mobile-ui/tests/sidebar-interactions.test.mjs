import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../www/', import.meta.url));
const evidence = fileURLToPath(new URL(process.env.WEFTMATE_UXP3_EVIDENCE === '1' ? '../../../tests/evidence/ux-p3/' : '../../../.local/ux-p3/', import.meta.url));
test('D50 touch drawer aligns project and chat rows, single status, long press and settings page titles', async () => {
  const server = createServer(async (req, res) => { try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root)) return res.writeHead(404).end();
    res.setHeader('Content-Type', { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' }[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch({ headless:true });
  await mkdir(evidence, { recursive:true });
  try {
    const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
    const errors=[];page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.weftNative = { postMessage(json) {
        const req=JSON.parse(json);let result={};
        if(req.method==='app.bootstrap')result={loggedIn:true,owner:'synthetic-sidebar',username:'界面测试',deviceId:'synthetic-phone',model:{source:'phone',displayName:'合成模型'}};
        if(req.method==='settings.appearance')result={value:'light'};
        if(req.method==='attachments.list')result={attachments:[]};
        if(req.method==='conversations.list')result={conversations:[]};
        if(req.method==='shared.sessions.list')result={source:'host',hostAvailable:true,sessions:window.fixtureSessions||[]};
        if(req.method==='shared.projects.list')result={projects:window.fixtureProjects||[]};
        if(req.method==='auth.me')result={displayName:'界面测试',owner:'synthetic-sidebar',connectionVerified:true};
        if(req.method==='host.business') {
          if(req.params.path.includes('/settings/notifications'))result={settings:{approval:'notify',question:'notify',task:'notify',reminder:'notify',memory:'activity',memoryReport:'activity',system:'notify',dndStart:'22:00',dndEnd:'08:00',dailyLimit:5},timeZone:'Asia/Shanghai'};
          if(req.params.path.endsWith('/memory/status'))result={state:'ready',ownerId:'synthetic-sidebar',worldRevision:1,capabilities:{list:true,source:true},pendingBoundaryCount:0,blockedBoundaryCount:0,ingestion:{formedCount:2}};
          if(req.params.path.includes('/memory/items'))result={ownerId:'synthetic-sidebar',worldRevision:1,searchScope:'account_snapshot',items:[],hasMore:false,totalCount:0};
          if(req.params.path.endsWith('/system'))result={host:{state:'ready'},model:{state:'ready'},memory:{state:'disabled'}};
          if(req.params.path.endsWith('/models/settings'))result={};
          if(req.params.path.endsWith('/projects'))result={projects:window.fixtureProjects||[]};
        }
        if(req.method==='notifications.state')result={systemAllowed:true,channels:[]};
        setTimeout(()=>window.weftNative.onmessage({data:JSON.stringify({id:req.id,ok:true,result})}),0);
      } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>state.booted);await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.fixtureProjects=[{projectId:'project-demo',name:'合成项目 · 较长的名称用于检查单行截断',permission:'read-only'}];
      window.fixtureSessions=[{sessionId:'running',source:'host',title:'运行中并有未读',running:true,unread:true},{sessionId:'unread',source:'host',title:'未读旁聊',unread:true},{sessionId:'pinned',source:'host',title:'已置顶的临时旁聊',pinned:true,memoryMode:'off'},
        {sessionId:'project-selected',source:'host',projectId:'project-demo',title:'项目内选中的长名称对话不会挤掉状态位用于检查截断'},{sessionId:'project-unread',source:'host',projectId:'project-demo',title:'项目内未读对话',unread:true}];
      state.sharedSessions=fixtureSessions;uiCore.state.ownerId=state.owner;uiCore.state.projects=fixtureProjects;state.sharedSessionId='project-selected';state.chatSource='host';renderConversationList();
    });
    for(const size of [{width:390,height:844},{width:360,height:780}]) {
      await page.setViewportSize(size);
      for(const theme of ['light','dark']) {
        await page.evaluate(theme=>{applyTheme(theme);openDrawer();},theme);
        const capture=async name=>{await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)));await page.screenshot({path:resolve(evidence,`after-mobile-${size.width}-${theme}-${name}.png`)});};
        const nav=page.getByRole('navigation',{name:'主导航'});
        assert.equal(await nav.locator('.session-more').count(),0);
        const project=nav.getByRole('button',{name:'收起项目 合成项目 · 较长的名称用于检查单行截断'});
        const selected=nav.getByRole('button',{name:'项目内选中的长名称对话不会挤掉状态位用于检查截断',exact:true});
        assert.equal(await selected.count(),1,await nav.innerText());await nav.locator('#conversation-list').evaluate(el=>el.scrollTop=0);await capture('drawer-states');await selected.scrollIntoViewIfNeeded();
        const a=await project.boundingBox(),b=await selected.boundingBox();
        assert.equal(a.x,b.x);assert.equal(a.width,b.width);assert.ok(b.y-a.y-a.height>=2&&b.y-a.y-a.height<=4);
        assert.equal(await nav.getByRole('button',{name:'运行中并有未读',exact:true}).locator('.mobile-session-status.is-running').count(),1);
        assert.equal(await nav.getByRole('button',{name:'运行中并有未读',exact:true}).locator('.is-unread').count(),0);
        assert.equal(await nav.getByRole('button',{name:'已置顶的临时旁聊',exact:true}).locator('.mobile-session-status:empty').count(),1);
        assert.equal(await page.locator('.session-hover-card').count(),0);
        await capture('drawer');
        await selected.dispatchEvent('pointerdown',{pointerType:'touch',clientX:b.x+30,clientY:b.y+20});await page.getByRole('dialog',{name:'对话操作'}).waitFor();await selected.dispatchEvent('pointerup');
        const menu=page.getByRole('dialog',{name:'对话操作'});
        assert.equal(await menu.getByRole('button',{name:'置顶聊天',exact:true}).isVisible(),true);
        assert.equal(await menu.getByRole('button',{name:'归档',exact:true}).isVisible(),true);
        assert.equal(await menu.getByRole('button',{name:'更多',exact:true}).isVisible(),true);
        await capture('longpress');
        if(size.width===390){await menu.getByRole('button',{name:'更多',exact:true}).click();const full=page.getByRole('dialog',{name:'对话操作'});await full.getByRole('button',{name:'重命名',exact:true}).waitFor();await capture('longpress-more');await full.getByRole('button',{name:'取消',exact:true}).click();}
        else await menu.getByRole('button',{name:'取消',exact:true}).click();
        await project.dispatchEvent('pointerdown',{pointerType:'touch',clientX:a.x+30,clientY:a.y+20});const projectMenu=page.getByRole('dialog',{name:/项目操作/});await projectMenu.waitFor();await project.dispatchEvent('pointerup');await capture('project-longpress');await projectMenu.getByRole('button',{name:'取消',exact:true}).click();
        await page.evaluate(()=>closeDrawer());
      }
    }
    await page.setViewportSize({width:390,height:844});
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>{applyTheme(theme);state.logicalChats=true;uiCore.state.mainChat={chatId:'main-test'};uiCore.state.selectedChatId='main-test';uiCore.state.activeChatSource='desktop';page('notifications');},theme);
      assert.equal(await page.locator('#header-title').innerText(),'通知');
      const entry=page.getByRole('button',{name:'查看后台运行设置',exact:true});await entry.scrollIntoViewIfNeeded();
      assert.equal(await entry.locator('svg').count(),1);
      assert.equal(await entry.evaluate(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)'),false);
      await page.screenshot({path:resolve(evidence,`after-mobile-390-${theme}-notifications.png`)});
      await page.evaluate(()=>page('general'));await page.getByRole('button',{name:'刷新系统状态',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'刷新系统状态',exact:true}).innerText(),'');
      assert.equal(await page.locator('#header-title').innerText(),'常规');
      await page.screenshot({path:resolve(evidence,`after-mobile-390-${theme}-settings-general.png`)});
      await page.evaluate(()=>page('memory'));await page.waitForFunction(()=>state.memory?.statusState==='ready'&&!state.memory.loading);
      assert.equal(await page.locator('#header-title').innerText(),'记忆');const more=page.getByRole('button',{name:'更多记忆操作',exact:true});assert.equal(await more.innerText(),'');
      await more.click();await page.getByRole('menuitem',{name:'刷新',exact:true}).click();await page.waitForFunction(()=>!state.memory.loading);
      const search=page.getByRole('searchbox',{name:'搜索当前类别的全部账户记忆'});await search.fill('测试');await search.press('Enter');await page.waitForFunction(()=>state.memory.query==='测试'&&!state.memory.loading);await search.blur();
      await page.screenshot({path:resolve(evidence,`after-mobile-390-${theme}-memory.png`)});await page.getByRole('button',{name:'更多记忆操作',exact:true}).click();await page.getByRole('menuitem',{name:'导出我的记忆 · JSON'}).waitFor();
      await page.screenshot({path:resolve(evidence,`after-mobile-390-${theme}-memory-more.png`)});await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close();await new Promise(done=>server.close(done)); }
});
