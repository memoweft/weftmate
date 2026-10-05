/** Isolated Stage 15.4 original file -> bounded DSH input -> model reply -> public history acceptance. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptStage12Dpapi } from './stage12-dpapi-loader.mjs';

const synthetic = process.env.WEFTMATE_STAGE15_ATTACHMENT_SYNTHETIC_E2E === '1';
const realRelay = process.env.WEFTMATE_STAGE15_ATTACHMENT_REAL_E2E === '1';
if (process.platform !== 'win32' || synthetic === realRelay) {
  throw new Error('Select exactly one Stage 15 attachment synthetic or real mode on Windows.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const evidenceDir = join(repository, '..', 'Runtime', 'UnifiedAssistant',
  'Stage15-WindowsAndroid-20261005', 'Attachments');
mkdirSync(evidenceDir, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage15-attachment-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'),
  `${JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' })}\n`, { flag: 'wx', mode: 0o600 });

const runId = randomUUID();
const marker = `STAGE15-FILE-MARKER-${runId.slice(0, 8).toUpperCase()}`;
const tailMarker = `STAGE15-TAIL-NOT-STAGED-${runId.slice(9, 17).toUpperCase()}`;
const pdfRawMarker = `STAGE15-PDF-RAW-NOT-READ-${runId.slice(18, 26).toUpperCase()}`;
const prompt = '请读取可读文本附件，只回复其中以 STAGE15-FILE-MARKER- 开头的完整标记。不要调用工具，不要解释。';
const textPrefix = `Stage 15 attachment reference\nanswer=${marker}\n`;
const textSize = 2 * 1024 * 1024 + 733;
const textBytes = Buffer.alloc(textSize, 0x61);
textBytes.write(textPrefix, 0, 'utf8');
textBytes.write(`\n${tailMarker}\n`, textBytes.length - Buffer.byteLength(tailMarker) - 3, 'utf8');
// The synthetic pass exercises the established 12 KiB path. The paid pass uses
// a smaller but still bounded excerpt so a long repeated-file tail cannot spend
// the model's output budget before the one requested marker is returned.
const stagedBytes = textBytes.subarray(0, realRelay ? 2 * 1024 : 12 * 1024);
const pdfBytes = Buffer.concat([Buffer.from(`%PDF-1.7\n% ${pdfRawMarker}\n`, 'utf8'), Buffer.alloc(32 * 1024, 0x42)]);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const textSha256 = sha(textBytes), stagedSha256 = sha(stagedBytes), pdfSha256 = sha(pdfBytes);
const textAttachmentId = `attachment-${randomUUID()}`;
const pdfAttachmentId = `attachment-${randomUUID()}`;
const attachmentMessageId = `message-${randomUUID()}`;
const textName = `stage15-${runId.slice(0, 8)}.txt`;
const pdfName = `stage15-metadata-${runId.slice(0, 8)}.pdf`;
const deadline = Date.now() + (realRelay ? 12 * 60_000 : 6 * 60_000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = {
  classification: realRelay ? 'real-mimo' : 'synthetic-sdk', runId,
  limits: { providerCompletionsMaximum: realRelay ? 3 : 0, providerCompletionMs: 240_000,
    runMs: realRelay ? 720_000 : 360_000 },
  providerCompletions: { attempted: 0, forwarded: 0, rejected: 0, finishReasons: [] },
  originals: { text: { attachmentId: textAttachmentId, name: textName, size: textBytes.length,
    sha256: textSha256, contentType: 'text/plain' },
  unsupported: { attachmentId: pdfAttachmentId, name: pdfName, size: pdfBytes.length,
    sha256: pdfSha256, contentType: 'application/pdf' } },
  modelInput: { stagedBytes: stagedBytes.length, stagedSha256, sdkCompositeHash: null,
    persistedModelInputHash: null, markerPresent: false, tailAbsent: false, unsupportedRawAbsent: false,
    unsupportedMetadataPresent: false },
  completion: { terminal: null, markerAnswered: false, replyEvidenceStatus: null,
    assistantMessages: null, textChunks: null },
  publicHistory: { originalTextOnly: false, originalRefsExact: false, wrapperAbsent: false,
    markerAbsentFromUserText: false, internalHashAbsent: false },
  access: { sameAccountTextExact: false, sameAccountPdfExact: false, foreignText404: false,
    restartHistoryRestored: false, restartTextExact: false },
  result: 'failed', failure: null,
};
let child = null, output = '', relayKey = null, cleanShutdown = false;
let providerBody = null, sdkCompositeText = null;

if (realRelay) {
  const keyPath = process.env.WEFTMATE_STAGE15_MIMO_DPAPI_PATH;
  const privateRoot = realpathSync(join(repository, '..', 'Runtime', 'UnifiedAssistant', 'private-model-tests'));
  if (!keyPath || !isAbsolute(keyPath) || basename(keyPath) !== 'mimo-v2.6-flash.dpapi' ||
      !realpathSync(keyPath).startsWith(privateRoot + sep)) {
    throw new Error('Authorized Stage 15 MiMo DPAPI fixture is required.');
  }
  relayKey = await decryptStage12Dpapi(realpathSync(keyPath));
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('');
}
function sse(response, content) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  const frame = (choice) => response.write(`data: ${JSON.stringify({ id: 'stage15-attachment',
    object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'synthetic-stop-model',
    choices: [choice] })}\n\n`);
  frame({ index: 0, delta: { role: 'assistant', content }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: 'stop' });
  response.end('data: [DONE]\n\n');
}
const upstream = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-stop-model', object: 'model' }] }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end(); return;
  }
  let raw = '';
  for await (const part of request) {
    raw += part;
    if (raw.length > 1024 * 1024) { response.destroy(); return; }
  }
  const body = JSON.parse(raw);
  assert.equal(body.model, 'synthetic-stop-model');
  evidence.providerCompletions.attempted++;
  if (evidence.providerCompletions.attempted > (realRelay ? 3 : 1)) {
    evidence.providerCompletions.rejected++;
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'PROVIDER_COMPLETION_LIMIT' } })); return;
  }
  providerBody = body;
  const userTexts = (body.messages ?? []).filter((item) => item?.role === 'user').map(messageText);
  const composite = userTexts.find((text) => text.includes(marker) && text.includes('[BEGIN REFERENCE FILE')) ?? null;
  assert.equal(typeof composite, 'string');
  // DSH may continue a length-limited provider response. The immutable command
  // hash corresponds to the first SDK prompt, not a later continuation body.
  if (sdkCompositeText === null) {
    sdkCompositeText = composite;
    evidence.modelInput.sdkCompositeHash = sha(composite);
  }
  evidence.modelInput.markerPresent = composite.includes(marker);
  evidence.modelInput.tailAbsent = !composite.includes(tailMarker);
  evidence.modelInput.unsupportedRawAbsent = !composite.includes(pdfRawMarker);
  evidence.modelInput.unsupportedMetadataPresent = composite.includes(pdfName) &&
    composite.includes(pdfSha256) && composite.includes('application/pdf');
  assert.equal(evidence.modelInput.markerPresent, true);
  assert.equal(evidence.modelInput.tailAbsent, true);
  assert.equal(evidence.modelInput.unsupportedRawAbsent, true);
  assert.equal(evidence.modelInput.unsupportedMetadataPresent, true);
  if (!realRelay) { sse(response, marker); return; }
  evidence.providerCompletions.forwarded++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const actual = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${relayKey}`, 'content-type': 'application/json',
        accept: 'text/event-stream' },
      body: JSON.stringify({ ...body, model: 'mimo-v2.6-flash' }),
    });
    if (!actual.ok || !actual.body || !/^text\/event-stream/i.test(actual.headers.get('content-type') ?? '')) {
      response.writeHead(actual.status || 502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'REAL_PROVIDER_UNAVAILABLE' } })); return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    let bytes = 0, carry = '';
    const decoder = new TextDecoder();
    const inspectFrames = (text) => {
      carry += text;
      const lines = carry.split(/\r?\n/); carry = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6); if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          for (const choice of parsed?.choices ?? []) if (typeof choice?.finish_reason === 'string' &&
              !evidence.providerCompletions.finishReasons.includes(choice.finish_reason)) {
            evidence.providerCompletions.finishReasons.push(choice.finish_reason);
          }
        } catch { /* Provider bytes are relayed unchanged; malformed frames remain a DSH concern. */ }
      }
    };
    for await (const part of actual.body) {
      bytes += part.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('provider response too large');
      inspectFrames(decoder.decode(part, { stream: true }));
      response.write(part);
    }
    inspectFrames(decoder.decode());
    response.end();
  } finally { clearTimeout(timer); controller.abort(); }
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;

const electron = createRequire(import.meta.url)('electron');
function startHost() {
  const running = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
      WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1' },
  });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (part) => {
    output = (output + String(part)).slice(-64 * 1024);
  });
  return running;
}
async function until(check, cap = 90_000) {
  const end = Math.min(deadline, Date.now() + cap);
  while (Date.now() < end) {
    const value = await check(); if (value) return value;
    if (!child || child.exitCode !== null) throw new Error('isolated host exited');
    await pause(100);
  }
  throw new Error('Stage 15 attachment fixture timed out');
}
function manage(action, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error('management timeout')); }, 45_000);
    const receive = (frame) => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', receive); clearTimeout(timer);
      frame.ok === true ? resolve(frame.result) : reject(new Error(`management failed: ${frame.code}`));
    };
    child.on('message', receive);
    child.send({ type: 'weftmate:manage', requestId, action, ...fields }, (error) => {
      if (error) { child.off('message', receive); clearTimeout(timer); reject(error); }
    });
  });
}
async function api(origin, account, method, route, body) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...(account?.cookie ? { cookie: account.cookie } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json',
        ...(account?.csrf ? { 'x-weftmate-csrf': account.csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.min(20_000, Math.max(1, deadline - Date.now()))),
  });
  const contentType = response.headers.get('content-type') ?? '';
  return { status: response.status,
    body: /^application\/json/i.test(contentType) ? await response.json() : Buffer.from(await response.arrayBuffer()),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function upload(origin, account, route, bytes, contentType, digest) {
  const response = await fetch(`${origin}${route}`, { method: 'PUT', headers: { origin,
    cookie: account.cookie, 'x-weftmate-csrf': account.csrf, 'content-type': contentType,
    'x-weftmate-sha256': digest, 'content-length': String(bytes.length) }, body: bytes,
    signal: AbortSignal.timeout(Math.min(120_000, Math.max(1, deadline - Date.now()))),
    duplex: 'half' });
  return { status: response.status, body: await response.json() };
}
async function settledCommand(origin, account, commandId) {
  return until(async () => {
    const current = await api(origin, account, 'GET', `/personal/v1/commands/${commandId}`);
    assert.equal(current.status, 200);
    return ['pending', 'dispatching'].includes(current.body.command?.state) ? null : current.body.command;
  }, 60_000);
}
async function history(origin, account, sessionId) {
  const events = []; let afterSeq = -1;
  for (let page = 0; page < 16; page++) {
    const current = await api(origin, account, 'GET',
      `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
    assert.equal(current.status, 200); events.push(...current.body.events);
    if (!current.body.hasMore) return events;
    assert.ok(current.body.nextSeq > afterSeq); afterSeq = current.body.nextSeq;
  }
  throw new Error('bounded history exceeded');
}
async function terminal(origin, account, sessionId, receiptId) {
  return until(async () => {
    const rows = await history(origin, account, sessionId);
    const user = rows.find((event) => event.type === 'user.message' && event.data?.receiptId === receiptId);
    const start = rows.findLast((event) => event.type === 'turn.started' && event.seq < user?.seq);
    const end = rows.find((event) => event.type === 'turn.ended' && event.data?.turn === start?.data?.turn);
    return end ? { rows, user, start, end } : null;
  }, 240_000);
}
async function shutdown() {
  if (!child || child.exitCode !== null) return child?.exitCode === 0;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.send({ type: 'weftmate:quit' });
  const graceful = await Promise.race([closed.then(() => true), pause(20_000).then(() => false)]);
  if (!graceful && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve) => killer.once('close', resolve)); await closed;
  }
  cleanShutdown = child.exitCode === 0;
  return cleanShutdown;
}
function safeFailure(error) {
  return { name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'ATTACHMENT_ACCEPTANCE_FAILED' };
}

let origin = null, owner = null, foreign = null, login = null, sessionId = null, commandId = null;
try {
  child = startHost();
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const configured = await manage('model.configure-synthetic-stop-fixture',
    { baseUrl: `http://127.0.0.1:${upstreamPort}/v1` });
  assert.equal(configured.id, 'synthetic-stop-fixture');
  const grant = await manage('account.setup');
  login = { username: `Stage15Attach${runId.slice(0, 8)}`, password: `stage15-${randomUUID()}-pass` };
  const setup = await api(origin, null, 'POST', '/personal/v1/auth/setup',
    { grant: grant.grant, ...login, deviceName: 'Stage 15 attachment owner' });
  assert.equal(setup.status, 201);
  owner = { cookie: setup.cookie, csrf: setup.body.csrfToken };
  const foreignLogin = { username: `Stage15Foreign${runId.slice(0, 8)}`,
    password: `stage15-${randomUUID()}-foreign` };
  const registeredForeign = await api(origin, null, 'POST', '/personal/v1/auth/register',
    { ...foreignLogin, deviceName: 'Stage 15 foreign owner' });
  assert.equal(registeredForeign.status, 201);
  foreign = { cookie: registeredForeign.cookie, csrf: registeredForeign.body.csrfToken, login: foreignLogin };
  const status = await api(origin, owner, 'GET', '/personal/v1/status');
  assert.equal(status.status, 200);
  const opened = await api(origin, owner, 'POST', '/personal/v1/commands', {
    requestId: `stage15-attachment-session-${runId}`, kind: 'session.create',
    targetDeviceId: status.body.hostId, modelProfileId: 'synthetic-stop-fixture',
  });
  assert.equal(opened.status, 202);
  const session = await settledCommand(origin, owner, opened.body.command.commandId);
  assert.equal(session.state, 'accepted_by_dsh'); sessionId = session.sessionId;

  const originalText = await upload(origin, owner,
    `/personal/v1/sync/attachments/${textAttachmentId}?conversationId=${sessionId}` +
      `&messageId=${attachmentMessageId}&name=${encodeURIComponent(textName)}`,
    textBytes, 'text/plain', textSha256);
  assert.equal(originalText.status, 201);
  const originalPdf = await upload(origin, owner,
    `/personal/v1/sync/attachments/${pdfAttachmentId}?conversationId=${sessionId}` +
      `&messageId=${attachmentMessageId}&name=${encodeURIComponent(pdfName)}`,
    pdfBytes, 'application/pdf', pdfSha256);
  assert.equal(originalPdf.status, 201);
  const requestId = `stage15-attachment-message-${runId}`;
  const staged = await upload(origin, owner,
    `/personal/v1/sessions/${sessionId}/attachments/${textAttachmentId}` +
      `?requestId=${encodeURIComponent(requestId)}&name=${encodeURIComponent(textName)}`,
    stagedBytes, 'text/plain', stagedSha256);
  assert.equal(staged.status, 201);
  const sent = await api(origin, owner, 'POST', '/personal/v1/commands', {
    requestId, kind: 'session.message', targetDeviceId: status.body.hostId, sessionId,
    mode: 'queue', text: prompt, attachments: [staged.body.attachment],
    attachmentMessageId, originalAttachments: [originalText.body.attachment, originalPdf.body.attachment],
  });
  assert.equal(sent.status, 202); commandId = sent.body.command.commandId;
  const accepted = await settledCommand(origin, owner, commandId);
  assert.equal(accepted.state, 'accepted_by_dsh');
  const completed = await terminal(origin, owner, sessionId, accepted.receiptId);
  evidence.completion.terminal = completed.end.data?.reason ?? null;
  const userIndex = completed.rows.findIndex((event) => event.seq === completed.user.seq);
  const assistant = completed.rows.slice(userIndex + 1)
    .find((event) => event.type === 'assistant.message' && typeof event.data?.text === 'string');
  evidence.completion.markerAnswered = assistant?.data.text.includes(marker) === true;
  const task = await until(async () => {
    const current = await api(origin, owner, 'GET', `/personal/v1/tasks/${commandId}`);
    assert.equal(current.status, 200);
    return ['completed', 'aborted', 'error'].includes(current.body.replyEvidence?.status)
      ? current.body : null;
  }, 30_000);
  evidence.completion.replyEvidenceStatus = task.replyEvidence.status;
  evidence.completion.assistantMessages = task.replyEvidence.assistantMessages;
  evidence.completion.textChunks = task.replyEvidence.textChunks;
  assert.equal(evidence.completion.terminal, 'completed');
  assert.equal(evidence.completion.replyEvidenceStatus, 'completed');
  assert.equal(evidence.completion.markerAnswered, true);

  const store = JSON.parse(readFileSync(join(profile, 'personal-access', 'store.json'), 'utf8'));
  const internal = Object.values(store.accounts).map((account) => account.commands?.[commandId]).find(Boolean);
  assert.ok(internal);
  evidence.modelInput.persistedModelInputHash = internal.payload.modelInputHash;
  evidence.publicHistory.originalTextOnly = completed.user.data.text === prompt;
  evidence.publicHistory.originalRefsExact = JSON.stringify(completed.user.data.originalAttachments) ===
    JSON.stringify([originalText.body.attachment, originalPdf.body.attachment]);
  const publicUserJson = JSON.stringify(completed.user);
  evidence.publicHistory.wrapperAbsent = !publicUserJson.includes('BEGIN REFERENCE FILE') &&
    !publicUserJson.includes('Attached files retained');
  evidence.publicHistory.markerAbsentFromUserText = !completed.user.data.text.includes(marker);
  evidence.publicHistory.internalHashAbsent = !publicUserJson.includes('messageHash') &&
    !publicUserJson.includes('modelInputHash');
  for (const value of Object.values(evidence.publicHistory)) assert.equal(value, true);
  assert.equal(evidence.modelInput.persistedModelInputHash, evidence.modelInput.sdkCompositeHash);

  const textRead = await api(origin, owner, 'GET',
    `/personal/v1/sync/attachments/${textAttachmentId}`);
  assert.equal(textRead.status, 200);
  evidence.access.sameAccountTextExact = sha(textRead.body) === textSha256 && textRead.body.length === textBytes.length;
  const pdfRead = await api(origin, owner, 'GET', `/personal/v1/sync/attachments/${pdfAttachmentId}`);
  assert.equal(pdfRead.status, 200);
  evidence.access.sameAccountPdfExact = sha(pdfRead.body) === pdfSha256 && pdfRead.body.length === pdfBytes.length;
  const foreignRead = await api(origin, foreign, 'GET', `/personal/v1/sync/attachments/${textAttachmentId}`);
  evidence.access.foreignText404 = foreignRead.status === 404;
  assert.equal(evidence.access.sameAccountTextExact, true);
  assert.equal(evidence.access.sameAccountPdfExact, true);
  assert.equal(evidence.access.foreignText404, true);

  assert.equal(await shutdown(), true);
  output = ''; child = startHost();
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const relogin = await api(origin, null, 'POST', '/personal/v1/auth/login',
    { ...login, deviceName: 'Stage 15 attachment restart' });
  assert.equal(relogin.status, 200); owner = { cookie: relogin.cookie, csrf: relogin.body.csrfToken };
  const restartedRows = await history(origin, owner, sessionId);
  const restartedUser = restartedRows.find((event) => event.type === 'user.message' &&
    event.data?.receiptId === accepted.receiptId);
  evidence.access.restartHistoryRestored = restartedUser?.data?.text === prompt &&
    JSON.stringify(restartedUser.data.originalAttachments) ===
      JSON.stringify([originalText.body.attachment, originalPdf.body.attachment]);
  const restartedText = await api(origin, owner, 'GET', `/personal/v1/sync/attachments/${textAttachmentId}`);
  evidence.access.restartTextExact = restartedText.status === 200 && sha(restartedText.body) === textSha256 &&
    restartedText.body.length === textBytes.length;
  assert.equal(evidence.access.restartHistoryRestored, true);
  assert.equal(evidence.access.restartTextExact, true);
  assert.equal(evidence.providerCompletions.attempted, 1);
  if (realRelay) assert.equal(evidence.providerCompletions.forwarded, 1);
  evidence.result = 'passed';
  console.log(`[stage15-attachment-model] ${evidence.classification} SDK bounded text, model marker, public history, original GET and restart passed`);
} catch (error) {
  evidence.failure = safeFailure(error); throw error;
} finally {
  relayKey = null; providerBody = null; sdkCompositeText = null;
  evidence.finishedAt = new Date().toISOString();
  const outputPath = join(evidenceDir,
    `${realRelay ? 'real' : 'synthetic'}-attachment-model-${runId}.json`);
  try { writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  finally {
    await shutdown().catch(() => {});
    await new Promise((resolve) => upstream.close(resolve));
    if (child?.exitCode === 0 && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}
