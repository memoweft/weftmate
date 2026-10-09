import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/chat-timeline-fixture.mjs';

test('cross-segment pages keep stable ids and independent sync while old segments receive late events', async () => {
  const f = fixture(600);
  try {
    const initial = await f.query('events');
    assert.equal(initial.items.length, 50); assert.equal(initial.indexState, 'building');
    await f.timeline.ready('owner', f.mainId);
    const tail = await f.query('events');
    const seen = [...tail.items]; let page = tail;
    while (page.hasOlder) { page = await f.query('events', { before: page.olderCursor }); seen.unshift(...page.items); }
    assert.equal(seen.length, 600); assert.equal(new Set(seen.map(row => row.eventId)).size, 600);
    assert.deepEqual(seen.map(row => row.orderKey), seen.map(row => row.orderKey).sort());
    f.logs.get('native-0').push({ seq: 401, at: '2026-10-11T00:00:00Z', type: 'assistant.message', data: { text: '旧段迟到结论' } });
    f.logs.get('native-2').push({ seq: 401, at: '2026-10-11T00:00:00Z', type: 'user.message', data: { text: '新段输入' } });
    const delta = await f.query('changes', { cursor: tail.syncCursor });
    assert.equal(delta.upserts.length, 2); assert.ok(delta.upserts.some(row => row.data.text === '旧段迟到结论'));
    assert.equal((await f.query('changes', { cursor: delta.nextCursor })).upserts.length, 0);
    const removed = delta.upserts[0];
    f.timeline.removeEvents('owner', f.mainId, [removed.eventId], 'forgotten');
    const erased = await f.query('changes', { cursor: delta.nextCursor });
    assert.deepEqual(erased.removals.map(row => [row.eventId, row.reason]), [[removed.eventId, 'forgotten']]);
    assert.equal((await f.query('search', { q: removed.data.text })).hits.length, 0);
    assert.equal((await f.query('events', { around: seen[205].eventId, limit: 11 })).items[5].eventId, seen[205].eventId);
    await assert.rejects(f.query('changes', { cursor: tail.olderCursor }), { code: 'CURSOR_RESET_REQUIRED' });
    await assert.rejects(f.timeline.query('other', f.mainId, 'events', new URLSearchParams()), { code: 'CHAT_UNAVAILABLE' });
  } finally { await f.timeline.close(); }
});

test('dates use account timezone; Chinese search excludes tools, supports filters and resets after content invalidation', async () => {
  const f = fixture();
  try {
    await f.timeline.ready('owner', f.mainId);
    f.account.chatIdentity.timeZone = 'America/Los_Angeles';
    const dates = await f.query('dates', { from: '2026-10-07', to: '2026-10-10' });
    assert.deepEqual(dates.days.map(row => row.date), ['2026-10-07','2026-10-08','2026-10-09']);
    const located = await f.query('locate', { date: '2026-10-08' }); assert.ok(located.eventId);
    assert.equal((await f.query('locate', { date: '2026-10-10' })).previousDate, '2026-10-09');
    assert.equal((await f.query('search', { q: '隐藏工具文字' })).hits.length, 0);
    const search = await f.query('search', { q: '中文纸船', role: 'user', hasArtifact: true, limit: 2 });
    assert.equal(search.hits.length, 2); assert.ok(search.hasMore);
    const hit = search.hits[0]; assert.equal(hit.snippet.slice(hit.highlights[0].start, hit.highlights[0].end), '中文纸船');
    await assert.rejects(f.query('search', { q: 'different', cursor: search.nextCursor }), { code: 'CURSOR_RESET_REQUIRED' });
    const tail = await f.query('events');
    f.logs.set('native-0', []); f.account.chatIdentity.chats[f.mainId].contentRevision++;
    await assert.rejects(f.query('changes', { cursor: tail.syncCursor }), { code: 'CURSOR_RESET_REQUIRED' });
    await f.timeline.ready('owner', f.mainId);
    assert.equal((await f.query('search', { q: '纸船 0-' })).hits.length, 0);
    await assert.rejects(f.query('dates', { from: '2026-02-30', to: '2026-03-01' }), { code: 'INVALID_REQUEST' });
  } finally { await f.timeline.close(); }
});
