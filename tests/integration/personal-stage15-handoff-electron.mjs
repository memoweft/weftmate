/** Explicit isolated Stage 15.2 shared-conversation acceptance; synthetic by default. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_HANDOFF_SYNTHETIC_E2E !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_HANDOFF_SYNTHETIC_E2E=1 on Windows.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const evidenceDir = join(repository, '..', 'Runtime', 'UnifiedAssistant', 'Stage15-WindowsAndroid-20261005', 'Handoff');
mkdirSync(evidenceDir, { recursive: true });
// Keep the existing synthetic-route policy's owned Temp-profile prefix.
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage15-handoff-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  `${JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' })}\n`, { flag: 'wx', mode: 0o600 });
const runId = randomUUID(), fact = `stage15-violet-${runId.slice(0, 8)}`;
const artifactText = `# Stage 15 shared handoff\n${fact}\n`;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + 360_000;
const evidence = { classification: 'synthetic', runId, originalModelUnique: false, sameSession: false,
  duplicateSyncEvent: false, duplicateRequestNoRegeneration: false, toolArtifactExact: false,
  supplementCompleted: false, stopObserved: false, restartNoReplay: false, failure: null };
let modelCalls = 0, documentToolRequestSeen = false, contextSeen = false, blockResponse = null, child = null, output = '';
function sse(response, content = null, tool = null) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const frame = (choice) => response.write(`data: ${JSON.stringify({ id: 'stage15-synthetic', object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000), model: 'synthetic-stop-model', choices: [choice] })}\n\n`);
  frame(tool ? { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`,
    type: 'function', function: { name: 'personal_save_document', arguments: JSON.stringify(tool) } }] }, finish_reason: null }
    : { index: 0, delta: { role: 'assistant', content }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' });
  response.end('data: [DONE]\n\n');
}
const upstream = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] })); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let raw = ''; for await (const part of request) { raw += part; if (raw.length > 256 * 1024) { response.destroy(); return; } }
  const body = JSON.parse(raw); assert.equal(body.model, 'synthetic-stop-model'); modelCalls++;
  const text = JSON.stringify(body.messages ?? []);
  if (text.includes('stage15-block-until-stop')) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(`data: ${JSON.stringify({ id: 'stage15-block', choices: [{ index: 0, delta: { content: 'working' }, finish_reason: null }] })}\n\n`);
    blockResponse = response; response.once('close', () => { blockResponse = null; }); return;
  }
  if (text.includes('stage15-save-exact')) {
    const hasDocumentTool = JSON.stringify(body.tools ?? []).includes('personal_save_document');
    if (hasDocumentTool) { documentToolRequestSeen = true; contextSeen ||= text.includes(fact);
      sse(response, null, { fileName: 'stage15-handoff.md', content: artifactText }); return; }
  }
  sse(response, 'stage15 supplement completed');
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const port = upstream.address().port;
const electron = createRequire(import.meta.url)('electron');
function startHost() {
  const running = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1' },
  });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (part) => { output = (output + String(part)).slice(-64 * 1024); });
  return running;
}
async function until(check, cap = 90_000) {
  const end = Math.min(deadline, Date.now() + cap);
  while (Date.now() < end) { const value = await check(); if (value) return value;
    if (!child || child.exitCode !== null) throw new Error('isolated host exited'); await pause(100); }
  throw new Error('stage15 handoff fixture timed out');
}
function manage(action, fields = {}) { return new Promise((resolve, reject) => {
  const requestId = randomUUID(), timer = setTimeout(() => { child.off('message', receive); reject(new Error('management timeout')); }, 45_000);
  const receive = (frame) => { if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
    child.off('message', receive); clearTimeout(timer); frame.ok === true ? resolve(frame.result) : reject(new Error(`management failed: ${frame.code}`)); };
  child.on('message', receive); child.send({ type: 'weftmate:manage', requestId, action, ...fields }, (error) => {
    if (error) { child.off('message', receive); clearTimeout(timer); reject(error); } });
}); }
async function api(origin, account, method, path, body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
    ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json', ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function command(origin, account, commandId) { return until(async () => {
  const value = await api(origin, account, 'GET', `/personal/v1/commands/${commandId}`); assert.equal(value.status, 200);
  return ['pending', 'dispatching'].includes(value.body.command.state) ? null : value.body.command; }, 45_000); }
async function events(origin, account, sessionId) { const rows = []; let after = -1; for (let page = 0; page < 16; page++) {
  const value = await api(origin, account, 'GET', `/personal/v1/sessions/${sessionId}/events?afterSeq=${after}&limit=200`); assert.equal(value.status, 200); rows.push(...value.body.events);
  if (!value.body.hasMore) return rows; after = value.body.nextSeq; } throw new Error('event page bound exceeded'); }
async function terminal(origin, account, sessionId, receiptId, reason) { return until(async () => {
  const rows = await events(origin, account, sessionId), user = rows.find((row) => row.type === 'user.message' && row.data?.receiptId === receiptId);
  const start = rows.findLast((row) => row.type === 'turn.started' && row.seq < user?.seq);
  const end = rows.find((row) => row.type === 'turn.ended' && row.data?.turn === start?.data?.turn);
  return end?.data?.reason === reason ? end : null; }, 90_000); }
async function shutdown() { if (!child || child.exitCode !== null) return child?.exitCode === 0; const closed = new Promise((resolve) => child.once('close', resolve));
  child.send({ type: 'weftmate:quit' }); const done = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!done && child.pid) { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); await new Promise((resolve) => killer.once('close', resolve)); await closed; }
  return child.exitCode === 0; }
let origin, desktop, phone, conversationId, sessionId, rootTaskId, supplementRequest, blockRequest, modelCallsBeforeRestart;
try {
  child = startHost(); origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  assert.equal((await manage('model.configure-synthetic-stop-fixture', { baseUrl: `http://127.0.0.1:${port}/v1` })).id, 'synthetic-stop-fixture');
  const grant = await manage('account.setup'); const login = { username: `Stage15${runId.slice(0, 8)}`, password: `stage15-${randomUUID()}-pass` };
  const setup = await api(origin, null, 'POST', '/personal/v1/auth/setup', { grant: grant.grant, ...login, deviceName: 'Stage15 desktop' }); assert.equal(setup.status, 201);
  desktop = { cookie: setup.cookie, csrf: setup.body.csrfToken }; const mobile = await api(origin, null, 'POST', '/personal/v1/auth/login', { ...login, deviceName: 'Stage15 phone' }); assert.equal(mobile.status, 200);
  phone = { cookie: mobile.cookie, csrf: mobile.body.csrfToken }; assert.equal((await api(origin, phone, 'POST', '/personal/v1/sync/capabilities', { sharedConversations: 1, nativeVersionCode: 12 })).status, 200);
  conversationId = `conversation-${randomUUID()}`; const now = new Date().toISOString(), phoneTurn = `turn-${randomUUID()}`;
  const seed = [{ eventId: `event-${randomUUID()}`, conversationId, clientSeq: 1, kind: 'conversation.created', occurredAt: now, payload: { title: 'Stage15 phone conversation' } },
    { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 2, kind: 'message.created', occurredAt: now, payload: { messageId: `message-${randomUUID()}`, role: 'user', text: fact } },
    { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 3, kind: 'message.created', occurredAt: now, payload: { messageId: `message-${randomUUID()}`, role: 'assistant', text: 'phone acknowledged' } },
    { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 4, kind: 'turn.finished', occurredAt: now, payload: { turnId: phoneTurn, status: 'completed', originalModel: { modelId: 'synthetic-stop-model', displayName: 'Stage15 Synthetic', routeFingerprint: null } } }];
  const synced = await api(origin, phone, 'POST', '/personal/v1/sync/events', { events: seed }); assert.equal(synced.status, 200);
  const duplicate = await api(origin, phone, 'POST', '/personal/v1/sync/events', { events: [seed[1]] }); assert.equal(duplicate.status, 200); evidence.duplicateSyncEvent = duplicate.body.accepted?.[0]?.duplicate === true; assert.equal(evidence.duplicateSyncEvent, true);
  let shared = await api(origin, desktop, 'GET', `/personal/v1/sync/conversations/${conversationId}/shared`); assert.equal(shared.status, 200); assert.equal(shared.body.canAdopt, true);
  evidence.originalModelUnique = shared.body.originalModel?.modelId === 'synthetic-stop-model' && shared.body.originalModel?.routeFingerprint === null; assert.equal(evidence.originalModelUnique, true);
  const adoptRequest = `stage15-adopt-${runId}`; const adoption = { requestId: adoptRequest, modelProfileId: 'synthetic-stop-fixture', expectedSyncSeq: shared.body.syncThroughSeq };
  const adopted = await api(origin, desktop, 'POST', `/personal/v1/sync/conversations/${conversationId}/shared`, adoption); assert.equal(adopted.status, 202);
  const duplicateAdopt = await api(origin, desktop, 'POST', `/personal/v1/sync/conversations/${conversationId}/shared`, adoption); assert.equal(duplicateAdopt.status, 202); assert.equal(duplicateAdopt.body.command.commandId, adopted.body.command.commandId);
  const adoptCommand = await command(origin, desktop, adopted.body.command.commandId); assert.equal(adoptCommand.state, 'accepted_by_dsh'); sessionId = adoptCommand.sessionId;
  shared = await until(async () => { const value = await api(origin, desktop, 'GET', `/personal/v1/sync/conversations/${conversationId}/shared`); return value.body.status === 'active' ? value.body : null; });
  evidence.sameSession = shared.binding.sessionId === sessionId && shared.binding.modelProfileId === 'synthetic-stop-fixture'; assert.equal(evidence.sameSession, true);
  const late = { eventId: `event-${randomUUID()}`, conversationId, clientSeq: 5, kind: 'message.created', occurredAt: new Date().toISOString(), payload: { messageId: `message-${randomUUID()}`, role: 'user', text: 'stage15-phone-continuation' } };
  assert.equal((await api(origin, phone, 'POST', '/personal/v1/sync/events', { events: [late] })).status, 200);
  const messageRequest = `stage15-phone-to-desktop-${runId}`; const sent = await api(origin, phone, 'POST', '/personal/v1/commands', { requestId: messageRequest, kind: 'session.message', targetDeviceId: shared.hostId, sessionId, mode: 'queue', text: late.payload.text, sourceSyncEventId: late.eventId }); assert.equal(sent.status, 202);
  const sentDuplicate = await api(origin, phone, 'POST', '/personal/v1/commands', { requestId: messageRequest, kind: 'session.message', targetDeviceId: shared.hostId, sessionId, mode: 'queue', text: late.payload.text, sourceSyncEventId: late.eventId }); assert.equal(sentDuplicate.status, 202); assert.equal(sentDuplicate.body.command.commandId, sent.body.command.commandId);
  const phoneContinuation = await command(origin, phone, sent.body.command.commandId); assert.equal(phoneContinuation.state, 'accepted_by_dsh'); await terminal(origin, phone, sessionId, phoneContinuation.receiptId, 'completed');
  const toolRequest = `stage15-desktop-tool-${runId}`; const toolGoal = await api(origin, desktop, 'POST', '/personal/v1/commands', { requestId: toolRequest, kind: 'session.message', targetDeviceId: shared.hostId, sessionId, mode: 'queue', text: 'stage15-save-exact：请使用 personal_save_document 保存一份简短 Markdown。' }); assert.equal(toolGoal.status, 202);
  const root = await command(origin, desktop, toolGoal.body.command.commandId); assert.equal(root.state, 'accepted_by_dsh'); rootTaskId = root.commandId; await terminal(origin, desktop, sessionId, root.receiptId, 'completed');
  assert.equal(documentToolRequestSeen, true, 'the adopted task must offer the document tool to the model');
  assert.equal(contextSeen, true, 'phone-origin fact must be injected into the adopted session');
  const detail = await until(async () => { const value = await api(origin, phone, 'GET', `/personal/v1/tasks/${rootTaskId}`); return value.body.artifacts?.some((item) => item.state === 'observed') ? value.body : null; });
  const artifact = detail.artifacts.find((item) => item.state === 'observed'); const download = await fetch(`${origin}/personal/v1/artifacts/${artifact.artifactId}/download`, { headers: { cookie: phone.cookie } }); assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer()); evidence.toolArtifactExact = bytes.toString('utf8') === artifactText && sha(bytes) === artifact.sha256; assert.equal(evidence.toolArtifactExact, true);
  supplementRequest = `stage15-supplement-${runId}`; const supplement = await api(origin, desktop, 'POST', `/personal/v1/tasks/${rootTaskId}/supplements`, { requestId: supplementRequest, text: 'stage15-supplement' }); assert.equal(supplement.status, 202);
  const supplementCommand = await command(origin, desktop, supplement.body.command.commandId); assert.equal(supplementCommand.rootTaskId, rootTaskId); await terminal(origin, desktop, sessionId, supplementCommand.receiptId, 'completed');
  const supplementDuplicate = await api(origin, desktop, 'POST', `/personal/v1/tasks/${rootTaskId}/supplements`, { requestId: supplementRequest, text: 'stage15-supplement' }); assert.equal(supplementDuplicate.status, 202); assert.equal(supplementDuplicate.body.command.commandId, supplementCommand.commandId); evidence.supplementCompleted = true;
  blockRequest = `stage15-block-${runId}`; const blocked = await api(origin, desktop, 'POST', `/personal/v1/tasks/${rootTaskId}/supplements`, { requestId: blockRequest, text: 'stage15-block-until-stop' }); assert.equal(blocked.status, 202);
  const blockCommand = await command(origin, desktop, blocked.body.command.commandId); await until(() => blockResponse !== null, 30_000);
  assert.equal((await api(origin, desktop, 'POST', `/personal/v1/tasks/${rootTaskId}/stop`, { requestId: `stage15-stop-${runId}` })).status, 202); await terminal(origin, desktop, sessionId, blockCommand.receiptId, 'aborted');
  const stopped = await until(async () => { const value = await api(origin, desktop, 'GET', `/personal/v1/tasks/${rootTaskId}`); return value.body.control?.stopStatus === 'stopped' ? value.body : null; }); assert.equal(stopped.control.reasonCode, 'STOP_OBSERVED'); evidence.stopObserved = true;
  modelCallsBeforeRestart = modelCalls; assert.equal(await shutdown(), true); output = ''; child = startHost(); origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const relogin = await api(origin, null, 'POST', '/personal/v1/auth/login', { ...login, deviceName: 'Stage15 recovery' }); assert.equal(relogin.status, 200); desktop = { cookie: relogin.cookie, csrf: relogin.body.csrfToken };
  const replayAdopt = await api(origin, desktop, 'POST', `/personal/v1/sync/conversations/${conversationId}/shared`, adoption); assert.equal(replayAdopt.status, 202); assert.equal(replayAdopt.body.command.commandId, adoptCommand.commandId);
  const original = await api(origin, desktop, 'GET', `/personal/v1/commands/by-request/${messageRequest}`); const toolOriginal = await api(origin, desktop, 'GET', `/personal/v1/commands/by-request/${toolRequest}`); const extra = await api(origin, desktop, 'GET', `/personal/v1/commands/by-request/${supplementRequest}`); assert.equal(original.body.command.commandId, phoneContinuation.commandId); assert.equal(toolOriginal.body.command.commandId, rootTaskId); assert.equal(extra.body.command.commandId, supplementCommand.commandId);
  const sessions = await api(origin, desktop, 'GET', '/personal/v1/sessions'); assert.equal(sessions.body.sessions.filter((item) => item.conversationId === conversationId).length, 1); assert.equal(modelCalls, modelCallsBeforeRestart); evidence.duplicateRequestNoRegeneration = true; evidence.restartNoReplay = true;
  evidence.result = 'passed'; console.log('[stage15-handoff] synthetic same-session adoption, exact artifact, supplement, stop, and restart dedupe passed');
} catch (error) { evidence.failure = { code: typeof error?.code === 'string' ? error.code : 'ACCEPTANCE_FAILED', name: error?.name ?? 'Error' }; throw error; }
finally { const outputPath = join(evidenceDir, `synthetic-handoff-${runId}.json`); try { writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); } finally { await shutdown().catch(() => {}); await new Promise((resolve) => upstream.close(resolve)); if (child?.exitCode === 0 && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true }); } }
