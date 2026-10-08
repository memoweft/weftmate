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
const root = join('C:/Temp', `weftmate-m2-4-${modelName}-${randomUUID()}`), profile = join(root, 'profile'), out = join(root, 'eval');
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
  await page.fill('#login-name', username); await page.fill('#login-password', password); await page.fill('#login-device', 'Long task Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  const requestId = `long-task-model-${modelName}`;
  assert.equal((await api('/account/models', { requestId, name: modelName,
    baseUrl: 'https://api.xiaomimimo.com/v1',
    modelId, apiKey: key })).status, 202);
  const operation = await until(async () => { const value = await api(`/account/models/by-request/${requestId}`); return !['pending', 'applying'].includes(value.body.operation?.status) && value.body.operation; });
  assert.equal(operation.status, 'succeeded');
  const selected = (await api('/models')).body.models.find(model => model.name === modelName); assert.ok(selected?.configured);
  assert.equal((await api('/settings/models', { backgroundModelProfileId: selected.id }, 'PATCH')).status, 200);

  const evidence = join(repository, 'tests/evidence/m2-4'); mkdirSync(evidence,{recursive:true});
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
      if(events?.some(e=>e.type==='user.message'&&e.data.text===text)&&events.filter(e=>e.type==='turn.ended').length>=prior)return events;
      await pause(1000)}throw new Error('model turn timeout');
  }
  const A=await session('A');
  await api(`/sessions/${A}/approval-mode`,{mode:'allow'},'PATCH');
  const first=await message(A,'请在本对话默认工作目录创建 triangle.py：用 Python 打印 1 到 n 的三角数，n 从命令行参数读取。运行 n=8，检查输出 36。写经验.md 简短记录脚本路径与使用命令。只在默认工作目录写文件，不要询问。');
  console.log('A script turn completed');
  const B=await session('B');await message(B,'只回复：这是另一段独立对话。');
  const returned=await message(A,'用这段对话已有的方法计算 n=12 的三角数。复用已有脚本，不要重写脚本。');
  const scriptEvents=returned.filter(e=>e.type==='step.started' && e.seq > (first.at(-1)?.seq??-1));assert.ok(scriptEvents.length);const details=await Promise.all(scriptEvents.map(e=>api(`/sessions/${A}/events/${e.seq}/detail`)));assert.ok(details.some(d=>d.body.text?.includes('triangle.py')),'tool command reuses the existing script');
  assert.ok(JSON.stringify(returned).includes('78'));
  console.log('A reuse completed');
  await page.evaluate(id=>globalThis.WeftUiCore&&fetch('/personal/v1/auth/me').then(r=>r.json()),A);
  await page.getByRole('button',{name:'更多操作',exact:false}).first().click();await page.getByRole('button',{name:'归档对话',exact:true}).click();
  await page.getByRole('button',{name:'已归档',exact:true}).click();
  await page.screenshot({path:join(evidence,'desktop-archived.png')});
  await page.getByRole('button',{name:'更多操作',exact:false}).first().click();await page.getByRole('button',{name:'恢复对话',exact:true}).click();
  await page.getByRole('button',{name:'返回最近对话',exact:true}).click();
  assert.equal((await api(`/sessions/${A}/archive`,{})).status,200);
  const rejected=await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:(await api('/status')).body.hostId,sessionId:A,text:'不可发送'});assert.equal(rejected.status,409);
  await api(`/sessions/${A}/unarchive`,{});
  await page.getByRole('button',{name:'更多操作',exact:false}).first().click();await page.getByRole('button',{name:'删除对话',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'同时忘掉从这段对话形成的记忆'}).isChecked(),false);
  await page.screenshot({path:join(evidence,'desktop-delete-confirm.png')});await page.getByRole('button',{name:'取消',exact:true}).click();
  const deletion=await api(`/sessions/${A}`,{forgetMemories:false},'DELETE');assert.equal(deletion.status,200,JSON.stringify(deletion.body));
  assert.ok(!(await api('/sessions?archived=all')).body.sessions.some(s=>s.sessionId===A));
  console.log('Default delete passed');
  console.log('Memory status',JSON.stringify((await api('/memory/status')).body));
  const D=await session('retain');await message(D,'记住我的长期早餐偏好：我喜欢蒸紫薯。请记下来，只简短确认。');
  await until(async()=>{const m=(await api('/memory/items?kind=cognition')).body;return m.items?.some(i=>i.text.includes('紫薯'))});
  assert.equal((await api(`/sessions/${D}`,{},'DELETE')).status,200);assert.ok((await api('/memory/items?kind=cognition')).body.items.some(i=>i.text.includes('紫薯')));
  console.log('Default deletion retains formed memory');
  const C=await session('forget');
  await message(C,'记住我的长期偏好：我喝燕麦咖啡时一直喜欢加一小撮肉桂粉。请记下来，只简短确认。');
  const memories=await until(async()=>{const m=(await api('/memory/items?kind=cognition')).body;return m.items?.some(i=>i.text.includes('肉桂'))&&m;});
  console.log('Memory formed');
  assert.equal((await api(`/sessions/${B}`,{},'DELETE')).status,200);
  await page.reload();await page.getByRole('button',{name:'更多操作',exact:false}).first().click();await page.getByRole('button',{name:'删除对话',exact:true}).click();
  await page.getByRole('checkbox',{name:'同时忘掉从这段对话形成的记忆'}).check();await page.screenshot({path:join(evidence,'desktop-forget-confirm.png')});
  const forgetResponse=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname.endsWith(`/sessions/${C}`));
  await page.getByRole('button',{name:'永久删除',exact:true}).click();const response=await forgetResponse;const forgetResult={status:response.status(),body:await response.json()};
  await page.getByRole('dialog',{name:'删除对话',exact:true}).waitFor({state:'hidden'});
  assert.equal(forgetResult.status,200,JSON.stringify(forgetResult.body));
  assert.ok(forgetResult.body.forgottenEvidenceCount>0);assert.ok(!(await api('/memory/items?kind=cognition')).body.items.some(i=>i.text.includes('肉桂')));
  console.log('True forget passed');
  const summary={desktop:true,scriptCreated:JSON.stringify(first).includes('triangle.py'),reusedScript:JSON.stringify(returned).includes('triangle.py'),archiveRestore:true,defaultDelete:true,formedMemoryRetained:true,trueForget:true};
  const native=readFileSync(join(root,'native-events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const usage=native.filter(e=>e.type==='assistant/message').map(e=>e.data.usage).filter(Boolean);
  summary.usage=usage;writeFileSync(join(evidence,'verification.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
} finally {
  await app?.close().catch(()=>{});
  const files=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(row=>row.isDirectory()?files(join(dir,row.name)):[join(dir,row.name)]);
  const remaining=existsSync(join(profile,'conversations'))?files(join(profile,'conversations')):[];assert.ok(!remaining.some(file=>file.endsWith('triangle.py')||file.endsWith('经验.md')),'deleted workspace stays deleted after shutdown');
  console.log(`Isolated result: ${root}`);
}
