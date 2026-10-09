import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { nativeRelayState, prepareNativeHandoff, installNativeHandoff } from '../src/runtime/dsh-adapter/chat-handoff.mjs';

test('durable main sends bind once, queue during relay, keep attachments, recover unpublished target and preserve source receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ia2b-main-'));
  const native = new Set(), sends: any[] = [], created: any[] = []; let pressure = false, safe = true, failCreate = false, failSummary = false, release;
  let started; const summarizing = new Promise(resolve => { started = resolve; });
  const backend: any = { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [{ id: 'local', model: 'synthetic', configured: true }],
    preflight: async () => ({}), cancelSession: async () => ({ accepted: true }),
    createSession: async options => { created.push(options); native.add(options.sessionId); if (failCreate) { failCreate = false; throw new Error('simulated lost response'); } return { sessionId: options.sessionId }; },
    describeSession: async sessionId => ({ sessionId, running: false, modelProfileId: 'local', agentPreset: 'personal-remote' }),
    readEvents: async ({ afterSeq = -1 }) => ({ events: [], nextSeq: afterSeq, hasMore: false, hasOlder: false }),
    sendMessage: async value => { sends.push(value); return { accepted: true, receiptId: `receipt-${sends.length}` }; },
    chatRelayState: async () => ({ pending: pressure, safe }),
    prepareChatHandoff: async ({ sessionId }) => { if (failSummary) throw new Error('summary failed'); started(); if (release !== false) await new Promise(resolve => { release = resolve; }); return { text: 'synthetic summary and pending todo', sourceRefs: [{ sessionId, seq: 1 }], sourceSessionId: sessionId, throughSeq: 2 }; },
    installChatHandoff: async () => { pressure = false; return { installed: true }; },
  };
  let service;
  try {
    service = await createPersonalAccessService({ root, port: 0, backend });
    let { origin, hostId } = await service.start(); const grant = await service.issueSetupGrant();
    const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'synthetic-relay', password: 'synthetic-password-long', deviceName: 'synthetic' }) });
    const auth = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const headers = { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken };
    const api = async (path, body?, method = body ? 'POST' : 'GET') => { const response = await fetch(origin + '/personal/v1' + path, { method, headers: { ...headers, origin }, body: body && JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
    const main = (await api('/chats/main')).body.chat;
    const body = (requestId, text = 'test') => ({ requestId, kind: 'chat.message', targetDeviceId: hostId, chatId: main.chatId, modelProfileId: 'local', text });
    const wait = async request => {
      for (let i = 0; i < 200; i++) { const row = (await api(`/commands/by-request/${request}`)).body.command;
        if (['accepted_by_dsh','rejected','uncertain'].includes(row.state)) return row;
        await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.fail('pending command did not settle');
    };
    const uploadText = Buffer.from('synthetic attached text'), attachmentId = `attachment-${randomUUID()}`;
    const upload = await fetch(`${origin}/personal/v1/chats/${main.chatId}/attachments/${attachmentId}?requestId=first&name=note.txt`,
      { method: 'PUT', headers: { ...headers, 'content-type': 'text/plain', 'x-weftmate-sha256': createHash('sha256').update(uploadText).digest('hex') }, body: uploadText });
    assert.equal(upload.status, 201); const attachment = (await upload.json()).attachment;
    const request = { ...body('first'), attachments: [attachment] };
    const [a, b] = await Promise.all([api('/commands', request), api('/commands', request)]);
    assert.equal(a.status, 202, JSON.stringify(a)); assert.equal(a.body.command.commandId, b.body.command.commandId);
    const first = await wait('first'); assert.equal(first.state, 'accepted_by_dsh', JSON.stringify(first));
    assert.equal(sends.length, 1); assert.match(sends[0].text, /synthetic attached text/);
    assert.equal((await api('/commands', request)).body.command.receiptId, first.receiptId);
    let mainView=(await api('/chats/main')).body.chat;
    const marked=await api(`/chats/${main.chatId}/metadata`,{requestId:'unread',expectedRevision:mainView.revision,unread:true},'PATCH');
    assert.equal((await api('/chats/main')).body.chat.unread,true);
    await api(`/chats/${main.chatId}/metadata`,{requestId:'read',expectedRevision:marked.body.chat.revision,unread:false},'PATCH');
    assert.equal((await api('/chats/main')).body.chat.unread,false);
    assert.equal((await api('/commands', { ...request, text: 'different' })).status, 409);
    pressure = true;
    await api('/commands', body('relay-first')); await summarizing;
    assert.equal((await api('/commands', body('relay-queued'))).status, 202);
    assert.equal((await api('/commands/by-request/relay-queued')).body.command.state, 'pending');
    release(); release = false;
    const second = await wait('relay-first'), queued = await wait('relay-queued');
    assert.notEqual(second.sessionId, first.sessionId); assert.equal(queued.sessionId, second.sessionId);
    assert.equal((await api('/commands', request)).body.command.sessionId, first.sessionId);
    assert.ok(created.every(row => row.workspaceChatId === main.chatId));
    pressure = true; failSummary = true;
    await api('/commands', body('summary-failed')); assert.equal((await wait('summary-failed')).sessionId, second.sessionId);
    failSummary = false; failCreate = true;
    await api('/commands', body('create-response-lost')); assert.equal((await wait('create-response-lost')).state, 'rejected');
    const orphan = created.at(-1).sessionId;
    await service.close();
    service = await createPersonalAccessService({ root, port: 0, backend });
    ({ origin } = await service.start());
    await api('/commands', body('recover-target'));
    const recovered = await wait('recover-target'); assert.equal(recovered.sessionId, orphan); assert.equal(recovered.state, 'accepted_by_dsh');
    assert.equal(native.size, 3);
    safe = false; pressure = true;
    await api('/commands', body('busy')); assert.equal((await wait('busy')).sessionId, orphan);
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
});

test('native handoff uses durable route and surface ordering, carries todos, excludes hidden blocks and installs once', async () => {
  const events: any[] = [{ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'tail' }] } },
    { seq: 7, type: 'user/message', data: { content: [{ type: 'text', text: 'summary' }, { type: 'reasoning', text: 'hidden' }] }, sourceEventSeqs: [0] },
    { seq: 8, type: 'todo/write', data: { todos: [{ content: 'next action', status: 'pending' }] } }];
  const agent: any = { status: 'idle', inbox: { hasPending: false }, options: {},
    session: { id: 'source', events, surface: { nodes: [7,1] }, requestHeader: () => ({ config: { provider: 'route', model: 'model' } }) } };
  const services: any = { tokenMeter: { measure: () => ({ totalTokens: 90 }), estimateMessage: () => 10 },
    llm: { resolveModelInfo: async (provider, model) => { assert.equal(provider, 'route'); return { context: { contextWindow: 100 } }; } },
    compaction: { config: { thresholdRatio: 0.8 }, compactNow: async () => ({ summary: [] }) } };
  const ctx: any = { get: name => services[name], sessions: { flush: async () => {} } };
  assert.equal((await nativeRelayState(ctx, agent)).pending, true);
  services.goals = { get: () => ({ phase: 'active' }) }; assert.equal((await nativeRelayState(ctx, agent)).safe, false); delete services.goals;
  const handoff = await prepareNativeHandoff(ctx, agent);
  assert.ok(handoff.text.indexOf('summary') < handoff.text.indexOf('tail')); assert.match(handoff.text, /next action/); assert.doesNotMatch(handoff.text, /hidden/);
  const target: any = { status: 'idle', inbox: { hasPending: false }, session: { events: [], append(type,data) { this.events.push({ type,data }); } } };
  await installNativeHandoff(ctx, target, handoff, value => value); await installNativeHandoff(ctx, target, handoff, value => value);
  assert.equal(target.session.events.length, 1);
});
