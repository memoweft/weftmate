/** Synthetic phone-only service journey; browser viewport evidence does not claim native system-bar coverage. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('apps/mobile-ui/www'), out = resolve('tests/evidence/model-1/phone-standalone');
const credential = randomBytes(24).toString('base64url'), modelsUsed = [];
const colors = [];
const server = createServer(async (request, response) => {
  try {
    if (request.url.startsWith('/fixture/v1/')) {
      assert.ok(request.headers.authorization === `Bearer ${credential}`, 'fixture request uses its process-only credential');
      response.setHeader('content-type', 'application/json');
      if (request.url.endsWith('/models')) return response.end(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash' }, { id: 'mimo-v2.6-pro' }, { id: 'mimo-v2.5-asr' }] }));
      let body = ''; for await (const chunk of request) body += chunk;
      modelsUsed.push(JSON.parse(body).model); return response.end(JSON.stringify({ choices: [{ message: { content: '已使用你刚选的模型。' } }] }));
    }
    const url = new URL(request.url, 'http://synthetic');
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root)) return response.writeHead(404).end();
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(path)] || 'application/octet-stream'));
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => typeof WeftPhone !== 'undefined' && typeof state !== 'undefined' && state.booted);
  await page.evaluate(async ({ endpoint, credential }) => {
    await WeftPhone.start({ origin: 'https://synthetic.example', accountId: 'synthetic-model1', email: '模型服务测试', deviceId: 'synthetic-phone' }, {
      authorized: async () => ({ devices: [{ isCurrent: true, revoked: false }], hosts: [] }),
    });
    await WeftPhone.serviceCall('configure', { name: 'MiMo', endpoint, apiKey: credential });
    uiCore.state.currentView='assistant'; WeftMobileCloud.core.state.currentView='assistant'; page('chat');
    updateComposer();
  }, { endpoint: origin + '/fixture/v1', credential });
  assert.equal(await page.locator('#model-button').isVisible(), true, 'model button is visible before focusing the draft');
  await page.locator('#model-button').click();
  await page.getByRole('menuitemradio', { name: 'MiMo v2.6 Pro', exact: true }).waitFor();
  assert.equal(await page.locator('.wm-model-group').count(), 0);
  await page.getByRole('menuitemradio', { name: 'MiMo v2.6 Pro', exact: true }).click();
  await page.locator('#model-popover').waitFor({ state: 'hidden' });
  await page.locator('#draft').fill('确认下一条消息使用新选择。');
  await page.locator('#send-button').click();
  await page.getByText('已使用你刚选的模型。', { exact: true }).waitFor();
  assert.equal(modelsUsed.at(-1), 'mimo-v2.6-pro');
  assert.match(await page.locator('#model-button').getAttribute('aria-label'), /MiMo v2.6 Pro/);
  if(process.argv.includes('--inspect')){
    await page.evaluate(()=>{applyTheme('dark');state.appearance='dark';document.documentElement.dataset.theme='dark';});
    await page.locator('#model-button').click();
    await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished)));
    console.log(JSON.stringify(await page.evaluate(()=>{const popup=document.getElementById('model-popover'),style=getComputedStyle(popup),rules=[];const walk=list=>{for(const rule of list){if(rule.cssRules)walk(rule.cssRules);if(rule.selectorText){try{if(popup.matches(rule.selectorText)&&(rule.style?.background||rule.style?.backgroundColor))rules.push({selector:rule.selectorText,background:rule.style.background,backgroundColor:rule.style.backgroundColor});}catch{}}}};for(const sheet of document.styleSheets){try{walk(sheet.cssRules);}catch{}}return {html:document.documentElement.outerHTML.split('>')[0]+'>',classes:popup.className,inlineStyle:popup.getAttribute('style'),background:style.backgroundColor,msSurface:style.getPropertyValue('--ms-surface'),msInk:style.getPropertyValue('--ms-ink'),backdrop:style.backdropFilter,rules};}),null,2));
  }else{
  for (const [width, height] of [[390, 844], [360, 780]]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => { applyTheme(theme); state.appearance = theme; document.documentElement.dataset.theme = theme; }, theme);
    if (await page.locator('#model-popover').isVisible()) await page.keyboard.press('Escape');
    await page.locator('#draft').focus();
    await page.locator('#model-button').click();
    await page.getByRole('menuitemradio', { name: 'MiMo v2.6 Pro', exact: true }).waitFor();
    colors.push(await page.evaluate(()=>({theme:document.documentElement.dataset.theme,background:getComputedStyle(document.getElementById('model-popover')).backgroundColor,msSurface:getComputedStyle(document.getElementById('model-popover')).getPropertyValue('--ms-surface')})));
    await page.screenshot({ path: resolve(out, `phone-${width}-${theme}-menu.png`) });
    await page.getByRole('menuitem', { name: '添加模型服务…', exact: true }).click();
    await page.getByText('这台手机的模型服务', { exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `phone-${width}-${theme}-services.png`) });
    await page.getByRole('combobox', { name: '选择模型服务', exact: true }).click();
    await page.getByRole('listbox', { name: '选择模型服务', exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `phone-${width}-${theme}-presets-open.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '修改 MiMo 模型服务', exact: true }).click();
    await page.getByRole('checkbox', { name: '显示 MiMo v2.6 Pro', exact: true }).waitFor();
    await page.getByRole('checkbox', { name: '显示 MiMo v2.6 Pro', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, `phone-${width}-${theme}-editor-models.png`) });
    await page.evaluate(() => page('chat'));
  }
  assert.equal(errors.filter(error => !/404|fetch/i.test(error)).length, 0, 'phone service journey has no script errors');
  await page.evaluate(() => WeftPhone.clear());
  await page.evaluate(()=>{
    state.loggedIn=true;state.owner='synthetic-host-settings';state.authEpoch++;state.connection='connected';state.chatSource='host';state.sharedHostAvailable=true;state.sharedSessionId='synthetic-session';state.logicalChats=false;
    const service={serviceId:'model-service-12345678-1234-4234-8234-123456789abc',name:'MiMo',baseUrl:'https://model.example/v1',interfaceType:'openai-compatible',revision:1,selectedModelId:'mimo-v2.6-pro',
      models:[{modelId:'mimo-v2.6-flash',name:'MiMo v2.6 Flash',enabled:true,profileId:'synthetic-flash'},{modelId:'mimo-v2.6-pro',name:'MiMo v2.6 Pro',enabled:true,profileId:'synthetic-pro'}],
      catalog:{status:'available',message:'已找到 2 个聊天模型。',checkedAt:new Date().toISOString()}};
    globalThis.model1HostRequests=[];
    const oldModels=()=>service.models.map(model=>({id:model.profileId,name:model.name,model:model.modelId,configured:true,available:true}));
    uiCore.accessApi=async(path,options={})=>{
      if(path==='/model-services'&&options.method!=='POST')return {services:[structuredClone(service)],canManage:true};
      if(path==='/models')return {models:oldModels()};
      if(path==='/settings/models')return {defaultModelProfileId:'synthetic-pro'};
      if(path.startsWith('/model-services/')){
        const body=options.body||{};model1HostRequests.push({path,method:options.method,hasExpectedRevision:Number.isInteger(body.expectedRevision)});
        if(options.method==='PATCH'){if(body.expectedRevision!==service.revision)throw Error('REVISION_CHANGED');if(body.models)for(const patch of body.models){const model=service.models.find(model=>model.modelId===patch.modelId);if(model)model.enabled=patch.enabled;}service.revision++;}
        if(path.endsWith('/select')){service.selectedModelId=body.modelId;return {profileId:service.models.find(model=>model.modelId===body.modelId).profileId,service:structuredClone(service),models:oldModels()};}
        return {service:structuredClone(service)};
      }
      return {};
    };
    uiCore.syncMobileIdentity();uiCore.state.modelProfileId='synthetic-pro';uiCore.state.models=oldModels();uiCore.state.newConversation=false;uiCore.state.currentView='models';
    state.sharedSessions=[{sessionId:'synthetic-session',modelProfileId:'synthetic-pro',modelDisplayName:'MiMo v2.6 Pro',sendAvailable:true}];
    page('models');
  });
  for(const [width,height] of [[390,844],[360,780]])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height});await page.evaluate(theme=>{applyTheme(theme);state.appearance=theme;document.documentElement.dataset.theme=theme;page('models');},theme);
    await page.getByText('电脑的模型服务',{exact:true}).waitFor();await page.locator('.wm-model-service-card').waitFor();
    await page.screenshot({path:resolve(out,`host-${width}-${theme}-services.png`)});
    await page.getByRole('combobox',{name:'选择模型服务',exact:true}).click();await page.getByRole('listbox',{name:'选择模型服务',exact:true}).waitFor();
    await page.screenshot({path:resolve(out,`host-${width}-${theme}-presets-open.png`)});await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'修改 MiMo 模型服务',exact:true}).click();await page.getByRole('checkbox',{name:'显示 MiMo v2.6 Pro',exact:true}).waitFor();
    await page.getByRole('checkbox',{name:'显示 MiMo v2.6 Pro',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,`host-${width}-${theme}-editor-models.png`)});
  }
  await page.getByRole('checkbox',{name:'显示 MiMo v2.6 Flash',exact:true}).uncheck();
  await page.waitForFunction(()=>model1HostRequests.some(row=>row.method==='PATCH'&&row.hasExpectedRevision));
  assert.equal(errors.filter(error=>!/404|fetch/i.test(error)).length,0,'host service settings have no script errors');
  await writeFile(resolve(out, 'validation.json'), JSON.stringify({ syntheticModelService: true, modelsUsed, colors, screenshots: 28, hostRevisionWrite: true, closedModelButtonVisible: true, browserViewportOnly: true, nativeSystemBars: 'not claimed by browser viewport screenshots', errors: [] }, null, 2) + '\n');
  console.log('Phone standalone: next message used MiMo v2.6 Pro; standalone and host 390/360 light/dark menu, service-list, editor and preset evidence saved.');
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
