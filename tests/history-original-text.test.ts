import test from 'node:test';
import assert from 'node:assert/strict';
import { createDshSessionAdapter, projectHistoryEvent } from '../src/runtime/dsh-adapter/sessions.mjs';
import { createHistoryCache } from '../src/runtime/dsh-adapter/history-cache.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('personal history, details and live replies preserve original paths and credential-like prose', async () => {
  const text = 'C:\\Synthetic\\report.md /tmp/synthetic/report.md password: synthetic-example';
  const entries = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    { seq: 1, type: 'assistant/message', data: { content: [{ type: 'text', text }, { type: 'reasoning', text }] } },
  ];
  assert.equal(projectHistoryEvent(entries[0]).data.text, text);
  assert.equal(projectHistoryEvent(entries[1], null, null, null, null, true).data.modelThinking, text);
  const adapter = createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 'synthetic' }] } } }) }, events: {} }, { readLog: async () => entries });
  assert.equal((await adapter.historyPage('synthetic')).events[1].data.text, text);
  assert.equal((await adapter.historyDetail('synthetic', 0)).text, text);
  assert.equal((await adapter.historyDetail('synthetic', 1)).text, text);
  entries.push({ seq: 2, type: 'turn/start', data: { turn: 1 } } as any,
    { seq: 3, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text } } } as any);
  assert.equal((await adapter.historyPage('synthetic')).liveEvents[0].data.text, text);
});

test('old redacted history caches rebuild from native originals, including a growing live log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-original-history-')), file = join(root, 'cache.sqlite');
  const text = 'C:\\Synthetic\\report.md';
  const native = [{ seq: 0, type: 'assistant.message', data: { text } }, { seq: 1, type: 'assistant.message', data: { text: 'new' } }];
  const sql = new DatabaseSync(file);
  sql.exec('CREATE TABLE segments (id TEXT PRIMARY KEY, revision TEXT NOT NULL, stable INTEGER NOT NULL, tail INTEGER NOT NULL); CREATE TABLE events (session TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session,seq)) WITHOUT ROWID;');
  sql.prepare('INSERT INTO segments VALUES (?,?,?,?)').run('synthetic', 'one:thinking-v1:stream-v1', 0, 0);
  sql.prepare('INSERT INTO events VALUES (?,?,?)').run('synthetic', 0, JSON.stringify({ ...native[0], data: { text: '[local path]' } }));
  sql.close();
  const cache = createHistoryCache({ file, source: async () => ({ revision: 'one', events: native }), readNative: async () => native });
  try {
    const page = await cache.read('synthetic', {}, (rows, options) => ({ events: rows.filter(row => row.seq > options.afterSeq), nextSeq: 1, latestSeq: 1, hasMore: false }));
    assert.equal(page.events[0].data.text, text);
  } finally { await cache.close(); await rm(root, { recursive: true, force: true }); }
});
