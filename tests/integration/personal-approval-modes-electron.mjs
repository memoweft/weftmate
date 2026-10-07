/** Real desktop main, pinned DSH and isolated synthetic account; --qwen runs original scenarios. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { runEvaluation, loadScenarios } from '../../scripts/eval.mjs';

const realModel = process.argv.includes('--qwen');
const repository = resolve(import.meta.dirname, '../..');
const root = join('C:/Temp', `weftmate-m1-2-${randomUUID()}`), profile = join(root, 'profile');
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const evidence = join(repository, 'tests/evidence/m1-2'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`, username = `eval-${randomUUID()}`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(key => [key, async () => ({})]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await preparation.start(), setup = await preparation.issueSetupGrant();
const registration = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'M1-2 Preparation' }) });
assert.equal(registration.status, 201); await preparation.close();
const tasks = new Map(), counters = new Map();
const model = realModel ? null : createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'm1-2-synthetic', object: 'model' }] })); return; }
  if (request.url === '/props') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ default_generation_settings: { n_ctx: 98304 }, total_slots: 1 })); return; }
  let raw = ''; for await (const part of request) raw += part;
  const body = JSON.parse(raw), text = JSON.stringify(body.messages);
  // Background title requests contain task text but no tool schemas. They must
  // not consume this deterministic execution sequence or overwrite its evidence.
  const tag = body.tools?.length ? [...tasks.keys()].findLast(key => text.includes(key)) : undefined;
  if (tag) {
    report.promptModes ??= {};
    report.promptModes[tag] = /WeftMate approval mode: ([a-z-]+)/.exec(text)?.[1];
    report.verbalCheckpointsAdvertised = text.includes('verbal instructions');
    report.systemVerbalGuidance = (body.messages ?? []).some(message => message.role === 'system' && JSON.stringify(message.content).includes('verbal instructions'));
  }
  const n = counters.get(tag) ?? 0; counters.set(tag, n + 1);
  const action = tasks.get(tag)?.[n];
  const names = (body.tools ?? []).map(tool => tool.function?.name);
  let tool = action?.name, args = action?.args;
  if (tool === 'pwsh') args = { description: 'M1-2 synthetic operation', ...args };
  if (tool && names.includes('run_code')) { args = { code: `return await tools.${tool}(${JSON.stringify(args)});`, description: `M1-2 ${tag}` }; tool = 'run_code'; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = choice => response.write(`data: ${JSON.stringify({ id: `m12-${randomUUID()}`, model: body.model, object: 'chat.completion.chunk', choices: [choice] })}\n\n`);
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
    : { role: 'assistant', content: `M1-2 fixture completed ${tag}` }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
});
if (model) await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let application, page, output = '';
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
async function screenshot(name) {
  if (process.argv.includes('--no-screenshots')) return;
  const encoded = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate');
    const handle = win.getNativeWindowHandle(), id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
    const source = sources.find(source => source.id.split(':')[1] === id);
    if (!source || source.thumbnail.isEmpty()) throw new Error('Native desktop capture unavailable');
    return source.thumbnail.toPNG().toString('base64');
  });
  writeFileSync(join(evidence, name), Buffer.from(encoded, 'base64'));
}
async function newConversation(mode = 'auto') {
  const previous = new Set((await api('/sessions')).body.sessions.map(session => session.sessionId));
  const selected = page.waitForResponse(response => {
    const match = /\/sessions\/([^/]+)\/approval-mode$/.exec(response.url());
    return match && !previous.has(match[1]) && response.request().method() === 'GET';
  });
  await page.locator('#new-session').click();
  const selectedResponse = await selected, initial = await selectedResponse.json();
  const label = { auto: '自动', ask: '每次询问', 'accept-edits': '自动接受文件修改', plan: '先出计划', 'allow-all': '全部允许' };
  await until(async () => await page.locator('#approval-mode-trigger').isEnabled() && await page.locator('#approval-mode-label').textContent() === label[initial.mode]);
  if (mode !== 'auto') {
    await page.locator('#approval-mode-trigger').click();
    if (mode === 'allow-all') page.once('dialog', dialog => dialog.accept());
    await page.locator(`#approval-mode-menu [data-mode="${mode}"]`).click();
    await until(async () => await page.locator('#approval-mode-trigger').isEnabled() && await page.locator('#approval-mode-label').textContent() === label[mode]);
    assert.equal(await page.locator('#approval-mode-menu').isVisible(), false);
  }
  return /\/sessions\/([^/]+)\/approval-mode$/.exec(selectedResponse.url())[1];
}
async function send(tag, actions) {
  tasks.set(tag, actions);
  await page.fill('#message-text', tag); await page.locator('#send-message').click();
}
async function completed(tag) { await page.getByText(`M1-2 fixture completed ${tag}`, { exact: true }).first().waitFor(); }
const deleteAction = file => ({ name: 'pwsh', args: { command: `Remove-Item -LiteralPath '${file}'` } });
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [join(repository, 'tests/integration/personal-approval-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], cwd: repository, env, timeout: 90000 });
  application.process().stdout?.on('data', part => { output += String(part); });
  application.process().stderr?.on('data', part => { output += String(part); });
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
  await page.waitForURL('**/personal/v1/ui');
  await page.fill('#login-name', username); await page.fill('#login-password', password); await page.fill('#login-device', 'M1-2 Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  const modelId = realModel ? 'qwen3.8-27b-original' : 'm1-2-synthetic';
  const apiKey = realModel ? process.env.MODEL_SWITCH_UNIFIED_KEY : 'synthetic-no-secret';
  if (!apiKey) throw new Error('MODEL_SWITCH_UNIFIED_KEY must be supplied in process environment');
  const configured = await api('/account/models', { requestId: 'm12-model', name: realModel ? 'M1-2 Qwen' : 'M1-2 Synthetic',
    baseUrl: realModel ? 'http://127.0.0.1:8081/v1' : `http://127.0.0.1:${model.address().port}/v1`, modelId, apiKey });
  assert.equal(configured.status, 202);
  const operation = await until(async () => { const value = await api('/account/models/by-request/m12-model'); return !['pending', 'applying'].includes(value.body.operation?.status) && value.body; });
  assert.equal(operation.operation.status, 'succeeded');
  await page.reload();
  if (realModel) {
    if (process.argv.includes('--warmup')) {
      const sessionId = await newConversation();
      await page.fill('#message-text', '请只回复 M12_READY，不使用工具。'); await page.locator('#send-message').click();
      const readEnd = async () => {
        const result = await api(`/sessions/${sessionId}/events?afterSeq=-1&limit=200`);
        return result.body.events?.find(event => event.type === 'turn.ended');
      };
      let end;
      try { end = await until(readEnd, 90000); }
      catch {
        const status = await api('/status');
        const stopped = await api('/commands', { requestId: 'm12-readiness-stop', kind: 'session.cancel',
          sessionId, targetDeviceId: status.body.hostId });
        assert.equal(stopped.status, 202);
        end = await until(readEnd, 30000);
      }
      report.readinessReason = end.data?.reason?.kind ?? end.data?.reason;
      console.log('Qwen readiness turn:', end.data?.reason?.kind ?? end.data?.reason);
    }
    const out = join(root, 'eval'); mkdirSync(out);
    writeFileSync(join(out, 'credentials.json'), JSON.stringify({ host: new URL(page.url()).origin, username, password, deviceName: 'M1-2 Qwen runner', provisioned: true }), { mode: 0o600 });
    const rejectOnly = process.argv.includes('--reject-only');
    const wanted = process.argv.includes('--only-action-06') || rejectOnly ? ['action-06-delete-approval'] : ['action-06-delete-approval', 'action-01-organize'];
    let scenarioList = (await loadScenarios('eval/scenarios/*.yaml')).filter(s => wanted.includes(s.id));
    if (rejectOnly) {
      const source = scenarioList[0];
      // Supplemental single-turn behavior check. The original scenario and its 180s
      // total deadline remain intact; this result never replaces the original score.
      scenarioList = [{ ...source, id: 'm1-2-delete-rejection-supplement', title: '独立删除拒绝验证',
        turns: [{ user: source.turns[0].user.replace('过期草稿.txt', '还要保留.txt'), approvals: [{ outcome: 'rejected' }] }],
        checks: source.checks.filter(check => check.turn === 2).map(check => ({ ...check, turn: 1 })) }];
    }
    scenarioList.sort((a, b) => a.id === 'action-06-delete-approval' ? -1 : 1);
    const evaluation = await runEvaluation({ host: new URL(page.url()).origin, out, model: 'M1-2 Qwen', scenarioList });
    report.scenarios = evaluation.results.map(result => ({ id: result.id, status: result.status, durationMs: result.durationMs, checks: result.checks, reason: result.reason }));
    rmSync(join(out, 'credentials.json'), { force: true });
    console.log(JSON.stringify(report.scenarios));
  } else {
    await newConversation();
    await page.locator('#approval-mode-trigger').click(); await screenshot('01-mode-menu.png');
    await page.keyboard.press('2'); await until(() => page.locator('#approval-mode-trigger').isEnabled());
    assert.equal(await page.locator('#approval-mode-label').textContent(), '每次询问'); report.numericShortcut = true;
    await page.locator('#approval-mode-trigger').click(); await page.keyboard.press('1'); await until(() => page.locator('#approval-mode-trigger').isEnabled());
    const once = join(root, 'once.txt'), denied = join(root, 'denied.txt'); writeFileSync(once, 'synthetic'); writeFileSync(denied, 'keep');
    await send('M12_AUTO_ONCE', [deleteAction(once)]);
    await page.getByRole('button', { name: '允许一次', exact: true }).first().waitFor(); assert.ok(existsSync(once));
    await screenshot('02-delete-approval.png'); await page.getByRole('button', { name: '允许一次', exact: true }).first().click();
    await completed('M12_AUTO_ONCE'); assert.equal(existsSync(once), false);
    await send('M12_AUTO_DENY', [deleteAction(denied)]); await page.getByRole('button', { name: '拒绝', exact: true }).first().click();
    await completed('M12_AUTO_DENY'); assert.ok(existsSync(denied)); await screenshot('03-rejected.png'); report.approvedAndRejected = true;
    const a = join(root, 'category-a.txt'), b = join(root, 'category-b.txt'); writeFileSync(a, 'synthetic'); writeFileSync(b, 'synthetic');
    await send('M12_CATEGORY', [deleteAction(a), deleteAction(b)]);
    await page.getByRole('button', { name: '总是允许此类', exact: true }).first().click();
    await completed('M12_CATEGORY'); assert.equal(existsSync(a) || existsSync(b), false); report.alwaysThisCategory = true;
    await newConversation('ask'); await send('M12_ASK', [{ name: 'pwsh', args: { command: "Write-Output 'synthetic read'" } }]);
    await page.getByRole('button', { name: '允许一次', exact: true }).first().click(); await completed('M12_ASK'); report.ask = true;
    const edit = join(root, 'edit.txt'); writeFileSync(edit, 'before');
    await newConversation('accept-edits'); await send('M12_EDIT', [{ name: 'read', args: { file_path: edit } }, { name: 'write', args: { file_path: edit, content: 'after' } }]);
    await completed('M12_EDIT'); assert.equal(readFileSync(edit, 'utf8'), 'after'); report.acceptEdits = true;
    await newConversation('plan'); const planned = join(root, 'planned.txt');
    await send('M12_PLAN', [{ name: 'exit_plan_mode', args: { plan: '# 合成执行计划\n\n1. 创建测试文件。\n2. 核对结果。' } }, { name: 'write', args: { file_path: planned, content: 'planned' } }]);
    await page.getByText('确认执行计划', { exact: true }).waitFor(); assert.equal(existsSync(planned), false);
    await screenshot('04-plan.png'); await page.locator('.conversation-plan .question-option input:enabled').first().check();
    await page.getByRole('button', { name: /提交回答/ }).first().click(); await completed('M12_PLAN'); assert.ok(existsSync(planned)); report.plan = true;
    const declinedPlan = join(root, 'declined-plan.txt');
    await send('M12_PLAN_REJECT', [{ name: 'exit_plan_mode', args: { plan: '# 第二项任务的计划\n\n创建另一份测试文件。' } }, { name: 'write', args: { file_path: declinedPlan, content: 'must not execute' } }]);
    await page.getByText('确认执行计划', { exact: true }).waitFor();
    await page.locator('.conversation-plan .question-option input:enabled').nth(1).check();
    await page.getByRole('button', { name: /提交回答/ }).first().click(); await completed('M12_PLAN_REJECT');
    assert.equal(existsSync(declinedPlan), false); report.nextTaskPlanAndRejection = true;
    const all = join(root, 'all.txt'); writeFileSync(all, 'synthetic');
    await newConversation('allow-all'); await send('M12_ALL', [deleteAction(all)]); await completed('M12_ALL'); assert.equal(existsSync(all), false); report.allowAll = true;
    await page.locator('#account-menu-trigger').click(); await page.locator('#rail-account').click();
    await until(() => page.locator('#default-approval-mode').isEnabled());
    await page.locator('#default-approval-mode').selectOption('accept-edits');
    await page.getByText('已保存，下次新建对话时生效。', { exact: true }).waitFor();
    await screenshot('06-settings.png'); await page.locator('#account-back').click();
    await page.reload(); await newConversation(); assert.equal(await page.locator('#approval-mode-label').textContent(), '自动接受文件修改'); report.defaultAndReload = true;
    await screenshot('05-default-mode.png');
    assert.equal(report.promptModes.M12_ASK, 'ask'); assert.equal(report.promptModes.M12_EDIT, 'accept-edits');
    assert.equal(report.promptModes.M12_PLAN, 'plan'); assert.equal(report.promptModes.M12_ALL, 'allow-all');
    assert.equal(report.verbalCheckpointsAdvertised, true); assert.equal(report.systemVerbalGuidance, true);
  }
  writeFileSync(join(evidence, realModel ? process.argv.includes('--reject-only') ? 'qwen-reject-verification.json' : 'qwen-verification.json' : 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`M1-2 verification completed; isolated diagnostics: ${root}`);
  if (realModel && report.scenarios.some(result => result.status === 'failed')) process.exitCode = 1;
} catch (error) {
  if (page && !page.isClosed()) {
    const sessions = (await api('/sessions')).body.sessions ?? [];
    for (const session of sessions) {
      const events = (await api(`/sessions/${session.sessionId}/events?afterSeq=-1&limit=200`)).body.events ?? [];
      const details = [];
      for (const event of events.filter(event => event.type === 'step.completed')) details.push((await api(`/sessions/${session.sessionId}/events/${event.seq}/detail`)).body);
      writeFileSync(join(root, `${session.sessionId}.json`), JSON.stringify({ events, details }, null, 2));
    }
  }
  writeFileSync(join(root, 'failure.log'), output); console.error(`M1-2 isolated failure: ${root}`); throw error;
} finally {
  await application?.close().catch(() => {}); if (model) await new Promise(resolve => model.close(resolve));
  writeFileSync(join(root, 'host.log'), output);
  for (const file of [join(root, 'eval/credentials.json'), join(root, 'setup.json'), join(profile, 'dsh-home/config-secrets.bin')]) rmSync(file, { force: true });
}
