/** macOS source desktop acceptance. Synthetic model; no real login keychain. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir, uptime } from 'node:os';
import { resolve, join } from 'node:path';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

assert.equal(process.platform, 'darwin');
const repository = resolve(import.meta.dirname, '../..'), out = join(repository, 'tests/evidence/m3-3');
await mkdir(out, { recursive: true });
const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-m3-3-'))), profile = join(root, 'profile'), project = join(root, 'synthetic-project');
await mkdir(profile); await mkdir(project);
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const input = '# Synthetic input\nM3-3 synthetic file value: 42.\n', written = '# Synthetic output\nRead value: 42.\n';
await writeFile(join(project, 'brief.md'), input);
const vaultKey = randomBytes(32).toString('base64'), modelKey = randomBytes(24).toString('hex');
const report = { sourceDesktop: true, realDSH: true, account: 'synthetic local owner', computerName: 'synthetic-mac',
  credentialStorage: 'test-only injected AES-256-GCM; production safeStorage remains unchanged',
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
  const names = (body.tools || []).map(t => t.function?.name), text = JSON.stringify(body.messages);
  let tool, content = 'M3-3 流式回复成功：这台 Mac 可以独立聊天。';
  if (names.length && text.includes('M3-3_READ_WRITE')) {
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
  Object.assign(env, { WEFTMATE_TEST_HOST_NAME: 'synthetic-mac', WEFTMATE_MEMOWEFT_ENABLED: '0', M3_3_TEST_VAULT_KEY: vaultKey });
  report.electronLaunches++;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository, env,
    args: [join(repository, 'tests/helpers/m3-3-electron-bootstrap.mjs'), '--disable-gpu', '--disable-gpu-compositing', '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], timeout: 90000 });
  const capture = bytes => { log = (log + String(bytes)).slice(-100000); };
  app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.waitForURL('**/personal/v1/ui*', { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 860));
  await until(async () => (await api('/auth/me')).body.local === true, 'native local owner session');
}
try {
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
  phase = 'main-chat'; await page.locator('#message-text').fill('M3-3_HELLO 请向我问好。');
  await page.locator('#message-text').press('Enter');
  await page.getByText('M3-3 流式回复成功：这台 Mac 可以独立聊天。', { exact: true }).first().waitFor({ timeout: 90000 });
  await shots('main-chat'); report.checks.push('main chat received two separate synthetic SSE content chunks');
  phase = 'project';
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
    if (approvals === 1) await shots('between-file-steps');
    await approve.click(); approvals++;
  }
  await until(async () => (await readFile(join(project, 'result.md'), 'utf8').catch(() => '')) === written, 'physical project output');
  await until(() => report.readReachedModel, 'read content returned to real model adapter');
  report.approvals = approvals; report.outputSha256 = createHash('sha256').update(written).digest('hex');
  report.checks.push('trusted project registration, native read/write tools, visible approvals, physical file bytes and SHA-256');
  await shots('project-output');
  const ciphertext = await readFile(join(profile, 'weftmate-model.enc'));
  assert.ok(!ciphertext.includes(Buffer.from(modelKey)));
  const settings = await readFile(join(profile, 'weftmate-settings.json'));
  assert.ok(!settings.includes(Buffer.from(modelKey)));
  report.checks.push('model key absent from ciphertext/plain settings; injected store does not call system keychain');
  phase = 'restart'; await app.close(); app = null; await launch();
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  assert.ok((await api('/models')).body.models.some(m => m.name === '合成 Mac 模型' && m.configured));
  const main = (await api('/chats/main')).body.chat;
  const events = (await api('/sessions/' + main.activeSessionId + '/events?limit=200')).body.events;
  assert.ok(events.some(e => e.type === 'assistant.message' && e.data?.text?.includes('M3-3 流式回复成功')));
  assert.ok((await api('/projects')).body.projects.some(p => p.projectId === projectId));
  await shots('restart'); report.checks.push('graceful quit/reopen retains main conversation, model credential/configuration and project');
  report.completed = true;
} catch (error) {
  report.completed = false; report.phase = phase;
  report.failure = String(error.stack).replaceAll(root, '<synthetic-temp>').replace(/\/Users\/[^/\s]+/g, '/Users/<user>');
  if (page && !page.isClosed()) await shot('failure-electron.png').catch(() => {});
  process.exitCode = 1;
} finally {
  await app?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  report.newGpuOrWindowServerReports = (await diagnostics()).filter(x => !before.has(x)).length;
  report.machineRestarted = uptime() < uptimeBefore;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(out, 'desktop.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(repository, '.local/m3-3/desktop-runtime.log'), log.replaceAll(modelKey, '[private]').replaceAll(vaultKey, '[private]').replaceAll(root, '<synthetic-temp>'));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ completed: report.completed, phase: report.phase, launches: report.electronLaunches, newReports: report.newGpuOrWindowServerReports }));
}
