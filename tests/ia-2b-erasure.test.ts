import test from 'node:test';
import assert from 'node:assert/strict';
import { eraseChatCopies } from '../src/personal-access/chat-erasure.mjs';
import { shadowForgottenSurface } from '../src/runtime/dsh-adapter/memory-erasure.mjs';
import { fixture } from './helpers/chat-timeline-fixture.mjs';

test('D33 clears result, handoff, side creation copies and search generations without deleting the main identity', async () => {
  const f: any = fixture(); const a = f.account, identity = a.chatIdentity;
  const transfer = { state: 'ready', summary: 'private-derived', sourceRefs: [{ sessionId: 'native-0' }] };
  a.sessions['native-2'].sideChat = { contextTransfer: structuredClone(transfer) };
  a.commands.create = { payload: { sideChat: { contextTransfer: structuredClone(transfer) } } };
  identity.segments[identity.sessionSegments['native-1']].handoff = { summary: 'private-derived' };
  identity.segments[identity.sessionSegments['native-1']].handoffSourceRefs = transfer.sourceRefs;
  a.chatResults = { result: { sourceChatId: f.mainId, summary: 'private-derived', artifactRefs: [{ name: 'private-derived' }],
    requiresResponse: true, resultRevision: 1 } };
  try {
    await f.timeline.ready('owner', f.mainId);
    const before = await f.query('events');
    for (const id of eraseChatCopies(a, { forgotten: true })) f.timeline.invalidate('owner', id);
    assert.doesNotMatch(JSON.stringify(a), /private-derived/);
    assert.equal(identity.chats[f.mainId].contentRevision, 2);
    assert.equal(Object.keys(identity.segments).length, 3);
    assert.equal(a.chatResults.result.deleted, true);
    assert.equal(a.sessions['native-2'].sideChat.contextTransfer.sourceRefs.length, 0);
    assert.deepEqual(a.commands.create.payload.sideChat, a.sessions['native-2'].sideChat);
    await assert.rejects(f.query('changes', { cursor: before.syncCursor }), { code: 'CURSOR_RESET_REQUIRED' });
  } finally { await f.timeline.close(); }
});

test('deleting one source invalidates dependent side references and leaves unrelated context intact', () => {
  const a: any = { sessions: { child: { sideChat: { contextTransfer: { sourceRefs: [{ sessionId: 'old' }], summary: 'erase' } } },
    other: { sideChat: { contextTransfer: { sourceRefs: [{ sessionId: 'unrelated' }], summary: 'keep' } } } }, commands: {} };
  eraseChatCopies(a, { sessionId: 'old' });
  assert.doesNotMatch(JSON.stringify(a), /erase/);
  assert.equal(a.sessions.other.sideChat.contextTransfer.summary, 'keep');
});

test('native forgetting shadows matching turns and mixed summaries in surface order, preserving unrelated originals', () => {
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { content: [{ text: 'private-original' }] } },
    { seq: 2, type: 'assistant/message', data: { content: [{ text: 'derived' }] } },
    { seq: 3, type: 'turn/end', data: {} },
    { seq: 4, type: 'user/message', data: { content: [{ text: 'unrelated' }] } },
    { seq: 9, type: 'user/message', surfaceOp: { op: 'replace' }, data: { content: [{ text: 'mixed summary' }] } },
  ];
  const appended: any[] = [], session = { events, surface: { nodes: [9, 1, 2, 4] }, append: (...args) => appended.push(args) };
  assert.deepEqual(shadowForgottenSurface(session, ['private-original'], value => value), [9, 1, 2]);
  assert.deepEqual(appended[0][1].shadowedSeqs, [9, 1, 2]);
  assert.deepEqual(appended[1][2].surfaceOp, { op: 'replace', start: 9, end: 2 });
  assert.match(JSON.stringify(events), /private-original/);
  assert.doesNotMatch(JSON.stringify(appended), /private-original|derived|mixed summary/);
});

test('an in-flight index read cannot return pre-erasure content after invalidation', async () => {
  const f: any = fixture(); let resume;
  const original = f.context.backend.readEvents;
  f.context.backend.readEvents = async args => { const page = await original(args); await new Promise(resolve => { resume = resolve; }); return page; };
  const pending = f.query('events');
  await new Promise(resolve => setImmediate(resolve));
  f.timeline.invalidate('owner', f.mainId); resume();
  await assert.rejects(pending, { code: 'CURSOR_RESET_REQUIRED' });
  await f.timeline.close();
});
