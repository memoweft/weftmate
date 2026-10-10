// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** M2-4: real Electron + personal/v1 + native DSH, keys only in memory. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { PROFILE_PATCH_TEMPLATE } from '../../src/dsh-web-runtime.ts';

const repository = resolve(import.meta.dirname, '../..');
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
const root = join('C:/Temp', `weftmate-ui-5-${modelName}-${randomUUID()}`), profile = join(root, 'profile'), out = join(root, 'eval');
mkdirSync(profile, { recursive: true }); mkdirSync(out);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const memoryConfig=join(root,'memory-config.json');writeFileSync(memoryConfig,JSON.stringify({python:'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',pythonPath:'D:/AIProjects/MemoWeft/Core/py/src',baseUrl:'http://127.0.0.1:8081/v1',model:'@current',authRef:'fixture'}));
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
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
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
    args: [join(repository, 'tests/integration/personal-baseline-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0', `--personal-memory-config=${memoryConfig}`], cwd: repository, env, timeout: 90000 });
  const capture = part => { output += redact(part); writeFileSync(join(root, 'host.log'), output); };
  app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
  page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
  await page.waitForURL('**/personal/v1/ui');
  page.on('pageerror',error=>console.error('Renderer:',error.message));
  await page.evaluate(async credentials=>{const response=await fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});if(!response.ok)throw new Error('Synthetic login failed');},{username,password,deviceName:'UI-5 Electron'});
  await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});
  const requestId = `long-task-model-${modelName}`;
  assert.equal((await api('/account/models', { requestId, name: modelName,
    baseUrl: 'https://api.xiaomimimo.com/v1',
    modelId, apiKey: key })).status, 202);
  const operation = await until(async () => { const value = await api(`/account/models/by-request/${requestId}`); return !['pending', 'applying'].includes(value.body.operation?.status) && value.body.operation; });
  assert.equal(operation.status, 'succeeded');
  const selected = (await api('/models')).body.models.find(model => model.name === modelName); assert.ok(selected?.configured);
  assert.equal((await api('/settings/models', { backgroundModelProfileId: selected.id }, 'PATCH')).status, 200);

  const evidence = join(repository, 'tests/evidence/ui-5'); mkdirSync(evidence,{recursive:true});
  async function session(title) {
    const response=await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:(await api('/status')).body.hostId,modelProfileId:selected.id});
    assert.equal(response.status,202,JSON.stringify(response.body));
    const command=await until(async()=>{const v=await api(`/commands/${response.body.command.commandId}`);if(['rejected','uncertain'].includes(v.body.command.state))throw new Error(JSON.stringify(v.body));return v.body.command.state==='accepted_by_dsh'&&v.body.command});
    return command.sessionId;
  }
  async function message(id,text) {
    const result=await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:(await api('/status')).body.hostId,sessionId:id,text});
    assert.equal(result.status,202,JSON.stringify(result.body));
    await until(async()=>{const r=await api(`/commands/${result.body.command.commandId}`);if(r.body.command.state==='rejected'||r.body.command.state==='uncertain')throw new Error(JSON.stringify(r.body));return r.body.command.state==='accepted_by_dsh'});
    const prior=(await api(`/sessions/${id}/events?limit=200`)).body.events?.filter(e=>e.type==='turn.started').length||0;const deadline=Date.now()+240000;
    while(Date.now()<deadline){const events=(await api(`/sessions/${id}/events?limit=200`)).body.events;
      if(events?.some(e=>e.type==='user.message'&&e.data.text===text)&&events.some(e=>e.type==='turn.ended'&&e.seq>events.findLast(e=>e.type==='user.message'&&e.data.text===text).seq))return events;
      await pause(1000)}throw new Error('model turn timeout');
  }
  const A=await session('A'); await api(`/sessions/${A}/approval-mode`,{mode:'allow'},'PATCH');
  await message(A,'合成测试：本对话暗号是蓝色纸鹤。请在默认工作目录写经验.md，内容为暗号是蓝色纸鹤；另写 marker.txt，内容是 ui-5-original。只写这两个文件，简短确认。');
  await page.reload();await page.getByRole('button',{name:'更多操作',exact:false}).first().waitFor();
  const title=(await api('/sessions')).body.sessions.find(s=>s.sessionId===A).title;
  const more=()=>page.getByRole('button',{name:`更多操作 ${title}`,exact:true});
  await more().hover();await more().click();await page.getByRole('menu',{name:'对话操作',exact:true}).waitFor();
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:join(evidence,`desktop-menu-${theme}.png`)});}
  await page.keyboard.press('p');await until(async()=>(await api('/sessions')).body.sessions.find(s=>s.sessionId===A).pinned);
  await more().click();await page.keyboard.press('u');await until(async()=>(await api('/sessions')).body.sessions.find(s=>s.sessionId===A).unread);
  await more().click();await page.getByRole('menuitemcheckbox',{name:'标记为已读',exact:false}).click();await until(async()=>!(await api('/sessions')).body.sessions.find(s=>s.sessionId===A).unread);
  await more().click();await page.keyboard.press('r');const rename=page.getByRole('textbox',{name:'重命名对话',exact:true});await rename.fill('取消改名');await rename.press('Escape');assert.equal((await api('/sessions')).body.sessions.find(s=>s.sessionId===A).title,title);
  await more().click();await page.keyboard.press('r');await rename.fill('合成分叉验收');await rename.press('Enter');await until(async()=>(await api('/sessions')).body.sessions.find(s=>s.sessionId===A).title==='合成分叉验收');
  await page.getByRole('button',{name:'合成分叉验收',exact:true}).click({button:'right'});await page.getByRole('menu',{name:'对话操作',exact:true}).waitFor();await page.keyboard.press('d');await page.getByRole('dialog',{name:'删除对话',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'同时忘掉从这段对话形成的记忆',exact:true}).isChecked(),false);await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'更多操作 合成分叉验收',exact:true}).click();await page.getByRole('menuitem',{name:'移至分组',exact:true}).click();await page.getByRole('menuitem',{name:'新建分组…',exact:true}).click();await page.getByRole('textbox',{name:'新建分组',exact:true}).fill('合成资料');await page.getByRole('button',{name:'保存',exact:true}).click();
  await until(async()=>(await api('/session-groups')).body.groups.length===1);
  await page.getByRole('button',{name:'更多操作 合成分叉验收',exact:true}).click();await page.keyboard.press('f');
  const B=await until(async()=>{const rows=(await api('/sessions')).body.sessions;return rows.find(s=>s.parentSessionId===A)?.sessionId});
  await page.getByText('合成分叉验收（分叉）',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'合成资料',exact:true}).click();assert.equal(await page.getByRole('button',{name:'更多操作 合成分叉验收（分叉）',exact:true}).count(),0);await page.getByRole('button',{name:'合成资料',exact:true}).click();await page.getByRole('button',{name:'更多操作 合成分叉验收（分叉）',exact:true}).waitFor();
  const storeBefore=JSON.parse(readFileSync(join(profile,'personal-access','store.json'),'utf8'));
  const account=Object.values(storeBefore.accounts).find(a=>a.sessions[A]);
  assert.equal(account.sessions[B].conversationId,undefined,'fork does not create a memory/conversation provenance binding');
  const hash=(await import('node:crypto')).createHash('sha256').update(account.sessions[A].ownerId).digest('hex');
  const sourceDir=join(profile,'conversations',hash,A),childDir=join(profile,'conversations',hash,B);
  assert.equal(readFileSync(join(childDir,'marker.txt'),'utf8').trim(),'ui-5-original');assert.ok(readFileSync(join(childDir,'经验.md'),'utf8').includes('蓝色纸鹤'));
  writeFileSync(join(childDir,'marker.txt'),'ui-5-child');assert.equal(readFileSync(join(sourceDir,'marker.txt'),'utf8').trim(),'ui-5-original');
  const continued=await message(B,'只说之前的暗号是什么，不使用工具。');assert.ok(continued.some(e=>e.type==='assistant.message'&&e.seq>0&&e.data.text.includes('蓝色纸鹤')));
  await page.getByRole('button',{name:'更多操作 合成分叉验收（分叉）',exact:true}).click();await page.keyboard.press('a');
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'已归档',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索已归档对话',exact:true}).fill('分叉');await page.getByRole('button',{name:'恢复',exact:true}).waitFor();
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:join(evidence,`desktop-archived-${theme}.png`)});}
  await page.getByRole('button',{name:'恢复',exact:true}).click();await until(async()=>!(await api('/sessions?archived=all')).body.sessions.find(s=>s.sessionId===B).archived);
  await api(`/sessions/${B}/archive`,{});await page.getByRole('button',{name:'已归档',exact:true}).click();await page.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'永久删除',exact:true}).click();await until(async()=>!(await api('/sessions?archived=all')).body.sessions.some(s=>s.sessionId===B));
  const total=(await api('/usage')).body.total;
  writeFileSync(join(evidence,'desktop-verification.json'),JSON.stringify({desktop:true,pin:true,unread:true,renameSaveCancel:true,groups:true,forkContinued:true,workspaceIndependent:true,memoryProvenanceNotCopied:true,archiveRestoreDelete:true,usage:total},null,2));
  if(process.argv.includes('--mobile')){
    const {verifyMobileMenus}=await import('./ui-5-mobile-menu.mjs');
    const options={origin:new URL(page.url()).origin,credentials:{username,password},evidence,sessionId:A,api};
    await verifyMobileMenus(options);await verifyMobileMenus({...options,mumu:true});
  }
  console.log(JSON.stringify({passed:true,usage:total,root}));
} catch(error){if(page){await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-1500));}throw error;} finally {await app?.close().catch(()=>{});}
