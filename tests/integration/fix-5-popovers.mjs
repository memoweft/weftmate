import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron, chromium } from 'playwright';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'tests/evidence/fix-5');
const baseline = '2f1d60bc113c828bfc5019c939be96326fb62989';
const capture = !process.argv.includes('--verify-only'), fixture = process.argv.includes('--fixture');
mkdirSync(evidence, { recursive: true });
const results = [], errors = [];
let app, candidate, browser, server, phase = 'after';
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
async function check(page, locator, name, size, enforce = true) {
  await locator.waitFor(); await page.waitForTimeout(300);
  const rect = await locator.evaluate(node => { const r = node.getBoundingClientRect(), v = visualViewport; return { presentation: node.dataset.presentation, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, viewport: { left: v?.offsetLeft || 0, top: v?.offsetTop || 0, width: v?.width || innerWidth, height: v?.height || innerHeight }, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }; });
  results.push({ phase, size, name, ...rect }); console.log(`${phase} ${size} ${name}`);
  if (enforce) { const v = rect.viewport; const inset = rect.presentation === 'sheet' ? -0.5 : 7.5; assert.ok(rect.width > 0 && rect.height > 0 && rect.left >= v.left + inset && rect.top >= v.top + 7.5 && rect.right <= v.left + v.width - inset && rect.bottom <= v.top + v.height - inset, `${name} ${size}: ${JSON.stringify(rect)}`); if (rect.presentation === 'sheet') assert.ok(rect.height <= v.height * .55 + 1, 'bottom selection list stays within 55% of the visible viewport'); }
  if (capture) await page.screenshot({ path: join(evidence, `${phase}-${size}-${name}.png`) });
}
try {
  candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true, baseTime: Date.now() - 80000 });
  const profile = mkdtempSync(join(tmpdir(), 'weftmate-fix5-'));
  writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, env, timeout: 90000,
    args: fixture ? ['tests/integration/desktop-ui-1.cjs', candidate.origin + '/personal/v1/ui/'] : ['.', '--personal-host', '--access-port=0', `--user-data-dir=${profile}`, '--force-device-scale-factor=1'] });
  const page = await app.firstWindow(); if (fixture) await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].show()); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
  if (!fixture) {
    await page.waitForURL(url => url.pathname.startsWith('/personal/v1/ui'));
    await page.route('**/personal/v1/**', async route => {
      const url = new URL(route.request().url());
      if (phase === 'before' && url.pathname.includes('/ui/') && !url.pathname.includes('/ui/ui-core/') && !url.pathname.endsWith('/popovers.js')) {
        const path = 'src/personal-access-ui/' + url.pathname.split('/ui/')[1];
        try { const body = execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root }); return route.fulfill({ body, contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript' }); } catch {}
      }
      const response = await route.fetch({ url: candidate.origin + url.pathname + url.search, headers: { ...route.request().headers(), origin: candidate.origin } });
      await route.fulfill({ response });
    });
  }
  for (phase of capture && !fixture ? ['before', 'after'] : ['after']) {
    await page.reload(); await localUiSession(page, candidate.credentials);
    await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).waitFor();
    for (const [width, height] of [[1200,800], [720,600]]) {
      await app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0,0); window.setContentSize(...size); }, [width,height]);
      const size = `${width}x${height}`, enforce = phase === 'after';
      await page.getByRole('button', { name: '合成会话', exact: true }).click();
      await check(page, page.getByRole('listbox', { name: '选择模型' }).locator('..'), 'model', size, enforce);
      if (enforce) assert.equal(await page.getByRole('listbox', { name: '选择模型' }).locator('..').evaluate(n => n.dataset.popoverSide), 'top');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '自动', exact: true }).click();
      await check(page, page.getByRole('menu', { name: '审批模式' }), 'approval', size, enforce); await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '账户菜单' }).click();
      await check(page, page.getByRole('button', { name: '设置', exact: true }).locator('..'), 'account', size, enforce); await page.keyboard.press('Escape');
      if(enforce){
        await page.getByRole('button',{name:'账户菜单'}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
        await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'助手',exact:true}).click();
        const mode=page.getByRole('combobox',{name:'回复进行中时发送的消息',exact:true});await mode.click();
        await check(page,page.getByRole('listbox',{name:'回复进行中时发送的消息'}).locator('..'),'message-mode-setting',size);
        await page.getByRole('option',{name:'排队',exact:true}).click();assert.match(await mode.textContent(),/排队/);
        await page.getByRole('button',{name:'关闭设置',exact:true}).click();
      }

      await page.getByRole('button', { name: /^更多操作 / }).first().click();
      await check(page, page.getByRole('menu', { name: '对话操作', exact: true }), 'session', size, enforce); await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '输出与来源', exact: true }).click();
      await check(page, page.getByRole('dialog', { name: '输出与来源' }), 'resources', size, enforce);
      await page.getByRole('dialog', { name: '输出与来源' }).getByRole('button', { name: /README/ }).click();
      await page.getByRole('button', { name: '再打开一项' }).click();
      await check(page, page.getByRole('dialog', { name: '输出与来源' }), 'panel-menu', size, enforce);
      await page.getByRole('button', { name: '关闭列表' }).click(); await page.getByRole('button', { name: '收起右侧面板' }).click();
      if (enforce) {
        await page.getByRole('button', { name: '合成会话', exact: true }).click();
        await page.getByRole('listbox', { name: '选择模型' }).evaluate(list => {
          for (let i=0;i<40;i++) { const option=list.firstElementChild.cloneNode(true);option.textContent=`合成模型 ${i}`;list.append(option); }
        });
        await check(page, page.getByRole('listbox', { name: '选择模型' }).locator('..'), 'model-long', size);
        assert.ok(await page.getByRole('listbox', { name: '选择模型' }).evaluate(n => n.scrollHeight > n.clientHeight));
        await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0,0); window.setContentSize(460,400); });
        await check(page, page.getByRole('listbox', { name: '选择模型' }).locator('..'), 'model-resize', '460x400'); await page.keyboard.press('Escape');
      }
    }
  }
  await app.close(); app = null;
  // The phone component projection uses synthetic identity/model responses; no native
  // app, cloud login, inference, attachment picker or user data is involved.
  const assets = join(root, 'apps/mobile-ui/www');
  server = createServer((req,res) => {
    const path = new URL(req.url,'http://localhost').pathname, file = resolve(assets,'.'+(path==='/'?'/index.html':path));
    if (!file.startsWith(assets + '/') && !file.startsWith(assets + '\\')) return res.writeHead(404).end();
    try {
      let body = readFileSync(file);
      if (phase==='before' && ['/components/chat.js','/components/decisions.js','/styles.css'].includes(path)) body=execFileSync('git',['show',`${baseline}:apps/mobile-ui/www${path}`],{cwd:root});
      res.setHeader('content-type',{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream');res.end(body);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  let phone;
  if (fixture) {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, env, args: ['tests/integration/desktop-ui-1.cjs', `http://127.0.0.1:${server.address().port}/`] });
    phone = await app.firstWindow(); await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].show()); await phone.setViewportSize({width:390,height:844});
  } else { browser=await chromium.launch({headless:true,...(process.argv.includes('--chrome')?{channel:'chrome'}:{})});phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); }
  phone.setDefaultTimeout(15000);phone.on('pageerror',e=>errors.push(e.message));
  await phone.addInitScript(()=>{window.weftNative={postMessage(raw){const message=JSON.parse(raw);const result=message.method==='host.business'&&message.params?.path==='/personal/v1/settings/personalization'?{settings:{...WeftPersonalization.defaults,...message.params.body},updatedAt:'2026-10-10T00:00:00.000Z',synced:true}:message.method==='app.bootstrap'?{loggedIn:false}:message.method==='models.list'?{models:[{source:'phone',modelId:'fixture',displayName:'MiMo 定时验收',selected:true}]}:message.method==='models.host'?{models:[]}:{};queueMicrotask(()=>window.weftNative.onmessage({data:JSON.stringify({id:message.id,ok:true,result})}));}};});
  for(phase of capture?['before','after']:['after']) {
    await phone.goto(`http://127.0.0.1:${server.address().port}/`);await phone.waitForFunction(()=>typeof state!=='undefined'&&state.booted);
    await phone.evaluate(()=>{state.loggedIn=true;state.owner='synthetic-fix5';state.deviceId='synthetic-phone';state.transitionPending=false;state.chatSource='phone';state.restorePending=false;page('chat');updateComposer();});
    await phone.getByRole('button',{name:'选择模型',exact:true}).click();await check(phone,phone.getByRole('heading',{name:'选择模型',exact:true}).locator('..'),'model','390x844',phase==='after');
    await phone.getByRole('button',{name:'添加图片或文件',exact:true}).click();await check(phone,phone.getByRole('menu',{name:'添加附件'}),'attachment','390x844',phase==='after');
    await phone.getByRole('button',{name:/^审批模式/}).click();await check(phone,phone.getByRole('menu',{name:'审批模式'}),'approval','390x844',phase==='after');
    await phone.evaluate(()=>{closeApprovalModeMenu();mobileSessionMenu({sessionId:'synthetic',title:'合成会话'});});
    await check(phone,phone.getByRole('dialog',{name:'对话操作',exact:true}),'session','390x844',phase==='after');await phone.getByRole('button',{name:'取消',exact:true}).click();
    if(phase==='after') {
      await phone.evaluate(()=>{state.chatSource='host';state.sharedRunning=true;state.sharedSessionId='synthetic-session';state.sharedSessions=[{sessionId:'synthetic-session',sendAvailable:true}];updateComposer();});
      await phone.getByRole('button',{name:'返回',exact:true}).click();await phone.getByRole('button',{name:'打开导航',exact:true}).click();
      await phone.getByRole('button',{name:'设置',exact:true}).click();await phone.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^助手/}).click();
      await phone.getByRole('combobox',{name:'回复进行中时发送的消息'}).click();await check(phone,phone.getByRole('listbox',{name:'回复进行中时发送的消息'}).locator('..'),'message-mode-setting','390x844');
      await phone.getByRole('option',{name:'排队',exact:true}).click();
      assert.match(await phone.getByRole('combobox',{name:'回复进行中时发送的消息'}).textContent(),/排队/);
      await phone.getByRole('button',{name:'返回',exact:true}).click();await phone.getByRole('button',{name:'返回',exact:true}).click();
      await phone.evaluate(()=>page('chat'));
      await phone.evaluate(()=>{state.chatSource='phone';state.sharedRunning=false;updateComposer();});
      await phone.getByRole('button',{name:'选择模型',exact:true}).click();
      await phone.setViewportSize({width:280,height:300});await check(phone,phone.getByRole('heading',{name:'选择模型',exact:true}).locator('..'),'model-resize','280x300');
      await phone.setViewportSize({width:390,height:844});
      // Force edge anchors through the same production helper, including horizontal
      // flip, both vertical directions, scrollable content and visual viewport events.
      await phone.evaluate(()=>{closeModelMenu();const menu=$('model-popover'),trigger=$('model-button');menu.hidden=false;trigger.style.position='fixed';trigger.style.left='370px';trigger.style.top='8px';WeftPopover.position(menu,trigger);});
      await check(phone,phone.getByRole('heading',{name:'选择模型',exact:true}).locator('..'),'edge-flip','390x844');
      assert.equal(await phone.getByRole('heading',{name:'选择模型',exact:true}).locator('..').evaluate(n=>n.dataset.popoverSide),'bottom');
    }
  }
  assert.deepEqual(errors,[]);
  if (capture) writeFileSync(join(evidence,'verification.json'),JSON.stringify({baseline,desktop:fixture?'portable Electron fixture':'real WeftMate application',mobile:'Chromium phone webpage with synthetic component projection',results},null,2)+'\n');
  console.log(`FIX-5: ${results.length} menu measurements passed; no page errors.`);
} finally {await app?.close();await browser?.close();await candidate?.close();await new Promise(done=>server?server.close(done):done());}
