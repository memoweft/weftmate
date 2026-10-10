import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { startFe1bFixture } from './fe-1b-fixture.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { startMainChatCandidate } from './main-chat-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { mobileBridge } from '../../scripts/review-gallery/mobile-bridge.mjs';
import { repository, outDirectory, runScene, catalog } from '../../scripts/review-gallery/common.mjs';
import { startAndroid } from '../../scripts/nightly/android.mjs';
const assets = join(repository, 'apps/mobile-ui/www'), out = outDirectory();
const sceneIndex = process.argv.indexOf('--scene'), onlyScene = sceneIndex < 0 ? null : process.argv[sceneIndex + 1];
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(assets, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(assets + sep)) return res.writeHead(404).end();
    res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const device = process.argv.includes('--android');
const android = device ? await startAndroid(out) : null;
const browser = android?.browser || await chromium.launch({ headless: true });
let currentBridge;
if (android) {
  await android.reverse(server.address().port);
  await android.page.exposeFunction('__reviewNative', async payload => {
    try { return { id: payload.id, ok: true, result: await currentBridge(payload) }; }
    catch (error) { return { id: payload.id, ok: false, error: { code: error.message } }; }
  });
  await android.page.addInitScript(() => { window.weftNative = { postMessage(value) { window.__reviewNative(JSON.parse(value)).then(result => window.weftNative.onmessage({ data: JSON.stringify(result) })); } }; });
}
try {
  for (const theme of ['light', 'dark']) {
    const fixture = await startFe1bFixture();
    const candidate = await startTimelineCandidate({ historyCount: 0, interactive: true });
    const context = android ? android.page.context() : await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: theme });
    const page = android?.page || await context.newPage(), errors = [];let mainFixture;
    try {
      const bridge = mobileBridge(fixture, theme);
      currentBridge = bridge;
      if (android) { await android.reverse(new URL(candidate.mobileUrl).port); await android.theme(theme); }
      page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
      if (!android) await page.exposeFunction('__reviewNative', async payload => {
        try { return { id: payload.id, ok: true, result: await bridge(payload) }; }
        catch (error) { return { id: payload.id, ok: false, error: { code: error.message } }; }
      });
      if (!android) await page.addInitScript(() => { window.weftNative = { postMessage(value) { window.__reviewNative(JSON.parse(value)).then(result => window.weftNative.onmessage({ data: JSON.stringify(result) })); } }; });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
      const conversation = title => button(new RegExp(`^${title} [0-9]`));
      const shot = (scene, prepare, current = page) => (!onlyScene || scene === onlyScene) && !(android && catalog.scenes.find(row => row.id === scene).unavailable?.includes('android'))
        ? runScene({ page: current, out, platform: android ? 'android' : 'mobile-web', scene, theme, prepare, screenshot: android?.screenshot }) : null;
      // LG-1b account-first login; authentication below remains independent.
      const prepareLogin = async () => {
        // FE-1b's local auth fixture predates the native cloudApp bootstrap flag.
        await page.waitForFunction(() => state.booted);
        await page.evaluate(() => WeftMobileCloud.init());
        await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
        await page.getByRole('textbox', { name: '邮箱', exact: true }).waitFor();
        await page.getByRole('button', { name: '还没有账号？注册', exact: true }).waitFor();
      };
      await shot('login', prepareLogin);
      // Keep authenticated scenes independent of an evolving login form.
      await bridge({ method: 'auth.login', params: { ...fixture.credentials, deviceName: '合成审稿手机' } });
      const home = async () => { await page.reload(); await conversation('整理项目进展').waitFor(); };
      const report = async () => { await home(); await conversation('整理项目进展').click(); };
      const settings = async () => { await home(); await button('设置与账户').click(); };
      const preparations = {
        onboarding: async () => { await settings(); await button(/^设备 /).click(); await page.getByRole('heading', { name: '连接你的电脑', exact: true }).waitFor(); },
        sessions: home,
        'composer-menu': async()=>{await report();await button('添加图片或文件').click();await page.getByRole('menu',{name:'添加附件'}).waitFor();await page.getByRole('menuitem',{name:'相机'}).waitFor();},
        'composer-context': async()=>{await report();await button('背景信息窗口：86% 已用').click();await page.getByRole('tooltip').waitFor();},
        conversation: async () => { await report(); await page.getByText(/读取了 1 个文件/).click(); await page.getByText(/^读取(?: 1 个文件|项目记录)/).waitFor(); },
        'outputs-sources': async () => { await report(); await button('输出与来源').click(); await button(/^notes.md 1 次使用$/).waitFor(); },
        approval: async () => { await home(); await conversation('整理临时文件').click(); await button('批准').waitFor(); },
        memory: async () => { await home(); await button('打开导航').click(); await button('记忆').click(); await button(/使用中文说明/).waitFor(); },
        appearance: async () => { await settings(); await button(/^外观 /).click(); await button(new RegExp(`^${theme === 'dark' ? '深色' : '浅色'}`)).click(); },
        general: async () => { await settings(); await button(/^助手/).click(); await page.getByRole('combobox', { name: '回复进行中时发送的消息', exact: true }).waitFor(); },
        usage: async () => { await settings(); await button(/^用量 /).click(); await page.getByRole('heading', { name: '用量与费用', exact: true }).waitFor(); await button('刷新用量').waitFor(); },
        'session-menu': async () => { await home(); await page.getByRole('main').getByRole('button', { name: '更多操作 整理项目进展', exact: true }).click(); await page.getByRole('dialog', { name: '对话操作', exact: true }).waitFor(); await button('归档').waitFor(); await button('删除').waitFor(); },
      };
      for (const scene of catalog.scenes.filter(row => !['login', 'question','main-chat','activity'].includes(row.id) && (!onlyScene || row.id === onlyScene))) await shot(scene.id, preparations[scene.id]);
      // FE-1a's real question projection supplies the missing FE-1b question fixture.
      const questionPage = android?.page || await context.newPage(); questionPage.setDefaultTimeout(30000);
      if (android) await questionPage.unrouteAll({ behavior: 'ignoreErrors' });
      await questionPage.route('**/bridge', async route => {
        const body = route.request().postDataJSON();
        if (body.method === 'settings.appearance') return route.fulfill({ json: { result: { value: theme } } });
        await route.continue();
      });
      await shot('activity', async () => {
        await candidate.recordActivity({key:'gallery-paused',type:'memory.paused',title:'记忆已暂停',summary:'记忆暂时无法更新，可在记忆页查看状态。',level:'normal'});
        await questionPage.goto(candidate.mobileUrl);await questionPage.waitForFunction(()=>state.booted&&state.loggedIn);
        await questionPage.getByRole('button',{name:'打开导航',exact:true}).click();await questionPage.getByRole('button',{name:'动态',exact:true}).click();
        await questionPage.getByRole('heading',{name:'动态',exact:true}).waitFor();await questionPage.getByText('记忆已暂停',{exact:true}).waitFor();
      },questionPage);
      await shot('question', async () => {
        await questionPage.goto(candidate.mobileUrl);
        await questionPage.waitForFunction(() => state.booted && state.page === 'home');
        await questionPage.getByRole('main').getByRole('button', { name: /^项目进度报告(?:\s|$)/ }).click();
        await questionPage.getByRole('button',{name:'拒绝',exact:true}).click();
        await questionPage.getByRole('region',{name:'待回答问题'}).waitFor();
        await questionPage.getByRole('radio',{name:'简要报告',exact:true}).waitFor();
      }, questionPage);
      const mainPage=android?.page || await context.newPage();
      await shot('main-chat',async()=>{
        mainFixture=await startMainChatCandidate(300,{logicalMobile:true});if(android)await android.reverse(new URL(mainFixture.mobileUrl).port);await mainPage.goto(mainFixture.mobileUrl);
        await mainPage.getByRole('button',{name:'搜索主对话',exact:true}).waitFor();await mainPage.waitForFunction(()=>document.querySelector('.main-chat-row'));
        await mainPage.evaluate(theme=>applyTheme(theme),theme);
        await mainPage.getByRole('button',{name:'搜索主对话',exact:true}).click();await mainPage.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('合成');await mainPage.getByRole('searchbox',{name:'主对话搜索关键词'}).press('Enter');await mainPage.locator('mark').first().waitFor();
      },mainPage);
      if (errors.length) throw Error('Mobile renderer failed');
      console.log(`Mobile ${theme}: scene outcomes recorded.`);
    } finally { if (!android) await context.close(); await fixture.close(); await candidate.close();await mainFixture?.close(); await rm(fixture.root, { recursive: true, force: true }); await rm(candidate.root, { recursive: true, force: true });if(mainFixture)await rm(mainFixture.root,{recursive:true,force:true}); }
  }
} finally { if (android) await android.close(); else await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
