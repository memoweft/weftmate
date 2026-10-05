/** Explicit 20-minute isolated Core host for a manually observed desktop/Android memory UI pass. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE15_MEMORY_UI_SERVE !== '1') {
  throw new Error('Set WEFTMATE_STAGE15_MEMORY_UI_SERVE=1 to start the bounded isolated UI fixture.');
}
const evidenceRoot = 'D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/Stage15-WindowsAndroid-20261005/Memory';
const privateFixture = join(evidenceRoot, 'private-stage15-memory-ui-fixture.json');
const publicEvidence = join(evidenceRoot, 'stage15-memory-ui-serve.json');
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const root = mkdtempSync(join(tmpdir(), 'weftmate-stage15-memory-ui-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const manager = createPersonalMemoryManager({ root: join(root, 'memory'), enabled: true, python, pythonPath,
  baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'stage15-isolated',
  rpcFactory: (options) => new MemoWeftRpc({ ...options, env: { ...options.env,
    MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' } }) });
const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
  preflight: async () => ({ ok: true }), createSession: async ({ sessionId }) => ({ sessionId }),
  sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
  readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }), describeSession: async () => null };
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend, memoryManager: manager });
async function register(origin, username, password) {
  const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, deviceName: 'Stage15 UI fixture' }) });
  assert.equal(response.status, 201); return { ...(await response.json()).account, username, password };
}
try {
  const { origin } = await service.start(); const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const a = await register(origin, `stage15uia${suffix}`, `Stage15-A-${randomUUID()}-memory`);
  const b = await register(origin, `stage15uib${suffix}`, `Stage15-B-${randomUUID()}-memory`);
  const text = `stage15-ui-memory-${suffix}`; let itemId = `cognition:stage15:${suffix}`;
  const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 2, type: 'user/message',
    data: { id: `stage15-ui-${suffix}`, source: { kind: 'user' }, content: [{ type: 'text', text }] } },
  { seq: 3, type: 'assistant/message', data: { message: { id: `stage15-assistant-${suffix}`, content: [{ type: 'text', text: '已记录。' }] } } },
  { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }];
  assert.equal((await manager.ingest(a.ownerId, boundaryForCompletedTurn({ id: `session-ui-${suffix}`,
    header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)))).state, 'accepted');
  const deadline = Date.now() + 30_000;
  let formed;
  while (Date.now() < deadline) {
    const world = await manager.query(a.ownerId, 'query_world', { operation: 'list', object_kind: 'cognition', include_history: false });
    const matches = (world.items ?? []).filter((row) => row.value?.content?.includes(text) && row.current_state === 'current');
    if (matches.length === 1 && Number.isSafeInteger(world.world_revision)) { itemId = matches[0].item_id; formed = world; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(formed, 'isolated Core did not form one stable cognition');
  mkdirSync(evidenceRoot, { recursive: true }); const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
  writeFileSync(privateFixture, JSON.stringify({ origin, expiresAt, accountA: a, accountB: b, itemId, text }, null, 2), { mode: 0o600 });
  writeFileSync(publicEvidence, JSON.stringify({ startedAt: new Date().toISOString(), expiresAt, origin, fixture: 'private-stage15-memory-ui-fixture.json',
    scope: 'isolated Core/A-B only; ordinary-chat formation and production accounts are not covered' }, null, 2));
  console.log(JSON.stringify({ origin, expiresAt, privateFixture, note: 'Use A in the normal login form, open Memory, list -> detail/source -> back -> mute or correct. B must not see A.' }));
  await new Promise((resolve) => setTimeout(resolve, 20 * 60_000));
} finally { await service.close().catch(() => {}); await manager.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
