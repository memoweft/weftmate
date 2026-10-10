// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Bounded isolated host for manually observing the desktop ordinary-file candidate. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';

if (process.env.WEFTMATE_STAGE15_FILE_UI_SERVE !== '1') throw new Error('Explicit file UI fixture only.');
const evidenceRoot = 'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Stage15-WindowsAndroid-20261005/Attachments';
const candidate = join(evidenceRoot, 'DesktopUiCandidate');
const candidateAssets = ['index.html', 'app.js', 'styles.css', 'file-sha256.js',
  'vendor/noble-hashes-2.3.0/sha2.js', 'vendor/noble-hashes-2.3.0/_md.js',
  'vendor/noble-hashes-2.3.0/_u64.js', 'vendor/noble-hashes-2.3.0/utils.js'];
for (const name of candidateAssets) if (!existsSync(join(candidate, name)))
  throw new Error(`missing desktop candidate ${name}`);
const root = await mkdtemp(join(tmpdir(), 'weftmate-stage15-file-ui-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const username = `stage15win${suffix}`;
const password = `Stage15-${randomUUID()}-windows-file`;
const profile = { id: 'stage15-files-model', model: 'stage15-synthetic',
  baseUrl: 'http://127.0.0.1:8081/v1', provider: 'openai-compatible', source: 'formal-host-catalog',
  credentialHash: createHash('sha256').update('stage15-files-win').digest('hex') };
const fileName = `stage15-windows-${suffix}.csv`;
const fileBytes = Buffer.from('row,value\nmarker,WINDOWS_GUI_ATTACHMENT_OK\n' +
  Array.from({ length: 280_000 }, (_, index) => `${index},${index % 97}`).join('\n'));
const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
const attachmentId = `attachment-${randomUUID()}`;
const attachmentMessageId = `message-${randomUUID()}`;
let sessionId = '';
let nextSeq = 0;
let nextTurn = 0;
let nextReceipt = 0;
const eventLog = [];
function appendSyntheticTurn(input) {
  const turn = ++nextTurn;
  const receiptId = `receipt-stage15-win-${suffix}-${++nextReceipt}`;
  // Keep the synthetic event behind the durable command receipt. The product
  // public-history projection, rather than this fixture, restores the original
  // user text and originalAttachments from that receipt and message hash.
  const visibleAt = Date.now() + 100;
  const append = (type, data) => eventLog.push({ seq: ++nextSeq, type, data, visibleAt });
  append('turn.started', { turn });
  append('user.message', { text: input.text.slice(0, 4_000), truncated: true,
    messageHash: createHash('sha256').update(input.text).digest('hex'), receiptId });
  append('assistant.message', { text: turn === 1 ? 'Windows 文件卡已从持久历史恢复。'
    : 'Windows 新附件已由合成 SDK 接收，原件引用已持久保存。' });
  append('turn.ended', { turn, reason: 'completed' });
  return { accepted: true, receiptId };
}
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', modules: {}, capabilities: {
    chat: { available: true, inferenceVerified: true }, desktopOpenApp: { available: false },
    naturalLanguageDesktop: { available: false },
  } }),
  listModels: async () => [{ id: profile.id, name: 'Stage15 合成模型', model: profile.model,
    configured: true, source: 'host' }],
  preflight: async () => ({ ok: true }), createSession: async (input) => ({ sessionId: input.sessionId }),
  sendMessage: async (input) => appendSyntheticTurn(input),
  cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => {
    const visible = eventLog.filter((event) => event.visibleAt <= Date.now());
    const page = visible.filter((event) => event.seq > afterSeq).slice(0, 200);
    const through = page.at(-1)?.seq ?? afterSeq;
    return { events: page.map(({ visibleAt: _visibleAt, ...event }) => event), nextSeq: through,
      hasMore: visible.some((event) => event.seq > through) };
  },
  describeSession: async (id) => id === sessionId ? { sessionId: id, title: 'Stage15 Windows 文件验收',
    running: false, agentPreset: 'personal-shared-chat', modelProfileId: profile.id } : null,
};
const assetTypes = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8', 'file-sha256.js': 'text/javascript; charset=utf-8',
  'vendor/noble-hashes-2.3.0/sha2.js': 'text/javascript; charset=utf-8',
  'vendor/noble-hashes-2.3.0/_md.js': 'text/javascript; charset=utf-8',
  'vendor/noble-hashes-2.3.0/_u64.js': 'text/javascript; charset=utf-8',
  'vendor/noble-hashes-2.3.0/utils.js': 'text/javascript; charset=utf-8' };
const uiHandler = async (request, response) => {
  if (request.method !== 'GET') return false;
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const name = ['/personal/v1/ui', '/personal/v1/ui/', '/personal/v1/ui/index.html'].includes(pathname)
    ? 'index.html' : pathname.startsWith('/personal/v1/ui/') ? pathname.slice('/personal/v1/ui/'.length) : null;
  if (name && !candidateAssets.includes(name)) return false;
  if (!name) return false;
  const body = readFileSync(join(candidate, name));
  response.writeHead(200, { 'content-type': assetTypes[name], 'content-length': String(body.length),
    'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:" });
  response.end(body); return true;
};
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 18191, backend, uiHandler,
  sharedProfileIsFormal: (item) => item.id === profile.id });
async function waitAccepted(origin, cookie, commandId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch(`${origin}/personal/v1/commands/${commandId}`, { headers: { cookie } });
    const row = (await response.json()).command;
    if (row.state === 'accepted_by_dsh') return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('acceptance timed out');
}
try {
  const { origin, hostId } = await service.start();
  const registered = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST', headers: { origin,
    'content-type': 'application/json' }, body: JSON.stringify({ username, password, deviceName: 'Windows UI Fixture' }) });
  assert.equal(registered.status, 201); const registration = await registered.json();
  const account = { cookie: registered.headers.get('set-cookie').split(';')[0], csrf: registration.csrfToken };
  const write = (body) => fetch(`${origin}/personal/v1/commands`, { method: 'POST', headers: { origin,
    cookie: account.cookie, 'x-weftmate-csrf': account.csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await service.setSharedModelProfiles([profile]);
  const created = await write({ requestId: `create-${suffix}`, kind: 'session.create', targetDeviceId: hostId,
    modelProfileId: profile.id }); sessionId = (await created.json()).command.sessionId;
  await waitAccepted(origin, account.cookie, (await (await fetch(`${origin}/personal/v1/commands?limit=1`,
    { headers: { cookie: account.cookie } })).json()).commands[0].commandId);
  const uploaded = await fetch(`${origin}/personal/v1/sync/attachments/${attachmentId}` +
    `?conversationId=${sessionId}&messageId=${attachmentMessageId}&name=${encodeURIComponent(fileName)}`, {
    method: 'PUT', headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
      'content-type': 'text/csv', 'x-weftmate-sha256': fileSha256 }, body: fileBytes });
  const original = (await uploaded.json()).attachment;
  const sent = await write({ requestId: `file-${suffix}`, kind: 'session.message', targetDeviceId: hostId,
    sessionId, text: '请保留并显示这个 Windows 验收文件。', attachmentMessageId, originalAttachments: [original] });
  await waitAccepted(origin, account.cookie, (await sent.json()).command.commandId);
  for (let attempt = 0; attempt < 20 && !eventLog.every((event) => event.visibleAt <= Date.now()); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(eventLog.length === 4 && eventLog.every((event) => event.visibleAt <= Date.now()));
  mkdirSync(evidenceRoot, { recursive: true });
  const testFilePath = join(evidenceRoot, `stage15-windows-upload-${suffix}.csv`);
  writeFileSync(testFilePath, fileBytes);
  assert.equal(createHash('sha256').update(readFileSync(testFilePath)).digest('hex'), fileSha256);
  writeFileSync(join(evidenceRoot, 'private-stage15-windows-file-ui.json'), JSON.stringify({ origin,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), username, password, sessionId, fileName,
    size: fileBytes.length, sha256: fileSha256, testFilePath }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ origin: `${origin}/personal/v1/ui/`, sessionId, fileName,
    size: fileBytes.length, sha256: fileSha256, testFilePath,
    privateFixture: join(evidenceRoot, 'private-stage15-windows-file-ui.json') }));
  await new Promise((resolve) => setTimeout(resolve, 10 * 60_000));
} finally { await service.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
