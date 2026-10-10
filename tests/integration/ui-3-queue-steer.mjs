// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real Electron and browser, real personal host/pinned DSH, isolated synthetic model. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const repository = resolve(import.meta.dirname, '../..');
const root = mkdtempSync(join(process.env.SystemRoot || 'C:/Windows', 'Temp', 'weftmate-ui-3-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const evidence = join(repository, 'tests/evidence/ui-3'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`;
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0,
  backend: Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => name === 'listModels' ? [] : {}])) });
const prepared = await preparation.start(), grant = await preparation.issueSetupGrant();
const setup = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'UiThreeFixture', password, deviceName: 'Preparation' }) });
assert.equal(setup.status, 201); await preparation.close();
const requests = [], emitted = new Set(), automatic = new Set(), errors = [], reports = [];
const model = createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'ui3-synthetic-model', object: 'model' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let raw = ''; for await (const part of request) raw += part;
  const body = JSON.parse(raw), text = JSON.stringify(body.messages), names = (body.tools || []).map(row => row.function?.name);
  const marker = /UI3_(desktop|web)/.exec(text)?.[0] || 'background';
  const deletion = /UI3_DELETE_(desktop|web)_(allow|deny)/.exec(text)?.[0];
  const record = { marker, text, closed: false, complete: null }; requests.push(record);
  response.on('close', () => { record.closed = true; });
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const frame = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id: 'ui3-fixture', object: 'chat.completion.chunk', model: body.model,
    choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const finish = () => { if (record.closed) return; frame({ content: '合成任务完成。' }); frame({}, 'stop'); response.end('data: [DONE]\n\n'); };
  record.complete = finish;
  if (deletion && names.length && !emitted.has(deletion)) {
    emitted.add(deletion);
    const file = join(root, `${deletion}.txt`);
    let tool = 'pwsh', args = { command: `Remove-Item -LiteralPath '${file.replace(/'/g, "''")}'`, description: '删除本次隔离测试文件' };
    if (!names.includes(tool) && names.includes('run_code')) { args = { code: `return await tools.pwsh(${JSON.stringify(args)});`, description: '删除本次隔离测试文件' }; tool = 'run_code'; }
    assert.ok(names.includes(tool), `Missing shell tool: ${names.join(',')}`);
    frame({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] });
    frame({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
  }
  if (deletion || marker === 'background' || automatic.has(marker)) { finish(); return; }
  frame({ role: 'assistant', content: '正在处理隔离测试任务。' });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let application, browser, page, output = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(200); }
  throw Error('UI-3 condition timed out');
}
async function api(page, path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function login(page) {
  page.setDefaultTimeout(30000); page.on('pageerror', error => { errors.push(error.message); console.error('UI-3 renderer error:',error.message); });
  await page.getByRole('textbox', { name: '账户名', exact: true }).fill('UiThreeFixture');
  await page.getByLabel('密码', { exact: true }).filter({ visible: true }).fill(password);
  await page.getByRole('textbox', { name: '这台设备的名称' }).fill('UI-3 隔离验收');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '新对话 Ctrl N', exact: true }).waitFor();
}
async function newSession(page) {
  const seen = new Set(), listen = request => seen.add(request.url()); page.on('request', listen);
  const posted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/commands'));
  await page.getByRole('button', { name: '新对话 Ctrl N', exact: true }).click();
  const created = await (await posted).json(), id = created.command.sessionId;
  await until(() => [...seen].some(url => url.includes(`/sessions/${id}/events`)));
  await until(() => page.getByRole('textbox', { name: '输入消息', exact: true }).isEnabled());
  page.off('request', listen); console.log('UI-3 new isolated session'); return id;
}
async function history(page, sessionId) { return (await api(page, `/sessions/${sessionId}/events?afterSeq=-1&limit=200`)).body.events; }
async function send(page, text, key = null) {
  await sleep(900);
  const input = page.getByRole('textbox', { name: '输入消息', exact: true }); await input.fill(text);
  await until(() => page.getByRole('button', {name:'发送',exact:true}).isEnabled());
  const posted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/commands'));
  console.log(`UI-3 sending ${text}; inputEnabled=${await input.isEnabled()}; sendEnabled=${await page.getByRole('button', {name:'发送',exact:true}).isEnabled()}`);
  if (key) await input.press(key); else await page.getByRole('button', { name: '发送', exact: true }).click();
  const submission = await (await posted).json(), id = submission.command.commandId;
  await until(async () => await input.inputValue() === '');
  const command = await until(async () => { const row = (await api(page, `/commands/${id}`)).body.command; return row?.state === 'accepted_by_dsh' ? row : null; });
  console.log(`UI-3 sent ${text}: ${command.intent}`); return command;
}
async function shots(page, name) {
  await page.mouse.move(0, 0); await page.evaluate(() => document.fonts.ready);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: join(evidence, `${name}-${theme}.png`), animations: 'disabled' });
  }
}
async function scenario(page, surface) {
  console.log(`UI-3 ${surface} queue acceptance`);
  const marker = `UI3_${surface}`, sessionId = await newSession(page);
  const target = await send(page, `${marker} BLOCK`);
  await until(() => requests.some(row => row.marker === marker && !row.closed));
  await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).waitFor();
  const steer = await send(page, `${marker} STEER`, 'Enter');
  assert.equal(steer.intent, 'steer'); assert.equal(steer.rootTaskId, target.commandId);
  const cancelled = await send(page, `${marker} CANCEL`, 'Control+Enter');
  const one = await send(page, `${marker} ONE`, 'Control+Enter');
  await page.getByRole('combobox', { name: '运行中输入方式', exact: true }).click(); await page.getByRole('option',{name:'新任务',exact:true}).click();
  const two = await send(page, `${marker} TWO`);
  assert.equal(one.intent, 'queue'); assert.equal(two.intent, 'queue');
  const cancelledCard = page.getByRole('article', { name: `排队任务 ${marker} CANCEL`, exact: true });
  await cancelledCard.getByRole('button', { name: '取消', exact: true }).click();
  await cancelledCard.waitFor({ state: 'hidden' });
  const edit = await send(page, `${marker} EDIT`, 'Control+Enter');
  await page.getByRole('article', { name: `排队任务 ${marker} EDIT`, exact: true }).getByRole('button', { name: '编辑后重新排', exact: true }).click();
  await until(async () => await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue() === `${marker} EDIT`);
  const edited = await send(page, `${marker} EDIT changed`);
  await page.getByRole('article', { name: `排队任务 ${marker} EDIT changed`, exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await until(async () => (await history(page, sessionId)).some(event => event.type === 'task.ended' && event.data.taskId === edited.commandId));
  await shots(page, `${surface}-queue`);
  requests.find(row => row.marker === marker && !row.closed).complete();
  await until(() => requests.filter(row => row.marker === marker && row.text.includes(`${marker} STEER`)).length > 0);
  await page.getByText('已补充到当前任务', { exact: true }).waitFor();
  const rejectedCancel = await api(page, `/tasks/${target.commandId}/cancel`, { requestId: randomUUID() }); assert.equal(rejectedCancel.status, 409);
  automatic.add(marker);
  await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).click();
  let events;
  await until(async () => { events = await history(page, sessionId); return events.some(event => event.type === 'task.ended' && event.data.taskId === two.commandId); });
  assert.deepEqual(events.filter(event => event.type === 'task.started').map(event => event.data.taskId), [target.commandId, one.commandId, two.commandId]);
  assert.ok(events.some(event => event.type === 'task.ended' && event.data.taskId === target.commandId && event.data.reason === 'aborted'));
  assert.ok(!events.some(event => event.type === 'user.message' && [cancelled.receiptId, edit.receiptId, edited.receiptId].includes(event.data.receiptId)));
  await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).waitFor({ state: 'hidden' });
  for (const decision of ['allow', 'deny']) {
    console.log(`UI-3 ${surface} deletion ${decision}`);
    const id = await newSession(page), deletion = `UI3_DELETE_${surface}_${decision}`, file = join(root, `${deletion}.txt`); writeFileSync(file, 'isolated test file');
    assert.equal((await api(page, `/sessions/${id}/approval-mode`, { mode: 'ask' }, 'PATCH')).status, 200);
    await page.reload(); await page.getByRole('textbox', { name: '输入消息', exact: true }).waitFor();
    await send(page, deletion);
    await page.getByRole('button', { name: '允许一次', exact: true }).waitFor();
    await page.getByText(/运行命令：Remove-Item/).waitFor();
    assert.equal(await page.getByRole('button', { name: '允许一次', exact: true }).count(), 1);
    assert.ok(existsSync(file));
    await page.getByRole('button', { name: '允许一次', exact: true }).scrollIntoViewIfNeeded();
    await shots(page, `${surface}-approval-${decision}`);
    await page.getByRole('button', { name: decision === 'allow' ? '允许一次' : '拒绝', exact: true }).click();
    await until(async () => (await history(page, id)).some(event => event.type === 'task.ended'));
    assert.equal(existsSync(file), decision === 'deny');
    await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).waitFor({ state: 'hidden' });
    const approval = (await api(page, `/sessions/${id}/approvals?limit=100`)).body.approvals[0];
    assert.equal(approval.decisionOutcome, decision === 'allow' ? 'allowed-once' : 'rejected');
    if (decision === 'allow') {
      await page.getByRole('button', { name: '输出与来源', exact: true }).click();
      await page.getByRole('button', { name: /pwsh.*调用/ }).click();
      const panel = page.getByRole('complementary', { name: '成果与来源预览' });
      await panel.getByText(/运行命令 Remove-Item/).click();
      await panel.getByText(/运行命令：Remove-Item/).waitFor();
      assert.equal(await panel.getByText('详情', { exact: true }).count(), 1);
      assert.equal(await panel.getByText(/\"arguments\"/).isVisible(), false);
      await shots(page, `${surface}-source`);
      await page.getByRole('button', { name: '收起右侧面板', exact: true }).click();
    }
  }
  reports.push({ surface, steerInOriginalTask: true, orderedQueue: true, cancelledNotExecuted: true, editRequeue: true, stopPreservesQueue: true, approvalsAllowDeny: true, sourcesSummarized: true });
}
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['.', '--personal-host', '--access-port=0', `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
  application.process().stdout?.on('data', part => { output = (output + part).slice(-50000); });
  application.process().stderr?.on('data', part => { output = (output + part).slice(-50000); });
  page = await application.firstWindow(); await page.waitForURL('**/personal/v1/ui*'); await login(page);
  const configured = await api(page, '/account/models', { requestId: 'ui3-model', name: 'UI-3 合成模型', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: 'ui3-synthetic-model', apiKey: 'synthetic-fixture-only' });
  assert.ok([200, 202].includes(configured.status), JSON.stringify(configured.body));
  await until(async () => (await api(page, '/account/models/by-request/ui3-model')).body.operation?.status === 'succeeded');
  await page.reload(); await scenario(page, 'desktop');
  browser = await chromium.launch({ headless: true }); const web = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await web.goto(page.url().split('#')[0]); page = web; await login(page); await scenario(page, 'web');
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify({ realElectron: true, realBrowser: true, realHost: true, realPinnedDsh: true, syntheticModel: true, isolated: true, reports, errors }, null, 2) + '\n');
  console.log('UI-3 real Electron and browser acceptance passed.');
} catch (error) {
  console.error('UI-3 failure:', error.message); console.error((await page?.locator('body').innerText().catch(() => ''))?.slice(-2200));
  console.error('Host diagnostics:', output.slice(-2200));
  await page?.screenshot({ path: join(root, 'failure.png') }).catch(() => {}); console.error('Isolated diagnostics:', root); throw error;
} finally {
  await browser?.close().catch(() => {}); await application?.close().catch(() => {});
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
}
