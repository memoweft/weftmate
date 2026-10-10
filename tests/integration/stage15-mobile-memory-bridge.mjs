// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Explicit isolated Android WebView bridge acceptance against real account-scoped MemoWeft Core. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_ANDROID_MEMORY_BRIDGE !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_ANDROID_MEMORY_BRIDGE=1 for isolated Android memory bridge acceptance.');
}
const adb = process.env.WEFTMATE_STAGE15_ADB;
const serial = process.env.WEFTMATE_STAGE15_ANDROID_SERIAL;
const appApk = process.env.WEFTMATE_STAGE15_ANDROID_APP_APK;
const testApk = process.env.WEFTMATE_STAGE15_ANDROID_TEST_APK;
if (![adb, appApk, testApk].every((value) => typeof value === 'string' && existsSync(value)) ||
    typeof serial !== 'string' || !serial) {
  throw new Error('Stage15 Android bridge requires existing WEFTMATE_STAGE15_ADB, serial, app APK and test APK paths.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const root = mkdtempSync(join(tmpdir(), 'weftmate-stage15-android-memory-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const memoryRoot = join(root, 'memory');
const manager = createPersonalMemoryManager({ root: memoryRoot, enabled: true, python, pythonPath,
  baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'stage15-isolated',
  rpcFactory: (options) => new MemoWeftRpc({ ...options, env: { ...options.env,
    MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' } }) });
const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [], preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => ({ accepted: true }),
  cancelSession: async () => ({ accepted: true }), readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null };
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend, memoryManager: manager });
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { windowsHide: true, encoding: 'utf8', timeout: 60_000 });
const runAsync = (...args) => promisify(execFile)(adb, ['-s', serial, ...args],
  { windowsHide: true, encoding: 'utf8', timeout: 90_000 });
const passwordA = `Stage15-A-${randomUUID()}-memory`;
const passwordB = `Stage15-B-${randomUUID()}-memory`;
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const userA = `stage15a${suffix}`;
const userB = `stage15b${suffix}`;
const text = `stage15-memory-${suffix}`;
const itemId = `cognition:stage15:${suffix}`;
let reversePort = null;
async function register(origin, username, password) {
  const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, deviceName: 'Stage15 desktop fixture' }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  return { ownerId: body.account.ownerId, csrf: body.csrfToken, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function read(origin, account, path) {
  const response = await fetch(`${origin}${path}`, { headers: { cookie: account.cookie } });
  return { status: response.status, body: await response.json() };
}
try {
  const { origin } = await service.start();
  const [a, b] = await Promise.all([register(origin, userA, passwordA), register(origin, userB, passwordB)]);
  const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: `stage15-user-${suffix}`, source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }];
  const boundary = boundaryForCompletedTurn({ id: `session-stage15-${suffix}`, header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1));
  assert.equal((await manager.ingest(a.ownerId, boundary)).state, 'accepted');
  const evidence = await manager.query(a.ownerId, 'query_evidence', { operation: 'list' });
  const evidenceId = evidence.evidence.find((row) => row.raw_content === text)?.evidence_id;
  assert.equal(typeof evidenceId, 'string');
  const database = join(memoryRoot, 'accounts', a.ownerId, 'memory-home', 'memoweft', 'memoweft.sqlite3');
  const seed = `import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\ndb.execute("INSERT INTO cognition(id,subject_id,content,content_type,formed_by,confidence,cred_status,scope,valid_at,invalid_at,asked_at,archived_at,muted_at,created_at,updated_at) VALUES (?,?,?,'preference','stated',80,'credible',NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-05T00:00:00Z','2026-10-05T00:00:00Z')", (sys.argv[2],sys.argv[3],sys.argv[4]))\ndb.execute("INSERT INTO cognition_evidence(cognition_id,evidence_id,relation) VALUES (?,?,'support')", (sys.argv[2],sys.argv[5]))\ndb.commit()\ndb.close()`;
  execFileSync(python, ['-c', seed, database, itemId, a.ownerId, text, evidenceId], { windowsHide: true, timeout: 10_000 });
  const encodedText = encodeURIComponent(text);
  assert.equal((await read(origin, a, `/personal/v1/memory/items?kind=cognition&query=${encodedText}`)).body.items[0].id, itemId);
  const encodedItemId = encodeURIComponent(itemId);
  assert.equal((await read(origin, a, `/personal/v1/memory/items/cognition/${encodedItemId}`)).body.item.id, itemId);
  assert.ok((await read(origin, a, `/personal/v1/memory/items/cognition/${encodedItemId}/sources`)).body.sources.length > 0);
  assert.equal((await read(origin, b, `/personal/v1/memory/items?kind=cognition&query=${encodedText}`)).body.items.length, 0);
  const port = Number(new URL(origin).port);
  run('reverse', `tcp:${port}`, `tcp:${port}`); reversePort = port;
  run('install', '-r', appApk); run('install', '-r', testApk);
  const { stdout: instrument } = await runAsync('shell', 'am', 'instrument', '-w', '-r',
    '-e', 'class', 'com.memoweft.weftmate.mobile.Stage15MemoryBridgeInstrumentedTest',
    '-e', 'stage15MemoryBridge', '1', '-e', 'origin', `http://127.0.0.1:${port}`,
    '-e', 'userA', userA, '-e', 'passwordA', passwordA, '-e', 'userB', userB, '-e', 'passwordB', passwordB,
    '-e', 'itemId', itemId, '-e', 'memoryText', text,
    'com.memoweft.weftmate.mobile.stage15memoryqa.test/androidx.test.runner.AndroidJUnitRunner');
  assert.match(instrument, /OK \(1 test\)/);
  const desktopA = await read(origin, a, `/personal/v1/memory/items?kind=cognition&query=${encodedText}`);
  assert.equal(desktopA.body.items[0].currentState, 'not_current');
  assert.equal(typeof desktopA.body.items[0].lifecycle?.mutedAt, 'string');
  const receipt = await read(origin, a, `/personal/v1/memory/commands/by-request/${encodeURIComponent('stage15:memory:mute')}`);
  assert.equal(receipt.body.receipt.state, 'applied');
  assert.equal((await read(origin, b, `/personal/v1/memory/items?kind=cognition&query=${encodedText}`)).body.items.length, 0);
  console.log('[stage15-mobile-memory-bridge] real Core, isolated A/B accounts, Android WebView bridge, %3A item, source, mute receipt, restart, and desktop readback passed');
} finally {
  if (reversePort !== null) try { run('reverse', '--remove', `tcp:${reversePort}`) } catch {}
  await service.close().catch(() => {}); await manager.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
