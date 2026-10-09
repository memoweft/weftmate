/** UI-P5: production Electron shell and phone pages; isolated synthetic accounts. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const before = process.argv.includes('--before');
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'tests/evidence/ui-p5');
mkdirSync(evidence, { recursive: true });
const env = { ...process.env }, errors = [], checks = [];
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
for (const theme of ['light', 'dark']) {
  const fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, inlineProgress: true, composer: true, windowChrome:true, appearanceTheme:theme, baseTime: Date.now() - 15000 });
  await fixture.request(`/sessions/${fixture.sessionId}/approval-mode`, { mode: 'allow-all' }, 'PATCH');
  const profile = mkdtempSync(join(tmpdir(), 'weftmate-ui-p5-'));
  writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  let app, browser;
  try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root,
      args: ['.', '--personal-host', '--access-port=0', `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
    const desktop = await app.firstWindow({timeout:90000});
    await desktop.waitForURL(url=>url.pathname.startsWith('/personal/v1/ui'));
    await desktop.route('**/personal/v1/**',async route=>{
      const url=new URL(route.request().url());
      const response=await route.fetch({url:fixture.origin+url.pathname+url.search,headers:{...route.request().headers(),origin:fixture.origin}});
      await route.fulfill({response});
    });
    await app.evaluate(({BrowserWindow,nativeTheme},theme)=>{nativeTheme.themeSource=theme;const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate');win.setContentSize(1200,800);},theme);
    const savedTheme=theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'}));
    await desktop.addInitScript(savedTheme,theme);
    await desktop.reload(); await localUiSession(desktop, fixture.credentials);
    browser = await chromium.launch({ headless: true });
    const remote = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await remote.addInitScript(savedTheme,theme);
    await remote.goto(fixture.origin + '/personal/v1/ui'); await localUiSession(remote, fixture.credentials);
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(fixture.mobileUrl); await mobile.getByRole('button', { name: '项目进度报告 正在运行', exact: true }).click();
    const surfaces = [['desktop', desktop], ['mobile-web', remote], ['mobile', mobile]];
    for (const [surface, page] of surfaces) {
      page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    }
    async function shot(surface, page, name) {
      await page.waitForTimeout(300);
      const path = join(evidence, `${before ? 'before' : 'after'}-${surface}-${theme}-${name}.png`);
      if (surface !== 'desktop') return page.screenshot({ path });
      const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const win = BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate'); win.show(); win.focus();
        const handle = win.getNativeWindowHandle();
        const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
        const { width, height } = win.getBounds();
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width, height } });
        const source = sources.find(source => source.id.split(':')[1] === id);
        if (!source || source.thumbnail.isEmpty()) throw Error('Native window capture unavailable');
        return source.thumbnail.toPNG().toString('base64');
      });
      writeFileSync(path, Buffer.from(png, 'base64'));
      if(!before){
        const pixels=await page.evaluate(async png=>{
          const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
          const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
          const sample=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
          return {caption:sample(200,8),nativeButtons:sample(img.width-115,8),sidebar:sample(3,250),panel:sample(img.width-5,300)};
        },png);
        const sameColor=(a,b)=>a.every((channel,index)=>Math.abs(channel-b[index])<=1);
        assert.ok(sameColor(pixels.caption,pixels.nativeButtons),`Native caption gap: ${name} ${JSON.stringify(pixels)}`);
        const surfaces=await page.evaluate(()=>({frame:getComputedStyle(document.querySelector('.desktop-titlebar')).backgroundColor,
          sidebar:getComputedStyle(document.querySelector('.session-rail')).backgroundColor,modal:!!document.querySelector('dialog:modal')}));
        assert.equal(surfaces.frame,surfaces.sidebar);
        // Modal shadows intentionally dim the sidebar sample differently from the caption.
        if(name!=='03-collapsed'&&!surfaces.modal)assert.ok(sameColor(pixels.caption,pixels.sidebar),`Sidebar seam: ${name} ${JSON.stringify(pixels)}`);
        assert.notDeepEqual(pixels.caption,pixels.panel,`Independent panel: ${name}`);
        checks.push({surface,theme,name,pixels,surfaces});
      }
    }
    for (const [surface, page] of surfaces) {
      await page.getByRole('button', { name: '停止回复', exact: true }).waitFor();
      await shot(surface, page, '01-running-risk');
      const input = page.getByRole('textbox', { name: /输入消息|消息/ }).first(); await input.fill('合成引导草稿');
      if(before){
        await page.getByRole('combobox', { name: '运行中输入方式', exact: true }).click();
        await shot(surface, page, '02-input-mode');
        await page.getByRole('option', { name: '新任务', exact: true }).click();
      }else{
        assert.equal(await page.getByRole('combobox', {name:'运行中输入方式'}).count(),0);
        const help='回复进行中时发送的消息';
        async function openSetting(){
          if(surface==='mobile'){
            await page.getByRole('button',{name:'返回',exact:true}).click();
            await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
            await page.getByRole('button',{name:/^常规/}).click();
          }else{
            if(!await page.getByRole('button',{name:'账户菜单',exact:true}).isVisible())await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
            await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
            const nav=page.getByRole('navigation',{name:'设置分类'});
            if(await nav.isVisible())await nav.getByRole('button',{name:'常规',exact:true}).click();
            else {const category=page.getByRole('combobox',{name:'设置分类',exact:true});if(await category.evaluate(node=>node.tagName==='SELECT'))await category.selectOption('general');else{await category.click();await page.getByRole('option',{name:'设置 · 常规',exact:true}).click();}}
          }
        }
        async function closeSetting(){
          if(surface==='mobile'){await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'返回',exact:true}).click();}
          else await page.getByRole('button',{name:'关闭设置',exact:true}).click();
        }
        await openSetting();const setting=page.getByRole('combobox',{name:help,exact:true});assert.match(await setting.textContent(),/排队/);
        async function pick(label,value){if(await setting.evaluate(node=>node.tagName==='SELECT'))await setting.selectOption(value);else{await setting.click();await page.getByRole('option',{name:label,exact:true}).click();}}
        await shot(surface,page,'02-input-mode');await pick('引导','steer');await closeSetting();
        if(surface==='mobile')await page.getByRole('button',{name:'项目进度报告 正在运行',exact:true}).click();
        await input.fill(`合成引导 ${surface}`);await page.getByRole('button',{name:'发送',exact:true}).click();
        await page.waitForFunction(()=>!(document.getElementById('message-text')||document.getElementById('draft')).value);
        assert.ok(fixture.operations.some(op=>op.text===`合成引导 ${surface}`&&op.mode==='steer'));
        await openSetting();await pick('排队','queue');await closeSetting();
        if(surface==='mobile')await page.getByRole('button',{name:'项目进度报告 正在运行',exact:true}).click();
        await input.fill(`合成排队 ${surface}`);await page.getByRole('button',{name:'发送',exact:true}).click();
        await page.waitForFunction(()=>!(document.getElementById('message-text')||document.getElementById('draft')).value);
        await page.waitForTimeout(400);
        if(surface==='mobile')await page.getByText(/\d+ 个排队中/,{exact:true}).click();
        await page.getByRole('article',{name:`排队任务 合成排队 ${surface}`,exact:true}).waitFor();
        await shot(surface,page,'08-queued');
      }
      await input.fill('');
      if (!before) {
        await page.mouse.move(0,0);await page.waitForTimeout(250);
        const result = await page.evaluate(surface => {
          const style = node => getComputedStyle(node);
          const shield = document.querySelector('.approval-shield');
          const send = document.getElementById(surface === 'mobile' ? 'send-button' : 'send-message');
          const status = document.getElementById(surface === 'mobile' ? 'device-line' : 'timeline-status');
          return { shield: shield.getBoundingClientRect().width, shieldDisplay: style(shield).display,
            shieldColor: style(shield).color, riskColor: style(shield.parentElement).color,
            stopColor: style(send).backgroundColor, accent: style(document.body).getPropertyValue('--accent').trim(),
            statusVisible: !!status && !status.hidden && !!status.textContent.trim(), overflow: document.documentElement.scrollWidth > innerWidth };
        }, surface);
        assert.ok(result.shield > 0); assert.notEqual(result.shieldDisplay, 'none'); assert.equal(result.shieldColor, result.riskColor);
        assert.equal(result.statusVisible, false); assert.equal(result.overflow, false);
        await page.getByText(/正在加载模型 合成模型… \d+ 秒/, { exact: true }).waitFor();
        checks.push({ surface, theme, ...result });
      }
      if (surface === 'desktop') {
        await page.getByRole('button', { name: '收起会话侧栏', exact: true }).click(); await shot(surface, page, '03-collapsed');
        await page.getByRole('button', { name: '切换会话侧栏', exact: true }).click();
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate').maximize()); await shot(surface, page, '04-maximized');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate').unmaximize());
        await page.getByRole('button').filter({ has: page.locator('.rail-avatar') }).click();
        await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
        await shot(surface, page, '05-settings');
        await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      }
    }
    const approval = await fixture.progress.approve('p5-approval', 'Write-Output "合成审批"');
    for (const [surface, page] of surfaces) { await page.getByRole('region', { name: '待批准操作', exact: true }).waitFor(); await shot(surface, page, '06-approval'); }
    await desktop.getByRole('button', { name: '拒绝', exact: true }).click();
    fixture.progress.finish();
    for (const [surface, page] of surfaces) {
      await page.getByRole('button', { name: '发送', exact: true }).waitFor(); await shot(surface, page, '07-idle');
      if (!before) {
        await page.getByRole('textbox',{name:/输入消息|消息/}).first().fill('合成空闲草稿');
        await page.mouse.move(0,0);
        await page.getByRole('button',{name:'发送',exact:true}).waitFor();await page.waitForTimeout(250);
        const sendColor = await page.getByRole('button', { name: '发送', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor);
        assert.equal(sendColor, checks.find(row => row.surface === surface && row.theme === theme && row.stopColor).stopColor);
      }
    }
    console.log(theme, before ? 'before captured' : 'verified');
  } finally {
    await browser?.close(); await app?.close(); await fixture.close();
    assert.ok(fixture.root.startsWith(join(tmpdir(), 'weftmate-m0-3-'))); rmSync(fixture.root, { recursive: true, force: true });
    assert.ok(profile.startsWith(join(tmpdir(), 'weftmate-ui-p5-'))); rmSync(profile, { recursive: true, force: true });
  }
}
assert.deepEqual(errors, []);
writeFileSync(join(evidence, before ? 'before.json' : 'checks.json'), JSON.stringify({ syntheticOnly: true, before, checks, errors }, null, 2) + '\n');
