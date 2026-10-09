import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { reconcileChatIdentity, validateChatIdentity, protectMainSession } from '../src/personal-access/chat-identity.mjs';

const now = '2026-10-10T00:00:00.000Z';
const backend = () => ({
  getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [], preflight: async () => ({}),
  createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => ({ accepted: true }),
  cancelSession: async () => ({ accepted: true }),
  describeSession: async sessionId => ({ sessionId, title: '合成旧会话', running: false }),
  readEvents: async () => ({ events: [{ seq: 4, type: 'assistant.message', at: now, data: { text: '合成历史' } }], nextSeq: 4, hasMore: false }),
  renameSession: async ({ title }) => ({ title }),
});

test('identity mapping is additive, idempotent and keeps project/group/fork/shared provenance', () => {
  const sessions = {
    original: { ownerId: 'owner', title: '旧标题', groupId: 'group', pinned: true, unread: true,
      archived: true, readMessageSeq: 41, origin: 'personal-remote', modelProfileId: 'fixture', attachedAt: now },
    project: { ownerId: 'owner', projectId: 'project', projectRevision: 3, parentSessionId: 'original', modelProfileId: 'fixture' },
    shared: { ownerId: 'owner', conversationId: 'conversation-unrelated', origin: 'shared-chat' },
  };
  const account: any = { sessions: structuredClone(sessions), commands: { untouched: { receiptId: 'receipt-original' } } };
  reconcileChatIdentity(account, 'host', now);
  validateChatIdentity(account);
  const once = structuredClone(account);
  reconcileChatIdentity(account, 'host', now);
  assert.deepEqual(account, once);
  assert.deepEqual(account.sessions, sessions);
  assert.deepEqual(account.commands, { untouched: { receiptId: 'receipt-original' } });
  assert.equal(Object.values(account.chatIdentity.chats).filter((chat: any) => chat.kind === 'side').length, 3);
  const segment = account.chatIdentity.segments[account.chatIdentity.sessionSegments.original];
  account.sessions.original.title = '旧客户端改名';
  reconcileChatIdentity(account, 'host', now);
  assert.equal(account.chatIdentity.chats[segment.chatId].revision, 2);
  assert.equal(account.chatIdentity.sessionSegments.original, segment.segmentId);
  delete account.sessions.shared;
  reconcileChatIdentity(account, 'host', now);
  assert.equal(account.chatIdentity.sessionSegments.shared, undefined);
  validateChatIdentity(account);
});

test('main segment rejects legacy lifecycle and direct sends, while its original identity stays readable', () => {
  const account: any = { sessions: { synthetic: {} } };
  reconcileChatIdentity(account, 'host', now);
  const identity = account.chatIdentity, segment = identity.segments[identity.sessionSegments.synthetic];
  delete identity.chats[segment.chatId];
  segment.chatId = identity.mainChatId;
  identity.chats[identity.mainChatId].activeSegmentId = segment.segmentId;
  validateChatIdentity(account);
  assert.throws(() => protectMainSession(account, 'synthetic'), { code: 'MAIN_CHAT_PROTECTED' });
  assert.throws(() => protectMainSession(account, 'synthetic', 'MAIN_CHAT_ROUTE_REQUIRED'), { code: 'MAIN_CHAT_ROUTE_REQUIRED' });
  const invalid = structuredClone(account);
  invalid.chatIdentity.segments[segment.segmentId].chatId = 'missing';
  assert.throws(() => validateChatIdentity(invalid), { code: 'STORE_CORRUPT' });
});

test('real HTTP service migrates once, preserves old APIs, isolates accounts and reopens a stopped preimage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-ia-2a-identity-'));
  let service;
  const readStore = async () => JSON.parse(await readFile(path.join(root, 'store.json'), 'utf8'));
  try {
    service = await createPersonalAccessService({ root, port: 0, backend: backend() });
    const device = await service.enrollDevice({ name: 'synthetic-device-one' });
    const otherDevice = await service.enrollDevice({ name: 'synthetic-device-two' });
    await service.attachSession('original');
    await service.close();
    const seed = await readStore(), account = seed.accounts[seed.legacyOwnerId];
    delete account.chatIdentity; // An isolated pre-upgrade fixture, never a running profile.
    account.sessionGroups = { group: { id: 'group', name: '原分组' } };
    Object.assign(account.sessions.original, { title: '原标题', groupId: 'group', pinned: true, archived: true });
    await writeFile(path.join(root, 'store.json'), JSON.stringify(seed));
    // Remove only this test's initial empty preimage so the next startup captures this old fixture.
    await rm(path.join(root, 'chat-identity-v1.before.json'));
    service = await createPersonalAccessService({ root, port: 0, backend: backend() });
    const { origin } = await service.start();
    const request = async (route, token = device.token, method = 'GET', body?) => {
      const response = await fetch(`${origin}/personal/v1${route}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const [first, second] = await Promise.all([request('/chats/main'), request('/chats/main', otherDevice.token)]);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, second.body);
    const mainId = first.body.chat.chatId;
    assert.equal(first.body.chat.activeSessionId, null);
    assert.equal((await request('/status')).body.personalCapabilities.chats, 1);
    const link = (await request('/sessions/original/chat')).body;
    assert.equal(link.kind, 'side'); assert.equal(link.archived, true);
    assert.notEqual(link.chatId, mainId);
    assert.equal((await request('/sessions/original/events')).body.events[0].data.text, '合成历史');
    const side = (await request(`/chats/${link.chatId}`)).body.chat;
    assert.deepEqual(side.parent, { kind: 'main', id: mainId });
    assert.equal(side.groupId, 'group'); assert.equal(side.pinned, true); assert.equal(side.title, '原标题');
    assert.equal((await request('/chats')).body.items.length, 0);
    assert.equal((await request('/chats?archived=all')).body.items.length, 1);
    assert.equal((await request('/sessions/original/unarchive', device.token, 'POST', {})).status, 200);
    assert.equal((await request(`/chats/${link.chatId}`)).body.chat.archived, false);
    await request('/sessions/original/metadata', device.token, 'PATCH', { title: '原客户端改名', groupId: null });
    const renamed = (await request(`/chats/${link.chatId}`)).body.chat;
    assert.equal(renamed.title, '原客户端改名'); assert.equal(renamed.groupId, null); assert.ok(renamed.revision > side.revision);
    assert.equal((await request(`/chats/${mainId}`, device.token, 'DELETE', {})).body.error.code, 'MAIN_CHAT_PROTECTED');
    const mark = { requestId: 'main-unread', expectedRevision: first.body.chat.revision, unread: true };
    const marked = await request(`/chats/${mainId}/metadata`, device.token, 'PATCH', mark);
    assert.equal(marked.status, 200); assert.equal(marked.body.chat.unread, true);
    assert.deepEqual(await request(`/chats/${mainId}/metadata`, otherDevice.token, 'PATCH', mark), marked);
    assert.equal((await request(`/chats/${mainId}/metadata`, device.token, 'PATCH', { ...mark, unread: false })).body.error.code, 'REQUEST_CONFLICT');
    assert.equal((await request(`/chats/${mainId}/metadata`, device.token, 'PATCH', { ...mark, requestId: 'stale' })).body.error.code, 'REVISION_CHANGED');
    assert.equal((await request(`/chats/${mainId}/metadata`, device.token, 'PATCH', { ...mark, requestId: 123 })).status, 400);
    assert.equal((await request('/commands', device.token, 'POST', { requestId: mark.requestId, kind: 'session.cancel',
      targetDeviceId: seed.hostId, sessionId: 'original' })).body.error.code, 'REQUEST_CONFLICT');
    assert.equal((await request('/chats?limit=201')).status, 400);
    assert.equal((await request('/chats?cursor=made-up')).body.error.code, 'CURSOR_RESET_REQUIRED');
    const registration = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'synthetic-other', password: 'synthetic-password-long-enough', deviceName: 'other' }) });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get('set-cookie').split(';')[0];
    const forbidden = await fetch(`${origin}/personal/v1/chats/${mainId}`, { headers: { cookie } });
    assert.equal(forbidden.status, 404);
    const theirs = await (await fetch(`${origin}/personal/v1/chats/main`, { headers: { cookie } })).json();
    assert.notEqual(theirs.chat.chatId, mainId);
    await service.close();
    const migrated = await readStore();
    service = await createPersonalAccessService({ root, port: 0, backend: backend() });
    await service.close();
    assert.equal((await readStore()).accounts[seed.legacyOwnerId].chatIdentity.mainChatId, mainId);
    const preimage = JSON.parse(await readFile(path.join(root, 'chat-identity-v1.before.json'), 'utf8'));
    assert.deepEqual(preimage, seed);
    // Roll back only in a separate directory, while both writers are stopped.
    const rollback = path.join(root, 'rollback');
    const { mkdir } = await import('node:fs/promises'); await mkdir(rollback);
    await writeFile(path.join(rollback, 'store.json'), JSON.stringify(preimage));
    const restored = await createPersonalAccessService({ root: rollback, port: 0, backend: backend() });
    await restored.close();
    assert.deepEqual(JSON.parse(await readFile(path.join(rollback, 'store.json'), 'utf8')).accounts[seed.legacyOwnerId].sessions, seed.accounts[seed.legacyOwnerId].sessions);
    assert.deepEqual((await readStore()).accounts[seed.legacyOwnerId].chatIdentity, migrated.accounts[seed.legacyOwnerId].chatIdentity);
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
});
