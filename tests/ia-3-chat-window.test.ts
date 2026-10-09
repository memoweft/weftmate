import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
const context: any = { Intl, Date };
runInNewContext('globalThis.WeftUiCore = {};\n' + readFileSync(new URL('../src/ui-core/chat-window.js', import.meta.url), 'utf8'), context);
const model = context.WeftUiCore.ChatWindow;
const event = (n: number, text = '纸船') => ({ eventId: `event-${n}`, orderKey: String(n).padStart(16, '0'), revision: 1, at: '2026-10-08T10:00:00Z', type: 'assistant.message', data: { text } });
test('logical history keeps the live watermark independent, deduplicates revisions and bounds retained models', () => {
  const window = model.create(1000);
  window.merge({items: [event(100)], syncCursor: 'live-1', olderCursor: 'older-1', hasOlder: true, contentRevision: 1}, 'tail');
  window.merge({items: [event(99), event(100)], syncCursor: 'stale-live', olderCursor: 'older-2', hasOlder: true, contentRevision: 1}, 'older');
  assert.equal(window.state.syncCursor, 'live-1'); assert.equal(window.state.events.size, 2);
  window.merge({upserts: [{...event(100, '更新'),revision:2}], removals:[{eventId:'event-99'}],nextCursor:'live-2',contentRevision:1}, 'changes');
  assert.equal(window.state.syncCursor,'live-2'); assert.equal(window.ordered()[0].data.text,'更新');
  window.merge({items:Array.from({length:10000},(_,n)=>event(n)),syncCursor:'ignored',contentRevision:1},'newer');
  assert.equal(window.state.events.size,1000); assert.equal(window.state.syncCursor,'live-2'); assert.equal(window.state.hasOlder,true);
});
test('content revision clears every old body, search result, expansion and cursor before replacement', () => {
  const window=model.create(); window.merge({items:[event(1)],contentRevision:1,syncCursor:'old'});
  window.state.search={query:'纸船',hits:[event(1)],index:0};window.state.expanded.add('2026-10-08');
  window.merge({items:[event(2,'新正文')],contentRevision:2,syncCursor:'new'});
  assert.equal(window.state.events.has('event-1'),false);assert.equal(window.state.search.hits.length,0);
  assert.equal(window.state.expanded.size,0);assert.equal(window.state.syncCursor,'new');
});
test('days follow account timezone and old days collapse without discarding their events', () => {
  const window=model.create();window.merge({items:[{...event(1),at:'2026-10-08T20:00:00Z'}],timeZone:'Asia/Shanghai',contentRevision:1});
  const days=window.days(Date.parse('2026-10-11T04:00:00Z'));
  assert.equal(days[0].date,'2026-10-09');assert.equal(days[0].label,'10 月 9 日');assert.equal(days[0].collapsed,true);
  window.state.expanded.add(days[0].date);assert.equal(window.days(Date.parse('2026-10-11T04:00:00Z'))[0].collapsed,false);
});
