/** Verify FG-1/FG-2 on an isolated copy of an M3-A acceptance World, with no paid model. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { offlineBoundary } from '../../src/personal-offline/snapshot.mjs';
const source = process.env.WEFTMATE_M3A_SOURCE_PROFILE;
assert.ok(source?.includes('weftmate-m3a-e2e-') && !source.includes('Runtime'), 'Only an isolated M3-A fixture is allowed');
const state = JSON.parse(await readFile(join(source, 'personal-access/store.json'), 'utf8'));
const ownerId = Object.keys(state.accounts).find(id => Object.keys(state.accounts[id].accountModels ?? {}).length);
assert.ok(ownerId);
const root = await mkdtemp(join(tmpdir(), 'weftmate-m3a-forget-'));
const home = join(root, 'accounts', ownerId, 'memory-home/memoweft'); await mkdir(home, { recursive: true });
await copyFile(join(source, 'personal-access/accounts', ownerId, 'memory-home/memoweft/memoweft.sqlite3'), join(home, 'memoweft.sqlite3'));
const model = createServer((_req, response) => { response.writeHead(503); response.end('{}'); });
await new Promise(done => model.listen(0, '127.0.0.1', done));
const manager = createPersonalMemoryManager({ root, enabled: true, python: 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',
  pythonPath: 'D:/AIProjects/MemoWeft/Core/py/src', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: '@current', credential: () => 'synthetic-no-model' });
const marker = 'M3A_CORE_DERIVED_SENTINEL';
try {
  const world = await manager.query(ownerId, 'query_world', { operation: 'list', include_history: false });
  const item = world.items.find(i => i.object_kind === 'cognition' && /墨绿/.test(i.value.content)); assert.ok(item);
  const boundary = offlineBoundary('physical-device', { id: randomUUID(), conversationId: randomUUID(), timestamp: Date.now(),
    dependencyComplete: true, memoryRefs: [{ kind: 'cognition', id: item.item_id }],
    messages: [{ role: 'user', text: '我的徒步背包偏好是什么？' }, { role: 'assistant', text: marker + ' 你用墨绿色双肩背包。' }] });
  const imported = await manager.ingest(ownerId, boundary, { offline: true }); assert.equal(imported.state, 'accepted');
  const before = await manager.query(ownerId, 'query_interactions', { conversation_id: boundary.parent_session_id, user_message_id: boundary.source_messages[0].message_id, projection: 'history' });
  assert.ok(JSON.stringify(before).includes(marker), 'imported assistant history was persisted');
  const revision = (await manager.query(ownerId, 'query_world', { operation: 'revision' })).world_revision;
  const result = await manager.submitCommand(ownerId, { requestId: randomUUID(), operation: 'delete_world_item', targetKind: 'cognition',
    targetId: item.item_id, expectedWorldRevision: revision, payload: {}, deleteConversationSnippets: true });
  assert.ok(['applied', 'no_change'].includes((result.receipt ?? result).result_state));
  const after = await manager.query(ownerId, 'query_interactions', { conversation_id: boundary.parent_session_id, user_message_id: boundary.source_messages[0].message_id, projection: 'history' });
  assert.ok(!JSON.stringify(after).includes(marker), 'forget cascaded into offline assistant history');
  await manager.close();
  for (const file of await readdir(home)) {
    const bytes = await readFile(join(home, file)); assert.ok(!bytes.includes(Buffer.from(marker)), 'no derived reply bytes in ' + file);
  }
  const report = { status: 'passed', paidRequests: 0, core: 'real', checks: ['offline assistant dependencies persisted', 'forget cascaded into imported context', 'Core storage byte scan found no derived marker'] };
  await writeFile('tests/evidence/m3-a/core-forget.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally { await manager.close(); await new Promise(done => model.close(done)); await rm(root, { recursive: true, force: true }); }
