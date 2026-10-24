import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import test from 'node:test';
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs';

const metadata = (id: string) => ({ schema_version: 1, capture_status: 'complete',
  world_items: [{ object_kind: 'evidence', item_id: id }], interaction_ids: [] });

test('memory_query forwards the manager dependency metadata unchanged', async () => {
  const dependencies = metadata('tool-source');
  const result = await handlePersonalMemoryTool({ recall: async () => ({ state: 'ready', contextText: 'synthetic',
    memories: [], model_context_dependencies: dependencies }) }, 'synthetic',
    { name: 'memory_query', arguments: { query: 'synthetic' } }, { memoryPolicy: { recall: true } });
  assert.deepEqual(result.model_context_dependencies, dependencies);
});

for (const capture of ['complete', 'unknown', 'overflow-world', 'overflow-interaction']) test(`query tool sources survive later automatic recall (${capture} capture)`, { timeout: 15000 }, async () => {
  const complete = capture === 'complete';
  const child = fork(new URL('fixtures/personal-memory-plugin-child.mjs', import.meta.url), ['--protocol-only'], {
    env: { ...process.env, WEFTMATE_PERSONAL_MEMORY_ENABLED: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  try {
    const result: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('synthetic query capture timeout')), 12000);
      child.on('message', (message: any) => {
        if (message.type === 'ready') child.send({ type: 'run-query-dependencies' });
        else if (message.type === 'result' || message.type === 'failed') {
          clearTimeout(timer); if (message.type === 'failed') reject(Error(message.error)); else resolve(message);
        } else if (message.protocol === 'weftmate.personal-memory.v1') {
          const tool = message.action === 'tool';
          const dependencies = metadata(tool ? 'tool-source' : 'auto-source');
          if (tool && capture === 'overflow-world') {
            dependencies.world_items = Array.from({ length: 65 }, (_, i) => ({ object_kind: 'evidence', item_id: `source-${i}` }));
            dependencies.interaction_ids = ['history'];
          }
          if (tool && capture === 'overflow-interaction') dependencies.interaction_ids = Array.from({ length: 65 }, (_, i) => `history-${i}`);
          child.send({ protocol: message.protocol, id: message.id, ok: true, result: {
            state: 'ready', contextText: 'synthetic source context',
            memories: tool ? [] : [{ kind: 'evidence', id: 'auto-source', summary: 'synthetic' }],
            ...(tool ? { items: [{ kind: 'evidence', id: 'tool-source', summary: 'synthetic' }] } : {}),
            ...(!tool || capture !== 'unknown' ? { model_context_dependencies: dependencies } : {}),
          } });
        }
      });
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); reject(Error('synthetic child exited')); });
    });
    assert.deepEqual(result.dependencies.world_items, complete ? [...metadata('auto-source').world_items, ...metadata('tool-source').world_items] : []);
    assert.deepEqual(result.dependencies.interaction_ids, []);
    assert.equal(result.dependencies.capture_status, complete ? 'complete' : 'unavailable');
  } finally { child.kill(); }
});
