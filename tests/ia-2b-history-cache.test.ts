import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryCache } from '../src/runtime/dsh-adapter/history-cache.mjs';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';

test('public range cache survives cold reopening, updates only stable live suffix and physically erases after native rewrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ia2b-cache-')), file = join(root, 'history.sqlite');
  let revision = 'one', live = false, nativeReads = 0, projected = 0;
  let events = Array.from({ length: 1000 }, (_, seq) => ({ seq, type: 'user.message', data: { text: `CACHE_SECRET_${seq}` } }));
  const source = async () => ({ revision, ...(live ? { events } : {}) });
  const readNative = async () => { nativeReads++; return events; };
  const project = (rows, { afterSeq, limit }) => {
    const next = rows.filter(row => row.seq > afterSeq), page = next.slice(0, limit); projected += page.length;
    return { events: page, nextSeq: next.length > limit ? page.at(-1).seq : rows.at(-1)?.seq ?? afterSeq,
      latestSeq: rows.at(-1)?.seq ?? -1, hasMore: next.length > limit };
  };
  let cache = createHistoryCache({ file, source, readNative });
  try {
    const tail = await cache.read('session', { limit: 50 }, project);
    assert.equal(tail.events[0].seq, 950); assert.equal(nativeReads, 1); assert.equal(projected, 1000);
    await cache.close(); cache = createHistoryCache({ file, source, readNative });
    assert.equal((await cache.read('session', { beforeSeq: 950, limit: 50 }, project)).events[0].seq, 900);
    assert.equal(nativeReads, 1); assert.equal(projected, 1000);
    live = true; revision = 'two'; events.push({ seq: 1000, type: 'user.message', data: { text: 'new' } });
    const delta = await cache.read('session', { afterSeq: 999, limit: 50 }, project);
    assert.equal(delta.events.length, 1); assert.equal(projected, 1001); assert.equal(nativeReads, 1);
    await cache.invalidate('session');
    assert.ok(!(await readFile(file)).includes(Buffer.from('CACHE_SECRET')));
    revision = 'three'; events = [{ seq: 0, type: 'user.message', data: { text: 'clean' } }]; live = false;
    const clean = await cache.read('session', { limit: 50 }, project); assert.equal(clean.events.length, 1);
    assert.ok(!(await readFile(file)).includes(Buffer.from('CACHE_SECRET')));
  } finally { await cache.close(); await rm(root, { recursive: true, force: true }); }
});

test('public cache honors the native delayed step-end watermark and publishes its final classification once closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ia2b-stable-')); let revision = 'one';
  const message = (seq, text) => ({ seq, time: 1, type: 'user/message', data: { id: `m-${seq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }, surfaceOp: 'append' });
  const events: any[] = [{ seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } }, message(1,'first'),
    { seq: 2, time: 1, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 3, time: 1, type: 'step/end', data: { turn: 1, step: 1, reason: 'completed' } }];
  const read: any = async () => events;
  const cache = createHistoryCache({ file: join(root,'cache.sqlite'), source: async () => ({ revision, events }), readNative: read });
  read.historyPage = (id, options, project) => cache.read(id, options, project);
  const adapter = createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 'session' }] } } }) }, events: {} }, { readLog: read });
  try {
    const first = await adapter.historyPage('session'); assert.ok(first.events.some(row => row.data.text === 'first'));
    assert.equal(first.nextSeq, 2); assert.ok(!first.events.some(row => row.seq === 3));
    events.push({ seq: 4, time: 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } }); revision = 'two';
    const closed = await adapter.historyPage('session', { afterSeq: first.nextSeq });
    assert.ok(closed.events.some(row => row.seq === 3)); assert.equal(closed.nextSeq, 4);
  } finally { await cache.close(); await rm(root, { recursive: true, force: true }); }
});
