/** One isolated native information question -> original tool result -> original approval/file task. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePrivateFile } from '../../src/private-host-storage.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_USER_QUESTION_E2E !== '1') throw new Error('Explicit isolated Windows question fixture required');
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const evidence = process.env.WEFTMATE_USER_QUESTION_EVIDENCE;
if (!evidence) throw new Error('Question evidence directory required');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-general-question-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile'); mkdirSync(profile);
const workspace = join(profile, 'workspace'); mkdirSync(workspace);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'), JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }), { flag: 'wx' });
const outputFile = join(workspace, 'question-answer.txt');
const expected = { answers: [
  { id: 'single', selected: ['同意'] },
  { id: 'multi', selected: ['来源', '步骤'], custom: '额外信息' },
  { id: 'free', selected: [], custom: '合成问答备注' },
] };
const questionArgs = { questions: [
  { id: 'single', header: '信息选择', question: '选择报告说明用词；该回答不是执行许可。', options: [{ label: '同意' }, { label: '不同意' }] },
  { id: 'multi', question: '选择报告包含的信息。', multi_select: true, options: [{ label: '来源' }, { label: '步骤' }, { label: '摘要' }] },
  { id: 'free', question: '补充报告备注。' },
] };
const report = { repository, fixtureRoot: root, paidModelRequests: 0, modelRequests: [], hostPids: [], hostExits: [],
  provenance: [], profileAssetHashes: [], questionResults: [], informationDidNotGrantExecution: false,
  fileVerified: false, stopVerified: false, restartVerified: false, nativeArtifactFiles: [], cleanExit: false };
const modelCounts = new Map();
const pause = ms => new Promise(done => setTimeout(done, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
function respond(response, model, tool, args) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = choice => response.write('data: ' + JSON.stringify({ id: randomUUID(), object: 'chat.completion.chunk', model,
    created: Math.floor(Date.now() / 1000), choices: [choice] }) + '\n\n');
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + randomUUID(),
    type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: '本次问答与隔离任务结束。' }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
}
const modelServer = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] })); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let bodyText = ''; for await (const chunk of request) { bodyText += chunk; if (bodyText.length > 512 * 1024) { response.destroy(); return; } }
  const body = JSON.parse(bodyText), names = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name);
  if (!names.length) { respond(response, body.model); return; }
  const source = [...body.messages].reverse().filter(message => message.role === 'user').map(message =>
    typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join(''))
    .find(text => text.includes('QUESTION_NATIVE_')) ?? '';
  const mode = source.includes('QUESTION_NATIVE_STOP') ? 'stop' : source.includes('QUESTION_NATIVE_RESTART') ? 'restart' : 'full';
  const count = (modelCounts.get(mode) ?? 0) + 1; modelCounts.set(mode, count);
  report.modelRequests.push({ at: new Date().toISOString(), mode, count });
  const invoke = (name, args) => names.includes(name) ? respond(response, body.model, name, args)
    : respond(response, body.model, 'run_code', { code: 'return await tools.' + name + '(' + JSON.stringify(args) + ');', description: 'Use the existing information tool' });
  if (count === 1) { invoke('ask_user_question', mode === 'full' ? questionArgs : { questions: [{ id: mode, question: '等待本次原任务控制，不自动填写。' }] }); return; }
  if (mode === 'full' && count === 2) {
    const outputs = body.messages.filter(message => message.role === 'tool').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    const actual = outputs.map(text => { try { return JSON.parse(text); } catch { return null; } }).find(value => Array.isArray(value?.answers));
    assert.deepEqual(actual, expected); report.questionResults.push(actual);
    invoke('weftmod_script', { action: 'run', description: 'Write the supplied information to the owned fixture file',
      code: 'return await tools.write({file_path: params.path, content: params.content});',
      params: { path: outputFile, content: JSON.stringify(actual) } }); return;
  }
  respond(response, body.model);
});
await new Promise(done => modelServer.listen(0, '127.0.0.1', done));
report.modelFixturePort = modelServer.address().port;
const electron = createRequire(import.meta.url)('electron');
const { unzipSync } = createRequire(join(repository, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-host-apiproxy/package.json'))('fflate');
let child, output = '', origin, account;
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned host exited before expected result'); await pause(100); }
  throw new Error('Owned question flow did not reach expected result');
}
function manage(action, fields = {}) {
  return new Promise((done, reject) => { const requestId = randomUUID();
    const timer = setTimeout(() => { child.off('message', listener); reject(new Error('Owned management timeout')); }, 20000);
    const listener = frame => { if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      clearTimeout(timer); child.off('message', listener); frame.ok ? done(frame.result) : reject(new Error('Owned management ' + frame.code)); };
    child.on('message', listener); child.send({ type: 'weftmate:manage', requestId, action, ...fields }); });
}
async function request(method, path, body) {
  const result = await fetch(origin + '/personal/v1/' + path, { method, headers: { origin, 'content-type': 'application/json',
    ...(account ? { cookie: account.cookie, 'x-weftmate-csrf': account.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: result.status, body: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
}
async function launch() {
  output = ''; child = spawn(electron, ['.', '--user-data-dir=' + profile, '--personal-host', '--access-port=0'], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env,
      WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', WEFTMATE_MEMOWEFT_ENABLED: '0' } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + String(data)).slice(-128 * 1024); });
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  report.hostPids.push(child.pid); report.hostOrigins ??= []; report.hostOrigins.push(origin);
  const provenance = JSON.parse(/synthetic source provenance=(\{[^\r\n]+\})/.exec(output)[1]);
  assert.equal(realpathSync(provenance.appPath), realpathSync(repository));
  for (const key of ['mainModule', 'runtimeModule', 'gatewaySource', 'adapterSource']) assert.ok(realpathSync(provenance[key]).startsWith(realpathSync(join(repository, 'src')) + sep));
  report.provenance.push(provenance);
}
async function stopOwned() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(done => child.once('close', done)); child.send({ type: 'weftmate:quit' });
  if (!await Promise.race([closed.then(() => true), pause(15000).then(() => false)])) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(done => killer.once('close', done)); await closed;
  }
  report.hostExits.push({ pid: child.pid, exitCode: child.exitCode, signal: child.signalCode });
  report.cleanExit = child.exitCode === 0;
}
async function command(payload) {
  const accepted = await request('POST', 'commands', payload); assert.equal(accepted.status, 202);
  return until(async () => { const read = (await request('GET', 'commands/' + accepted.body.command.commandId)).body.command;
    if (['pending', 'dispatching'].includes(read.state)) return null; assert.equal(read.state, 'accepted_by_dsh'); return read; });
}
async function questionsFor(source) {
  return until(async () => { const page = await request('GET', 'sessions/' + source.sessionId + '/questions');
    if ([403, 503].includes(page.status)) return null; assert.equal(page.status, 200);
    return page.body.questions.find(row => row.sourceCommandId === source.commandId && row.status === 'pending'); });
}
async function rawAudit(sessionId) {
  const native = [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)[1];
  const response = await fetch(native + '/api/session.export?sessionId=' + sessionId); assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer()), entries = unzipSync(archive);
  const raw = entries['session.jsonl']; assert.ok(raw);
  const prefix = join(evidence, 'native-question-audit-' + (report.nativeArtifactFiles.length + 1));
  writeFileSync(prefix + '.zip', archive, { flag: 'wx' }); writeFileSync(prefix + '.jsonl', raw, { flag: 'wx' });
  report.nativeArtifactFiles.push({ zip: prefix + '.zip', jsonl: prefix + '.jsonl', sha256: sha(raw) });
  return Buffer.from(raw).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
try {
  await launch(); await manage('model.configure-synthetic-stop-fixture', { baseUrl: 'http://127.0.0.1:' + report.modelFixturePort + '/v1' });
  const grant = await manage('account.setup'), username = 'QuestionFixtureOwner', password = 'synthetic-question-' + randomUUID();
  const privateLogin = join(profile, 'question-login.json'); writeFileSync(privateLogin, JSON.stringify({ username, password }), { flag: 'wx', mode: 0o600 }); await ensurePrivateFile(privateLogin);
  const setup = await request('POST', 'auth/setup', { grant: grant.grant, username, password, deviceName: 'Question fixture client' });
  assert.equal(setup.status, 201); account = { cookie: setup.cookie, csrf: setup.body.csrfToken };
  const hostId = (await request('GET', 'status')).body.hostId;
  const session = await command({ requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic-stop-fixture' });
  const source = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'QUESTION_NATIVE_FULL 询问信息后按原任务继续，将资料写入隔离文件；信息回答不是执行许可。', mode: 'queue' });
  const pending = await questionsFor(source); report.publicPending = pending;
  assert.equal(pending.sourceReceiptId, source.receiptId); assert.deepEqual(pending.questions.map(q => q.id), ['single', 'multi', 'free']);
  const replay = await questionsFor(source); assert.equal(replay.questionRpcId, pending.questionRpcId);
  const answerRequestId = randomUUID(), answer = { requestId: answerRequestId, answer: expected };
  const answered = await request('POST', 'sessions/' + session.sessionId + '/questions/' + pending.questionRpcId, answer);
  assert.equal(answered.status, 200); assert.equal(answered.body.question.status, 'answered'); report.publicAnsweredReceipt = answered.body;
  assert.deepEqual((await request('POST', 'sessions/' + session.sessionId + '/questions/' + pending.questionRpcId, answer)).body, answered.body);
  const approval = await until(async () => { const page = await request('GET', 'sessions/' + session.sessionId + '/approvals');
    assert.equal(page.status, 200); return page.body.approvals.find(row => row.sourceCommandId === source.commandId && row.status === 'pending'); });
  assert.equal(existsSync(outputFile), false); report.informationDidNotGrantExecution = true;
  assert.equal((await request('POST', 'sessions/' + session.sessionId + '/approvals/' + approval.approvalId,
    { requestId: randomUUID(), outcome: 'allowed-once' })).status, 200);
  await until(() => existsSync(outputFile)); assert.deepEqual(JSON.parse(readFileSync(outputFile, 'utf8')), expected); report.fileVerified = true;
  const events = await rawAudit(session.sessionId);
  const questionCall = events.find(event => event.type === 'tool/call' && event.data.name === 'ask_user_question');
  assert.ok(events.some(event => event.type === 'tool/result' && event.data.message?.source?.callId === questionCall?.data.callId &&
    JSON.stringify(event.data).includes('合成问答备注') && JSON.stringify(event.data).includes('来源')));
  report.nativeToolResultVerified = true;
  report.publicFinalQuestions = (await request('GET', 'sessions/' + session.sessionId + '/questions')).body;
  const stopped = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'QUESTION_NATIVE_STOP 等待问题，在回答前停止原任务。', mode: 'queue' });
  const stopQuestion = await questionsFor(stopped);
  assert.equal((await request('POST', 'tasks/' + stopped.commandId + '/stop', { requestId: randomUUID() })).status, 202);
  const late = await request('POST', 'sessions/' + session.sessionId + '/questions/' + stopQuestion.questionRpcId,
    { requestId: randomUUID(), answer: { answers: [{ id: 'stop', selected: [], custom: 'late' }] } });
  assert.notEqual(late.status, 200); report.stopVerified = true;
  const replacing = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: session.sessionId,
    text: 'QUESTION_NATIVE_RESTART 保留待答问题，宿主关闭重开后不能复活。', mode: 'queue' });
  const restartQuestion = await questionsFor(replacing);
  await stopOwned(); assert.equal(report.cleanExit, true); await launch();
  const obsolete = await request('POST', 'sessions/' + session.sessionId + '/questions/' + restartQuestion.questionRpcId,
    { requestId: randomUUID(), answer: { answers: [{ id: 'restart', selected: [], custom: 'obsolete' }] } });
  assert.notEqual(obsolete.status, 200); report.restartVerified = true;
  for (const relative of ['runtime/dsh-adapter/agents.mjs', 'runtime/dsh-adapter/sessions.mjs', 'runtime/gateway/routes/v1.mjs']) {
    const profilePath = join(profile, 'dsh-home/profiles/weftmate', relative), sourcePath = join(repository, 'src', relative);
    assert.equal(sha(readFileSync(profilePath)), sha(readFileSync(sourcePath)));
    report.profileAssetHashes.push({ sourcePath, profilePath, sha256: sha(readFileSync(sourcePath)) });
  }
} catch (error) { report.failed = error.message; report.runtimeTail = output.slice(-18000); throw error; }
finally {
  await stopOwned(); await new Promise(done => modelServer.close(done)); report.modelListenerClosed = !modelServer.listening;
  writeFileSync(join(evidence, 'user-questions.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ fixtureRoot: root, paidModelRequests: 0, fileVerified: report.fileVerified,
    nativeToolResultVerified: report.nativeToolResultVerified, informationDidNotGrantExecution: report.informationDidNotGrantExecution,
    stopVerified: report.stopVerified, restartVerified: report.restartVerified, cleanExit: report.cleanExit, failed: report.failed ?? null }));
}
