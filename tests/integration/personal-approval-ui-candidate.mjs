/** Interactive approval/information UI candidate: fixed DSH, loopback model, frozen assets. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePrivateFile } from '../../src/private-host-storage.mjs';
import { artifactMetadata, confirmedSaveResult, documentFromTextDeliveryGoal, documentFromWeftmodResult, lastModelToolResult,
  observedTextArtifact, textDeliveryGoal, textDeliveryInput } from './personal-text-delivery-fixture.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_APPROVAL_UI_CANDIDATE !== '1')
  throw new Error('Set WEFTMATE_APPROVAL_UI_CANDIDATE=1 on Windows for the isolated live candidate.');

const textDeliveryOnly = process.env.WEFTMATE_APPROVAL_UI_TEXT_DELIVERY_ONLY === '1';
const textDeliverySourcePath = process.env.WEFTMATE_APPROVAL_UI_TEXT_DELIVERY_SOURCE;
if (textDeliveryOnly && (!textDeliverySourcePath || !isAbsolute(textDeliverySourcePath)))
  throw new Error('Text-delivery-only mode requires an absolute WEFTMATE_APPROVAL_UI_TEXT_DELIVERY_SOURCE.');
const textDeliverySource = textDeliveryOnly ? textDeliveryInput(JSON.parse(readFileSync(textDeliverySourcePath, 'utf8'))) : null;
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const candidateRoot = resolve(process.env.WEFTMATE_APPROVAL_UI_CANDIDATE_ROOT ??
  'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Task15ApprovalClients-20261006-01a1112e/Candidate');
const root = join(candidateRoot, 'live-' + randomUUID().replaceAll('-', ''));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-approval-'));
const profile = join(fixtureRoot, 'profile'), workspace = join(profile, 'workspace'), assets = join(root, 'assets');
mkdirSync(workspace, { recursive: true }); mkdirSync(assets, { recursive: true });
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'), JSON.stringify({ schemaVersion: 1,
  purpose: 'isolated-personal-host' }), { flag: 'wx' });
const reportPath = join(root, 'candidate.json'), loginFile = join(profile, 'private-login.json');
const now = () => new Date().toISOString();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const freezePath = resolve(process.env.WEFTMATE_APPROVAL_RUNTIME_MANIFEST ??
  'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Stage15-WindowsAndroid-20261005/QuestionBridge-20261006-667eaa64-36c3-4583-a1f8-6508c6fb3781/Evidence/Merge-5b32e264-6d27-4490-930e-aabd17f61bfb/current-manifest.json');
const freeze = JSON.parse(readFileSync(freezePath, 'utf8'));
const expectedRuntimeHashes = freeze.currentFiles ? Object.fromEntries(freeze.currentFiles.map((item) => [item.path, item.currentSha256])) : freeze.files;
const runtimeHashes = Object.fromEntries(Object.keys(expectedRuntimeHashes).map((path) => [path, sha(readFileSync(join(repository, path)))]));
assert.deepEqual(runtimeHashes, expectedRuntimeHashes, 'the current merged common runtime must remain exact');
const includeQuestions = process.env.WEFTMATE_APPROVAL_UI_QUESTIONS !== '0';
if (includeQuestions) assert.ok(runtimeHashes['src/runtime/dsh-adapter/sessions.mjs'], 'combined mode needs the merged question runtime manifest');
const clientPaths = ['src/personal-access-ui/app.js', 'src/personal-access-ui/styles.css', 'src/personal-access-ui/index.html',
  'apps/mobile-ui/www/app.js', 'apps/mobile-ui/www/styles.css', 'apps/mobile-ui/www/index.html',
  'apps/android/app/src/main/java/com/memoweft/weftmate/mobile/HybridActivity.kt',
  'apps/android/app/src/main/java/com/memoweft/weftmate/mobile/Network.kt', 'tests/integration/personal-approval-ui-candidate.mjs',
  'tests/integration/personal-text-delivery-fixture.mjs'];
const clientHashes = Object.fromEntries(clientPaths.map((path) => [path, sha(readFileSync(join(repository, path)))]));
const mobileFreezePath = includeQuestions ? resolve(process.env.WEFTMATE_APPROVAL_MOBILE_MANIFEST ??
  'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Task15ApprovalClients-20261006-01a1112e/mobile/combined-information/implementation.json') : null;
const mobileFreeze = mobileFreezePath ? JSON.parse(readFileSync(mobileFreezePath, 'utf8')) : null;
if (mobileFreeze) {
  for (const item of mobileFreeze.files) assert.equal(sha(readFileSync(join(repository, item.path))), item.sha256,
    `the frozen combined mobile source must remain exact: ${item.path}`);
  const apk = readFileSync(mobileFreeze.apk.path); assert.equal(apk.length, mobileFreeze.apk.size); assert.equal(sha(apk), mobileFreeze.apk.sha256);
}
cpSync(join(repository, 'src/personal-access-ui'), join(assets, 'desktop'), { recursive: true, errorOnExist: true });
cpSync(join(repository, 'apps/mobile-ui/www'), join(assets, 'mobile'), { recursive: true, errorOnExist: true });
const informationConfirmationOnly = process.env.WEFTMATE_APPROVAL_UI_CONFIRM_INFORMATION_ONLY === '1';
const cases = (textDeliveryOnly || informationConfirmationOnly ? [] : ['allow', 'reject', 'stop']).map((name) => ({ name, file: join(workspace, `${name}.txt`),
  expected: `approval-client:${name}`, sessionId: null, taskId: null, receiptId: null, approval: null }));
if (includeQuestions && !textDeliveryOnly) cases.push({ name: 'information', kind: 'question', file: join(workspace, 'information.txt'), expected: null,
  sessionId: null, taskId: null, receiptId: null, question: null, approval: null });
if (textDeliveryOnly) cases.push({ name: 'text-delivery', kind: 'text-delivery', fileName: textDeliverySource.fileName,
  contentBytes: Buffer.byteLength(textDeliverySource.content, 'utf8'), sourceDocument: textDeliverySource.source,
  sessionId: null, taskId: null, receiptId: null });
const nativeQuestionArgs = { questions: [
  { id: 'single', header: '信息选择', question: '选择报告说明用词；该回答不是执行许可。', options: [{ label: '同意' }, { label: '不同意' }] },
  { id: 'multi', question: '选择报告包含的信息。', multi_select: true, options: [{ label: '来源' }, { label: '步骤' }, { label: '摘要' }] },
  { id: 'free', question: '补充报告备注。' },
] };
const report = { schemaVersion: 1, kind: textDeliveryOnly ? 'fixed-DSH-live-text-artifact-delivery-candidate' :
  includeQuestions ? 'fixed-DSH-live-approval-and-information-candidate' : 'fixed-DSH-live-approval-candidate', createdAt: now(), root, fixtureRoot, profile, workspace,
  privateLoginFile: loginFile, publicMetadata: reportPath, candidateProcessId: process.pid, paidModelRequests: 0,
  runtimeManifest: freezePath, runtimeHashes, clientHashes, frozenAssets: assets,
  nativeCandidate: mobileFreeze ? { manifest: mobileFreezePath, apk: mobileFreeze.apk,
    sourceFiles: mobileFreeze.files.map((item) => ({ path: item.path, sha256: item.sha256 })), loaded: false,
    boundary: 'APK identity recorded; Android-native installation and GUI are separately coordinated by root' } : null,
  modelEvidence: 'owned loopback synthetic model; no paid or external model requests',
  desktopEvidence: 'real personal HTTP API and fixed DSH, served with frozen desktop assets',
  mobileEvidence: 'browser bridge against the real personal API; this is not Android-native evidence',
  autoAnswers: 0, informationConfirmationOnly, textDeliveryOnly,
  ...(textDeliveryOnly ? { textDeliverySourcePath } : {}),
  scenarios: cases, nativeReads: [], modelRequests: 0, ready: false, cleanExit: false };
function persist() { writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); }
const calls = new Map();
function sse(response, model, tool, args, text = '审批候选回合结束。实际结果请核对隔离文件与原生记录。') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const callId = tool ? 'call-' + randomUUID() : null;
  const frame = (choice) => response.write(`data: ${JSON.stringify({ id: randomUUID(), object: 'chat.completion.chunk', model,
    created: Math.floor(Date.now() / 1000), choices: [choice] })}\n\n`);
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: callId,
    type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
    : { role: 'assistant', content: text }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
  return callId;
}
function deliveryUnconfirmed(response, model, scenario, code) {
  scenario.modelDeliveryStatus = 'unconfirmed'; scenario.deliveryFailure = { code }; persist();
  return sse(response, model, null, null, `文本成果尚未完成交付：${code}。`);
}
function requestTextDelivery(response, body, names, scenario, document) {
  if (!document) return deliveryUnconfirmed(response, body.model, scenario, 'TEXT_RESULT_MISSING_OR_INVALID');
  if (!names.includes('personal_save_document'))
    return deliveryUnconfirmed(response, body.model, scenario, 'PERSONAL_SAVE_DOCUMENT_UNAVAILABLE');
  scenario.deliveryRequest = { fileName: document.fileName, size: Buffer.byteLength(document.content, 'utf8'), sha256: sha(document.content) };
  scenario.modelDeliveryStatus = 'requested';
  scenario.deliveryCallId = sse(response, body.model, 'personal_save_document', { fileName: document.fileName, content: document.content });
  persist();
}
function finishTextDelivery(response, body, scenario) {
  const returned = lastModelToolResult(body.messages, ['personal_save_document'], scenario.deliveryCallId);
  scenario.artifactToolResult = artifactMetadata(returned?.value);
  if (!confirmedSaveResult(returned?.value, { ...scenario.deliveryRequest, taskId: scenario.taskId }))
    return deliveryUnconfirmed(response, body.model, scenario, 'SAVE_RESULT_NOT_OBSERVED');
  scenario.modelDeliveryStatus = 'observed'; delete scenario.deliveryFailure; persist();
  return sse(response, body.model, null, null, `文档“${returned.value.fileName}”已作为本任务成果交付。`);
}
const modelServer = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] }));
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); return response.end(); }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw), names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
    report.modelRequests++;
    if (!names.length) return sse(response, body.model);
    report.toolCatalog = names;
    const text = [...body.messages].reverse().filter((message) => message.role === 'user').map((message) =>
      typeof message.content === 'string' ? message.content : (message.content ?? []).filter((part) => part.type === 'text')
        .map((part) => part.text).join('')).find((text) => /APPROVAL_CLIENT_(ALLOW|REJECT|STOP)|QUESTION_CLIENT_INFORMATION|TEXT_ARTIFACT_DELIVERY/.test(text)) ?? '';
    const scenario = cases.find((item) => text.includes(item.kind === 'text-delivery' ? 'TEXT_ARTIFACT_DELIVERY' :
      item.kind === 'question' ? 'QUESTION_CLIENT_INFORMATION' : `APPROVAL_CLIENT_${item.name.toUpperCase()}`));
    if (!scenario) return sse(response, body.model);
    const count = (calls.get(scenario.name) ?? 0) + 1; calls.set(scenario.name, count);
    if (scenario.kind === 'text-delivery') {
      if (count === 1) return requestTextDelivery(response, body, names, scenario, documentFromTextDeliveryGoal(text));
      if (count === 2) return finishTextDelivery(response, body, scenario);
      return deliveryUnconfirmed(response, body.model, scenario, 'UNEXPECTED_DELIVERY_MODEL_ROUND');
    }
    if (scenario.kind === 'question') {
      if (count === 1) return names.includes('ask_user_question') ? sse(response, body.model, 'ask_user_question', nativeQuestionArgs)
        : sse(response, body.model, 'run_code', { code: `return await tools.ask_user_question(${JSON.stringify(nativeQuestionArgs)});`,
          description: 'Ask for the owned task information' });
      if (count === 3) {
        const returned = lastModelToolResult(body.messages, ['weftmod_script', 'run_code']);
        const document = documentFromWeftmodResult(returned?.value);
        if (document) scenario.weftmodTextSource = { callId: returned.callId, tool: returned.name,
          path: document.sourcePath, operation: document.operation, bytes: Buffer.byteLength(document.content, 'utf8') };
        return requestTextDelivery(response, body, names, scenario, document);
      }
      if (count === 4) return finishTextDelivery(response, body, scenario);
      if (count !== 2) return deliveryUnconfirmed(response, body.model, scenario, 'UNEXPECTED_INFORMATION_MODEL_ROUND');
      const outputs = body.messages.filter((message) => message.role === 'tool').map((message) =>
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
      const answer = outputs.map((text) => { try { return JSON.parse(text); } catch { return null; } }).find((value) => Array.isArray(value?.answers));
      assert.ok(answer); assert.deepEqual(answer.answers.map((item) => item.id), ['single', 'multi', 'free']);
      scenario.nativeToolAnswer = answer; scenario.expected = JSON.stringify(answer);
    } else if (count !== 1) return sse(response, body.model);
    const args = { action: 'run', description: `Write one owned ${scenario.name} candidate file after this approval`,
      code: 'return await tools.write({file_path: params.path, content: params.content});',
      params: { path: scenario.file, content: scenario.expected } };
    if (names.includes('run_code') && !names.includes('weftmod_script')) {
      assert.ok(raw.includes('weftmod_script'), 'the fixed DSH catalog advertises the generic script tool');
      return sse(response, body.model, 'run_code', { code: `return await tools.weftmod_script(${JSON.stringify(args)});`,
        description: 'Request approval for the owned candidate script' });
    }
    assert.ok(names.includes('weftmod_script'));
    return sse(response, body.model, 'weftmod_script', args);
  } catch (error) { report.modelError = error.message; persist(); response.writeHead(500); response.end(); }
});
await new Promise((done) => modelServer.listen(0, '127.0.0.1', done));
report.modelOrigin = `http://127.0.0.1:${modelServer.address().port}`;
const electron = createRequire(import.meta.url)('electron');
const { unzipSync } = createRequire(join(repository, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-host-apiproxy/package.json'))('fflate');
let child, output = '', origin, account, control, controlOrigin, observer, observing = false, owner, hostId;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (report.modelError) throw new Error(report.modelError);
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Owned Electron exited before readiness');
    const value = await check(); if (value) return value; await pause(100);
  }
  throw new Error('Owned approval candidate timed out');
}
function manage(action, fields = {}) {
  return new Promise((done, fail) => {
    const requestId = randomUUID(), timer = setTimeout(() => { child.off('message', listener); fail(new Error('Owned IPC management timed out')); }, 20000);
    const listener = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', listener); clearTimeout(timer); frame.ok ? done(frame.result) : fail(new Error(`Owned IPC management ${frame.code}`));
    };
    child.on('message', listener); child.send({ type: 'weftmate:manage', requestId, action, ...fields });
  });
}
async function api(method, path, body) {
  const response = await fetch(origin + '/personal/v1/' + path, { method, headers: { origin,
    ...(account ? { cookie: account.cookie, 'x-weftmate-csrf': account.csrf } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value?.error?.code ?? `HTTP_${response.status}`); error.status = response.status; throw error; }
  return { body: value, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function command(body, onAccepted) {
  const accepted = await api('POST', 'commands', body); assert.equal(accepted.status, 202);
  onAccepted?.(accepted.body.command);
  return until(async () => {
    const row = (await api('GET', `commands/${accepted.body.command.commandId}`)).body.command;
    if (['pending', 'dispatching'].includes(row.state)) return null;
    assert.equal(row.state, 'accepted_by_dsh'); return row;
  });
}
async function nativeEvidence(scenario) {
  const nativeOrigin = [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)?.[1];
  assert.ok(nativeOrigin);
  const response = await fetch(`${nativeOrigin}/api/session.export?sessionId=${encodeURIComponent(scenario.sessionId)}`,
    { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(archive, { filter: (entry) => !/[\\/]/.test(entry.name) && entry.name.endsWith('.jsonl') });
  const names = Object.keys(entries); assert.equal(names.length, 1);
  const raw = Buffer.from(entries[names[0]]), events = raw.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const decided = events.find((event) => event.type === 'approval/decided' && event.data.id === scenario.approval.approvalId);
  if (!decided) return false;
  const base = join(root, `native-${scenario.name}-${randomUUID().slice(0, 8)}`);
  writeFileSync(base + '.zip', archive, { flag: 'wx' }); writeFileSync(base + '.jsonl', raw, { flag: 'wx' });
  scenario.nativeDecision = { approvalId: decided.data.id, outcome: decided.data.outcome };
  report.nativeReads.push({ scenario: scenario.name, sessionId: scenario.sessionId, at: now(),
    zipFile: base + '.zip', jsonlFile: base + '.jsonl', zipSha256: sha(archive), jsonlSha256: sha(raw) });
  return true;
}
async function nativeQuestionEvidence(scenario) {
  const nativeOrigin = [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)?.[1];
  const response = await fetch(`${nativeOrigin}/api/session.export?sessionId=${encodeURIComponent(scenario.sessionId)}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer()), entries = unzipSync(archive, {
    filter: (entry) => !/[\\/]/.test(entry.name) && entry.name.endsWith('.jsonl') });
  const names = Object.keys(entries); assert.equal(names.length, 1);
  const raw = Buffer.from(entries[names[0]]), events = raw.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const nativeCalls = events.filter((event) => event.type === 'tool/call' && event.data.name === 'ask_user_question' &&
    event.data.turn === scenario.question.turn && event.data.arguments === JSON.stringify(nativeQuestionArgs));
  if (nativeCalls.length !== 1) return false;
  const call = nativeCalls[0], result = events.find((event) => event.type === 'tool/result' && event.data.message?.source?.callId === call.data.callId);
  if (!result) return false;
  const answer = result.data.message.content.flatMap((part) => part.content || []).filter((part) => part.type === 'text')
    .map((part) => { try { return JSON.parse(part.text); } catch { return null; } }).find((value) => Array.isArray(value?.answers));
  if (!answer) return false;
  assert.deepEqual(answer, scenario.nativeToolAnswer);
  const base = join(root, `native-question-${randomUUID().slice(0, 8)}`);
  writeFileSync(base + '.zip', archive, { flag: 'wx' }); writeFileSync(base + '.jsonl', raw, { flag: 'wx' });
  scenario.nativeQuestionResult = { questionRpcId: scenario.question.questionRpcId, sourceReceiptId: scenario.receiptId,
    turn: call.data.turn, callId: call.data.callId, answer, clientAnswerAccepted: !!scenario.question.answerAcceptedAt };
  report.nativeReads.push({ scenario: scenario.name, kind: 'native-question-tool-result', at: now(), zipFile: base + '.zip',
    jsonlFile: base + '.jsonl', zipSha256: sha(archive), jsonlSha256: sha(raw) });
  return true;
}
async function observe() {
  if (observing || !report.ready) return;
  observing = true;
  try {
    for (const scenario of cases) {
      if (scenario.kind === 'text-delivery') { await observeTextDelivery(scenario); continue; }
      if (scenario.kind === 'question') {
        const rows = (await api('GET', `sessions/${scenario.sessionId}/questions?limit=100`)).body.questions;
        const question = rows.find((item) => item.questionRpcId === scenario.question.questionRpcId);
        assert.ok(question); assert.equal(question.sourceCommandId, scenario.taskId); assert.equal(question.sourceReceiptId, scenario.receiptId);
        scenario.question = question;
        if (scenario.nativeToolAnswer && !scenario.nativeQuestionResult) await nativeQuestionEvidence(scenario);
      }
      const rows = (await api('GET', `sessions/${scenario.sessionId}/approvals?limit=100`)).body.approvals;
      const row = scenario.approval ? rows.find((item) => item.approvalId === scenario.approval.approvalId)
        : rows.find((item) => item.sourceCommandId === scenario.taskId && item.sourceReceiptId === scenario.receiptId);
      if (scenario.kind !== 'question') assert.ok(row);
      if (row) { assert.equal(row.taskId, scenario.taskId); assert.equal(row.sourceCommandId, scenario.taskId);
        assert.equal(row.sourceReceiptId, scenario.receiptId); scenario.approval = row; }
      scenario.fileObservation = existsSync(scenario.file) ? (() => { const bytes = readFileSync(scenario.file);
        return { exists: true, bytes: bytes.length, sha256: sha(bytes), matchesExpected: scenario.expected !== null && bytes.equals(Buffer.from(scenario.expected)) }; })()
        : { exists: false };
      if (row && ['resolved', 'unavailable'].includes(row.status) && !scenario.nativeDecision) await nativeEvidence(scenario);
      if (scenario.kind === 'question' && scenario.nativeToolAnswer && row?.status === 'pending' && !scenario.fileObservation.exists)
        scenario.informationDidNotGrantExecution = true;
      scenario.task = (await api('GET', `tasks/${scenario.taskId}`)).body;
      if (scenario.deliveryRequest) recordTextDeliveryObservation(scenario, scenario.task);
    }
    report.lastObservedAt = now(); delete report.observationError; persist();
  } catch (error) { report.observationError = error.message; persist(); }
  finally { observing = false; }
}
function recordTextDeliveryObservation(scenario, task) {
  const expected = { ...scenario.deliveryRequest, taskId: scenario.taskId, sessionId: scenario.sessionId };
  const artifact = (task.artifacts ?? []).find((row) => observedTextArtifact(row, expected));
  scenario.artifactMetadata = artifactMetadata(artifact);
  scenario.artifactRegistered = !!artifact; scenario.replyCompleted = task.replyEvidence?.status === 'completed';
  scenario.deliveryComplete = scenario.modelDeliveryStatus === 'observed' && scenario.artifactRegistered && scenario.replyCompleted;
}
async function observeTextDelivery(scenario) {
  const task = (await api('GET', `tasks/${scenario.taskId}`)).body;
  recordTextDeliveryObservation(scenario, task);
  // Keep public artifact and reply evidence without repeating the protected source text.
  const { sourceText: _sourceText, ...metadata } = task;
  scenario.task = metadata;
  persist();
}
function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
const staticFiles = new Map();
for (const surface of ['desktop', 'mobile']) for (const name of readdirSync(join(assets, surface), { recursive: true })) {
  if (typeof name === 'string' && /\.(?:html|js|css|svg|png|webp)$/.test(name))
    staticFiles.set(`${surface}/${name.replaceAll('\\', '/')}`, join(assets, surface, name));
}
function mobileBridge() { return `(() => { const call=(method,params={})=>fetch('/__candidate/mobile-bridge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,params})}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error?.code||'BRIDGE_FAILED');return v.result}); window.weftNative={postMessage(raw){let m;try{m=JSON.parse(raw)}catch{return} call(m.method,m.params).then(result=>window.weftNative.onmessage?.({data:JSON.stringify({id:m.id,ok:true,result})})).catch(error=>window.weftNative.onmessage?.({data:JSON.stringify({id:m.id,ok:false,error:{code:error.message}})}))},onmessage:null};window.__weftmateCandidateBridge='fixed DSH API browser harness; not Android native';})();`; }
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('INVALID_REQUEST'); return value; }
async function bridge(method, params = {}) {
  if (method.startsWith('shared.')) {
    const me = (await api('GET', 'auth/me')).body;
    assert.equal(me.account.ownerId, account.ownerId); assert.equal(me.device.id, account.deviceId);
    for (const [field, expected] of Object.entries({ source: 'host', owner, ownerId: account.ownerId, deviceId: account.deviceId, hostId }))
      if (Object.hasOwn(params, field)) assert.equal(params[field], expected);
    if (params.sessionId !== undefined) assert.ok(cases.some((item) => item.sessionId === id(params.sessionId)));
    if (params.taskId !== undefined) assert.ok(cases.some((item) => item.taskId === id(params.taskId)));
  }
  if (['events.subscribe', 'app.ready', 'app.activity'].includes(method)) return { ok: true };
  if (method === 'app.bootstrap') return { loggedIn: true, username: 'Approval UI fixture', owner, busy: false,
    model: { source: 'host', displayName: '本机合成模型 · 固定 DSH 审批候选', modelProfileId: 'synthetic-stop-fixture' },
    backgroundSync: 'not-run', ui: null };
  if (method === 'settings.appearance') { if (params.value !== undefined) report.appearance = params.value; return { value: report.appearance ?? 'light' }; }
  if (method === 'auth.me') return { displayName: 'Approval UI fixture', connectionVerified: true, profileRevision: 1, deviceId: account.deviceId };
  if (method === 'conversations.list') return { conversations: [] };
  if (method === 'models.list') return { models: [], selected: { source: 'host', displayName: '本机合成模型 · 固定 DSH 审批候选' } };
  if (method === 'models.host') return { models: [{ profileId: 'synthetic-stop-fixture', displayName: '本机合成模型 · 固定 DSH 审批候选', configured: true }] };
  if (method === 'shared.sessions.list') {
    const value = (await api('GET', 'sessions')).body;
    if (!Array.isArray(value.sessions)) throw new Error('CANDIDATE_RESPONSE_INVALID');
    return { source: 'host', hostAvailable: true, sessions: value.sessions.map((row) => ({ ...row, source: 'host' })) };
  }
  if (method === 'activity.list') return { hostAvailable: true, activities: cases.map((item) => ({ ...item.source, source: 'host',
    taskId: item.taskId, summary: `审批候选 · ${item.name}`, children: [] })) };
  if (method === 'shared.sessions.events') return { ...(await api('GET', `sessions/${id(params.sessionId)}/events?afterSeq=${params.afterSeq ?? -1}&limit=100`)).body,
    source: 'host', sessionId: params.sessionId, hostAvailable: true, cached: false };
  if (method === 'shared.tasks.detail') return (await api('GET', `tasks/${id(params.taskId)}`)).body;
  if (method === 'shared.approvals.list') {
    const before = params.before === undefined ? '' : `&before=${encodeURIComponent(id(params.before))}`;
    return (await api('GET', `sessions/${id(params.sessionId)}/approvals?limit=${params.limit ?? 50}${before}`)).body;
  }
  if (method === 'shared.approvals.decide') return (await api('POST', `sessions/${id(params.sessionId)}/approvals/${id(params.approvalId)}`,
    { requestId: params.requestId, outcome: params.outcome })).body;
  if (method === 'shared.questions.list') {
    const before = params.before === undefined ? '' : `&before=${encodeURIComponent(id(params.before))}`;
    return (await api('GET', `sessions/${id(params.sessionId)}/questions?limit=${params.limit ?? 50}${before}`)).body;
  }
  if (method === 'shared.questions.answer') return (await api('POST', `sessions/${id(params.sessionId)}/questions/${id(params.questionRpcId)}`,
    { requestId: params.requestId, answer: params.answer })).body;
  if (method === 'shared.tasks.stop') return (await api('POST', `tasks/${id(params.taskId)}/stop`, { requestId: params.requestId })).body;
  if (method === 'shared.commands.detail') return (await api('GET', `commands/${id(params.commandId)}`)).body;
  if (method === 'shared.commands.byRequest') return (await api('GET', `commands/by-request/${encodeURIComponent(params.requestId)}`)).body;
  throw new Error('CANDIDATE_BRIDGE_UNSUPPORTED');
}
let closeRequested;
const closing = new Promise((done) => { closeRequested = done; });
async function startControl() {
  control = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/mobile/bridge.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); return response.end(mobileBridge());
      }
      if (request.method === 'GET' && url.pathname === '/__candidate/status') { await observe(); return json(response, 200, report); }
      if (request.method === 'POST' && url.pathname === '/__candidate/quit') { json(response, 200, { closing: true }); closeRequested(); return; }
      if (request.method === 'POST' && url.pathname === '/__candidate/mobile-bridge') {
        let raw = ''; for await (const chunk of request) raw += chunk;
        const input = JSON.parse(raw); return json(response, 200, { result: await bridge(input.method, input.params) });
      }
      const surface = url.pathname.startsWith('/mobile/') ? 'mobile' : url.pathname.startsWith('/personal/v1/ui') ? 'desktop' : null;
      if (request.method === 'GET' && surface) {
        const prefix = surface === 'mobile' ? '/mobile/' : '/personal/v1/ui';
        const name = url.pathname.slice(prefix.length).replace(/^\//, '') || 'index.html';
        const path = staticFiles.get(`${surface}/${name}`); if (!path || url.search) return json(response, 404, { error: { code: 'NOT_FOUND' } });
        let body = readFileSync(path);
        if (surface === 'mobile' && name === 'index.html') body = Buffer.from(body.toString('utf8').replace("connect-src 'none'", "connect-src 'self'")
          .replace('<script defer src="app.js"></script>', '<script defer src="bridge.js"></script><script defer src="app.js"></script>'));
        const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        response.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' }); return response.end(body);
      }
      if (!url.pathname.startsWith('/personal/v1/')) return json(response, 404, { error: { code: 'NOT_FOUND' } });
      let body; if (!['GET', 'HEAD'].includes(request.method)) { const chunks = []; for await (const chunk of request) chunks.push(chunk); body = Buffer.concat(chunks); }
      const headers = {}; for (const field of ['cookie', 'content-type', 'x-weftmate-csrf']) if (request.headers[field]) headers[field] = request.headers[field];
      if (request.headers.origin) {
        if (request.headers.origin !== controlOrigin) return json(response, 403, { error: { code: 'ORIGIN_REJECTED' } });
        headers.origin = origin;
      }
      const upstream = await fetch(origin + url.pathname + url.search, { method: request.method, headers, body, signal: AbortSignal.timeout(20000) });
      const forwarded = {}; for (const field of ['content-type', 'cache-control', 'set-cookie', 'content-disposition']) {
        const value = upstream.headers.get(field); if (value) forwarded[field] = value;
      }
      response.writeHead(upstream.status, forwarded); response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { json(response, error.status ?? 409, { error: { code: error.message } }); }
  });
  await new Promise((done) => control.listen(0, '127.0.0.1', done));
  controlOrigin = `http://127.0.0.1:${control.address().port}`;
}
async function closeOwned() {
  clearInterval(observer);
  if (control?.listening) await new Promise((done) => control.close(done));
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((done) => child.once('close', done)); child.send({ type: 'weftmate:quit' });
    if (!await Promise.race([closed.then(() => true), pause(15000).then(() => false)])) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise((done) => killer.once('close', done)); await closed;
    }
  }
  report.cleanExit = child?.exitCode === 0; report.hostExitCode = child?.exitCode;
  await new Promise((done) => modelServer.close(done)); report.modelFixtureListenerClosed = !modelServer.listening;
  process.stdin.pause(); process.stdin.removeAllListeners('data');
  persist();
}
try {
  child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env,
      WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', WEFTMATE_MEMOWEFT_ENABLED: '0' } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + String(chunk)).slice(-128 * 1024); });
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  report.hostPid = child.pid; report.personalOrigin = origin;
  if (includeQuestions) {
    const provenance = JSON.parse(/synthetic source provenance=(\{[^\r\n]+\})/.exec(output)[1]);
    assert.equal(resolve(provenance.appPath), resolve(repository));
    report.sourceProvenance = provenance;
    report.loadedProfileAssets = ['runtime/dsh-adapter/agents.mjs', 'runtime/dsh-adapter/sessions.mjs', 'runtime/gateway/routes/v1.mjs']
      .map((relative) => { const source = join(repository, 'src', relative), loaded = join(profile, 'dsh-home/profiles/weftmate', relative);
        const actual = sha(readFileSync(loaded)); assert.equal(actual, runtimeHashes['src/' + relative]);
        return { source, loaded, sha256: actual }; });
  }
  const originalNative = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
  await manage('model.configure-synthetic-stop-fixture', { baseUrl: report.modelOrigin + '/v1' });
  await until(() => [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].some((match) => match[1] !== originalNative));
  const grant = await manage('account.setup');
  const credentials = { username: 'ApprovalCandidate' + randomUUID().slice(0, 8), password: 'synthetic-approval-' + randomUUID() };
  writeFileSync(loginFile, JSON.stringify({ server: origin, ...credentials }) + '\n', { flag: 'wx', mode: 0o600 }); await ensurePrivateFile(loginFile);
  const registered = await api('POST', 'auth/setup', { grant: grant.grant, ...credentials, deviceName: 'Owned approval browser candidate' });
  assert.equal(registered.status, 201);
  account = { cookie: registered.cookie, csrf: registered.body.csrfToken, ownerId: registered.body.account.ownerId, deviceId: registered.body.device.id };
  owner = sha(`${origin}|${account.ownerId}`); hostId = (await api('GET', 'status')).body.hostId;
  for (const scenario of cases) {
    const session = await command({ requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic-stop-fixture' });
    scenario.sessionId = session.sessionId;
    const source = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: scenario.sessionId,
      text: scenario.kind === 'text-delivery' ? textDeliveryGoal(textDeliverySource) : scenario.kind === 'question'
        ? 'QUESTION_CLIENT_INFORMATION 先补充报告信息，随后单独批准隔离文件操作，并将实际文本作为本任务文档成果交付；信息答案不授执行许可。'
        : `APPROVAL_CLIENT_${scenario.name.toUpperCase()} ${scenario.name === 'allow' ? '允许本次后核对隔离文件' : scenario.name === 'reject' ? '拒绝本次后核对没有写入' : '审批前停止这件事，核对审批取消与文件未写入'}`, mode: 'queue' },
      (accepted) => { scenario.taskId = accepted.commandId; });
    scenario.source = source; scenario.taskId = source.commandId; scenario.receiptId = source.receiptId;
    if (scenario.kind === 'text-delivery') {
      await until(async () => {
        await observeTextDelivery(scenario);
        if (scenario.modelDeliveryStatus === 'unconfirmed') throw new Error(scenario.deliveryFailure.code);
        return scenario.deliveryComplete;
      });
    } else if (scenario.kind === 'question') {
      scenario.question = await until(async () => {
        try { return (await api('GET', `sessions/${scenario.sessionId}/questions`)).body.questions
          .find((row) => row.taskId === source.commandId && row.sourceCommandId === source.commandId && row.sourceReceiptId === source.receiptId && row.status === 'pending'); }
        catch (error) { if ([403, 503].includes(error.status)) return null; throw error; }
      });
    } else scenario.approval = await until(async () => (await api('GET', `sessions/${scenario.sessionId}/approvals`)).body.approvals
        .find((row) => row.taskId === source.commandId && row.sourceCommandId === source.commandId && row.sourceReceiptId === source.receiptId && row.status === 'pending'));
    if (scenario.kind !== 'text-delivery') assert.equal(existsSync(scenario.file), false);
    persist();
  }
  await startControl();
  report.desktopUrl = controlOrigin + '/personal/v1/ui/'; report.mobileBrowserHarnessUrl = controlOrigin + '/mobile/';
  report.statusUrl = controlOrigin + '/__candidate/status'; report.quitUrl = controlOrigin + '/__candidate/quit';
  writeFileSync(loginFile, JSON.stringify({ server: controlOrigin, ...credentials, conversationID: cases[0].sessionId }) + '\n'); await ensurePrivateFile(loginFile);
  report.ready = true; persist();
  observer = setInterval(() => { void observe(); }, 1500);
  process.once('SIGINT', closeRequested); process.once('SIGTERM', closeRequested);
  process.stdin.setEncoding('utf8'); process.stdin.on('data', (text) => { if (text.trim() === 'q') closeRequested(); });
  console.log(JSON.stringify({ ready: true, publicMetadata: reportPath, privateLoginFile: loginFile,
    desktopUrl: report.desktopUrl, mobileBrowserHarnessUrl: report.mobileBrowserHarnessUrl, paidModelRequests: 0, autoAnswers: 0 }));
  await closing;
  await observe();
} catch (error) {
  report.failed = error.message; report.safeRuntimeTail = output.slice(-24000); persist(); throw error;
} finally { await closeOwned(); }
