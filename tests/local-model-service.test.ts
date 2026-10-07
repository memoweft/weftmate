import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalModelController, localModelArguments } from '../src/local-model-service.mjs';

test('local launcher keeps its config and logs outside the public repository and defaults to one conservative slot', () => {
  assert.throws(() => createLocalModelController(resolve('scripts/local-model.example.json')), /OUTSIDE_REPOSITORY/);
  const args = localModelArguments({ model: 'synthetic.gguf', alias: 'qwen', port: 18081, contextSize: 32768 });
  const value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--parallel'), '1'); assert.equal(value('--n-gpu-layers'), '48');
  assert.equal(value('--cache-type-k'), 'q8_0'); assert.equal(value('--cache-type-v'), 'q8_0');
  assert.equal(value('--ctx-size'), '32768'); assert.equal(value('--host'), '127.0.0.1');
});

test('model status reports the service context rather than configuration and refuses unreadable props', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-local-service-'));
  let metadataStatus = 200;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') response.end('{"status":"ok"}');
    else { response.writeHead(metadataStatus); response.end(JSON.stringify({ build_info: 'synthetic-build',
      default_generation_settings: { n_ctx: 16384 }, total_slots: 1 })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const file = join(root, 'model.json');
  await writeFile(file, JSON.stringify({ executable: join(root, 'llama-server.exe'), model: join(root, 'model.gguf'),
    alias: 'qwen', port, contextSize: 32768 }));
  const controller = createLocalModelController(file);
  try {
    assert.deepEqual(await controller.status(), { state: 'ready', version: 'synthetic-build',
      contextWindow: 16384, slots: 1, lastError: null });
    metadataStatus = 401;
    assert.equal((await controller.status()).lastError, 'MODEL_HTTP_401');
    assert.equal((await controller.status()).state, 'unavailable');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
