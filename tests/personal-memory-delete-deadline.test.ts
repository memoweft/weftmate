import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('page deletion can finish a slow authorization check while ordinary reads retain their short deadline', async () => {
  // Scale seconds to milliseconds; exercise the actual abort/response behavior.
  const context: any = { WeftUiCore: { factories: {} }, AbortSignal: { timeout: (ms: number) => AbortSignal.timeout(ms / 1000) } };
  runInNewContext(await readFile(new URL('../src/ui-core/memory.js', import.meta.url), 'utf8'), context);
  const core: any = { memoryBase: 'http://synthetic/memory', state: { identityGeneration: 1,
    account: { ownerId: 'owner' }, device: { id: 'device' }, csrfToken: 'csrf' }, memory: { viewGeneration: 0 } };
  let requests = 0;
  const environment = { fetch: async (_url: string, options: any) => {
    requests++;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(Error('aborted')); };
      const timer = setTimeout(() => { options.signal.removeEventListener('abort', abort); resolve(); }, 30);
      options.signal.addEventListener('abort', abort, { once: true });
    });
    return { ok: true, json: async () => ({ ownerId: 'owner', receipt: { state: 'applied' } }) };
  } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, {}, environment));
  const result = await core.memoryRequest('/items/cognition/tea', { method: 'DELETE', body: { requestId: 'one' } });
  assert.equal(result.receipt.state, 'applied');
  assert.equal(requests, 1, 'the client must not replay a slow deletion');
  await assert.rejects(core.memoryRequest('/items/cognition/tea'), { code: 'NETWORK' });
});
