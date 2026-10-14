import { evidencePath } from '../helpers/evidence-path.mjs';
/** Synthetic phone-only service journey; browser viewport evidence does not claim native system-bar coverage. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('apps/mobile-ui/www'), out = evidencePath('model-1/phone-standalone');
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

const accountEntryOnly = process.argv.includes('--account-entry-only');

async function configureHostSettings(page) {
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
}

async function verifyAccountEntry(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [], captures = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => typeof WeftPhone !== 'undefined' && typeof state !== 'undefined' && state.booted);
    await page.evaluate(() => {
      // Native models.* read envelopes are synthetic. No real Android process or credential is used.
      const projection = {
        'models.list': { models: [{ endpoint: 'https://model.example/v1/chat/completions', modelId: 'mimo-v2.6-flash', displayName: '合成手机 · MiMo Flash', selected: true }] },
        'models.host': { models: [{ profileId: 'synthetic-pro', modelId: 'mimo-v2.6-pro', displayName: '合成电脑 · MiMo Pro', configured: true, selected: true, sourceKind: 'cloud' }] },
        'models.account.list': { models: [{ accountModelId: 'account-model-12345678-1234-4234-8234-123456789abc', name: '合成账户 · MiMo Pro', modelId: 'mimo-v2.6-pro', status: 'active', revision: 4 }] },
      };
      globalThis.model1AccountReads = [];
      globalThis.model1AccountProjectionFields = Object.fromEntries(Object.entries(projection).map(([method, value]) => [method, Object.keys(value.models[0]).sort()]));
      const nativeReads = WeftUiCore.createAndroidBridge({ postMessage(raw) {
        const request = JSON.parse(raw);
        model1AccountReads.push({ method: request.method, paramNames: Object.keys(request.params).sort() });
        const result = projection[request.method];
        nativeReads.receive(result
          ? { id: request.id, ok: true, result: structuredClone(result) }
          : { id: request.id, ok: false, error: { code: 'METHOD_UNKNOWN' } });
      } });
      const original = mobileWebBridge.call.bind(mobileWebBridge);
      mobileWebBridge.call = (method, params = {}) => Object.hasOwn(projection, method)
        ? nativeReads.call(method, params) : original(method, params);
    });
    await configureHostSettings(page);
    for (const [width, height] of [[390, 844], [360, 780]]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height });
      await page.evaluate(theme => { applyTheme(theme); state.appearance = theme; document.documentElement.dataset.theme = theme; page('models'); }, theme);
      await page.getByText('电脑的模型服务', { exact: true }).waitFor();
      await page.locator('.wm-model-service-card').waitFor();
      const priorReads = await page.evaluate(() => model1AccountReads.filter(row => row.method === 'models.account.list').length);
      const more = page.getByRole('button', { name: '模型服务更多操作', exact: true });
      await more.click();
      const account = page.getByRole('menuitem', { name: '账户云模型', exact: true });
      await account.waitFor();
      const popup = account.locator('..');
      const geometry = await popup.boundingBox();
      assert.ok(geometry && geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= width && geometry.y + geometry.height <= height, 'account entry menu fits the phone viewport');
      const menuStyle = await popup.evaluate(menu => { const style=getComputedStyle(menu);const sample=document.createElement('span');sample.style.backgroundColor='var(--ms-surface)';menu.append(sample);const tokenBackground=getComputedStyle(sample).backgroundColor;sample.remove();return { background:style.backgroundColor, tokenBackground, backdrop:style.backdropFilter, scoped:menu.classList.contains('wm-model-service-select-menu') }; });
      assert.equal(menuStyle.scoped, true, 'new account entry uses the scoped model service menu');
      assert.equal(menuStyle.background, menuStyle.tokenBackground, 'new account entry uses its model service surface token');
      await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)));
      const filename = `host-${width}-${theme}-account-menu-open.png`;
      await page.screenshot({ path: resolve(out, filename) });
      await account.click();
      await page.getByRole('heading', { name: '对话模型', exact: true }).waitFor();
      await page.getByText('合成账户 · MiMo Pro', { exact: true }).waitFor();
      await page.getByText('合成手机 · MiMo Flash · 当前', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '保存到手机', exact: true }).count(), 1, 'the saved account model remains available for explicit import');
      assert.equal(await page.getByRole('button', { name: '在电脑使用这个模型', exact: true }).count(), 1, 'the saved phone identity remains available for explicit publish');
      assert.equal(await page.evaluate(() => model1AccountReads.filter(row => row.method === 'models.account.list').length), priorReads + 1, 'opening the new entry reads the native account directory');
      await page.getByRole('button', { name: '账户云模型更多操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '返回模型服务', exact: true }).click();
      await page.getByText('电脑的模型服务', { exact: true }).waitFor();
      await page.locator('.wm-model-service-card').waitFor();
      assert.equal(await page.getByRole('heading', { name: '对话模型', exact: true }).count(), 0, 'return exits the legacy page');
      captures.push({ width, height, theme, filename, menuStyle, menuFitsViewport: true, enteredAccountPage: true, returnedToServices: true });
    }
    const fixture = await page.evaluate(() => ({ reads: model1AccountReads, projectionFields: model1AccountProjectionFields }));
    assert.equal(fixture.reads.filter(row => row.method === 'models.account.list').length, 4);
    assert.ok(fixture.reads.every(row => row.paramNames.length === 0), 'directory reads send no credential or model mutation');
    assert.ok(Object.values(fixture.projectionFields).every(fields => fields.every(field => !/key|secret|credential/i.test(field))), 'synthetic native projection contains no credential fields');
    assert.deepEqual(errors, [], 'new account entry journey has no page script errors');
    await writeFile(resolve(out, 'account-entry-validation.json'), JSON.stringify({ scenario: 'connected-host-account-entry', fixture: 'synthetic-native-model-read-projection', accountEntryOnly, screenshots: captures, accountDirectoryReads: 4, projectionFields: fixture.projectionFields, publishIdentityActionVisible: true, importRequiresExplicitAction: true, menuPath: ['模型服务更多操作', '账户云模型', '账户云模型更多操作', '返回模型服务'], browserViewportOnly: true, nativeSystemBars: 'not claimed by browser viewport screenshots', errors: [] }, null, 2) + '\n');
    console.log('Account cloud entry: 390/360 light/dark more-menu open, legacy directory entry and service-page return passed; four synthetic screenshots saved.');
  } finally { await page.close(); }
}

const browser = await chromium.launch({ headless: true });
try {
  if (!accountEntryOnly) {
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
  await configureHostSettings(page);
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
  }
  if (!process.argv.includes('--inspect')) await verifyAccountEntry(browser);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
