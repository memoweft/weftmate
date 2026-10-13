/** macOS source desktop acceptance. Synthetic model; no real login keychain. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fixture, P } from '../../services/cloud/test/identity-helpers.mjs';
import { appDevice, proof, control } from '../../services/cloud/test/app-helpers.mjs';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir, uptime } from 'node:os';
import { resolve, join } from 'node:path';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

assert.equal(process.platform, 'darwin');
const repository = resolve(import.meta.dirname, '../..'), out = join(repository, 'tests/evidence/m3-3b');
await mkdir(out, { recursive: true });
const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-m3-3-'))), profile = join(root, 'profile'), project = join(root, 'synthetic-project');
await mkdir(profile); await mkdir(project);
const memoryConfig = join(root, 'memory-config.json');
await writeFile(memoryConfig, JSON.stringify({ python: resolve('../memoweft/py/.venv/bin/python'), pythonPath: resolve('../memoweft/py/src'), baseUrl: 'http://127.0.0.1:18197/v1', model: '@current', authRef: 'current-local' }));
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const nativeExecutable = resolve(process.env.M3_3B_APP || '../trial/WeftMate.app', 'Contents/MacOS/WeftMate');
const nativeLibrary = resolve('.local/m3-3b/isolated-keychain.dylib');
const keychain = join(root, 'synthetic.keychain');
const keychainPassword = randomBytes(32).toString('base64url');
const cloudCleanups = []; let cloud, desktop, phoneBrowser, phone;
const email = `m3-3b-${randomUUID()}@example.com`, password = randomBytes(32).toString('base64url');
const input = '# Synthetic input\nM3-3 synthetic file value: 42.\n', written = '# Synthetic output\nRead value: 42.\n';
await writeFile(join(project, 'brief.md'), input);
const vaultKey = randomBytes(32).toString('base64'), modelKey = randomBytes(24).toString('hex');
const report = { packagedDesktop: true, realDSH: true, account: 'synthetic local owner', computerName: 'synthetic-mac',
  credentialStorage: 'real Electron safeStorage; Security API search/add scoped only to disposable keychain',
  startedAt: new Date().toISOString(), electronLaunches: 0, mimoRequests: 0, mimoKeyAvailable: Boolean(process.env.MIMO_API_KEY),
  checks: [], screenshots: [], syntheticRequests: 0, tools: [], errors: [] };
const diagnostics = async () => (await readdir('/Library/Logs/DiagnosticReports')).filter(x => /gpuRestart|WindowServer/.test(x));
const before = new Set(await diagnostics()), uptimeBefore = uptime();
const pause = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(100); }
  throw Error('M3-3 timeout: ' + label);
};
let shellCalls = 0, phoneFileCalls = 0;
let workflowCalls = 0, app, page, log = '', phase = 'setup';
async function stream(res, model, content, tool) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = (delta, reason = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`);
  if (tool) frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function', function: tool }] });
  else { frame({ role: 'assistant', content: content.slice(0, 8) }); await pause(300); frame({ content: content.slice(8) }); }
  frame({}, tool ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
}
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-mac-model', context_window: 32768 }] }));
  if (req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ total_slots: 1, n_ctx: 32768, currentModelId: 'synthetic-mac-model', probe: { health: true } }));
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw); report.syntheticRequests++;
  let interpretation; try { interpretation = JSON.parse(body.messages.at(-1).content); } catch {}
  if (interpretation?.evidence) {
    const e = interpretation.evidence.find(e => e.text.includes('小禾'));
    const content = e ? JSON.stringify({ schema_version: 8, result: 'cognitions', cognitions: [{
      action: 'form', target: 'owner_self', statement_kind: 'naming', formed_by: 'stated', proposition: e.text,
      entity: { canonical_name: '小禾', kind: 'person' }, supports: [{ evidence_id: e.id, start: 0, end: e.text.length }],
    }] }) : JSON.stringify({ schema_version: 8, result: 'no_change' });
    report.memoryInterpretations = (report.memoryInterpretations || 0) + (e ? 1 : 0);
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  }
  const names = (body.tools || []).map(t => t.function?.name), text = JSON.stringify(body.messages), queryText = JSON.stringify(body.messages.filter(m=>m.role==='user').at(-1));
  let tool, content = 'M3-3 流式回复成功：这台 Mac 可以独立聊天。';
  if (names.length && queryText.includes('M3-3_READ_WRITE')) {
    const step = workflowCalls++;
    const name = step === 0 ? 'read' : step === 1 ? 'write' : null;
    if (name) {
      const args = name === 'read' ? { file_path: 'brief.md' } : { file_path: 'result.md', content: written };
      report.tools.push(name);
      tool = names.includes('run_code') && !names.includes(name)
        ? { name: 'run_code', arguments: JSON.stringify({ code: `return await tools.${name}(${JSON.stringify(args)});`, description: '合成项目文件验证' }) }
        : { name, arguments: JSON.stringify(args) };
    } else {
      report.readReachedModel = text.includes('M3-3 synthetic file value: 42');
      content = 'M3-3 项目读取与写入已完成，文件内容已核对。';
    }
  }
  if (names.length && queryText.includes('M3-3B_SHELL')) {
    if (shellCalls++ === 0) {
      const args = { command: 'printf "M3_3B_SHELL_OK\\n"', description: '输出合成验证标记' };
      tool = names.includes('run_code') && !names.includes('bash')
        ? { name: 'run_code', arguments: JSON.stringify({ code: `return await tools.bash(${JSON.stringify(args)});`, description: 'Mac shell 验证' }) }
        : { name: 'bash', arguments: JSON.stringify(args) };
    } else { report.shellOutputReachedModel = text.includes('M3_3B_SHELL_OK'); content = 'M3-3b shell 已完成。'; }
  }
  if (names.length && queryText.includes('M3-3B_PHONE_READ')) {
    if (phoneFileCalls++ === 0) {
      const args = { file_path: 'brief.md' };
      tool = names.includes('run_code') && !names.includes('read')
        ? { name: 'run_code', arguments: JSON.stringify({ code: `return await tools.read(${JSON.stringify(args)});`, description: '手机请求读合成文件' }) }
        : { name: 'read', arguments: JSON.stringify(args) };
    } else { report.phoneReadReachedModel = text.includes('M3-3 synthetic file value: 42'); content = 'M3-3b 手机读到文件里的合成值 42。'; }
  }
  if (names.length && queryText.includes('M3-3B_MEMORY_QUERY')) {
    report.memoryContextReachedModel = report.memoryContextReachedModel || (text.includes('记忆：') && text.includes('小禾'));
    content = report.memoryContextReachedModel ? 'M3-3b 记忆回答：你希望我称呼你为小禾。' : 'M3-3b 没有获得正式记忆。';
  }
  if (queryText?.includes('M3-3B_PHONE_HELLO')) { content='M3-3b 手机聊天流式回复已完成。'; report.phoneHelloRequests=(report.phoneHelloRequests||0)+1; }
  if (body.stream) await stream(res, body.model, content, tool);
  else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const api = (path, body, method = body === undefined ? 'GET' : 'POST') => page.evaluate(async ({ path, body, method }) => {
  const me = await fetch('/personal/v1/auth/me').then(r => r.json());
  const response = await fetch('/personal/v1' + path, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}, { path, body, method });
async function shot(name) {
  const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(out, name), Buffer.from(bytes, 'base64')); report.screenshots.push(name);
}
async function shots(stage) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await pause(150); await shot(`electron-1200-${theme}-${stage}.png`);
  }
}
async function launch() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
  Object.assign(env, { WEFTMATE_TEST_HOST_NAME: 'synthetic-mac', WEFTMATE_MEMOWEFT_ENABLED: '0',
    WEFTMATE_CLOUD_ISSUER: cloud.config.issuer, WEFTMATE_CLOUD_WEB_CLIENT_ID: 'm3-3b-web',
    WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK: 'true',
    M3_3B_APP_EXECUTABLE: nativeExecutable, M3_3B_SECURITY_LIBRARY: nativeLibrary,
    M3_3B_KEYCHAIN_FILE: keychain, M3_3B_KEYCHAIN_PASSWORD: keychainPassword });
  report.electronLaunches++;
  app = await _electron.launch({ executablePath: join(repository, 'tests/helpers/m3-3b/launch-package.py'), cwd: repository, env,
    args: ['--disable-gpu', '--disable-gpu-compositing', '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--personal-host', '--access-port=18197', `--personal-memory-config=${memoryConfig}`], timeout: 90000 });
  const capture = bytes => { log = (log + String(bytes)).slice(-100000); };
  app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.waitForURL('**/personal/v1/ui*', { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 860));
  await until(async () => (await api('/auth/me')).body.local === true, 'native local owner session');
}
try {
  // All account traffic goes to an isolated real cloud implementation.
  const origin = 'http://127.0.0.1:18197';
  cloud = await fixture({ after: fn => cloudCleanups.push(fn) }, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'm3-3b-web', application_type: 'web', redirect_uris: [origin + '/personal/v1/ui/'] },
  ]) } });
  const challenge = (await cloud.api(P + '/auth/registration/request', { method: 'POST', body: { email }, status: 200 })).data;
  const ticket = (await cloud.api(P + '/auth/registration/verify', { method: 'POST', body: { challengeId: challenge.challengeId, code: await cloud.mailCode(challenge.challengeId) }, status: 200 })).data;
  await cloud.api(P + '/auth/registration/complete', { method: 'POST', body: { passwordTicket: ticket.passwordTicket, password }, status: 200 });
  desktop = await appDevice(cloud, 'synthetic-mac', email, password);
  await launch();
  phase = 'first-open'; await page.locator('section.onboarding').waitFor({ state: 'visible' }); await shots('first-open');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('textbox', { name: '怎么称呼你', exact: true }).fill('合成用户');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  phase = 'configure-model';
  await page.getByRole('combobox', { name: '模型提供方', exact: true }).click();
  await page.getByRole('option', { name: '本机 / 局域网', exact: true }).click();
  await page.getByRole('textbox', { name: '显示名称', exact: true }).fill('合成 Mac 模型');
  await page.getByRole('textbox', { name: '服务地址', exact: true }).fill(`http://127.0.0.1:${server.address().port}/v1`);
  await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('synthetic-mac-model');
  await page.getByRole('textbox', { name: '粘贴密钥', exact: true }).fill(modelKey);
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await until(async () => (await api('/models')).body.models?.some(m => m.name === '合成 Mac 模型' && m.configured), 'model saved');
  report.checks.push('first open and model connection/configuration through visible onboarding controls');
  for (const title of ['越聊，越了解你', '把过去带过来', '手机上，随时接着聊']) {
    await page.getByText(title, { exact: true }).waitFor();
    await page.getByRole('button', { name: '继续', exact: true }).click();
  }
  await page.getByRole('button', { name: '开始聊天', exact: true }).click();
  await page.locator('section.onboarding').waitFor({ state: 'hidden' });
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  // Exercise completion/approval notification construction without changing
  // the user's OS notification permissions or displaying private account UI.
  await app.evaluate(({ Notification }) => { globalThis.__m3Notifications=[]; Notification.prototype.show=function(){globalThis.__m3Notifications.push({title:this.title,body:this.body})}; });
  phase = 'native-shell';
  const nativeState = await app.evaluate(({ app, Menu, BrowserWindow, safeStorage }) => ({
    packaged: app.isPackaged, profile: app.getPath('userData'), encryption: safeStorage.isEncryptionAvailable(),
    mock: app.commandLine.hasSwitch('use-mock-keychain'),
    menuLabels: Menu.getApplicationMenu().items.map(row => row.label),
    autoStart: app.getLoginItemSettings().openAtLogin,
  }));
  assert.equal(nativeState.packaged, true); assert.equal(nativeState.profile, profile);
  assert.equal(nativeState.encryption, true); assert.equal(nativeState.mock, false);
  assert.equal(nativeState.autoStart, false); report.native = { ...nativeState, profile: '<synthetic-temp>/profile' };
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await app.evaluate(({ app }) => app.emit('activate'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(row => row.accelerator === 'Command+,').click());
  await page.getByRole('button', { name: '关闭设置', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.locator('#message-text').fill('编辑验证'); await page.locator('#message-text').press('Meta+A');
  await page.locator('#message-text').press('Meta+x');
  assert.equal(await page.locator('#message-text').inputValue(), '');
  await page.locator('#message-text').press('Meta+z');
  assert.equal(await page.locator('#message-text').inputValue(), '编辑验证'); await page.locator('#message-text').fill('');
  report.checks.push('packaged first open; real safeStorage without mock; autostart off; close hides, Dock activates; native settings/edit menu');
  phase = 'main-chat'; console.log('phase=main-chat'); await page.locator('#message-text').fill('M3-3_HELLO 请向我问好。');
  await page.locator('#message-text').press('Enter');
  await page.getByText('M3-3 流式回复成功：这台 Mac 可以独立聊天。', { exact: true }).first().waitFor({ timeout: 90000 });
  await shots('main-chat'); report.checks.push('main chat received two separate synthetic SSE content chunks');
  phase = 'file-drop';
  const cdp=await page.context().newCDPSession(page), box=await page.locator('#message-text').boundingBox();
  for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:box.x+40,y:box.y+15,data:{items:[],files:[join(project,'brief.md')],dragOperationsMask:1}});
  await page.getByText('brief.md',{exact:true}).filter({visible:true}).first().waitFor();
  await shots('native-file-drop'); await page.getByRole('button',{name:'移除文件 brief.md',exact:true}).click();await cdp.detach();
  report.fileDrop='Chromium native file-backed drag IPC; Finder mouse gesture not exercised';
  phase = 'project'; console.log('phase=project');
  // Substitute only the OS panel result. No system picker permission or real
  // user's directories are involved. The existing trusted desktop bridge runs.
  await app.evaluate(({ dialog }, project) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); }, project);
  const selected = await page.evaluate(() => weftmateDesktop.pickProjectFolder());
  assert.equal(selected, project);
  const fields = { requestId: randomUUID(), name: '合成项目', rootPath: selected, permission: 'write', instructions: '只使用此合成项目的文件。' };
  const registered = await page.evaluate(fields => weftmateDesktop.createFolderProject(fields), fields);
  const projectId = registered.project.projectId;
  assert.ok(projectId);
  await api('/settings/approvals', { mode: 'ask' }, 'PATCH');
  const models = (await api('/models')).body.models, host = (await api('/status')).body.hostId;
  const command = await api(`/projects/${projectId}/sessions`, { requestId: randomUUID(),
    modelProfileId: models.find(m => m.name === '合成 Mac 模型').id });
  assert.equal(command.status, 202, JSON.stringify(command.body));
  const receipt = await until(async () => {
    const item = (await api('/commands/' + command.body.command.commandId)).body.command;
    if (['failed','rejected','uncertain'].includes(item.state)) throw Error('session.create ' + item.state);
    return item.state === 'accepted_by_dsh' && item;
  }, 'project session');
  await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  const send = await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: host,
    sessionId: receipt.sessionId, text: 'M3-3_READ_WRITE 读取 brief.md，并在项目里新建 result.md。每步先等待我批准。' });
  assert.equal(send.status, 202, JSON.stringify(send.body));
  // Select the actual project conversation so native approval controls belong
  // to this same task; no synthetic DOM approval is created.
  await page.locator(`[data-session-id="${receipt.sessionId}"]`).getByRole('button').first().click();
  let approvals = 0;
  while (approvals < 2) {
    const approve = page.getByRole('button', { name: '批准', exact: true }).first();
    await approve.waitFor({ timeout: 90000 });
    assert.equal(await readFile(join(project, 'result.md')).then(() => true).catch(() => false), false, 'write cannot precede approval');
    await shots(approvals === 0 ? 'read-approval' : 'write-approval');
    await approve.click(); approvals++;
  }
  await until(async () => (await readFile(join(project, 'result.md'), 'utf8').catch(() => '')) === written, 'physical project output');
  await until(() => report.readReachedModel, 'read content returned to real model adapter');
  report.approvals = approvals; report.outputSha256 = createHash('sha256').update(written).digest('hex');
  report.checks.push('trusted project registration, native read/write tools, visible approvals, physical file bytes and SHA-256');
  await shots('project-output');
  phase = 'shell'; console.log('phase=shell');
  const sendShell = await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: host,
    sessionId: receipt.sessionId, text: 'M3-3B_SHELL 请运行一条 shell 命令验证，先等我批准。' });
  assert.equal(sendShell.status, 202);
  await page.getByRole('button', { name: '批准', exact: true }).first().waitFor({ timeout: 90000 });
  await shots('shell-approval'); await page.getByRole('button', { name: '批准', exact: true }).first().click();
  await until(() => report.shellOutputReachedModel, 'real bash output returned');
  await page.getByText('M3-3b shell 已完成。', { exact: true }).first().waitFor({ timeout: 90000 });
  report.checks.push('real DSH bash shell executed after native approval');
  phase = 'phone-bind'; console.log('phase=phone-bind');
  const nativeOwner = (await api('/auth/me')).body.account.ownerId;
  const claim = await api('/cloud/claims', {}); assert.equal(claim.status, 200);
  assert.equal((await api('/cloud/binding', { claimId: claim.body.claimId, accessToken: desktop.tokens.access_token })).status, 200);
  const nonce = await api('/auth/cloud-nonce', {});
  const bound = await page.evaluate(async ({ token, dpop }) => {
    const me = await fetch('/personal/v1/auth/me').then(r => r.json());
    const r = await fetch('/personal/v1/auth/cloud-desktop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken, dpop },
      body: JSON.stringify({ accessToken: token, deviceName: 'synthetic-mac' }) }); return { status: r.status, ...await r.json() };
  }, { token: desktop.tokens.access_token, dpop: await proof(desktop, origin + '/personal/v1/auth/cloud-desktop', desktop.tokens.access_token, { nonce: nonce.body.nonce }) });
  assert.equal(bound.status, 200); assert.equal(bound.account.ownerId, nativeOwner);
  const catalog = (await api('/models')).body.models; assert.ok(catalog.some(row => row.configured));
  report.phoneCatalog = catalog.map(({name, configured}) => ({name, configured}));
  phoneBrowser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  phone = await phoneBrowser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.addInitScript(() => {
    let coreApi; Object.defineProperty(globalThis,'WeftUiCore',{ configurable:true, get:()=>coreApi, set:value=>{
      coreApi=value; const create=value.create; value.create=(...args)=>{const core=create(...args);globalThis.__m3PhoneCore=core;return core;};
    }});
  });
  await phone.goto(origin + '/personal/v1/ui/');
  const form = phone.locator('#cloud-auth-form');
  await form.getByLabel('邮箱', { exact: true }).fill(email); await form.getByLabel('密码', { exact: true }).fill(password);
  await form.locator('[type=submit]').click();
  const code = phone.getByLabel(/^(邮箱)?验证码$/, { exact: true }); await code.waitFor();
  const row = cloud.db.prepare('SELECT id FROM email_challenges WHERE email=? ORDER BY rowid DESC LIMIT 1').get(email);
  await code.fill(await cloud.mailCode(row.id)); await form.locator('[type=submit]').click();
  await phone.locator('#assistant-view').waitFor({ state: 'visible', timeout: 60000 });
  await phone.evaluate(() => WeftSettingsNavigation.open('devices'));
  await phone.getByText('synthetic-mac', { exact: true }).filter({ visible: true }).first().waitFor();
  await phone.screenshot({ path: join(out,'phone-devices.png') });
  await phone.getByRole('button', {name:'关闭设置',exact:true}).click();
  phase = 'phone-chat';
  await phone.locator('#message-text').fill('M3-3B_PHONE_HELLO 请向我问好。'); await phone.locator('#message-text').press('Enter');
  await phone.getByText('M3-3b 手机聊天流式回复已完成。', { exact: true }).filter({visible:true}).first().waitFor({ timeout: 90000 });
  await phone.screenshot({ path: join(out,'phone-chat.png') });
  const phoneApi = async (path, body) => phone.evaluate(async ({path, body}) => {
    const auth = await fetch('/personal/v1/auth/me').then(r=>r.json()); const r = await fetch('/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})}); return {status:r.status,body:await r.json()};
  }, {path,body});
  assert.equal((await phoneApi('/auth/me')).body.account.ownerId, nativeOwner);
  const phoneCreate = await phoneApi(`/projects/${projectId}/sessions`, { requestId: randomUUID(), modelProfileId: catalog.find(row=>row.configured).id });
  assert.equal(phoneCreate.status,202);
  const phoneReceipt = await until(async()=>{ const cmd=(await phoneApi('/commands/'+phoneCreate.body.command.commandId)).body.command; if(['failed','rejected','uncertain'].includes(cmd.state))throw Error('phone session '+cmd.state); return cmd.state==='accepted_by_dsh'&&cmd;},'phone project session');
  await phone.reload(); await phone.locator('#assistant-view').waitFor({state:'visible'});
  await phoneApi('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:host,sessionId:phoneReceipt.sessionId,text:'M3-3B_PHONE_READ 请读取项目中的 brief.md，先等我批准。'});
  // Select using the existing shared conversation action. The narrow drawer
  // selection is a separate mobile UI boundary; it is not changed by this Mac package.
  await phone.evaluate(async id=>{await __m3PhoneCore.refreshSessions();await __m3PhoneCore.selectSession(id);},phoneReceipt.sessionId);
  report.phoneSelection='existing shared core.selectSession action invoked by test; narrow drawer navigation unverified';
  await phone.getByRole('button',{name:'批准',exact:true}).first().waitFor({timeout:90000});
  await phone.screenshot({path:join(out,'phone-file-approval.png')});
  await phone.getByRole('button',{name:'批准',exact:true}).first().click();
  await until(()=>report.phoneReadReachedModel,'phone approved read result');
  await phone.getByText('M3-3b 手机读到文件里的合成值 42。',{exact:true}).first().waitFor({timeout:90000});
  await phone.screenshot({path:join(out,'phone-file-completed.png')});
  assert.ok(report.phoneHelloRequests>0); report.phoneCompleted=true; report.checks.push('same synthetic account phone login, Mac selection, streaming chat, real project read approved from phone');
  phase = 'memory'; console.log('phase=memory');
  await phoneBrowser.close(); phoneBrowser=null;
  // A real completed user turn goes through the bundled host ingestion plugin.
  const memoryModels = (await api('/models')).body.models;
  const selectedMemoryModel = memoryModels.find(m=>m.configured).id;
  assert.equal((await api('/settings/models',{defaultModelProfileId:selectedMemoryModel,backgroundModelProfileId:selectedMemoryModel},'PATCH')).status,200);
  const mainMemory = (await api('/chats/main')).body.chat;
  const memorySend=await api('/commands',{requestId:randomUUID(),kind:'chat.message',targetDeviceId:host,chatId:mainMemory.chatId,modelProfileId:selectedMemoryModel,text:'以后请叫我小禾。'});
  assert.equal(memorySend.status,202,JSON.stringify(memorySend.body));
  await until(()=>report.memoryInterpretations>0,'real Core interpretation request',60000);
  await until(async()=>{const r=await api('/memory/items?kind=cognition'); return r.status===200 && JSON.stringify(r.body).includes('小禾');},'formed memory via public memory API',60000);
  report.memoryFormed=true;
  const queryCreate=await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:host,modelProfileId:selectedMemoryModel});
  assert.equal(queryCreate.status,202);
  const queryReceipt=await until(async()=>{const cmd=(await api('/commands/'+queryCreate.body.command.commandId)).body.command;return cmd.state==='accepted_by_dsh'&&cmd;},'new memory conversation');
  await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});
  await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:host,sessionId:queryReceipt.sessionId,text:'M3-3B_MEMORY_QUERY 怎么称呼我？'});
  await page.locator(`[data-session-id="${queryReceipt.sessionId}"]`).getByRole('button').first().click();
  await page.getByText('M3-3b 记忆回答：你希望我称呼你为小禾。',{exact:true}).first().waitFor({timeout:90000});
  assert.equal(report.memoryContextReachedModel,true);await shots('memory-new-chat');
  report.checks.push('bundled host ingests completed turn, real Core forms memory, new DSH conversation receives recalled context');
  report.notifications = await app.evaluate(()=>globalThis.__m3Notifications);
  const ciphertext = await readFile(join(profile, 'weftmate-model.enc'));
  assert.ok(!ciphertext.includes(Buffer.from(modelKey)));
  const settings = await readFile(join(profile, 'weftmate-settings.json'));
  assert.ok(!settings.includes(Buffer.from(modelKey)));
  report.checks.push('model key absent from ciphertext/plain settings; real safeStorage uses isolated temporary OS keychain');
  phase = 'restart';
  const processRows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(row=>row.trim().split(/\s+/).map(Number));
  const owned=new Set([app.process().pid]);let expanded=true;while(expanded){expanded=false;for(const [pid,parent]of processRows)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);expanded=true;}}
  const closed=app.waitForEvent('close');
  await app.evaluate(({Menu})=>{setTimeout(()=>Menu.getApplicationMenu().items[0].submenu.items.find(row=>row.accelerator==='Command+Q').click(),0)});
  await closed; app=null;
  await until(()=>{const alive=new Set(execFileSync('/bin/ps',['-axo','pid='],{encoding:'utf8'}).trim().split(/\s+/).map(Number));return [...owned].every(pid=>!alive.has(pid));},'all owned processes exited',10000);
  report.commandQuitExitedProcesses=owned.size;report.checks.push('native Command+Q menu action closes every observed owned process');
  await launch();
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  assert.ok((await api('/models')).body.models.some(m => m.name === '合成 Mac 模型' && m.configured));
  const main = (await api('/chats/main')).body.chat;
  const events = (await api('/sessions/' + main.activeSessionId + '/events?limit=200')).body.events;
  assert.ok(events.some(e => e.type === 'assistant.message' && e.data?.text?.includes('M3-3 流式回复成功')));
  assert.ok((await api('/projects')).body.projects.some(p => p.projectId === projectId));
  assert.equal((await api('/memory/items?kind=cognition')).status,200);
  assert.ok(JSON.stringify((await api('/memory/items?kind=cognition')).body).includes('小禾'));report.memoryRestoredAfterAppRestart=true;
  await shots('restart'); report.checks.push('graceful quit/reopen retains main conversation, model credential/configuration and project');
  report.completed = true;
} catch (error) {
  report.completed = false; report.phase = phase;
  report.failure = String(error.stack).replaceAll(root, '<synthetic-temp>').replace(/\/Users\/[^/\s]+/g, '/Users/<user>');
  if(phone) { await phone.screenshot({path:join(out,'failure-phone.png')}).catch(()=>{}); report.phoneFailureText=await phone.locator('body').innerText().then(t=>t.replaceAll(email,'<synthetic-email>')).catch(()=>null); }
  if (page && !page.isClosed()) await shot('failure-electron.png').catch(() => {});
  process.exitCode = 1;
} finally {
  await phoneBrowser?.close(); await app?.close(); for (const close of cloudCleanups.reverse()) await close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  report.newGpuOrWindowServerReports = (await diagnostics()).filter(x => !before.has(x)).length;
  report.machineRestarted = uptime() < uptimeBefore;
  report.keychainServiceNames=[...new Set([...log.matchAll(/M3_3B_KEYCHAIN_SERVICE ([^\r\n]+)/g)].map(m=>m[1]))];
  report.keychainOperations = { finds: (log.match(/M3_3B_KEYCHAIN (?:find|copy) 0/g)||[]).length, adds: (log.match(/M3_3B_KEYCHAIN (?:legacy-add|add) 0/g)||[]).length };
  report.finishedAt = new Date().toISOString();
  await writeFile(join(out, 'desktop.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(repository, '.local/m3-3b/desktop-runtime.log'), log.replaceAll(modelKey, '[private]').replaceAll(vaultKey, '[private]').replaceAll(root, '<synthetic-temp>'));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ completed: report.completed, phase: report.phase, launches: report.electronLaunches, newReports: report.newGpuOrWindowServerReports }));
}
