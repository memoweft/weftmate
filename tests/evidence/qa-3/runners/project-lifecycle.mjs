/** PJ-1: real Electron + personal/v1 + native DSH, keys only in memory. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { PROFILE_PATCH_TEMPLATE } from '../../../../src/dsh-web-runtime.ts';

const repository = resolve(import.meta.dirname, '../../../..');
process.env.TEMP = process.env.TMP = 'C:/Temp';
const modelName = 'mimo';
const run = promisify(execFile);
async function environmentValue(name, scope = 'User') {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true });
  return stdout.trim();
}
const key = await environmentValue('MIMO_API_KEY', 'Machine');
assert.ok(key, 'Required model key absent');
const modelId = 'mimo-v2.6-flash';
const privateValues = [key];
const redact = value => privateValues.reduce((text, secret) => text.replaceAll(secret, '[private-model]'), String(value));
const root = join('C:/Temp', `weftmate-pj-1-${modelName}-${randomUUID()}`), profile = join(root, 'profile'), out = join(root, 'eval');
mkdirSync(profile, { recursive: true }); mkdirSync(out);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const username = `eval-${randomUUID()}`, password = `test-${randomUUID()}-password`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => ({})]));
const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await prep.start(), setup = await prep.issueSetupGrant();
assert.equal((await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'Long task fixture' }) })).status, 201);
await prep.close();
const plugins = join(profile, 'dsh-home', 'profiles', 'weftmate', 'plugins'); mkdirSync(plugins, { recursive: true });
writeFileSync(join(plugins, 'long-task-observer.mjs'), `import { appendFileSync } from 'node:fs';
export const name = 'long-task-observer';
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    let data;
    if (['request/context', 'goal/change', 'todo/write', 'compaction/start', 'compaction/summary', 'compaction/end', 'turn/end'].includes(event.type)) data = event.data;
    if (event.type === 'assistant/message') data = { usage: event.data.usage, tools: event.data.message.content.filter(part => part.type === 'tool-call').map(part => part.name) };
    if (data) appendFileSync(${JSON.stringify(join(root, 'native-events.jsonl'))}, JSON.stringify({ sessionId: session.id, seq: event.seq, type: event.type, data }) + '\\n');
  });
}
`);
writeFileSync(join(profile, 'dsh-home', 'profiles', 'weftmate', 'cordis.patch.yml'), PROFILE_PATCH_TEMPLATE + '\n- insert:\n    - id: long-task-observer\n      name: ./plugins/long-task-observer.mjs\n');
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || ['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY', 'MODEL_SWITCH_UNIFIED_KEY'].includes(name)) delete env[name];
env.WEFTMATE_BASELINE_TRACE = join(root, 'requests.jsonl');
let app, page, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function until(check) { const deadline = Date.now() + 90000; while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(250); } throw new Error('Isolated host setup timed out'); }
console.log(`Isolated ${modelName} root: ${root}`);
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [join(repository, 'tests/integration/personal-baseline-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], cwd: repository, env, timeout: 90000 });
  const capture = part => { output += redact(part); writeFileSync(join(root, 'host.log'), output); };
  app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
  page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
  await page.waitForURL('**/personal/v1/ui');
  page.on('pageerror',error=>console.error('Renderer:',error.message));
  await page.evaluate(async credentials=>{const response=await fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});if(!response.ok)throw new Error('Synthetic login failed');},{username,password,deviceName:'PJ-1 Electron'});
  await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});
  const requestId = `long-task-model-${modelName}`;
  assert.equal((await api('/account/models', { requestId, name: modelName,
    baseUrl: 'https://api.xiaomimimo.com/v1',
    modelId, apiKey: key })).status, 202);
  const operation = await until(async () => { const value = await api(`/account/models/by-request/${requestId}`); return !['pending', 'applying'].includes(value.body.operation?.status) && value.body.operation; });
  assert.equal(operation.status, 'succeeded');
  const selected = (await api('/models')).body.models.find(model => model.name === modelName); assert.ok(selected?.configured);
  assert.equal((await api('/settings/models', { backgroundModelProfileId: selected.id }, 'PATCH')).status, 200);

  const evidence = join(repository, 'tests/evidence/qa-3/project-lifecycle'); mkdirSync(evidence,{recursive:true});
  async function session(title) {
    const response=await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:(await api('/status')).body.hostId,modelProfileId:selected.id});
    assert.equal(response.status,202,JSON.stringify(response.body));
    const command=await until(async()=>{const v=await api(`/commands/${response.body.command.commandId}`);if(['rejected','uncertain'].includes(v.body.command.state))throw new Error(JSON.stringify(v.body));return v.body.command.state==='accepted_by_dsh'&&v.body.command});
    return command.sessionId;
  }
  async function message(id,text) {
    const result=await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:(await api('/status')).body.hostId,sessionId:id,text});
    assert.equal(result.status,202,JSON.stringify(result.body));
    const accepted = await until(async()=>{const r=await api(`/commands/${result.body.command.commandId}`);if(r.body.command.state==='rejected'||r.body.command.state==='uncertain')throw new Error(JSON.stringify(r.body));return r.body.command.state==='accepted_by_dsh' && r.body.command;});
    const prior=(await api(`/sessions/${id}/events?limit=200`)).body.events?.filter(e=>e.type==='turn.started').length||0;const deadline=Date.now()+240000;
    while(Date.now()<deadline){const events=(await api(`/sessions/${id}/events?limit=200`)).body.events;
      if(events?.some(e=>e.type==='user.message'&&e.data.receiptId===accepted.receiptId)&&events.some(e=>e.type==='turn.ended'&&e.seq>events.findLast(e=>e.type==='user.message'&&e.data.receiptId===accepted.receiptId).seq))return events;
      await pause(1000)}throw new Error('model turn timeout');
  }
  const projectRoot = join(root, 'synthetic-project'); mkdirSync(projectRoot);
  writeFileSync(join(projectRoot, 'brief.md'), '# 合成项目\n项目代号：竹叶。目标：给社区图书角制作借阅说明。\n', 'utf8');
  const instructions = '所有总结使用中文，必须包含项目代号竹叶；只处理合成文件。';
  let project;
  if (!process.env.PJ1_SKIP_SCREENSHOTS) {
    await app.evaluate(({dialog},folder)=>{globalThis.__pjOriginalPicker=dialog.showOpenDialog;globalThis.__pjPickerCalls=0;dialog.showOpenDialog=async(_window,options)=>{globalThis.__pjPickerCalls++;if(!options.properties.includes('openDirectory'))throw Error('Folder dialog expected');return{canceled:false,filePaths:[folder]}};},projectRoot);
    await page.getByRole('button',{name:'新建项目',exact:true}).click();
    const create=page.getByRole('dialog',{name:'新建项目',exact:true});await create.getByRole('button',{name:'选择文件夹…',exact:true}).click();
    assert.equal(await create.getByRole('textbox',{name:'项目名称',exact:true}).inputValue(),'synthetic-project');
    await create.getByRole('textbox',{name:'项目名称',exact:true}).fill('社区图书角');await create.getByRole('textbox',{name:'项目说明',exact:true}).fill(instructions);
    await page.screenshot({path:join(evidence,'desktop-create-project.png')});await create.getByRole('button',{name:'创建项目',exact:true}).click();await create.waitFor({state:'hidden'});
    assert.equal(await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.__pjOriginalPicker;return globalThis.__pjPickerCalls;}),1);
    project=(await api('/projects')).body.projects.find(project=>project.name==='社区图书角');
  } else {
    const registered=await api('/projects',{requestId:randomUUID(),name:'社区图书角',rootPath:projectRoot.replaceAll('/', '\\'),permission:'write',instructions});assert.equal(registered.status,201,JSON.stringify(registered.body));project=registered.body.project;
  }
  assert.ok(project);assert.ok(!JSON.stringify((await api('/projects')).body).includes(projectRoot));
  await page.reload(); await page.getByRole('button', { name: '在项目 社区图书角 新建对话', exact: true }).click();
  const A = await until(async () => (await api('/sessions')).body.sessions.find(s => s.projectId === project.projectId)?.sessionId);
  await api(`/sessions/${A}/metadata`, {title:'借阅说明总结'}, 'PATCH');
  assert.equal((await api(`/sessions/${A}/approval-mode`,{mode:'accept-edits'},'PATCH')).status,200);
  await message(A, '请读取项目文件夹中的 brief.md，写 summary.md 为简短的总结，遵守项目固定说明。再用 pwsh 运行 Get-Location 和 Get-Content -LiteralPath summary.md，确认目录和内容。使用原生 read / write / pwsh 工具直接完成，不要问问题。');
  assert.ok(existsSync(join(projectRoot,'summary.md')), 'real task wrote inside selected project');
  assert.match(readFileSync(join(projectRoot,'summary.md'),'utf8'), /竹叶/);
  const events = (await api(`/sessions/${A}/events?limit=200`)).body.events;
  assert.ok(events.some(e=>e.data?.toolName==='read')); assert.ok(events.some(e=>e.data?.toolName==='write')); assert.ok(events.some(e=>e.data?.toolName==='pwsh'));
  if (!process.env.PJ1_SKIP_SCREENSHOTS) {
  await page.reload(); await page.getByRole('button',{name:'借阅说明总结',exact:true}).click();
  for (const theme of ['light','dark']) { await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme); await page.screenshot({path:join(evidence,`desktop-project-${theme}.png`)}); }
  await page.getByRole('button',{name:'项目设置 社区图书角',exact:true}).click();
  await page.screenshot({path:join(evidence,'desktop-project-settings.png')}); await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'更多操作 借阅说明总结',exact:true}).click(); await page.getByRole('menuitem',{name:'移至项目',exact:true}).click(); await page.screenshot({path:join(evidence,'desktop-move-project.png')}); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/personal/v1/ui')).setSize(800,600)); await page.screenshot({path:join(evidence,'desktop-project-narrow.png')});
  console.log('Desktop screenshots complete');
  const browser = await chromium.launch();
  try { const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); await mobile.goto(page.url());
    await mobile.evaluate(async credentials=>{const r=await fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});if(!r.ok)throw Error('mobile login failed')},{username,password,deviceName:'PJ-1 synthetic phone'});
    await mobile.reload(); await mobile.locator('#assistant-view').waitFor({state:'visible'});
    await mobile.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
    await mobile.screenshot({path:join(evidence,'mobile-project-list.png')});
    await mobile.getByRole('button',{name:'借阅说明总结',exact:true}).click(); await mobile.screenshot({path:join(evidence,'mobile-project-conversation.png')});
  } finally { await browser.close(); }
  const { verifyMobileProjects } = await import('../../../../tests/integration/pj-1-mobile-projects.mjs');
  console.log('Verifying mobile interface bundle');
  await verifyMobileProjects({ origin: new URL(page.url()).origin, credentials: {username,password}, evidence, api, project, sessionId: A });
  }
  // Explicit attempts verify that refusal does not modify either target.
  console.log('Mobile web screenshots complete');
  const outside = join(root,'outside.txt');
  await message(A, `边界测试：请用 write 尝试写入 ${outside}，内容 escaped；收到拒绝就停止，不换工具绕过。`);
  assert.ok(!existsSync(outside));
  console.log('Outside write refused');
  const patch = await api(`/projects/${project.projectId}`, {expectedRevision:project.revision,permission:'read-only'}, 'PATCH'); assert.equal(patch.status,200,JSON.stringify(patch.body));
  await message(A, '只读测试：请用 write 尝试创建 forbidden.txt，内容 readonly；收到拒绝就停止，不换工具。');
  assert.ok(!existsSync(join(projectRoot,'forbidden.txt')));
  console.log('Read-only write refused');
  const ordinary = await session('普通对话');
  assert.equal((await api(`/sessions/${ordinary}/metadata`,{projectId:project.projectId},'PATCH')).status,200);
  const writable = await api(`/projects/${project.projectId}`,{expectedRevision:patch.body.project.revision,permission:'write'},'PATCH');
  assert.equal(writable.status,200,JSON.stringify(writable.body));
  await message(ordinary, '移动后验收：读取项目中的 brief.md，再用 write 新建 moved.md，写一行包含项目代号的总结；用 pwsh 的 Get-Location 确认执行目录。不要改已有文件。');
  assert.ok(existsSync(join(projectRoot,'moved.md')));
  assert.equal((await api(`/projects/${project.projectId}`,{expectedRevision:writable.body.project.revision},'DELETE')).status,200);
  assert.ok(existsSync(join(projectRoot,'brief.md')) && existsSync(join(projectRoot,'summary.md')));
  const native=readFileSync(join(root,'native-events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const usage=native.filter(e=>e.type==='assistant/message').map(e=>e.data.usage).filter(Boolean);
  writeFileSync(join(evidence,'verification.json'),JSON.stringify({desktop:true,realMiMo:true,readWriteCommand:true,outsideRefused:true,readonlyRefused:true,removePreservesFiles:true,mobileWeb:true,usage},null,2));
  console.log('PJ-1 real model and desktop verification passed');
} finally { await app?.close().catch(()=>{}); console.log(`Isolated result: ${root}`); }
