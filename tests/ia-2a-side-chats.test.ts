import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { fixture } from './helpers/chat-timeline-fixture.mjs';
import { createSideChats } from '../src/personal-access/side-chats.mjs';
import { canonicalCommand } from '../src/personal-access/command-policy.mjs';

test('side creation references only the chosen message, requires suggestion confirmation and checks project destinations', async () => {
  const f = fixture(); const context: any = f.context;
  Object.assign(f.account, { hostId: 'host', ownerId: 'owner' });
  context.chatTimeline = f.timeline; context.hostOwner = () => true;
  const side = createSideChats(context);
  try {
    const page = await f.query('events'); const anchor = page.items.find(row => row.type === 'user.message');
    const body = { requestId: 'side-reference', kind: 'session.side.create', targetDeviceId: 'host',
      modelProfileId: 'local', parent: { kind: 'main', id: f.mainId }, originChatId: f.mainId, originEventId: anchor.eventId };
    const prepared = await side.prepare('owner', body);
    assert.equal(prepared.sideChat.contextTransfer.state, 'references_only');
    assert.equal(prepared.sideChat.contextTransfer.sourceRefs[0].seq, anchor.sourceRef.seq);
    assert.ok(!JSON.stringify(prepared).includes('合成中文纸船'));
    assert.deepEqual(canonicalCommand(prepared, 'host', true).sideChat, prepared.sideChat);
    await assert.rejects(side.prepare('owner', { ...body, entry: 'suggestion' }), { code: 'SIDE_CHAT_CONFIRMATION_REQUIRED' });
    assert.ok(await side.prepare('owner', { ...body, entry: 'suggestion', confirmed: true }));
    await assert.rejects(side.prepare('owner', { ...body, parent: { kind: 'project', id: 'missing' } }), { code: 'PROJECT_REVOKED' });
    (f.account as any).projects = { project: { revision: 1, revoked: false } };
    const project = await side.prepare('owner', { ...body, parent: { kind: 'project', id: 'project' } });
    assert.equal(project.projectId, 'project'); assert.equal(project.projectRevision, 1);
    (f.account.sessions['native-2'] as any).memoryMode = 'off';
    await assert.rejects(side.prepare('owner', body), { code: 'TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED' });
    delete (f.account.sessions['native-2'] as any).memoryMode;
    (f.account.sessions['native-2'] as any).origin = 'shared-chat';
    await assert.rejects(side.prepare('owner', body), { code: 'SHARED_CONTEXT_UNAVAILABLE' });
  } finally { await f.timeline.close(); }
});

test('side creation is idempotent and sends nothing until the user sends a message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-ia-2a-side-'));
  const logs = new Map<string, any[]>(), titles = new Map<string,string>(); let creates = 0, sends = 0, service;
  const backend = {
    getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId, title }: any) => { creates++; logs.set(sessionId, []); titles.set(sessionId, title ?? '旁聊'); return { sessionId }; },
    describeSession: async (sessionId: string) => ({ sessionId, title: titles.get(sessionId), agentPreset: 'personal-remote', modelProfileId: 'local', running: false }),
    cancelSession: async () => ({ accepted: true }), deleteSession: async ({ sessionId }: any) => { logs.delete(sessionId); return { deleted: true }; },
    sendMessage: async ({ sessionId }: any) => {
      sends++; const at = new Date().toISOString();
      logs.set(sessionId, [
        { seq: 0, type: 'turn.started', at, data: { turn: 1 } },
        { seq: 1, type: 'user.message', at, data: { text: '合成目标', receiptId: 'receipt-synthetic' } },
        { seq: 2, type: 'step.completed', at, data: { taskId: 'turn-1', stepId: 'native-tool', state: 'completed' } },
        { seq: 3, type: 'assistant.message', at, data: { text: '纸船已经整理。'.repeat(30) } },
        { seq: 4, type: 'turn.ended', at, data: { turn: 1, reason: 'completed' } },
      ]); return { accepted: true, receiptId: 'receipt-synthetic' };
    },
    readSourceEvents: async ({ sessionId }: any) => ({ current: true, events: logs.get(sessionId) }),
    getTaskReplyEvidence: async () => ({ status: 'completed', turn: 1, assistantChunks: 0, textChunks: 0, reasoningChunks: 0,
      assistantMessages: 1, toolSaveObserved: true, terminalAt: new Date().toISOString() }),
    readEvents: async ({ sessionId, afterSeq, beforeSeq, limit = 50 }: any) => {
      const all = logs.get(sessionId) ?? [], forward = afterSeq !== undefined;
      const rows = all.filter(row => forward ? row.seq > afterSeq : beforeSeq === undefined || row.seq < beforeSeq);
      const events = forward ? rows.slice(0,limit) : rows.slice(-limit);
      return { events, nextSeq: forward ? events.at(-1)?.seq ?? afterSeq : all.at(-1)?.seq ?? -1,
        nextBeforeSeq: events[0]?.seq ?? null, hasMore: forward && rows.length > limit, hasOlder: !forward && rows.length > limit };
    },
  };
  try {
    service = await createPersonalAccessService({ root, port: 0, backend });
    let { origin, hostId } = await service.start();
    const grant = await service.issueSetupGrant();
    const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'synthetic-side', password: 'synthetic-password-long', deviceName: 'synthetic' }) });
    assert.equal(setup.status, 201); const cookie = setup.headers.get('set-cookie')!.split(';')[0], auth = await setup.json();
    const api = async (route: string, body?: any, method = body ? 'POST' : 'GET') => {
      const response = await fetch(`${origin}/personal/v1${route}`, { method, headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, body: body && JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const main = (await api('/chats/main')).body.chat;
    const request = { requestId: 'create-side', kind: 'session.side.create', targetDeviceId: hostId,
      modelProfileId: 'local', parent: { kind: 'main', id: main.chatId }, title: '合成旁聊', entry: 'composer' };
    const [one, two] = await Promise.all([api('/commands', request), api('/commands', request)]);
    assert.equal(one.status, 202, JSON.stringify(one.body)); assert.equal(two.status, 202, JSON.stringify(two.body));
    assert.equal(one.body.command.chatId, two.body.command.chatId);
    const wait = async (id: string) => {
      for (let i=0;i<100;i++) { const c=(await api(`/commands/by-request/${id}`)).body.command;
        if (c.state==='accepted_by_dsh') return c;
        if (['uncertain','rejected'].includes(c.state)) assert.fail(JSON.stringify(c));
        await new Promise(r=>setTimeout(r,20)); }
      assert.fail('command did not complete');
    };
    const created = await wait('create-side');
    assert.equal(creates, 1); assert.equal(sends, 0);
    assert.equal((await api('/commands', { ...request, title: 'different' })).status, 409);
    const side = (await api(`/chats/${created.chatId}`)).body.chat;
    assert.equal(side.title, '合成旁聊'); assert.equal(side.parent, null);
    assert.equal((await api('/commands', { requestId: 'do-task', kind: 'session.message', targetDeviceId: hostId, sessionId: created.sessionId, text: '合成目标' })).status, 202);
    await wait('do-task');
    const answer = (await api(`/chats/${created.chatId}/events`)).body.items.find(row => row.type === 'assistant.message');
    assert.ok(answer);
    assert.equal((await api(`/chats/${created.chatId}/results`, {requestId:'manual-result',sourceEventId:answer.eventId,expectedRevision:side.revision})).status,404);
    assert.deepEqual((await api(`/chats/${main.chatId}/events`)).body.items,[]);
    const saved = JSON.parse(await readFile(join(root,'store.json'),'utf8'));
    assert.equal(Object.keys(saved.accounts[saved.legacyOwnerId].chatResults ?? {}).length,0);
    assert.equal((await api(`/sessions/${created.sessionId}`, {}, 'DELETE')).status,200);
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
});
