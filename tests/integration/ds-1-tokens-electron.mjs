// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real Windows Electron + real pinned DSH, isolated account and loopback model only. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

if (process.platform !== 'win32') throw new Error('This native shell verification requires Windows.');
const root = mkdtempSync(join(process.env.SystemRoot || 'C:/Windows', 'Temp', 'weftmate-ds-1-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/ds-1'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`;
// Prepare an existing test account through the ordinary registration API, then log in in the program.
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession']
  .map(method => [method, async () => method === 'listModels' ? [] : {}]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await preparation.start();
const setup = await preparation.issueSetupGrant();
const registered = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST',
  headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username: 'PanelFixture', password, deviceName: 'Preparation' }) });
assert.equal(registered.status, 201); await preparation.close();
let tools = [], workflowCalls = 0, questionCalls = 0, fixtureSession;
const model = createServer(async (request, response) => {
  console.log('Synthetic provider:', request.method, request.url);
  if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'w1-synthetic-model', object: 'model' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let raw = ''; for await (const part of request) raw += part;
  const body = JSON.parse(raw); const names = (body.tools || []).map(tool => tool.function?.name || tool.name);
  if (names.length) tools = names;
  console.log('Synthetic tools:', names.length);
  const text = body.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content :
    (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('')).join('\n');
  let tool, args;
  if (names.length && text.includes('W1_QUESTION')) {
    if (++questionCalls === 1) { tool = 'ask_user_question'; args = { questions: [{ id: 'w1', header: '合成提问', question: '请确认这次程序测试可以继续。', options: [{ label: '继续' }, { label: '稍后' }] }] }; }
  } else if (names.length && text.includes('W1_APPROVAL')) {
    workflowCalls++;
    if(workflowCalls === 1) { tool='pwsh'; args={command:"Write-Output 'IC-1 synthetic approval'",description:'核对图标测试结果'}; }
  }
  if (tool && names.includes('run_code')) { args = { code: `return await tools.${tool}(${JSON.stringify(args)});`, description: 'W1 synthetic tool call' }; tool = 'run_code'; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = choice => response.write(`data: ${JSON.stringify({ id: 'w1-fixture', model: body.model, object: 'chat.completion.chunk', choices: [choice] })}\n\n`);
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
    : { role: 'assistant', content: 'W1 合成模型已完成，真实程序时间线验证通过。' }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const executablePath = createRequire(import.meta.url)('electron');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const args = ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'];
let application, page, output = '';
const capture = !process.argv.includes('--verify-only');
const before = process.argv.includes('--before');
const report = { realElectron: true, realDsh: true, syntheticAccount: true, paidModelRequests: 0 };
async function until(check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error('W1 condition timed out');
}
async function start(extra = []) {
  application = await _electron.launch({ executablePath, args: [...args, ...extra], cwd: repository, env, timeout: 90000 });
  application.process().stdout?.on('data', part => { output += String(part); });
  application.process().stderr?.on('data', part => { output += String(part); });
  await application.evaluate(({ app, Tray, Notification }) => {
    globalThis.w1Notifications = []; globalThis.w1NativeNotifications = []; globalThis.w1Shown = [];
    app.on('weftmate-desktop-notification', event => globalThis.w1Notifications.push(event));
    app.on('weftmate-desktop-notification-shown', event => globalThis.w1Shown.push(event));
    const show = Notification.prototype.show;
    Notification.prototype.show = function () { globalThis.w1NativeNotifications.push(this); return show.call(this); };
    const menu = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (value) { globalThis.w1Tray = this; globalThis.w1TrayMenu = value; return menu.call(this, value); };
    // Verify the startup bridge without replacing the real user's Windows login entry.
    globalThis.w1Startup = false;
    app.getLoginItemSettings = () => ({ openAtLogin: globalThis.w1Startup });
    app.setLoginItemSettings = value => { globalThis.w1Startup = value.openAtLogin; globalThis.w1LoginOptions = value; };
  });
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(60000);
  await page.waitForURL('**/personal/v1/ui');
  if (before) {
    const baseline = '31a71a4e542a82acf31b3a0114680749a7fea9ce';
    for (const name of ['index.html', 'styles.css', 'native-desktop.css']) {
      const body = execFileSync('git', ['show', baseline + ':src/personal-access-ui/' + name], {cwd:repository});
      await page.route(name === 'index.html' ? '**/personal/v1/ui' : '**/personal/v1/ui/' + name,
        route => route.fulfill({body,contentType:name.endsWith('.css')?'text/css':'text/html'}));
    }
    await page.reload();
  }

}
async function api(path, body) {
  return page.evaluate(async ({ path, body }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}
async function screenshot(name) {
  if (!capture) return;
  name=name.replace('after',before?'before':'after');
  await page.mouse.move(0,0);
  await page.waitForTimeout(100);
  // Normalise the live elapsed-time text only; all styles and geometry remain real.
  await page.evaluate(() => {
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) walker.currentNode.textContent=walker.currentNode.textContent.replace(/\d+分\d+秒/g,'0分0秒');
  });
  await page.screenshot({path:join(evidence,name),animations:'disabled'});
}

try {
  await start();
  await page.locator('#login-view').waitFor({state:'visible'});
  await page.fill('#login-name', 'PanelFixture'); await page.fill('#login-password', password); await page.fill('#login-device', 'IC-1 Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({state:'visible'});
  const configured = await api('/account/models', {requestId:'ic1-model',name:'IC-1 Synthetic',baseUrl:'http://127.0.0.1:' + model.address().port + '/v1',modelId:'w1-synthetic-model',apiKey:'synthetic-no-secret'});
  assert.equal(configured.status,202);
  await until(async () => (await api('/account/models/by-request/ic1-model')).body.operation?.status === 'succeeded');
  await page.reload(); await page.locator('#new-session').click(); await until(() => page.locator('#message-text').isEnabled());
  fixtureSession = (await api('/sessions')).body.sessions[0].sessionId;
  await page.evaluate(async session => { const me=await(await fetch('/personal/v1/auth/me')).json(); const response=await fetch('/personal/v1/sessions/'+session+'/approval-mode',{method:'PATCH',headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:JSON.stringify({mode:'ask'})}); if(!response.ok) throw new Error('Cannot set synthetic approval mode'); },fixtureSession);
  await page.reload();
  await page.fill('#message-text','W1_APPROVAL：写入合成文件。'); await page.locator('#send-message').click();
  await page.getByRole('button',{name:'允许一次',exact:true}).waitFor();
  assert.ok(await page.locator('#new-session use[href$="#compose"]').count());
  assert.ok(await page.locator('#send-message .wm-icon').count());
  assert.ok(await page.getByRole('button',{name:'允许一次',exact:true}).locator('.wm-icon').count());
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#new-session svg')).strokeWidth),'1.75px');
  for(const theme of ['light','dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
    await application.evaluate(({nativeTheme},theme)=>{nativeTheme.themeSource=theme;},theme);
    await page.waitForTimeout(300); await screenshot('after'+'-desktop-'+theme+'.png');
    // The tray lives in Windows overflow on this machine. A getBounds crop hits
    // the overflow arrow, so retain no misleading screenshot of that region.
    assert.equal(await application.evaluate(() => globalThis.w1Tray.isDestroyed()),false);
  }
  await page.getByRole('button',{name:'允许一次',exact:true}).click();
  await until(() => application.evaluate(() => globalThis.w1Notifications.some(e=>e.type==='turn.ended')));
  await until(async () => await page.locator('#send-message').getAttribute('aria-label')==='发送');
  await screenshot('after-completed.png');
  writeFileSync(join(evidence,'desktop-verification.json'),JSON.stringify({...report,icons:true,approvalInteraction:true,nativeThemes:['light','dark']},null,2)+'\n');
  const values = await page.evaluate(() => {
    const result = {};
    for (const theme of ['light','dark']) for (const accent of ['neutral','blue','green','purple']) {
      for (const [key,value] of Object.entries({theme,accent,fontSize:'19'})) {
        const control=document.getElementById('appearance-'+key);control.value=value;control.dispatchEvent(new Event('change'));
      }
      result[theme+'-'+accent]={colors:['--accent','--accent-hover','--accent-soft'].map(k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim()),fontSize:getComputedStyle(document.documentElement).fontSize};
    }
    return result;
  });
  for (const value of Object.values(values)) assert.equal(value.fontSize,'19px');
  await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.accent),'purple');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'19px');
  writeFileSync(join(evidence,(before?'before':'after')+'-desktop-settings.json'),JSON.stringify(values,null,2)+'\n');
  console.log('DS-1 real Electron approval, themes, accent presets and font-size persistence passed.');
} finally { await application?.close().catch(()=>{}); await new Promise(resolve=>model.close(resolve)); }
