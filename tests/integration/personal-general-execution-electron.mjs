/** Isolated real DSH tool execution; all model responses come from an owned loopback fixture. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { ensurePrivateFile } from '../../src/private-host-storage.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_GENERAL_EXECUTION_E2E !== '1') {
  throw new Error('Set WEFTMATE_GENERAL_EXECUTION_E2E=1 on Windows for this isolated fixture.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const { unzipSync } = createRequire(join(repository, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-host-apiproxy/package.json'))('fflate');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-general-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile'); mkdirSync(profile);
const workspace = join(profile, 'workspace'); mkdirSync(workspace);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'), JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }), { flag: 'wx' });
const outputFile = join(workspace, 'generated.txt'), pidFile = join(workspace, 'foreground.pid');
const observationFolder = join(workspace, 'general-observation-' + randomUUID().slice(0, 8)); mkdirSync(observationFolder);
const bgPidFiles = [join(workspace, 'background-a.pid'), join(workspace, 'background-b.pid')];
const deniedFile = join(workspace, 'denied-script.txt'), cancelledFile = join(workspace, 'cancelled-script.txt'), replacedFile = join(workspace, 'replaced-script.txt');
const loginFile = join(profile, 'general-login.json');
const shellQuote = value => "'" + value.replaceAll("'", "''") + "'";
const requiredTools = ['pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_list', 'job_kill', 'weftmod', 'weftmod_script'];
const report = { fixtureRoot: root, paidModelRequests: 0, advertisedTools: [], workflowCalls: 0,
  stopCalls: 0, executionSteps: [], foregroundStopped: false, backgroundStopped: false, otherReceiptJobPreserved: false,
  preservedAcrossRestart: false, desktopObservationRead: false, scriptReadVerified: false, approvalRoundTrips: 0,
  approvalAnswers: [], nativeApprovalDecisions: [], nativeArtifactReads: [], nativeArtifactExports: [], nativeArtifactPolls: 0, rejectedApprovalPreventedWrite: false, cancelledApprovalPreventedWrite: false,
  replacedApprovalPreventedWrite: false, hostPids: [], hostOrigins: [], hostExits: [], cleanExit: false, privateLoginFile: loginFile };
report.modelRequestPhases = [];
let lifecyclePhase = 'initializing', launchIteration = 0;
const modelInflight = new Set();
let lastModelAcceptAt = 0;
const fingerprintPaths = ['src/dsh-web-runtime.ts', 'src/main.mjs', 'src/personal-access/index.mjs', 'src/personal-access-backend.mjs',
  'src/plugins/weftmate-personal-desktop.mjs', 'src/plugins/weftmate-personal-desktop-preset.mjs',
  'src/plugins/weftmate-personal-task-control.mjs', 'tests/integration/personal-general-execution-electron.mjs'];
const fingerprint = () => Object.fromEntries(fingerprintPaths.map(path => [path, createHash('sha256').update(readFileSync(join(repository, path))).digest('hex')]));
report.candidateFingerprint = fingerprint();
const bgCalls = new Map();
const approvalCalls = new Map();
function sse(response, model, tool, args) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = choices => response.write(`data: ${JSON.stringify({ id: randomUUID(), object: 'chat.completion.chunk', model,
    created: Math.floor(Date.now() / 1000), choices: [choices] })}\n\n`);
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + randomUUID(),
    type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: '工具流程已结束，业务目标核验仍以实际观察为准。' }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
}
const modelServer = createServer(async (request, response) => {
  lastModelAcceptAt = Date.now();
  const accepted = { at: new Date(lastModelAcceptAt).toISOString(), phase: lifecyclePhase, hostRun: launchIteration };
  modelInflight.add(accepted);
  const settle = () => { accepted.settledAt = new Date().toISOString(); modelInflight.delete(accepted); };
  response.once('finish', settle); response.once('close', settle);
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] })); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 512 * 1024) { response.destroy(); return; } }
  const body = JSON.parse(raw), names = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name);
  if (!names.length) { sse(response, body.model); return; } // isolated title generation
  report.advertisedTools = names;
  report.catalogMode = names.includes('run_code') && !names.includes('pwsh') ? 'code' : 'native';
  report.schemaMissing = requiredTools.filter(tool => !names.includes(tool) && !raw.includes(tool));
  if (report.schemaMissing.length) { sse(response, body.model); return; }
  assert.equal(names.includes('personal_open_notepad'), false);
  const invoke = (name, args) => report.catalogMode === 'code'
    ? sse(response, body.model, 'run_code', { code: `return await tools.${name}(${JSON.stringify(args)});`, description: 'Execute the existing generic tool' })
    : sse(response, body.model, name, args);
  const content = [...body.messages].reverse().filter(message => message.role === 'user').map(message =>
    typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join(''))
    .find(text => /GENERAL_(?:WORKFLOW|STOP|BACKGROUND|APPROVAL)/.test(text)) ?? '';
  if (content.includes('GENERAL_APPROVAL')) {
    const mode = content.includes('REJECT') ? 'reject' : content.includes('CANCEL') ? 'cancel' : 'replace';
    const count = (approvalCalls.get(mode) ?? 0) + 1; approvalCalls.set(mode, count);
    Object.assign(accepted, { kind: mode, count, bodyCompleteAt: new Date().toISOString(), bodyCompletePhase: lifecyclePhase });
    report.modelRequestPhases.push(accepted);
    if (count === 1) invoke('weftmod_script', { action: 'run', description: `Owned ${mode} approval fixture`,
      code: 'return await tools.write({file_path: params.path, content: "this file must never be written"});',
      params: { path: mode === 'reject' ? deniedFile : mode === 'cancel' ? cancelledFile : replacedFile } });
    else sse(response, body.model);
    return;
  }
  if (content.includes('GENERAL_BACKGROUND')) {
    const index = content.includes('GENERAL_BACKGROUND_OTHER') ? 1 : 0, count = (bgCalls.get(index) ?? 0) + 1;
    bgCalls.set(index, count);
    if (count === 1) invoke('pwsh', { description: 'Run one owned native background job', command:
      `Set-Content -LiteralPath ${shellQuote(bgPidFiles[index])} -Value $PID; Start-Sleep -Seconds 50`,
      workdir: workspace, run_in_background: true, timeoutMs: 60000 });
    else sse(response, body.model);
    return;
  }
  if (content.includes('GENERAL_STOP')) {
    report.stopCalls++;
    if (report.stopCalls === 1) invoke('pwsh', { description: 'Run an owned stoppable foreground process',
      command: `Set-Content -LiteralPath ${shellQuote(pidFile)} -Value $PID; Start-Sleep -Seconds 40`, workdir: workspace, timeoutMs: 60000 });
    else sse(response, body.model);
    return;
  }
  report.workflowCalls++;
  if (report.workflowCalls === 1) invoke('pwsh', { description: 'Discover the environment and create a fixture file',
    command: `Get-Location; Set-Content -LiteralPath ${shellQuote(outputFile)} -Value 'general execution 42' -Encoding utf8; Get-Item -LiteralPath ${shellQuote(outputFile)} | Select-Object Length`, workdir: workspace, timeoutMs: 10000 });
  else if (report.workflowCalls === 2) invoke('read', { file_path: outputFile });
  else if (report.workflowCalls === 3) invoke('weftmod', { action: 'desktop', desktop: { action: 'windows', title: observationFolder.split(sep).at(-1) } });
  else if (report.workflowCalls === 4) invoke('weftmod_script', { action: 'run', description: 'Read the owned file through a reusable script',
    code: 'return await tools.read({file_path: params.path});', params: { path: outputFile } });
  else sse(response, body.model);
});
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
report.modelFixturePort = modelServer.address().port;
const electron = createRequire(import.meta.url)('electron');
let child, output = '', origin, account, approvalController, approvalWork;
const approvalPolicies = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (report.approvalError) throw new Error(report.approvalError);
    const value = await check(); if (value) return value;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned Electron exited before readiness');
    await pause(100);
  }
  throw new Error('Owned generic execution fixture timed out');
}
async function launch() {
  lifecyclePhase = 'launching'; launchIteration++;
  output = ''; child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env,
      WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1' } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + String(chunk)).slice(-128 * 1024); });
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  report.hostPids.push(child.pid); report.hostOrigins.push(origin);
  lifecyclePhase = 'running';
}
function manage(action, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID(), timer = setTimeout(() => { child.off('message', listener); reject(new Error('Fixture management timeout')); }, 20000);
    const listener = frame => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', listener); clearTimeout(timer); frame.ok ? resolve(frame.result) : reject(new Error(`Fixture management ${frame.code}`));
    };
    child.on('message', listener); child.send({ type: 'weftmate:manage', requestId, action, ...fields });
  });
}
async function request(method, path, body) {
  const response = await fetch(origin + '/personal/v1/' + path, { method, headers: { origin, 'content-type': 'application/json',
    ...(account ? { cookie: account.cookie, 'x-weftmate-csrf': account.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function command(payload) {
  const accepted = await request('POST', 'commands', payload); assert.equal(accepted.status, 202);
  return until(async () => {
    const value = (await request('GET', `commands/${accepted.body.command.commandId}`)).body.command;
    if (['pending', 'dispatching'].includes(value.state)) return null;
    assert.equal(value.state, 'accepted_by_dsh'); return value;
  });
}
async function stopOwned() {
  lifecyclePhase = 'stopping';
  approvalController?.abort();
  await approvalWork;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve)); child.send({ type: 'weftmate:quit' });
  if (!await Promise.race([closed.then(() => true), pause(15000).then(() => false)])) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolve => killer.once('close', resolve)); await closed;
  }
  report.cleanExit = child.exitCode === 0;
  report.hostExits.push({ pid: child.pid, exitCode: child.exitCode, signal: child.signalCode });
  lifecyclePhase = 'stopped';
}
function approveOwnedFixture(sessionId) {
  approvalController = new AbortController();
  const signal = approvalController.signal;
  approvalWork = (async () => {
    while (!signal.aborted) {
      const page = await request('GET', `sessions/${sessionId}/approvals`);
      if (signal.aborted) return;
      assert.equal(page.status, 200);
      for (const approval of page.body.approvals) {
        const policy = approvalPolicies.get(approval.taskId);
        if (approval.status !== 'pending' || !policy || policy.outcome === 'hold') continue;
        assert.equal(approval.sessionId, sessionId); assert.equal(approval.sourceCommandId, policy.source.commandId);
        assert.equal(approval.sourceReceiptId, policy.source.receiptId); assert.equal(approval.toolName, 'weftmod_script');
        const answer = await request('POST', `sessions/${sessionId}/approvals/${approval.approvalId}`,
          { requestId: randomUUID(), outcome: policy.outcome });
        assert.equal(answer.status, 200); assert.equal(answer.body.approval.status, 'answered');
        assert.equal(answer.body.approval.decisionOutcome, policy.outcome);
        report.approvalAnswers.push({ approvalId: approval.approvalId, taskId: approval.taskId,
          sourceCommandId: approval.sourceCommandId, sourceReceiptId: approval.sourceReceiptId,
          toolName: approval.toolName, status: answer.body.approval.status, decisionOutcome: policy.outcome });
        report.approvalRoundTrips++;
      }
      await pause(100);
    }
  })().catch(error => { if (!signal.aborted) report.approvalError = error.message; });
}
const selectApprovalPolicy = (source, outcome) => approvalPolicies.set(source.commandId, { source, outcome });
async function drainOwnedModelRequests() {
  const deadline = Date.now() + 5000;
  while (modelInflight.size > 0 || Date.now() - lastModelAcceptAt < 100) {
    if (Date.now() >= deadline) throw new Error('Owned model requests did not settle before restart baseline');
    await pause(25);
  }
  report.modelRequestsInFlightAtRestartBaseline = modelInflight.size;
  report.restartBaselineAt = new Date().toISOString();
}
async function approvalFor(source, status) {
  return until(async () => {
    const page = await request('GET', `sessions/${source.sessionId}/approvals`); assert.equal(page.status, 200);
    return page.body.approvals.find(row => row.taskId === source.commandId && row.sourceReceiptId === source.receiptId && row.status === status);
  }, 25000);
}
async function nativeEvents(sessionId) {
  const native = [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)[1];
  const response = await fetch(native + '/api/session.export?sessionId=' + encodeURIComponent(sessionId), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer()); assert.ok(archive.length <= 4 * 1024 * 1024);
  const entries = unzipSync(archive, { filter: entry => !/[\\/]/.test(entry.name) && entry.name.endsWith('.jsonl') && entry.originalSize <= 4 * 1024 * 1024 });
  const names = Object.keys(entries); assert.equal(names.length, 1);
  const raw = Buffer.from(entries[names[0]]); assert.ok(raw.length <= 4 * 1024 * 1024);
  const evidence = process.env.WEFTMATE_GENERAL_EXECUTION_EVIDENCE;
  const artifact = { sessionId, exportedAt: new Date().toISOString(), entryName: names[0], zipSha256: createHash('sha256').update(archive).digest('hex'),
    artifactSha256: createHash('sha256').update(raw).digest('hex'), byteLength: raw.length };
  report.nativeArtifactPolls++;
  const prior = report.nativeArtifactReads.find(prior => prior.sessionId === sessionId && prior.artifactSha256 === artifact.artifactSha256);
  if (prior) {
    report.nativeArtifactExports.push({ call: report.nativeArtifactPolls, ...artifact, zipFile: prior.zipFile, jsonlFile: prior.jsonlFile, reusedArtifact: true });
    return raw.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    const base = 'native-session-audit-' + (report.nativeArtifactReads.length + 1);
    artifact.zipFile = join(evidence, base + '.zip'); artifact.jsonlFile = join(evidence, base + '.jsonl');
    writeFileSync(artifact.zipFile, archive, { flag: 'wx' }); writeFileSync(artifact.jsonlFile, raw, { flag: 'wx' });
  }
  report.nativeArtifactReads.push(artifact);
  report.nativeArtifactExports.push({ call: report.nativeArtifactPolls, ...artifact, reusedArtifact: false });
  return raw.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
try {
  await launch();
  const originalNativeOrigin = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
  await manage('model.configure-synthetic-stop-fixture', { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1` });
  await until(() => [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].some(match => match[1] !== originalNativeOrigin));
  const grant = await manage('account.setup');
  const privateLogin = { server: origin, username: 'GeneralWorkflowFixture', password: 'synthetic-general-' + randomUUID() };
  writeFileSync(loginFile, JSON.stringify(privateLogin) + '\n', { flag: 'wx', mode: 0o600 }); await ensurePrivateFile(loginFile);
  const setup = await request('POST', 'auth/setup', { grant: grant.grant, username: privateLogin.username,
    password: privateLogin.password, deviceName: 'Synthetic shared phone' });
  assert.equal(setup.status, 201); account = { cookie: setup.cookie, csrf: setup.body.csrfToken };
  const hostId = (await request('GET', 'status')).body.hostId;
  const session = await command({ requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic-stop-fixture' });
  approveOwnedFixture(session.sessionId);
  const backgroundOnly = process.env.WEFTMATE_GENERAL_EXECUTION_BACKGROUND_ONLY === '1';
  report.backgroundOnly = backgroundOnly;
  let workflow, detail;
  if (!backgroundOnly) {
  workflow = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'GENERAL_WORKFLOW 请用通用工具发现环境、生成资料并读取实际结果', mode: 'queue' });
  selectApprovalPolicy(workflow, 'allowed-once');
  detail = await until(async () => {
    const value = (await request('GET', `tasks/${workflow.commandId}`)).body;
    return ['pwsh', 'read', 'weftmod', 'weftmod_script'].every(name => value.executionSteps?.some(row => row.toolName === name && row.state === 'completed')) &&
      value.executionSteps.every(row => row.state === 'completed') ? value : null;
  }, 25000);
  assert.match(readFileSync(outputFile, 'utf8'), /general execution 42/);
  report.executionSteps = detail.executionSteps;
  const granted = await approvalFor(workflow, 'resolved'); assert.equal(granted.outcome, 'allowed-once');
  const events = await nativeEvents(session.sessionId);
  const desktopCall = detail.executionSteps.find(row => row.toolName === 'weftmod');
  report.desktopObservationRead = events.some(event => event.type === 'tool/result' &&
    [desktopCall.callId, desktopCall.rootCallId].includes(event.data.message?.source?.callId) && event.data.error === undefined);
  report.scriptReadVerified = events.some(event => event.type === 'tool/result' && [granted.callId, granted.rootCallId].includes(event.data.message?.source?.callId) &&
    JSON.stringify(event.data).includes('general execution 42') && event.data.error === undefined);
  assert.equal(report.desktopObservationRead, true); assert.equal(report.scriptReadVerified, true);
  assert.ok(events.some(event => event.type === 'approval/decided' && event.data.id === granted.approvalId && event.data.outcome === 'allowed-once'));
  report.nativeApprovalDecisions.push({ approvalId: granted.approvalId, outcome: 'allowed-once' });
  assert.ok(detail.executionSteps.every(row => row.sourceReceiptId === workflow.receiptId && !('verification' in row)));
  const rejected = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'GENERAL_APPROVAL_REJECT 拒绝这个隔离脚本，本轮不能写入目标文件', mode: 'queue' });
  selectApprovalPolicy(rejected, 'rejected');
  const rejection = await approvalFor(rejected, 'resolved'); assert.equal(rejection.outcome, 'rejected');
  await until(async () => (await request('GET', `tasks/${rejected.commandId}`)).body.executionSteps.some(row => row.toolName === 'weftmod_script' && row.state === 'failed'));
  assert.equal(existsSync(deniedFile), false); report.rejectedApprovalPreventedWrite = true;
  assert.ok((await nativeEvents(session.sessionId)).some(event => event.type === 'approval/decided' && event.data.id === rejection.approvalId && event.data.outcome === 'rejected'));
  report.nativeApprovalDecisions.push({ approvalId: rejection.approvalId, outcome: 'rejected' });
  const cancelled = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'GENERAL_APPROVAL_CANCEL 等待这个隔离脚本审批，在回答前停止原任务', mode: 'queue' });
  selectApprovalPolicy(cancelled, 'hold');
  const cancelling = await approvalFor(cancelled, 'pending');
  assert.equal((await request('POST', `tasks/${cancelled.commandId}/stop`, { requestId: randomUUID() })).status, 202);
  const cancelledApproval = await approvalFor(cancelled, 'unavailable'); assert.equal(cancelledApproval.outcome, 'cancelled');
  assert.equal((await request('POST', `sessions/${session.sessionId}/approvals/${cancelling.approvalId}`,
    { requestId: randomUUID(), outcome: 'allowed-once' })).status, 409);
  await until(async () => (await nativeEvents(session.sessionId)).some(event => event.type === 'approval/decided' &&
    event.data.id === cancelling.approvalId && event.data.outcome === 'cancelled'));
  assert.equal(existsSync(cancelledFile), false); report.cancelledApprovalPreventedWrite = true;
  report.nativeApprovalDecisions.push({ approvalId: cancelling.approvalId, outcome: 'cancelled' });
  const stopped = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'GENERAL_STOP 启动一个可停止的临时进程，然后等待用户停止', mode: 'queue' });
  const pid = await until(() => { try { return Number(readFileSync(pidFile, 'utf8').trim()); } catch { return null; } }, 20000);
  assert.ok(pid > 0); process.kill(pid, 0);
  assert.equal((await request('POST', `tasks/${stopped.commandId}/stop`, { requestId: randomUUID() })).status, 202);
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 10000);
  await until(async () => (await request('GET', `tasks/${stopped.commandId}`)).body.executionSteps.some(row => row.state === 'cancelled'), 10000);
  report.foregroundStopped = true;
  }
  const bg = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'GENERAL_BACKGROUND 启动一个独立临时后台工作，保留状态并等待用户停止', mode: 'queue' });
  const pidA = await until(() => { try { return Number(readFileSync(bgPidFiles[0], 'utf8').trim()); } catch { return null; } }, 15000);
  await until(async () => (await request('GET', `tasks/${bg.commandId}`)).body.executionSteps.some(row => row.jobId && row.jobState === 'running'));
  const bgOther = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'GENERAL_BACKGROUND_OTHER 启动另一个独立临时后台工作，保留其状态', mode: 'queue' });
  const pidB = await until(() => { try { return Number(readFileSync(bgPidFiles[1], 'utf8').trim()); } catch { return null; } }, 15000);
  await until(async () => (await request('GET', `tasks/${bgOther.commandId}`)).body.executionSteps.some(row => row.jobId && row.jobState === 'running'));
  assert.equal((await request('POST', `tasks/${bg.commandId}/stop`, { requestId: randomUUID() })).status, 202);
  await until(() => { try { process.kill(pidA, 0); return false; } catch { return true; } }, 10000);
  process.kill(pidB, 0); report.otherReceiptJobPreserved = true;
  await until(async () => (await request('GET', `tasks/${bg.commandId}`)).body.executionSteps.some(row => row.jobState === 'killed'));
  report.backgroundStopped = true;
  assert.equal((await request('POST', `tasks/${bgOther.commandId}/stop`, { requestId: randomUUID() })).status, 202);
  await until(() => { try { process.kill(pidB, 0); return false; } catch { return true; } }, 10000);
  let replacing, replaceApproval;
  if (!backgroundOnly) {
    replacing = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
      text: 'GENERAL_APPROVAL_REPLACE 等待这个隔离脚本审批，宿主将关闭重开', mode: 'queue' });
    selectApprovalPolicy(replacing, 'hold'); replaceApproval = await approvalFor(replacing, 'pending');
  }
  const counts = [report.workflowCalls, report.stopCalls, ...approvalCalls.values()];
  report.modelCountsBeforeShutdown = counts;
  await stopOwned(); assert.equal(report.cleanExit, true);
  await drainOwnedModelRequests();
  const closedCounts = [report.workflowCalls, report.stopCalls, ...approvalCalls.values()];
  report.modelCountsAfterShutdown = closedCounts;
  await launch();
  const reread = workflow ? (await request('GET', `tasks/${workflow.commandId}`)).body : null;
  assert.equal((await request('GET', `tasks/${bg.commandId}`)).body.executionSteps.find(row => row.jobId).jobState, 'killed');
  if (workflow) assert.deepEqual(reread.executionSteps, detail.executionSteps);
  if (replacing) {
    const replacementApproval = await approvalFor(replacing, 'unavailable'); assert.equal(replacementApproval.outcome, 'unavailable');
    assert.equal((await request('POST', `sessions/${session.sessionId}/approvals/${replaceApproval.approvalId}`,
      { requestId: randomUUID(), outcome: 'allowed-once' })).status, 409);
    assert.equal(existsSync(replacedFile), false); report.replacedApprovalPreventedWrite = true;
    const replacementDetail = (await request('GET', `tasks/${replacing.commandId}`)).body;
    report.replacementTaskOutcome = { state: replacementDetail.control.state,
      executionSteps: replacementDetail.executionSteps.map(row => ({ toolName: row.toolName, state: row.state })) };
  }
  await pause(300); report.modelCountsAfterRestart = [report.workflowCalls, report.stopCalls, ...approvalCalls.values()];
  assert.deepEqual(report.modelCountsAfterRestart, closedCounts);
  report.preservedAcrossRestart = true;
  privateLogin.server = origin; privateLogin.conversationID = session.sessionId;
  writeFileSync(loginFile, JSON.stringify(privateLogin) + '\n'); await ensurePrivateFile(loginFile);
  if (process.env.WEFTMATE_GENERAL_EXECUTION_KEEP_LIVE === '1') {
    report.liveGuiOrigin = origin + '/personal/v1/ui';
    console.log(JSON.stringify({ liveGuiOrigin: report.liveGuiOrigin, privateLoginFile: loginFile }));
    await new Promise(resolve => { process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { if (value.includes('q')) resolve(); }); });
  }
} catch (error) { report.failed = error.message; report.safeRuntimeTail = output.slice(-24000); throw error; }
finally {
  await stopOwned(); await new Promise(resolve => modelServer.close(resolve));
  report.modelFixtureListenerClosed = !modelServer.listening;
  report.candidateFingerprintAfter = fingerprint();
  report.candidateFingerprintUnchanged = JSON.stringify(report.candidateFingerprintAfter) === JSON.stringify(report.candidateFingerprint);
  const evidence = process.env.WEFTMATE_GENERAL_EXECUTION_EVIDENCE;
  if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, 'general-execution.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ fixtureRoot: root, paidModelRequests: 0, toolCatalog: report.advertisedTools,
    foregroundStopped: report.foregroundStopped, preservedAcrossRestart: report.preservedAcrossRestart, cleanExit: report.cleanExit, failed: report.failed ?? null }));
}
