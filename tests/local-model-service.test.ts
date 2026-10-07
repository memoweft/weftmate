import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalModelController, loadLocalModelConfig } from '../src/local-model-service.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-model-endpoint-'));
  const file = join(root, 'config.json');
  let propsStatus = 200, restarting = false;
  const calls: any[] = [];
  const server = createServer((request, response) => {
    calls.push({ path: request.url, method: request.method, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== 'Bearer synthetic-key') { response.writeHead(401).end('{}'); return; }
    if (request.url === '/switch/status') response.end(JSON.stringify({ currentModelId: 'qwen3.8-27b-original',
      switching: false, state: { modelPath: 'private-path' }, models: [{ config: 'private-path' }],
      lastSwitch: { action: restarting ? 'restart' : 'switch', dshModelId: 'qwen3.8-27b-original',
        at: '2026-10-07T12:00:00Z', ok: true, stdout: 'private-script-output' } }));
    else if (request.url === '/props') { response.writeHead(propsStatus); response.end(JSON.stringify({
      default_generation_settings: { n_ctx: 98304 }, total_slots: 1, build_info: 'synthetic-build' })); }
    else if (request.url === '/switch/restart' && request.method === 'POST') {
      restarting = true; response.end('{"ok":true,"restarted":true}');
    } else response.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(file, JSON.stringify({ baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1/`,
    apiKeyEnv: 'MODEL_SWITCH_UNIFIED_KEY', restartPath: '/switch/restart' }));
  const controller = createLocalModelController(file, { credentialFor: async () => 'synthetic-key' });
  try { await run({ controller, calls, file, setPropsStatus: value => { propsStatus = value; } }); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
}

test('endpoint configuration stays outside repository and missing configuration is unconfigured', async () => {
  assert.throws(() => createLocalModelController(resolve('scripts/local-model-endpoint.example.json')), /OUTSIDE_REPOSITORY/);
  await fixture(async ({ file }) => {
    const missing = createLocalModelController(join(file, '..', 'missing.json'));
    assert.equal((await missing.status()).state, 'unconfigured');
    await assert.rejects(missing.control('restart'), /unconfigured/);
  });
});

test('status reads actual ModelSwitcher model and capacity without leaking private metadata', async () => {
  await fixture(async ({ controller, calls }) => {
    const status = await controller.status();
    assert.equal(status.state, 'ready'); assert.equal(status.contextWindow, 98304);
    assert.equal(status.currentModelId, 'qwen3.8-27b-original'); assert.equal(status.slots, 1);
    assert.equal(status.canRestart, true); assert.equal(status.lastSwitch.ok, true);
    assert.equal(JSON.stringify(status).includes('private-'), false);
    assert.deepEqual(calls.map(row => row.path), ['/switch/status', '/props']);
  });
});

test('unreadable props reports unavailable instead of configured capacity or ready', async () => {
  await fixture(async ({ controller, setPropsStatus }) => {
    setPropsStatus(401);
    const status = await controller.status();
    assert.equal(status.state, 'unavailable'); assert.equal(status.contextWindow, null);
    assert.equal(status.currentModelId, 'qwen3.8-27b-original');
  });
});

test('restart delegates only to current-model maintenance and rereads actual capacity', async () => {
  await fixture(async ({ controller, calls }) => {
    const status = await controller.control('restart');
    assert.equal(status.contextWindow, 98304); assert.equal(status.lastSwitch.action, 'restart');
    assert.deepEqual(calls.map(row => [row.method, row.path]), [
      ['POST', '/switch/restart'], ['GET', '/switch/status'], ['GET', '/props']]);
    await assert.rejects(controller.control('start'), /ACTION_INVALID/);
    await assert.rejects(controller.control('stop'), /ACTION_INVALID/);
  });
});

test('invalid legacy configuration is unavailable and read-only configuration cannot restart', async () => {
  await fixture(async ({ controller, file }) => {
    const cfg = await loadLocalModelConfig(file);
    delete cfg.restartPath; await writeFile(file, JSON.stringify(cfg));
    assert.equal((await controller.status()).canRestart, false);
    await assert.rejects(controller.control('restart'), /unconfigured/);
    await writeFile(file, '{"executable":"llama-server","port":18081}');
    assert.equal((await controller.status()).state, 'unavailable');
    await assert.rejects(loadLocalModelConfig(file), /CONFIGURATION_INVALID/);
  });
});

test('credential and transport failures expose only safe error codes', async () => {
  await fixture(async ({ file }) => {
    const controller = createLocalModelController(file, { credentialFor: async () => { throw new Error('private-key'); } });
    const status = await controller.status();
    assert.equal(status.state, 'unavailable'); assert.equal(status.canRestart, false);
    assert.equal(JSON.stringify(status).includes('private-key'), false);
    await assert.rejects(controller.control('restart'), /^Error: MODEL_RESTART_FAILED$/);
  });
});
