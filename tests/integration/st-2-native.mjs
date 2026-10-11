// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real desktop main, pinned DSH and isolated synthetic account. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {redactEvidenceText,systemCommitMemory} from '../helpers/process-evidence.mjs';
import {managedMkdtempSync,managedTempRoot} from '../helpers/managed-temp.mjs';

const realModel = false;
const repository = resolve(import.meta.dirname, '../..');
const root = managedMkdtempSync(join(managedTempRoot(),'weftmate-st2-native-')), profile = join(root, 'profile');
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const evidence = join(repository, 'tests/evidence/st-2'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`, username = `eval-${randomUUID()}`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(key => [key, async () => ({})]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await preparation.start(), setup = await preparation.issueSetupGrant();
const registration = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'M1-2 Preparation' }) });
assert.equal(registration.status, 201); await preparation.close();
const tasks = new Map(), counters = new Map();
const model = realModel ? null : createServer(async (request, response) => {
  if (new URL(request.url,'http://synthetic.invalid').pathname === '/v1/models') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'm1-2-synthetic', object: 'model' }] })); return; }
  if (['/props','/v1/props'].includes(new URL(request.url,'http://synthetic.invalid').pathname)) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ default_generation_settings: { n_ctx: 98304 }, total_slots: 1 })); return; }
  let raw = ''; for await (const part of request) raw += part;
  if (!raw.trim()) { response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:[],default_generation_settings:{n_ctx:98304},total_slots:1}));return; }
  const body = JSON.parse(raw), text = JSON.stringify(body.messages);
  // Background title requests contain task text but no tool schemas. They must
  // not consume this deterministic execution sequence or overwrite its evidence.
  const tag = body.tools?.length ? [...tasks.keys()].findLast(key => text.includes(key)) : undefined;
  if (tag) {
    if (tag === '合成禁止命令' && text.includes('WeftMate permission rule forbids')) report.modelSawBlockedReason=true;
  }
  const n = counters.get(tag) ?? 0; counters.set(tag, n + 1);
  const action = tasks.get(tag)?.[n];
  const names = (body.tools ?? []).map(tool => tool.function?.name);
  let tool = action?.name, args = action?.args;
  if (tool === 'pwsh') args = { description: '合成验收操作', ...args };
  if (tool && names.includes('run_code')) { args = { code: `return await tools.${tool}(${JSON.stringify(args)});`, description: tag }; tool = 'run_code'; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = choice => response.write(`data: ${JSON.stringify({ id: `m12-${randomUUID()}`, model: body.model, object: 'chat.completion.chunk', choices: [choice] })}\n\n`);
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
    : { role: 'assistant', content: tag === '合成禁止命令' ? '这个命令已被禁止，未执行。我可以改用读取文件的办法。' : `已处理：${tag}` }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
});
if (model) await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let application, nativeProcess, page, output = '';
const report = { realElectron: true, realDsh: true, isolatedAccount: true, realModel, scenarios: [] };
async function until(check, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('M1-2 condition timed out');
}
async function api(path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function newConversation(project=null) {
  const status=(await api('/status')).body;assert.ok(status.hostId,JSON.stringify(status));
  const accepted=await api(project?`/projects/${project.projectId}/sessions`:'/commands',project?{requestId:randomUUID(),modelProfileId}: {requestId:randomUUID(),kind:'session.create',targetDeviceId:status.hostId,modelProfileId});
  assert.equal(accepted.status,202,JSON.stringify(accepted.body));
  const row=await until(async()=>{const command=(await api('/commands/'+accepted.body.command.commandId)).body.command;return command.state==='accepted_by_dsh'&&command;});
  await page.reload();await page.waitForFunction(()=>globalThis.st2Entered===true);await page.locator(`[data-session-id="${row.sessionId}"] > button:first-child`).first().click();await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();return row.sessionId;
}
let modelProfileId;
async function send(tag, actions) {
  tasks.set(tag, actions);
  await page.fill('#message-text', tag); await page.locator('#send-message').click();
}
async function completed(tag) { await page.getByText(tag === '合成禁止命令' ? '这个命令已被禁止，未执行。我可以改用读取文件的办法。' : `已处理：${tag}`, { exact: true }).first().waitFor(); }

async function select(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
async function settings(category){await page.evaluate(category=>WeftSettingsNavigation.open(category),category);await page.getByRole('combobox',{name:category==='approvals'?'写文件':'操作类型',exact:true}).waitFor();}
try {
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:[join(repository,'tests/integration/st-2-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
  nativeProcess=application.process();
  for(const stream of [nativeProcess.stdout,nativeProcess.stderr])stream?.on('data',part=>{output=(output+part).slice(-100000);});
  page=await application.firstWindow({timeout:90000});page.setDefaultTimeout(45000);await page.waitForURL('**/personal/v1/ui');await page.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=(...args)=>{const core=create(...args),enter=core.enterAssistant;globalThis.st2Core=core;core.enterAssistant=async(...values)=>{globalThis.st2Entered=false;try{return await enter(...values);}finally{globalThis.st2Entered=true;}};return core;};}});});await localUiSession(page,{username,password},'ST-2 synthetic native',{interceptLegacyStatus:false});
  await page.waitForFunction(()=>globalThis.st2Entered===true);
  const configured=await api('/account/models',{requestId:'st2-model',name:'合成工具模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'m1-2-synthetic',apiKey:'synthetic-no-secret'});assert.equal(configured.status,202,JSON.stringify(configured.body));
  const operation=await until(async()=>{const result=(await api('/account/models/by-request/st2-model')).body.operation;return result.status==='succeeded'&&result;});modelProfileId=(await api('/models')).body.models.find(row=>row.accountModelId===operation.accountModelId).id;
  assert.ok(modelProfileId,JSON.stringify(operation));// Session creation below waits for an actual accepted_by_dsh receipt; diagnostics may time out independently.
  await page.reload();await page.waitForFunction(()=>globalThis.st2Entered===true);
  await settings('approvals');await select('写文件','总是允许');await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const writeFile=join(root,'allowed.txt');writeFileSync(writeFile,'original synthetic content');const autoSession=await newConversation();
  await send('合成写入文件',[{name:'read',args:{file_path:writeFile}},{name:'write',args:{file_path:writeFile,content:'ST-2 synthetic file'}}]);await completed('合成写入文件');assert.equal(readFileSync(writeFile,'utf8'),'ST-2 synthetic file');
  assert.equal((await api(`/sessions/${autoSession}/approvals`)).body.approvals.length,0);
  assert.ok((await api('/execution-records?type=write')).body.items.some(row=>row.sessionId===autoSession&&row.result==='automatic'));report.scenarios.push('write allowed without approval and recorded automatic');
  await settings('approvals');await select('运行命令','禁止');await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const forbiddenFile=join(root,'forbidden.txt'),blockedSession=await newConversation();
  await send('合成禁止命令',[{name:'pwsh',args:{command:`Set-Content -LiteralPath '${forbiddenFile}' -Value 'should never execute'`}}]);await completed('合成禁止命令');assert.equal(existsSync(forbiddenFile),false);
  assert.ok((await api('/execution-records?type=command')).body.items.some(row=>row.sessionId===blockedSession&&row.result==='blocked'));
  assert.equal(report.modelSawBlockedReason,true,'the real runtime must explain the denied operation to the model');report.scenarios.push('command denied before any side effect, model received alternative guidance, recorded blocked');
  const projectRoot=join(root,'synthetic-project');mkdirSync(projectRoot);await application.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},projectRoot);await page.evaluate(()=>weftmateDesktop.pickProjectFolder());const projectResult=await page.evaluate(rootPath=>weftmateDesktop.createFolderProject({requestId:crypto.randomUUID(),name:'合成项目',rootPath,permission:'write',instructions:'仅用于合成验收。'}),projectRoot);let project=projectResult.project;
  await page.reload();await page.waitForFunction(()=>globalThis.st2Entered===true);await page.evaluate(async()=>{await st2Core.refreshSessions();st2Core.effects?.renderSessions?.();});await page.locator('.sidebar-project-heading').first().hover();await page.getByRole('button',{name:'项目菜单 合成项目',exact:true}).click();for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`native-${theme}-project-menu.png`)});}await page.getByRole('menuitem',{name:'项目设置',exact:true}).click();
  await page.getByRole('dialog',{name:'项目设置',exact:true}).getByRole('combobox',{name:'运行命令',exact:true}).waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`native-${theme}-project-settings.png`)});}await page.getByRole('combobox',{name:'运行命令',exact:true}).click();for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`native-${theme}-project-rule-menu.png`)});}await page.getByRole('option',{name:'总是允许',exact:true}).click();await select('写文件','总是允许');await page.getByRole('dialog',{name:'项目设置',exact:true}).locator('.dialog-body').evaluate(body=>{const row=body.querySelector('[aria-label="写文件"]').closest('.settings-row');body.scrollTop+=row.getBoundingClientRect().top-body.getBoundingClientRect().top-24;});
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`native-${theme}-project-overrides.png`)});}
  await page.getByRole('dialog',{name:'项目设置',exact:true}).getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog',{name:'项目设置',exact:true}).waitFor({state:'hidden'});
  project=(await api('/projects')).body.projects.find(row=>row.projectId===project.projectId);assert.deepEqual(project.permissionRules,{command:'allow',write:'allow'});
  const projectSession=await newConversation(project);await send('合成项目写入',[{name:'pwsh',args:{command:"Set-Content -LiteralPath project-note.txt -Value 'project override'"}}]);await completed('合成项目写入');assert.equal(readFileSync(join(projectRoot,'project-note.txt'),'utf8').trim(),'project override');report.scenarios.push('project allow overrides global command deny');
  await api('/settings/approvals',{rules:{write:'ask'}},'PATCH');const shortcutSession=await newConversation();const shortcutFile=join(root,'shortcut.txt');
  await send('合成审批快捷操作',[{name:'write',args:{file_path:shortcutFile,content:'shortcut works'}}]);await page.getByRole('button',{name:'以后这类都允许',exact:true}).waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`native-${theme}-approval-shortcut.png`)});}
  await page.getByRole('button',{name:'以后这类都允许',exact:true}).click();await completed('合成审批快捷操作');assert.equal((await api('/settings/approvals')).body.rules.write,'allow');assert.equal(readFileSync(shortcutFile,'utf8'),'shortcut works');report.scenarios.push('native approval shortcut writes global rule and executes exact request');
  await send('合成再次写入',[{name:'write',args:{file_path:join(root,'after-shortcut.txt'),content:'no approval'}}]);await completed('合成再次写入');assert.equal((await api(`/sessions/${shortcutSession}/approvals`)).body.approvals.length,1);
  await settings('executionRecords');await page.getByText('被禁止',{exact:true}).first().waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`native-${theme}-records.png`)});}
  report.realModelRequests=0;report.syntheticModelRequests=[...counters.values()].reduce((sum,n)=>sum+n,0);writeFileSync(join(evidence,'native-checks.json'),JSON.stringify(report,null,2)+'\n');console.log('ST2 native passed',report.scenarios);
}catch(error){console.log(redactEvidenceText(output,[root]).slice(-5000));console.log('Last stage and memory',JSON.stringify({exitCode:nativeProcess?.exitCode,memory:systemCommitMemory()}));if(page)await page.screenshot({path:join(evidence,'native-failure.png')}).catch(()=>{});throw error;}
finally{await application?.close();model?.closeAllConnections();if(model)await new Promise(r=>model.close(r));rmSync(root,{recursive:true,force:true});}
