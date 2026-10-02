/** Authenticated retry of an actual Core WAL cleanup, with one synthetic reader lock. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_MEMORY_WAL_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_WAL_E2E=1 for isolated Core WAL cleanup acceptance.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-wal-'));
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
let reader = null;
try {
  const { origin } = await service.start();
  const registered = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'SyntheticWalOwner', password: 'synthetic wal password 123',
      deviceName: 'Fixture' }) });
  assert.equal(registered.status, 201);
  const auth = await registered.json();
  const ownerId = auth.account.ownerId;
  const cookie = registered.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: 'wal-user', source: { kind: 'user' },
      content: [{ type: 'text', text: '合成待删除来源' }] } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ];
  const boundary = boundaryForCompletedTurn({ id: 'session-synthetic-wal',
    header: { agentPreset: 'personal-remote' }, events }, events.at(-1));
  assert.equal((await manager.ingest(ownerId, boundary)).state, 'accepted');
  const evidence = await manager.query(ownerId, 'query_evidence', { operation: 'list' });
  const evidenceId = evidence.evidence.find((item) => item.raw_content === '合成待删除来源')?.evidence_id;
  assert.equal(typeof evidenceId, 'string');
  const revision = (await manager.query(ownerId, 'query_world', { operation: 'revision' })).world_revision;
  const db = join(root, 'memory', 'accounts', ownerId, 'memory-home', 'memoweft', 'memoweft.sqlite3');
  const walMode = execFileSync(python, ['-c', `import sqlite3, sys
db=sqlite3.connect(sys.argv[1])
print(db.execute('PRAGMA journal_mode=WAL').fetchone()[0])
db.close()`, db], { windowsHide: true, timeout: 10_000 }).toString('utf8').trim();
  assert.equal(walMode, 'wal');
  const hold = `import sqlite3, sys
db=sqlite3.connect(sys.argv[1], isolation_level=None)
db.execute('BEGIN')
assert db.execute('SELECT raw_content FROM evidence WHERE id=?', (sys.argv[2],)).fetchone()
print('READY', flush=True)
sys.stdin.readline()
db.execute('ROLLBACK')
db.close()`;
  reader = spawn(python, ['-u', '-c', hold, db, evidenceId],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let ready = '';
  for await (const chunk of reader.stdout) {
    ready += chunk;
    if (ready.includes('READY')) break;
  }
  assert.match(ready, /READY/);
  const path = `/personal/v1/memory/evidence/${encodeURIComponent(evidenceId)}`;
  const deleted = await fetch(`${origin}${path}`, { method: 'DELETE',
    headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'synthetic-wal-delete', expectedWorldRevision: revision }) });
  const deletedBody = await deleted.json();
  assert.equal(deleted.status, 200, `delete code=${deletedBody?.error?.code ?? 'none'}`);
  assert.equal(deletedBody.receipt.storageCleanup.state, 'pending');
  const receiptPath = '/personal/v1/memory/commands/by-request/synthetic-wal-delete';
  const pending = await fetch(`${origin}${receiptPath}`, { headers: { cookie } });
  assert.equal((await pending.json()).receipt.storageCleanup.state, 'pending');
  reader.stdin.end('\n');
  await once(reader, 'close');
  assert.equal(reader.exitCode, 0);
  reader = null;
  const retried = await fetch(`${origin}${receiptPath}/retry-cleanup`, { method: 'POST',
    headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' },
    body: '{}' });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).receipt.storageCleanup.state, 'complete');
  console.log('[personal-memory-wal-cleanup] authenticated delete pending under WAL reader; explicit retry completed after release; no model calls');
} finally {
  if (reader && reader.exitCode === null) { reader.stdin.end('\n'); reader.kill(); }
  await service.close().catch(() => {});
  await manager.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
