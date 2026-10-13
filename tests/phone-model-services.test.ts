import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import * as catalog from '../src/model-service-catalog.mjs';
import '../src/ui-core/phone-model-services.js';
const create = (globalThis as any).WeftPhoneModelServices.create;

async function fixture(t: any, respond: any) {
  const credential = randomBytes(24).toString('base64url');
  const server = createServer((request, response) => {
    assert.ok(request.headers.authorization === `Bearer ${credential}`, 'credential is used only in the request');
    respond(request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  return { endpoint, credential };
}

test('phone service discovers multiple chat models and the next request uses the selection', async t => {
  const used: string[] = [];
  const { endpoint, credential } = await fixture(t, (request: any, response: any) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [
      { id: 'mimo-v2.6-pro' }, { id: 'mimo-v2.6-flash', display_name: 'MiMo v2.6 Flash' },
      { id: 'mimo-v2.5-asr' }, { id: 'mimo-v2.5-tts' }, { id: 'text-embedding-3-small' },
    ] }));
    let body = ''; request.on('data', (value: Buffer) => { body += value; }); request.on('end', () => {
      used.push(JSON.parse(body).model); response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
  });
  const manager = await create({ catalog, crypto: webcrypto });
  await manager.configure({ name: '合成服务', endpoint, apiKey: credential });
  const view = manager.view(), service = view.services[0];
  assert.deepEqual(service.models.map((row: any) => row.modelId), ['mimo-v2.6-pro', 'mimo-v2.6-flash']);
  assert.equal(view.selected.modelId, 'mimo-v2.6-flash');
  assert.equal(JSON.stringify(view).includes(credential), false);
  const inFlight = manager.currentModel();
  manager.select(service.serviceId, 'mimo-v2.6-pro');
  assert.equal(inFlight.modelId, 'mimo-v2.6-flash');
  const next = manager.currentModel();
  await fetch(endpoint + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${next.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: next.modelId }) });
  assert.deepEqual(used, ['mimo-v2.6-pro']);
  assert.equal(manager.selectedView().displayName, 'MiMo v2.6 Pro');
});

test('phone service caches, refreshes in the background and preserves hidden and manual models', async t => {
  let queries = 0, discovered = [{ id: 'chat-fast' }];
  const { endpoint, credential } = await fixture(t, (_request: any, response: any) => {
    queries++; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: discovered }));
  });
  let now = Date.now();
  const manager = await create({ catalog, crypto: webcrypto, now: () => now });
  await manager.configure({ name: '合成服务', endpoint, apiKey: credential });
  const serviceId = manager.view().services[0].serviceId;
  manager.update({ serviceId, enabledModelIds: [], modelId: 'manual-chat' });
  await manager.refresh(); assert.equal(queries, 1);
  discovered.push({ id: 'chat-new' }); now += catalog.SERVICE_CATALOG_TTL_MS + 1;
  const refresh = manager.refresh();
  assert.ok(manager.view().services[0].models.some((row: any) => row.modelId === 'manual-chat'));
  await refresh; assert.equal(queries, 2);
  const models = manager.view().services[0].models;
  assert.equal(models.find((row: any) => row.modelId === 'chat-fast').enabled, false);
  assert.ok(models.some((row: any) => row.modelId === 'chat-new'));
  assert.ok(models.some((row: any) => row.modelId === 'manual-chat'));
});

test('phone unavailable directory and rejected credential have different messages, manual fallback remains', async t => {
  let status = 404;
  const { endpoint, credential } = await fixture(t, (_request: any, response: any) => { response.statusCode = status; response.end('{}'); });
  const manager = await create({ catalog, crypto: webcrypto });
  const result = await manager.configure({ name: '合成服务', endpoint, apiKey: credential, modelId: 'custom-chat' });
  assert.equal(result.services[0].catalog.status, 'unsupported');
  assert.match(result.services[0].catalog.message, /不提供模型清单/);
  assert.equal(manager.currentModel().modelId, 'custom-chat');
  status = 401; await manager.refresh(undefined, { force: true });
  assert.equal(manager.view().services[0].catalog.status, 'authentication_failed');
  assert.match(manager.view().services[0].catalog.message, /密钥/);
  assert.equal(manager.currentModel().modelId, 'custom-chat');
});

test('phone repeated old configure merges same service while distinct credentials remain distinct', async t => {
  const { endpoint, credential } = await fixture(t, (_request: any, response: any) => { response.statusCode = 404; response.end('{}'); });
  const manager = await create({ catalog, crypto: webcrypto });
  await manager.configure({ endpoint, apiKey: credential, modelId: 'old-first' });
  await manager.configure({ endpoint, apiKey: credential, modelId: 'old-second' });
  await manager.configure({ endpoint, apiKey: credential, modelId: 'old-second' });
  assert.equal(manager.view().services.length, 1);
  assert.deepEqual(manager.view().services[0].models.map((model: any) => model.modelId).sort(), ['old-first', 'old-second']);
  const different = randomBytes(24).toString('base64url');
  const second = await create({ catalog: { ...catalog, queryServiceCatalog: async () => ({ status: 'unsupported', models: [], checkedAt: new Date().toISOString() }) }, crypto: webcrypto });
  await second.configure({ endpoint, apiKey: credential, modelId: 'first' });
  await second.configure({ endpoint, apiKey: different, modelId: 'second' });
  assert.equal(second.view().services.length, 2);
  second.clear(); assert.equal(second.view().services.length, 0); assert.equal(second.currentModel(), null);
});

test('phone shared directory reads only declared capabilities and accepts native Claude interface', async () => {
  let headers: any;
  const manager = await create({ catalog, crypto: webcrypto, fetchImpl: async (_url: string, options: any) => {
    headers = options.headers;
    return new Response(JSON.stringify({ data: [{ id: 'claude-current', display_name: '服务显示名', capabilities: { vision: true, reasoning: true, contextWindow: 200000 } }, { id: 'chat-unknown' }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const credential = randomBytes(24).toString('base64url');
  await manager.configure({ endpoint: 'https://model.example/v1', interfaceType: 'anthropic', apiKey: credential });
  assert.ok(headers['x-api-key'] === credential, 'native Claude headers use the in-memory credential');
  const models = manager.view().services[0].models;
  assert.equal(models[0].name, '服务显示名'); assert.deepEqual(models[0].capabilities, { vision: true, contextWindow: 200000 });
  assert.equal(models[0].deepThinking.supported, true); assert.equal(models[1].capabilities, undefined);
  manager.setDeepThinking(true); assert.equal(manager.currentModel().deepThinking.enabled, true);
  await manager.refresh(undefined, { force: true }); assert.equal(manager.currentModel().deepThinking.enabled, true);
});

test('phone changing a service while an old directory refresh is pending ignores the stale result', async () => {
  let finishOld: () => void, startedOld: () => void, delayed = false;
  const gate = new Promise<void>(resolve => { finishOld = resolve; });
  const started = new Promise<void>(resolve => { startedOld = resolve; });
  const firstCredential = randomBytes(24).toString('base64url'), nextCredential = randomBytes(24).toString('base64url');
  const manager = await create({ catalog, crypto: webcrypto, fetchImpl: async (_url: string, options: any) => {
    const old = options.headers.authorization === `Bearer ${firstCredential}`;
    if (old && delayed) { startedOld(); await gate; }
    return new Response(JSON.stringify({ data: [{ id: old ? delayed ? 'stale-chat' : 'old-chat' : 'new-chat' }] }));
  } });
  await manager.configure({ endpoint: 'https://model.example/v1', apiKey: firstCredential });
  const serviceId = manager.view().services[0].serviceId; delayed = true;
  const refresh = manager.refresh(serviceId, { force: true }); await started;
  await manager.configure({ serviceId, endpoint: 'https://model.example/v1', apiKey: nextCredential });
  finishOld(); await refresh;
  assert.ok(manager.view().services[0].models.some((model: any) => model.modelId === 'new-chat'));
  assert.equal(manager.view().services[0].models.some((model: any) => model.modelId === 'stale-chat'), false);
  assert.ok(manager.currentModel().apiKey === nextCredential, 'only the newly configured service credential remains selected');
});
