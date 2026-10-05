/** Read-only HTTP verification for the isolated Windows ordinary-file UI fixture. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

if (process.env.WEFTMATE_STAGE15_WINDOWS_FILE_HTTP !== '1') {
  throw new Error('Explicit isolated Windows file HTTP verification only.');
}

const evidenceRoot = 'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Stage15-WindowsAndroid-20261005/Attachments';
const fixture = JSON.parse(readFileSync(`${evidenceRoot}/private-stage15-windows-file-ui.json`, 'utf8'));
const origin = new URL(fixture.origin).origin;
const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST', headers: {
  origin, 'content-type': 'application/json',
}, body: JSON.stringify({ username: fixture.username, password: fixture.password,
  deviceName: 'Windows attachment HTTP verification' }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
const loginBody = await login.json();
assert.ok(loginBody.csrfToken);

const assetNames = ['index.html', 'app.js', 'styles.css', 'file-sha256.js',
  'vendor/noble-hashes-2.3.0/sha2.js', 'vendor/noble-hashes-2.3.0/_md.js',
  'vendor/noble-hashes-2.3.0/_u64.js', 'vendor/noble-hashes-2.3.0/utils.js'];
const assets = [];
for (const name of assetNames) {
  const response = await fetch(`${origin}/personal/v1/ui/${name}`, { headers: { cookie } });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'self'/);
  assets.push({ name, status: response.status, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
}

async function history() {
  const response = await fetch(`${origin}/personal/v1/sessions/${encodeURIComponent(fixture.sessionId)}/events?afterSeq=-1&limit=200`,
    { headers: { cookie } });
  assert.equal(response.status, 200);
  return response.json();
}
const first = await history();
const user = first.events.find((event) => event.type === 'user.message' &&
  event.data?.originalAttachments?.some((item) => item.name === fixture.fileName));
assert.ok(user);
const reference = user.data.originalAttachments.find((item) => item.name === fixture.fileName);
assert.equal(reference.size, fixture.size);
assert.equal(reference.sha256, fixture.sha256);

async function download() {
  const response = await fetch(`${origin}/personal/v1/sync/attachments/${encodeURIComponent(reference.attachmentId)}`,
    { headers: { cookie } });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(bytes.length, fixture.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
  return { status: response.status, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}
const firstDownload = await download();
const statusResponse = await fetch(`${origin}/personal/v1/status`, { headers: { cookie } });
assert.equal(statusResponse.status, 200);
const status = await statusResponse.json();
assert.equal(typeof status.hostId, 'string');
const dynamicAttachmentId = `attachment-${randomUUID()}`;
const dynamicMessageId = `message-${randomUUID()}`;
const dynamicName = `dynamic-${fixture.fileName}`;
const testBytes = readFileSync(fixture.testFilePath);
assert.equal(testBytes.length, fixture.size);
assert.equal(createHash('sha256').update(testBytes).digest('hex'), fixture.sha256);
const dynamicUpload = await fetch(`${origin}/personal/v1/sync/attachments/${dynamicAttachmentId}` +
  `?conversationId=${encodeURIComponent(fixture.sessionId)}&messageId=${dynamicMessageId}` +
  `&name=${encodeURIComponent(dynamicName)}`, { method: 'PUT', headers: { origin, cookie,
    'x-weftmate-csrf': loginBody.csrfToken, 'content-type': 'text/csv',
    'x-weftmate-sha256': fixture.sha256 }, body: testBytes });
assert.equal(dynamicUpload.status, 201);
const dynamicOriginal = (await dynamicUpload.json()).attachment;
const dynamicRequestId = `dynamic-${randomUUID()}`;
const dynamicText = `请显示第二个动态 Windows 文件引用 ${dynamicRequestId.slice(-8)}。`;
const dynamicSend = await fetch(`${origin}/personal/v1/commands`, { method: 'POST', headers: { origin, cookie,
  'x-weftmate-csrf': loginBody.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({
  requestId: dynamicRequestId, kind: 'session.message', targetDeviceId: status.hostId,
  sessionId: fixture.sessionId, text: dynamicText, mode: 'queue', attachmentMessageId: dynamicMessageId,
  originalAttachments: [dynamicOriginal],
}) });
assert.equal(dynamicSend.status, 202);
const dynamicCommand = (await dynamicSend.json()).command;
let accepted;
for (let attempt = 0; attempt < 200; attempt++) {
  const response = await fetch(`${origin}/personal/v1/commands/${dynamicCommand.commandId}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  accepted = (await response.json()).command;
  if (accepted.state === 'accepted_by_dsh') break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
assert.equal(accepted?.state, 'accepted_by_dsh');
let second;
for (let attempt = 0; attempt < 100; attempt++) {
  second = await history();
  if (second.events.some((event) => event.seq > user.seq + 2 && event.type === 'user.message')) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const dynamicUser = second.events.find((event) => event.type === 'user.message' && event.data?.text === dynamicText);
assert.ok(dynamicUser);
assert.ok(dynamicUser.seq > user.seq);
assert.notEqual(dynamicUser.data.receiptId, user.data.receiptId);
assert.deepEqual(dynamicUser.data.originalAttachments, [dynamicOriginal]);
assert.notEqual(dynamicUser.data.truncated, true);
assert.ok(second.events.some((event) => event.seq > dynamicUser.seq && event.type === 'assistant.message'));
assert.ok(second.events.some((event) => event.seq > dynamicUser.seq && event.type === 'turn.ended' &&
  event.data?.reason === 'completed'));
const secondDownload = await download();
assert.deepEqual(second.events.find((event) => event.seq === user.seq)?.data.originalAttachments,
  user.data.originalAttachments);

const evidence = { generatedAt: new Date().toISOString(), classification: 'isolated-synthetic-sdk',
  staticAssets: assets, publicHistory: { originalTextOnly: user.data.text === '请保留并显示这个 Windows 验收文件。',
    referenceExact: true, attachmentId: reference.attachmentId, name: reference.name,
    size: reference.size, sha256: reference.sha256 },
  download: { first: firstDownload, afterReload: secondDownload, exactAfterReload: true },
  dynamicAppend: { acceptedState: accepted.state, requestId: dynamicRequestId,
    commandOriginalExact: JSON.stringify(accepted.originalAttachments) === JSON.stringify([dynamicOriginal]),
    userSeq: dynamicUser.seq, uniqueReceipt: dynamicUser.data.receiptId !== user.data.receiptId,
    publicTextExact: dynamicUser.data.text === dynamicText,
    publicOriginalRefsExact: JSON.stringify(dynamicUser.data.originalAttachments) === JSON.stringify([dynamicOriginal]),
    completed: second.events.some((event) => event.seq > dynamicUser.seq && event.type === 'turn.ended' &&
      event.data?.reason === 'completed') },
  gui: { historyCardVisible: true, fileSelectionUpload: 'blocked-by-edge-extension-file-access-setting' } };
writeFileSync(`${evidenceRoot}/windows-attachment-ui-http.json`, JSON.stringify(evidence, null, 2));
console.log(`[stage15-windows-file-http] ${assets.length}/${assets.length} assets, public file ref, dynamic append, exact download and reload passed`);
