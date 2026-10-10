// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Authenticated A/B HTTP true-delete through real isolated MemoWeft Core processes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_MEMORY_HTTP_DELETE !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_HTTP_DELETE=1 for isolated account/Core deletion acceptance.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-http-delete-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const manager = createPersonalMemoryManager({ root: join(root, 'memory'), enabled: true,
  python, pythonPath, baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => null });
const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [], preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => ({ accepted: true }),
  cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null };
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0,
  backend, memoryManager: manager });
try {
  const { origin } = await service.start();
  async function register(username) {
    const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'synthetic delete password 123', deviceName: 'Fixture' }) });
    assert.equal(response.status, 201);
    const body = await response.json();
    return { ownerId: body.account.ownerId, csrf: body.csrfToken,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function read(account, path) {
    const response = await fetch(`${origin}${path}`, { headers: { cookie: account.cookie } });
    return { status: response.status, body: await response.json() };
  }
  async function remove(account, path, requestId, expectedWorldRevision) {
    const response = await fetch(`${origin}${path}`, { method: 'DELETE',
      headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
        'content-type': 'application/json' },
      body: JSON.stringify({ requestId, expectedWorldRevision }) });
    return { status: response.status, body: await response.json() };
  }
  const [a, b] = await Promise.all([register('SyntheticDeleteA'), register('SyntheticDeleteB')]);
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: 'synthetic-user-a', source: { kind: 'user' },
      content: [{ type: 'text', text: '合成A独占来源' }] } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ];
  const boundary = boundaryForCompletedTurn({ id: 'session-synthetic-a',
    header: { agentPreset: 'personal-remote' }, events }, events.at(-1));
  assert.equal((await manager.ingest(a.ownerId, boundary)).state, 'accepted');
  const evidence = await manager.query(a.ownerId, 'query_evidence', { operation: 'list' });
  const evidenceId = evidence.evidence.find((row) => row.raw_content === '合成A独占来源')?.evidence_id;
  assert.equal(typeof evidenceId, 'string');
  const itemId = 'cognition-synthetic-a-only';
  const db = join(root, 'memory', 'accounts', a.ownerId, 'memory-home', 'memoweft', 'memoweft.sqlite3');
  const seed = `import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute("INSERT INTO cognition(id,subject_id,content,content_type,formed_by,confidence,cred_status,scope,valid_at,invalid_at,asked_at,archived_at,muted_at,created_at,updated_at) VALUES (?,?,?,'preference','stated',80,'credible',NULL,NULL,NULL,NULL,NULL,NULL,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z')", (sys.argv[2],sys.argv[3],'合成A独占来源'))
db.execute("INSERT INTO cognition_evidence(cognition_id,evidence_id,relation) VALUES (?,?,'support')", (sys.argv[2],sys.argv[4]))
db.commit()
db.close()`;
  execFileSync(python, ['-c', seed, db, itemId, a.ownerId, evidenceId],
    { windowsHide: true, timeout: 10_000 });
  const listPath = '/personal/v1/memory/items?kind=cognition&query=合成A独占来源';
  const aList = await read(a, listPath);
  assert.equal(aList.status, 200);
  assert.equal(aList.body.items.length, 1);
  assert.equal(aList.body.items[0].id, itemId);
  assert.equal((await read(b, listPath)).body.items.length, 0);
  const itemPath = `/personal/v1/memory/items/cognition/${itemId}`;
  const detail = await read(a, itemPath);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.availableActions.delete.available, true);
  const sources = await read(a, `${itemPath}/sources`);
  assert.equal(sources.status, 200);
  assert.equal(sources.body.sources.some((source) => source.evidenceId === evidenceId), true);
  assert.equal((await read(b, itemPath)).status, 404);
  assert.equal((await remove(b, itemPath, 'foreign-delete', detail.body.worldRevision)).status, 404);
  const removed = await remove(a, itemPath, 'own-world-delete', detail.body.worldRevision);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.receipt.state, 'applied');
  assert.ok(['complete', 'pending'].includes(removed.body.receipt.storageCleanup.state));
  const recovery = await read(a, '/personal/v1/memory/commands/by-request/own-world-delete');
  assert.equal(recovery.body.receipt.commandId, removed.body.receipt.commandId);
  assert.equal((await read(a, listPath)).body.items.length, 0);
  const remaining = await manager.query(a.ownerId, 'query_evidence', { operation: 'get', evidence_id: evidenceId });
  assert.equal(remaining.evidence.raw_content, null, 'Core projection must not reveal a deleted source');
  const cleared = execFileSync(python, ['-c', `import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
row=db.execute('SELECT raw_content,deleted_at FROM evidence WHERE id=?', (sys.argv[2],)).fetchone()
print(int(row is not None and row[0]=='' and row[1] is not None))
db.close()`, db, evidenceId], { windowsHide: true, timeout: 10_000 }).toString('utf8').trim();
  assert.equal(cleared, '1', 'underlying Core DB must clear the original Evidence content');
  assert.equal((await manager.ingest(a.ownerId, boundary)).state, 'discarded');
  assert.equal((await manager.query(b.ownerId, 'query_evidence', { operation: 'list' })).evidence.length, 0);
  console.log('[personal-memory-http-delete] owner A list/source/true-delete/receipt; B same ID 404; Core source cleared and replay rejected; no model calls');
} finally {
  await service.close().catch(() => {});
  await manager.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
