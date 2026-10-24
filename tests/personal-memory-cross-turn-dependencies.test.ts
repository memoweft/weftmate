import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import test from 'node:test';

for (const scenario of ['known', 'unknown', 'dropped', 'compacted', 'transitive']) test(`saved reply dependencies follow the actual next-turn context: ${scenario}`, { timeout: 15000 }, async () => {
  const child = fork(new URL('fixtures/personal-memory-plugin-child.mjs', import.meta.url), ['--protocol-only'], {
    env: { ...process.env, WEFTMATE_PERSONAL_MEMORY_ENABLED: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  try {
    const result: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('cross-turn fixture timeout')), 12000);
      child.on('message', (message: any) => {
        if (message.type === 'ready') child.send({ type: 'run-cross-turn-dependencies', scenario });
        else if (message.type === 'result' || message.type === 'failed') {
          clearTimeout(timer); if (message.type === 'failed') reject(Error(message.error)); else resolve(message);
        } else if (message.protocol === 'weftmate.personal-memory.v1') {
          const id = `source-${String.fromCharCode(64 + message.turn)}`;
          child.send({ protocol: message.protocol, id: message.id, ok: true, result: { state: 'ready', contextText: 'Synthetic recall.',
            memories: [{ kind: 'evidence', id, summary: 'Synthetic' }], model_context_dependencies: {
              schema_version: 1, capture_status: 'complete', world_items: [{ object_kind: 'evidence', item_id: id }], interaction_ids: [] } } });
        }
      });
      child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(Error('fixture exited')); });
    });
    assert.equal(result.priorInContext, ['known', 'unknown', 'transitive'].includes(scenario));
    assert.equal(result.dependencies.capture_status, scenario === 'unknown' || scenario === 'compacted' ? 'unavailable' : 'complete');
    assert.deepEqual(result.dependencies.world_items, scenario === 'known' || scenario === 'transitive'
      ? (scenario === 'transitive' ? ['source-A', 'source-B', 'source-C'] : ['source-A', 'source-B']).map(item_id => ({ object_kind: 'evidence', item_id }))
      : scenario === 'dropped' ? [{ object_kind: 'evidence', item_id: 'source-B' }] : []);
  } finally { child.kill(); }
});
