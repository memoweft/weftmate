/** Real isolated Core workers, synthetic interpretation, no network model calls. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_MEMORY_WORLD_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_WORLD_E2E=1 for this synthetic, model-free Core worker test.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-world-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const ownerA = 'owner-00000000-0000-4000-8000-000000000001';
const ownerB = 'owner-00000000-0000-4000-8000-000000000002';
const sessionId = 'session-synthetic-same-id';
const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
  baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'synthetic-no-network',
  rpcFactory: (options) => new MemoWeftRpc({ ...options,
    env: { ...options.env, MEMOWEFT_TESTING: '1', MEMOWEFT_TEST_MODEL_RESPONSE: '__smart__' } }) });
const boundary = (text, turn) => {
  const events = [
    { seq: 1, type: 'turn/start', data: { turn } },
    { seq: 2, type: 'user/message', data: { id: `user-${turn}`, source: { kind: 'user' },
      content: [{ type: 'text', text }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: `assistant-${turn}`,
      content: [{ type: 'text', text: '合成确认' }] } } },
    { seq: 4, type: 'turn/end', data: { turn, reason: { kind: 'stop' } } },
  ];
  return boundaryForCompletedTurn({ id: sessionId,
    header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1));
};
async function waitForWorld(ownerId, text) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await manager.query(ownerId, 'query_world', { operation: 'list',
      object_kind: 'cognition', include_history: true });
    if (result.items?.some((item) => item.value?.content?.includes(text))) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('synthetic Core world worker did not form its cognition');
}
try {
  assert.equal((await manager.status(ownerA)).state, 'ready');
  assert.equal((await manager.status(ownerB)).state, 'ready');
  assert.equal((await manager.ingest(ownerA, boundary('我喜欢合成蓝色茶杯', 1))).state, 'accepted');
  const formed = await waitForWorld(ownerA, '合成蓝色茶杯');
  const nextSession = 'session-synthetic-new-a';
  const aRecall = await manager.recall(ownerA, { query: '合成蓝色茶杯', sessionId: nextSession });
  const bRecall = await manager.recall(ownerB, { query: '合成蓝色茶杯', sessionId: nextSession });
  assert.equal(aRecall.state, 'ready');
  assert.match(aRecall.contextText, /合成蓝色茶杯/);
  assert.equal(bRecall.state, 'ready');
  assert.equal(bRecall.contextText.includes('合成蓝色茶杯'), false);
  const oldItem = formed.items.find((item) => item.value?.content?.includes('合成蓝色茶杯'));
  const corrected = await manager.submitCommand(ownerA, { requestId: 'synthetic-correction',
    expectedWorldRevision: formed.world_revision, operation: 'correct_world_item',
    targetKind: 'cognition', targetId: oldItem.item_id,
    payload: { correction_text: '用户喜欢合成绿色茶杯' } });
  assert.equal(corrected.receipt.result_state, 'applied');
  const correctedRecall = await manager.recall(ownerA,
    { query: '合成茶杯', sessionId: 'session-synthetic-after-correction' });
  assert.match(correctedRecall.contextText, /合成绿色茶杯/);
  assert.equal(correctedRecall.contextText.includes('合成蓝色茶杯'), false);
  const revised = await manager.query(ownerA, 'query_world', { operation: 'list',
    object_kind: 'cognition', include_history: true });
  const newItem = revised.items.find((item) => item.current_state === 'current' &&
    item.value?.content?.includes('合成绿色茶杯'));
  assert.ok(newItem);
  const muted = await manager.submitCommand(ownerA, { requestId: 'synthetic-mute',
    expectedWorldRevision: revised.world_revision, operation: 'mute_world_item',
    targetKind: 'cognition', targetId: newItem.item_id, payload: {} });
  assert.equal(muted.receipt.result_state, 'applied');
  const mutedRecall = await manager.recall(ownerA,
    { query: '合成茶杯', sessionId: 'session-synthetic-after-mute' });
  assert.equal(mutedRecall.contextText.includes('合成绿色茶杯'), false);
  console.log('[personal-memory-core-world] A real worker formed memory; A new session recalled it; B did not; correction and mute changed later recall; synthetic route only');
} finally {
  await manager.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
