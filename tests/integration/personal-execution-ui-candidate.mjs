/**
 * Explicit, loopback-only visual candidate for the Stage 15 execution cards.
 *
 * This is deliberately not a product API or a model test.  It starts the real
 * personal-access HTTP service with an isolated synthetic-history backend, then
 * serves the checked-in desktop page and the checked-in mobile Web UI.  The
 * latter receives a narrow browser bridge because it normally runs in Android
 * WebView; it must never be reported as an Android-native check.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';

if (process.env.WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE !== '1') {
  throw new Error('Set WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE=1 to start the isolated candidate.');
}

const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const candidateRoot = resolve(process.env.WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE_ROOT ??
  'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Task15Frontend-20261006/Candidate');
const runId = randomUUID().replaceAll('-', '');
const runtimeRoot = join(candidateRoot, `isolated-store-${runId}`);
const evidenceRoot = join(candidateRoot, `run-${runId}`);
const mobileRoot = join(repository, 'apps/mobile-ui/www');
mkdirSync(runtimeRoot, { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });

const now = () => new Date().toISOString();
const state = { ownerId: '', owner: '', deviceId: '', hostId: '', sessionId: '', receiptId: '', taskId: '', stopObserved: false, historyReadable: true, taskDetailReadable: true, events: [], seq: 0, terminalAt: null, executions: [] };
const profile = { id: 'candidate-synthetic-history', model: 'synthetic-history-only',
  baseUrl: 'http://127.0.0.1:18187/v1', provider: 'openai-compatible', source: 'formal-host-catalog',
  credentialHash: createHash('sha256').update(`candidate:${runId}`).digest('hex') };
function append(type, data) { state.events.push({ seq: ++state.seq, type, at: now(), data }); }
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'not-run', modules: {}, capabilities: { chat: { available: true, inferenceVerified: false } } }),
  listModels: async () => [{ ...profile, name: '候选合成历史（非模型）', configured: true, source: 'host', inferenceVerified: false }], preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => { state.sessionId = sessionId; return { sessionId }; },
  sendMessage: async ({ text }) => {
    state.receiptId = `candidate-receipt-${runId.slice(0, 16)}`;
    append('turn.started', { turn: 1 });
    append('user.message', { receiptId: state.receiptId, text: String(text).slice(0, 4000),
      messageHash: createHash('sha256').update(String(text)).digest('hex') });
    append('assistant.message', { text: `候选历史已写入：${'长内容 '.repeat(480)}\n这段内容来自本机合成历史，未调用真实模型。` });
    return { accepted: true, receiptId: state.receiptId };
  },
  cancelSession: async () => ({ accepted: true }),
  stopTask: async ({ receiptIds }) => {
    state.stopObserved = true; state.terminalAt = now(); append('turn.ended', { turn: 1, reason: 'aborted' });
    for (const item of state.executions) {
      if (item.mode === 'foreground') await service.trackToolExecution({ ...item.input, id: `${item.input.id}-cancel`, action: 'finish_execution', executionId: item.executionId, state: 'cancelled', resultHash: createHash('sha256').update('candidate-cancelled').digest('hex') });
      if (item.mode === 'background') await service.trackToolExecution({ ...item.input, id: `${item.input.id}-killed`, action: 'observe_execution_job', executionId: item.executionId, jobId: item.jobId, jobState: 'killed' });
    }
    return { outcomes: receiptIds.map(receiptId => ({ receiptId, status: 'cancel_requested' })) };
  },
  readEvents: async ({ sessionId, afterSeq, limit }) => {
    if (!state.historyReadable) { const error = new Error('candidate history read deliberately unavailable'); error.code = 'BACKEND_UNAVAILABLE'; error.status = 503; throw error; }
    assert.equal(sessionId, state.sessionId);
    const events = state.events.filter(event => event.seq > afterSeq).slice(0, limit);
    const nextSeq = events.at(-1)?.seq ?? afterSeq;
    return { events, nextSeq, hasMore: state.events.some(event => event.seq > nextSeq) };
  },
  describeSession: async id => id === state.sessionId ? { sessionId: id, title: '候选：执行与成果核对', running: !state.stopObserved,
    agentPreset: 'personal-remote', modelProfileId: profile.id } : null,
  getTaskReplyEvidence: async ({ receiptId }) => receiptId === state.receiptId ? { status: state.stopObserved ? 'aborted' : 'streaming',
    turn: 1, assistantChunks: 1, textChunks: 1, reasoningChunks: 0, assistantMessages: 1, toolSaveObserved: false,
    ...(state.terminalAt ? { terminalAt: state.terminalAt } : {}) } : { status: 'unconfirmed', turn: null, assistantChunks: 0, textChunks: 0, reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: false },
};

let service, serviceOrigin, authCookie, csrfToken, control;
async function serviceRequest(path, method = 'GET', body) {
  const response = await fetch(serviceOrigin + path, { method, headers: { origin: serviceOrigin, cookie: authCookie,
    ...(method === 'GET' ? {} : { 'x-weftmate-csrf': csrfToken, 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(value?.error?.code ?? `HTTP_${response.status}`); error.status = response.status; throw error; }
  return value;
}
async function waitCommand(commandId) { for (let i = 0; i < 100; i++) { const row = (await serviceRequest(`/personal/v1/commands/${commandId}`)).command;
  if (!['pending', 'dispatching'].includes(row.state)) return row; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('candidate command acceptance timed out'); }

function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
function asset(pathname) {
  const name = pathname === '/mobile/' || pathname === '/mobile/index.html' ? 'index.html' : pathname.slice('/mobile/'.length);
  if (!/^(?:index\.html|app\.js|styles\.css|vendor\.js)$/.test(name)) return null;
  return { name, body: readFileSync(join(mobileRoot, name)) };
}
function mobileBridge() { return `(() => { let n=0; const call=(method,params={})=>fetch('/__candidate/mobile-bridge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,params})}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error?.code||'BRIDGE_FAILED');return v.result}); window.weftNative={postMessage(raw){let m;try{m=JSON.parse(raw)}catch{return} call(m.method,m.params).then(result=>window.weftNative.onmessage?.({data:JSON.stringify({id:m.id,ok:true,result})})).catch(error=>window.weftNative.onmessage?.({data:JSON.stringify({id:m.id,ok:false,error:{code:error.message}})}))},onmessage:null}; window.__weftmateCandidateBridge='browser-harness: not Android native'; })();`; }
function bridgeFailure(code, status = 409) { const error = new Error(code); error.status = status; return error; }
function bridgeId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw bridgeFailure('INVALID_REQUEST', 400);
  return value;
}
async function requireBridgeContext(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw bridgeFailure('INVALID_REQUEST', 400);
  for (const field of ['sessionId', 'taskId', 'artifactId']) if (Object.hasOwn(params, field)) bridgeId(params[field]);
  for (const [field, expected] of Object.entries({ source: 'host', owner: state.owner, ownerId: state.ownerId,
    deviceId: state.deviceId, hostId: state.hostId, sessionId: state.sessionId, taskId: state.taskId })) {
    if (Object.hasOwn(params, field) && params[field] !== expected) throw bridgeFailure('CANDIDATE_CONTEXT_MISMATCH');
  }
  const me = await serviceRequest('/personal/v1/auth/me');
  if (me.account?.ownerId !== state.ownerId || me.device?.id !== state.deviceId) throw bridgeFailure('ACCOUNT_SWITCHED', 403);
}
async function bridge(method, params) {
  if (typeof method !== 'string') throw bridgeFailure('INVALID_REQUEST', 400);
  if (method.startsWith('shared.')) await requireBridgeContext(params);
  if (method === 'events.subscribe' || method === 'app.ready' || method === 'app.activity') return { ok: true };
  if (method === 'app.bootstrap') return { loggedIn: true, username: 'Candidate UI', owner: state.owner, busy: false,
    model: { source: 'host', displayName: '候选合成历史（非模型）', modelProfileId: profile.id }, backgroundSync: 'not-run', ui: null };
  if (method === 'settings.appearance') { if (params.value !== undefined) state.appearance = ['light', 'dark', 'system'].includes(params.value) ? params.value : 'light'; return { value: state.appearance ?? 'light' }; }
  if (method === 'auth.me') return { displayName: 'Candidate UI', connectionVerified: true, profileRevision: 1 };
  if (method === 'conversations.list') return { conversations: [] };
  if (method === 'models.list') return { models: [], selected: { source: 'host', displayName: '候选合成历史（非模型）' } };
  if (method === 'models.host') return { models: [{ profileId: profile.id, displayName: '候选合成历史（非模型）', configured: true }] };
  if (method === 'shared.sessions.list') {
    const value = await serviceRequest('/personal/v1/sessions');
    if (!Array.isArray(value.sessions)) throw bridgeFailure('CANDIDATE_RESPONSE_INVALID', 502);
    return { source: 'host', hostAvailable: true, sessions: value.sessions.map(row => ({ ...row, source: 'host' })) };
  }
  if (method === 'activity.list') { const commands = (await serviceRequest('/personal/v1/commands?limit=100')).commands;
    return { hostAvailable: true, activities: commands.filter(row => row.kind === 'session.message' && row.commandId === state.taskId)
      .map(row => ({ ...row, source: 'host', taskId: row.commandId, summary: '候选合成历史；非真实模型', children: [] })) }; }
  if (method === 'shared.sessions.events') {
    const sessionId = bridgeId(params.sessionId), afterSeq = params.afterSeq ?? -1;
    if (!Number.isSafeInteger(afterSeq) || afterSeq < -1) throw bridgeFailure('INVALID_REQUEST', 400);
    const value = await serviceRequest(`/personal/v1/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${afterSeq}&limit=100`);
    if (!Array.isArray(value.events) || !Number.isSafeInteger(value.nextSeq) || value.nextSeq < afterSeq ||
      value.events.length > 100 || typeof value.hasMore !== 'boolean' || value.hasMore && value.nextSeq === afterSeq)
      throw bridgeFailure('HISTORY_CURSOR_INVALID', 502);
    return { ...value, source: 'host', sessionId, hostAvailable: true, cached: false };
  }
  if (method === 'shared.tasks.detail') {
    const taskId = bridgeId(params.taskId), value = await serviceRequest(`/personal/v1/tasks/${encodeURIComponent(taskId)}`);
    if (value.taskId !== taskId || value.sessionId !== state.sessionId || value.source?.commandId !== taskId ||
      value.source?.sessionId !== state.sessionId || value.source?.receiptId !== state.receiptId)
      throw bridgeFailure('CANDIDATE_CONTEXT_MISMATCH');
    return value;
  }
  if (method === 'shared.artifacts.preview') {
    const artifactId = bridgeId(params.artifactId), value = await serviceRequest(`/personal/v1/artifacts/${encodeURIComponent(artifactId)}/preview`);
    const artifact = value.artifact;
    if (artifact?.artifactId !== artifactId || artifact.taskId !== state.taskId || artifact.sessionId !== state.sessionId ||
      typeof value.text !== 'string') throw bridgeFailure('CANDIDATE_CONTEXT_MISMATCH');
    const task = await serviceRequest(`/personal/v1/tasks/${encodeURIComponent(artifact.taskId)}`);
    const listed = task.artifacts?.find(row => row.artifactId === artifactId);
    if (task.taskId !== state.taskId || task.sessionId !== state.sessionId || task.source?.receiptId !== state.receiptId ||
      listed?.taskId !== artifact.taskId || listed.sessionId !== artifact.sessionId || listed.sha256 !== artifact.sha256 ||
      listed.size !== artifact.size || Buffer.byteLength(value.text, 'utf8') !== artifact.size ||
      createHash('sha256').update(value.text).digest('hex') !== artifact.sha256) throw bridgeFailure('ARTIFACT_CHANGED');
    return value;
  }
  if (method === 'shared.commands.detail') return serviceRequest(`/personal/v1/commands/${encodeURIComponent(params.commandId)}`).then(value => value);
  if (method === 'shared.commands.byRequest') return serviceRequest(`/personal/v1/commands/by-request/${encodeURIComponent(params.requestId)}`).then(value => value);
  const error = new Error('CANDIDATE_BRIDGE_UNSUPPORTED'); throw error;
}
async function startControl() {
  control = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/mobile/bridge.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); return response.end(mobileBridge()); }
      if (request.method === 'GET' && (url.pathname === '/mobile/' || url.pathname.startsWith('/mobile/'))) {
        const found = asset(url.pathname); if (!found) return json(response, 404, { error: { code: 'NOT_FOUND' } });
        let body = found.body; if (found.name === 'index.html') body = Buffer.from(body.toString('utf8').replace("connect-src 'none'", "connect-src 'self'")
          .replace('<script defer src="app.js"></script>', '<script defer src="bridge.js"></script><script defer src="app.js"></script>'));
        response.writeHead(200, { 'content-type': found.name.endsWith('.css') ? 'text/css; charset=utf-8' : found.name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return response.end(body);
      }
      if (request.method === 'POST' && url.pathname === '/__candidate/mobile-bridge') { let raw=''; for await (const part of request) raw += part; const input=JSON.parse(raw); return json(response, 200, { result: await bridge(input.method, input.params) }); }
      if (request.method === 'POST' && url.pathname === '/__candidate/control') { let raw=''; for await (const part of request) raw += part; const input=JSON.parse(raw);
        if (input.action === 'history.readable') state.historyReadable = true;
        else if (input.action === 'history.fail') state.historyReadable = false;
        else if (input.action === 'task.stop') await serviceRequest(`/personal/v1/tasks/${state.taskId}/stop`, 'POST', { requestId: `candidate-stop-${runId}` });
        else return json(response, 400, { error: { code: 'CANDIDATE_ACTION_UNKNOWN' } });
        return json(response, 200, { candidate: true, action: input.action, taskId: state.taskId, receiptId: state.receiptId, historyReadable: state.historyReadable, stopObserved: state.stopObserved });
      }
      json(response, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) { json(response, error?.status ?? 500, { error: { code: error?.message ?? 'CANDIDATE_FAILURE' } }); }
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${control.address().port}`;
}
async function close() { await service?.close().catch(() => {}); await new Promise(resolve => control?.close?.(resolve) ?? resolve()); }
try {
  const controlOrigin = await startControl();
  service = await createPersonalAccessService({ root: runtimeRoot, port: 0, backend, uiHandler: servePersonalAccessUi,
    sharedProfileIsFormal: item => item.id === profile.id });
  ({ origin: serviceOrigin } = await service.start()); await service.setSharedModelProfiles([profile]);
  const credentials = { username: `candidate${runId.slice(0, 12)}`, password: `isolated-${randomUUID()}` }, grant = await service.issueSetupGrant();
  const registration = await fetch(`${serviceOrigin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: serviceOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, ...credentials, deviceName: 'Candidate browser harness' }) });
  assert.equal(registration.status, 201); const account = await registration.json(); authCookie = registration.headers.get('set-cookie').split(';')[0]; csrfToken = account.csrfToken;
  state.ownerId = account.account.ownerId; state.deviceId = account.device.id;
  state.owner = createHash('sha256').update(`${serviceOrigin}|${state.ownerId}`).digest('hex');
  state.hostId = (await serviceRequest('/personal/v1/status')).hostId;
  writeFileSync(join(runtimeRoot, 'private-login.json'), `${JSON.stringify({ server: serviceOrigin, ...credentials }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const created = await serviceRequest('/personal/v1/commands', 'POST', { requestId: `candidate-create-${runId}`, kind: 'session.create', targetDeviceId: (await serviceRequest('/personal/v1/status')).hostId, modelProfileId: profile.id });
  const session = await waitCommand(created.command.commandId); state.sessionId = session.sessionId;
  const message = await serviceRequest('/personal/v1/commands', 'POST', { requestId: `candidate-message-${runId}`, kind: 'session.message', targetDeviceId: (await serviceRequest('/personal/v1/status')).hostId, sessionId: state.sessionId, mode: 'queue', text: '候选任务：核对原消息回执、执行状态、停止回执和成果。' });
  const accepted = await waitCommand(message.command.commandId); state.taskId = accepted.commandId; assert.equal(accepted.receiptId, state.receiptId);
  const messageHash = createHash('sha256').update('候选任务：核对原消息回执、执行状态、停止回执和成果。').digest('hex');
  const artifact = await service.submitToolArtifact({ sessionId: state.sessionId, turn: 1, callId: `candidate-artifact-${runId.slice(0, 12)}`, messageHash, fileName: 'candidate-result.txt', content: 'Candidate artifact: observed through the real isolated service.\n' });
  for (const index of [1, 2, 3, 0]) { const callId = `candidate-call-${index}-${runId.slice(0, 12)}`, rootCallId = `candidate-root-${index}-${runId.slice(0, 12)}`, argumentsHash = createHash('sha256').update(`candidate-step-${index}`).digest('hex'), input = { id: `candidate-track-${index}-${runId.slice(0, 12)}`, sessionId: state.sessionId, turn: 1, callId, rootCallId, receiptId: state.receiptId, messageHash, toolName: index > 1 ? (index === 2 ? 'read' : 'glob') : 'pwsh', argumentsHash };
    const running = await service.trackToolExecution({ ...input, action: 'authorize_execution' });
    if (index === 0) { state.executions.push({ mode: 'foreground', input, executionId: running.executionId }); continue; }
    const finish = { ...input, id: `candidate-finish-${index}-${runId.slice(0, 12)}`, action: 'finish_execution', executionId: running.executionId, state: 'completed', resultHash: createHash('sha256').update(`candidate-result-${index}`).digest('hex') };
    await service.trackToolExecution(finish); }
  const sourceHashes = ['src/personal-access-ui/app.js', 'src/personal-access-ui/styles.css', 'apps/mobile-ui/www/app.js',
    'apps/mobile-ui/www/styles.css', 'tests/personal-access-ui-interaction.test.ts', 'apps/mobile-ui/tests/chat-interactions.test.mjs',
    'tests/integration/personal-execution-ui-candidate.mjs', 'tests/personal-execution-ui-candidate.test.ts'].map(path => {
      const bytes = readFileSync(join(repository, path)); return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
  const publicMetadata = join(evidenceRoot, 'candidate.json');
  const evidence = { schema: 1, purpose: 'isolated UI candidate; synthetic history only, not model or Android-native evidence', startedAt: now(), runId, processId: process.pid, serviceOrigin,
    desktopUrl: `${serviceOrigin}/personal/v1/ui/`, mobileBrowserHarnessUrl: `${controlOrigin}/mobile/`, controlUrl: `${controlOrigin}/__candidate/control`, taskId: state.taskId, receiptId: state.receiptId,
    states: ['receiptId-linked source message', 'four receipt-filterable execution steps', 'service-written artifact', 'running/completed synthetic turn', 'control: task.stop -> observed stop', 'control: history.fail/readable -> reading failure and recovery'], runtimeRoot, privateLoginFixture: join(runtimeRoot, 'private-login.json'),
    publicMetadata, ownerId: state.ownerId, owner: state.owner, hostId: state.hostId, deviceId: state.deviceId, sessionId: state.sessionId,
    artifactId: artifact.artifactId, artifact: { artifactId: artifact.artifactId, taskId: artifact.taskId, sessionId: artifact.sessionId, sha256: artifact.sha256, size: artifact.size }, sourceHashes };
  writeFileSync(publicMetadata, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(evidence));
  if (process.env.WEFTMATE_PERSONAL_EXECUTION_UI_CANDIDATE_SMOKE === '1') {
    const call = async (method, params = {}) => {
      const response = await fetch(`${controlOrigin}/__candidate/mobile-bridge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) });
      assert.equal(response.status, 200); return (await response.json()).result;
    };
    const task = await call('shared.tasks.detail', { taskId: state.taskId }); assert.equal(task.executionSteps.length, 4); assert.equal(task.artifacts.length, 1);
    const list = await call('shared.sessions.list'); assert.equal(list.source, 'host'); assert.equal(list.hostAvailable, true); assert.equal(list.sessions[0].sessionId, state.sessionId);
    const events = await call('shared.sessions.events', { sessionId: state.sessionId }); assert.equal(events.source, 'host'); assert.equal(events.sessionId, state.sessionId); assert.ok(events.events.some(row => row.data?.receiptId === state.receiptId));
    const preview = await call('shared.artifacts.preview', { artifactId: artifact.artifactId }); assert.equal(preview.artifact.sha256, artifact.sha256); assert.equal(preview.artifact.size, artifact.size); assert.equal(createHash('sha256').update(preview.text).digest('hex'), artifact.sha256);
    assert.equal((await fetch(`${controlOrigin}/mobile/bridge.js`)).status, 200); assert.equal((await call('activity.list')).activities.length, 1); assert.equal((await call('settings.appearance', { value: 'dark' })).value, 'dark');
  } else await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
    if (process.send) process.once('message', message => { if (message?.type === 'candidate.close') resolve(); }); });
} finally { await close(); if (process.connected) process.disconnect(); }
