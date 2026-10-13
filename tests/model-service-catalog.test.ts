import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { canonicalServiceBaseUrl, isChatModel, modelDisplayName, normalizeServiceModels, queryServiceCatalog, mergeServiceModels } from '../src/model-service-catalog.mjs';

test('directory filters non-chat models, preserves display labels and marks only explicit abilities', () => {
  assert.equal(canonicalServiceBaseUrl('https://service.example.test/v1/chat/completions'), 'https://service.example.test/v1');
  assert.equal(canonicalServiceBaseUrl('http://service.example.test/v1'), null);
  assert.equal(modelDisplayName('mimo-v2.6-flash'), 'MiMo v2.6 Flash');
  for (const id of ['text-embedding-3-small','mimo-v2.5-asr','mimo-v2.5-tts','gpt-image-1','qwen-image','sora-2','omni-moderation-latest','whisper-1','gpt-4o-audio-preview']) assert.equal(isChatModel(id), false, id);
  const rows = normalizeServiceModels([{ id: 'mimo-v2.6-flash' }, { id: 'mimo-v2.6-pro', display_name: 'MiMo Pro', input_modalities: ['text','image'], context_window: 131072, supports_reasoning: true }, { id: 'mimo-v2.5-asr' }]);
  assert.equal(rows.length, 2); assert.equal(rows[0].capabilities, undefined); assert.equal(rows[0].deepThinking, undefined);
  assert.equal(rows[1].name, 'MiMo Pro'); assert.deepEqual(rows[1].capabilities, { vision: true, contextWindow: 131072 });
  assert.deepEqual(rows[1].deepThinking, { supported: true, effort: 'high' });
  const claude = normalizeServiceModels([{ id: 'claude-synthetic', max_input_tokens: 200000,
    capabilities: { image_input: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } } } }])[0];
  assert.deepEqual(claude.capabilities, { vision: true, contextWindow: 200000 }); assert.deepEqual(claude.deepThinking, { supported: true, effort: 'high', type: 'adaptive' });
  const merged = mergeServiceModels([{ ...rows[0], enabled: false, profileId: 'legacy', lastUsedAt: '2026-10-13T00:00:00.000Z' }, { modelId: 'manual-chat', name: 'Manual', enabled: true }], rows);
  assert.equal(merged[0].enabled, false); assert.equal(merged[0].profileId, 'legacy'); assert.equal(merged.length, 3);
});

test('random local directory distinguishes rejected credentials, unsupported directory, invalid and offline', async () => {
  const secret = randomBytes(24).toString('hex');
  let code = 200, malformed = false, seen = 0;
  const server = createServer((request, response) => {
    seen++; assert.equal(request.url, '/v1/models'); assert.equal(request.headers.authorization === `Bearer ${secret}`, true);
    response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify(malformed ? {} : { data: [{ id: 'mimo-v2.6-flash' }, { id: 'mimo-v2.6-pro' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  try {
    const success = await queryServiceCatalog({ baseUrl, apiKey: secret }); assert.equal(success.status, 'available'); assert.equal(success.models.length, 2);
    code = 401; const rejected = await queryServiceCatalog({ baseUrl, apiKey: secret }); assert.equal(rejected.status, 'authentication_failed');
    code = 404; const unsupported = await queryServiceCatalog({ baseUrl, apiKey: secret }); assert.equal(unsupported.status, 'unsupported'); assert.notEqual(unsupported.message, rejected.message);
    code = 200; malformed = true; assert.equal((await queryServiceCatalog({ baseUrl, apiKey: secret })).status, 'invalid');
    assert.equal(seen, 4);
    assert.equal(JSON.stringify(success).includes(secret), false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.equal((await queryServiceCatalog({ baseUrl, apiKey: secret })).status, 'offline');
});
