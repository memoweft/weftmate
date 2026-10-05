/** Explicit isolated Android acceptance for persisted host file cards and verified native download. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_ANDROID_FILE_BRIDGE !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_ANDROID_FILE_BRIDGE=1 for isolated Android file acceptance.');
}
const adb = process.env.WEFTMATE_STAGE15_ADB;
const serial = process.env.WEFTMATE_STAGE15_ANDROID_SERIAL;
const appApk = process.env.WEFTMATE_STAGE15_ANDROID_APP_APK;
const testApk = process.env.WEFTMATE_STAGE15_ANDROID_TEST_APK;
if (![adb, appApk, testApk].every((value) => typeof value === 'string' && existsSync(value)) ||
    typeof serial !== 'string' || !serial) throw new Error('Existing adb, serial, app APK and test APK are required.');

const root = mkdtempSync(join(tmpdir(), 'weftmate-stage15-files-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const username = `stage15file${suffix}`;
const password = `Stage15-${randomUUID()}-files`;
const hostProfile = { id: 'stage15-files-model', model: 'stage15-synthetic',
  baseUrl: 'http://127.0.0.1:8081/v1', provider: 'openai-compatible', source: 'formal-host-catalog',
  credentialHash: createHash('sha256').update('stage15-files').digest('hex') };
const fileName = `stage15-${suffix}.bin`;
const fileBytes = Buffer.alloc(2 * 1024 * 1024 + 137);
for (let index = 0; index < fileBytes.length; index++) fileBytes[index] = index % 251;
const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
const attachmentId = `attachment-${randomUUID()}`;
const attachmentMessageId = `message-${randomUUID()}`;
let sessionId = '';
let acceptedText = '';
const receiptId = `receipt-stage15-${suffix}`;
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [{ id: hostProfile.id, model: hostProfile.model, configured: true, source: 'host' }],
  preflight: async () => ({ ok: true }),
  createSession: async (input) => ({ sessionId: input.sessionId }),
  sendMessage: async (input) => { acceptedText = input.text; return { accepted: true, receiptId }; },
  cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => {
    if (!acceptedText || afterSeq >= 4) return { events: [], nextSeq: Math.max(afterSeq, acceptedText ? 4 : -1), hasMore: false };
    const all = [{ seq: 1, type: 'turn.started', data: { turn: 1 } },
      { seq: 2, type: 'user.message', data: { text: acceptedText.slice(0, 4_000), truncated: acceptedText.length > 4_000,
        messageHash: createHash('sha256').update(acceptedText).digest('hex'), receiptId } },
      { seq: 3, type: 'assistant.message', data: { text: '文件已经安全保存，可在任一登录设备下载。' } },
      { seq: 4, type: 'turn.ended', data: { turn: 1, reason: 'completed' } }];
    const events = all.filter((event) => event.seq > afterSeq);
    return { events, nextSeq: 4, hasMore: false };
  },
  describeSession: async (id) => id === sessionId
    ? { sessionId: id, title: 'Stage15 文件验收', running: false,
      agentPreset: 'personal-shared-chat', modelProfileId: hostProfile.id } : null,
};
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend,
  sharedProfileIsFormal: (profile) => profile.id === hostProfile.id });
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { windowsHide: true, encoding: 'utf8', timeout: 60_000 });
const runAsync = (...args) => promisify(execFile)(adb, ['-s', serial, ...args],
  { windowsHide: true, encoding: 'utf8', timeout: 180_000 });
let reversePort = null;

async function register(origin) {
  const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, deviceName: 'Stage15 Files Host' }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: body.csrfToken };
}
async function command(origin, account, body) {
  return fetch(`${origin}/personal/v1/commands`, { method: 'POST', headers: { origin,
    cookie: account.cookie, 'x-weftmate-csrf': account.csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}
async function waitAccepted(origin, account, commandId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch(`${origin}/personal/v1/commands/${commandId}`, { headers: { cookie: account.cookie } });
    const row = (await response.json()).command;
    if (row.state === 'accepted_by_dsh') return row;
    if (row.state === 'rejected') throw new Error(`command rejected: ${row.errorCode}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('command acceptance timed out');
}

try {
  const identity = await service.start();
  const { origin, hostId } = identity;
  const account = await register(origin);
  await service.setSharedModelProfiles([hostProfile]);
  const createdResponse = await command(origin, account, { requestId: `stage15-create-${suffix}`,
    kind: 'session.create', targetDeviceId: hostId, modelProfileId: hostProfile.id });
  assert.equal(createdResponse.status, 202);
  const created = (await createdResponse.json()).command;
  sessionId = created.sessionId;
  await waitAccepted(origin, account, created.commandId);

  const upload = await fetch(`${origin}/personal/v1/sync/attachments/${attachmentId}` +
    `?conversationId=${sessionId}&messageId=${attachmentMessageId}&name=${encodeURIComponent(fileName)}`, {
    method: 'PUT', headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
      'content-type': 'application/octet-stream', 'x-weftmate-sha256': fileSha256 }, body: fileBytes });
  assert.equal(upload.status, 201);
  const original = (await upload.json()).attachment;
  const sent = await command(origin, account, { requestId: `stage15-file-${suffix}`, kind: 'session.message',
    targetDeviceId: hostId, sessionId, text: '请保存这个验收文件。', attachmentMessageId,
    originalAttachments: [original] });
  assert.equal(sent.status, 202);
  const accepted = await waitAccepted(origin, account, (await sent.json()).command.commandId);
  assert.equal(accepted.receiptId, receiptId);
  const historyResponse = await fetch(`${origin}/personal/v1/sessions/${sessionId}/events`,
    { headers: { cookie: account.cookie } });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  const user = history.events.find((event) => event.type === 'user.message');
  assert.equal(user.data.text, '请保存这个验收文件。');
  assert.deepEqual(user.data.originalAttachments, [original]);
  assert.equal(JSON.stringify(history).includes('messageHash'), false);

  const port = Number(new URL(origin).port);
  run('reverse', `tcp:${port}`, `tcp:${port}`); reversePort = port;
  try { run('uninstall', 'com.memoweft.weftmate.mobile.stage15filesqa.test'); } catch {}
  try { run('uninstall', 'com.memoweft.weftmate.mobile.stage15filesqa'); } catch {}
  run('install', '-r', appApk);
  run('install', '-r', testApk);
  const { stdout } = await runAsync('shell', 'am', 'instrument', '-w', '-r',
    '-e', 'class', 'com.memoweft.weftmate.mobile.Stage15FileBridgeInstrumentedTest',
    '-e', 'stage15FileBridge', '1', '-e', 'origin', `http://127.0.0.1:${port}`,
    '-e', 'username', username, '-e', 'password', password, '-e', 'sessionId', sessionId,
    '-e', 'fileName', fileName, '-e', 'fileSize', String(fileBytes.length), '-e', 'fileSha256', fileSha256,
    ...(process.env.WEFTMATE_STAGE15_FILE_REOPEN_ONLY === '1' ? ['-e', 'reopenOnly', '1'] : []),
    'com.memoweft.weftmate.mobile.stage15filesqa.test/androidx.test.runner.AndroidJUnitRunner');
  assert.match(stdout, /OK \(1 test\)/);
  console.log(JSON.stringify({ sessionId, attachmentId, fileName, size: fileBytes.length, sha256: fileSha256,
    screenshots: ['stage15-files-card-first.png', 'stage15-files-card-reopened.png',
      'stage15-files-save-picker.png', 'stage15-files-saved.png'] }));
} finally {
  if (reversePort !== null) try { run('reverse', '--remove', `tcp:${reversePort}`); } catch {}
  await service.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
