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
for (const name of ['index.html', 'app.js', 'styles.css']) if (!existsSync(join(candidate, name)))
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
const fileBytes = Buffer.from('row,value\n' + Array.from({ length: 180_000 }, (_, index) => `${index},${index % 97}`).join('\n'));
const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
const attachmentId = `attachment-${randomUUID()}`;
const attachmentMessageId = `message-${randomUUID()}`;
const receiptId = `receipt-stage15-win-${suffix}`;
let sessionId = '';
let acceptedText = '';
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [{ id: profile.id, model: profile.model, configured: true, source: 'host' }],
  preflight: async () => ({ ok: true }), createSession: async (input) => ({ sessionId: input.sessionId }),
  sendMessage: async (input) => { acceptedText = input.text; return { accepted: true, receiptId }; },
  cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => {
    if (!acceptedText || afterSeq >= 4) return { events: [], nextSeq: Math.max(afterSeq, acceptedText ? 4 : -1), hasMore: false };
    return { events: [{ seq: 1, type: 'turn.started', data: { turn: 1 } },
      { seq: 2, type: 'user.message', data: { text: acceptedText.slice(0, 4_000), truncated: true,
        messageHash: createHash('sha256').update(acceptedText).digest('hex'), receiptId } },
      { seq: 3, type: 'assistant.message', data: { text: 'Windows 文件卡已从持久历史恢复。' } },
      { seq: 4, type: 'turn.ended', data: { turn: 1, reason: 'completed' } }]
      .filter((event) => event.seq > afterSeq), nextSeq: 4, hasMore: false };
  },
  describeSession: async (id) => id === sessionId ? { sessionId: id, title: 'Stage15 Windows 文件验收',
    running: false, agentPreset: 'personal-shared-chat', modelProfileId: profile.id } : null,
};
const assetTypes = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8' };
const uiHandler = async (request, response) => {
  if (request.method !== 'GET') return false;
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const name = pathname.endsWith('/app.js') ? 'app.js' : pathname.endsWith('/styles.css') ? 'styles.css'
    : ['/personal/v1/ui', '/personal/v1/ui/', '/personal/v1/ui/index.html'].includes(pathname) ? 'index.html' : null;
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
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, 'private-stage15-windows-file-ui.json'), JSON.stringify({ origin,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), username, password, sessionId, fileName,
    size: fileBytes.length, sha256: fileSha256 }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ origin: `${origin}/personal/v1/ui/`, username, password, sessionId, fileName,
    size: fileBytes.length, sha256: fileSha256 }));
  await new Promise((resolve) => setTimeout(resolve, 10 * 60_000));
} finally { await service.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
