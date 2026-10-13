import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';
import { projectOfficialProviderConfig } from '../src/dsh-settings-migration.ts';
import { normalizeProductConfig } from '../src/stage2-config.ts';
import { openAIAnthropicResponse } from '../src/anthropic-compatible-client.mjs';
import { createModelScheduler } from '../src/model-scheduler.mjs';
import { queryServiceCatalog } from '../src/model-service-catalog.mjs';

test('native Claude service stores its interface and projects the DSH messages protocol without changing OpenAI defaults', () => {
  const route = { route: 'synthetic-claude', displayName: 'Synthetic Claude', baseURL: 'https://service.example.test/v1', models: [{ id: 'claude-synthetic', name: 'Claude', contextWindow: 10000, maxTokens: 1000 }] };
  assert.equal(projectOfficialProviderConfig(route).api, 'openai-completions');
  assert.equal(projectOfficialProviderConfig({ ...route, api: 'anthropic-messages' }).api, 'anthropic-messages');
  const profile = { id: 'synthetic-claude', name: 'Claude', provider: 'openai-compatible', interfaceType: 'anthropic', baseUrl: route.baseURL, model: 'claude-synthetic' };
  assert.equal(normalizeProductConfig({ models: { profiles: [profile], activeId: profile.id } }).models.profiles[0].interfaceType, 'anthropic');
});

test('native Claude directory and old JSON/SSE completion proxy share the stored secret but use messages requests', async () => {
  const secret = randomBytes(24).toString('hex'); const requests: any[] = [];
  const upstream = createServer(async (request, response) => {
    if (request.url === '/props') { response.writeHead(404).end(); return; }
    assert.equal(request.headers['x-api-key'] === secret, true); assert.equal(request.headers.authorization, undefined); assert.equal(request.headers['anthropic-version'], '2023-06-01');
    if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'claude-synthetic', display_name: 'Claude Synthetic' }], has_more: true, last_id: 'claude-synthetic' })); return; }
    if (request.url === '/v1/models?after_id=claude-synthetic') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'claude-secondary' }], has_more: false })); return; }
    assert.equal(request.url, '/v1/messages');
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    if (!body.stream) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'message-one', model: body.model, content: [{ type: 'text', text: 'Synthetic reply' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } })); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const frames = [
      { type: 'message_start', message: { id: 'message-stream', model: body.model, usage: { input_tokens: 3, output_tokens: 0 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hidden synthetic reasoning' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Synthetic ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'stream' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 2 } }, { type: 'message_stop' },
    ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('');
    response.write(frames.slice(0, 37)); response.end(frames.slice(37));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const profile = { id: 'native-claude', name: 'Claude', model: 'claude-synthetic', baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}/v1`, interfaceType: 'anthropic' };
  const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://runtime.invalid', referenceScan: () => ({ state: 'ready' }), profiles: () => [profile], hasCredential: () => true,
    credentialForProfile: () => secret, routeForProfile: () => ({ provider: 'native-claude' }), listSessions: async () => ({ items: [] }), resolveSession: async () => null,
    ensureKnownSession: async () => {}, bindSession: () => {}, gateway: async () => ({}), queue: (work: any) => work() });
  try {
    const directory = await queryServiceCatalog({ baseUrl: profile.baseUrl, apiKey: secret, interfaceType: 'anthropic' }); assert.equal(directory.models.length, 2, 'all native directory pages are discovered');
    const checked = await backend.verifyModelProfile(profile.id, 'owner'); assert.equal(checked.modelListed, true); assert.equal(checked.authentication, 'accepted');
    const request = { profileId: profile.id, ownerId: 'owner', body: { model: profile.model, messages: [{ role: 'system', content: 'Synthetic instructions.' }, { role: 'user', content: 'Hello.' }], max_tokens: 32 } };
    const json = await (await backend.modelCompletion(request)).json(); assert.equal(json.choices[0].message.content, 'Synthetic reply'); assert.deepEqual(json.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    assert.equal(requests[0].system, 'Synthetic instructions.'); assert.deepEqual(requests[0].messages, [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }]);
    const stream = await (await backend.modelCompletion({ ...request, body: { ...request.body, stream: true } })).text();
    assert.match(stream, /Synthetic /); assert.match(stream, /stream/); assert.match(stream, /"finish_reason":"length"/); assert.match(stream, /data: \[DONE\]/); assert.equal(stream.includes('hidden synthetic reasoning'), false); assert.equal(stream.includes(secret), false);
    const tool = await openAIAnthropicResponse(Response.json({ content: [{ type: 'tool_use', id: 'call-one', name: 'synthetic_tool', input: { value: 1 } }], stop_reason: 'tool_use', usage: {} }), false);
    const reply = await tool.json(); assert.equal(reply.choices[0].finish_reason, 'tool_calls'); assert.equal(reply.choices[0].message.tool_calls[0].function.arguments, '{"value":1}');
    const bridge = await createModelScheduler({ isIdle: async () => true, profileFor: () => profile, credentialFor: () => secret, backgroundRoute: () => null });
    try {
      const scheduled = await fetch(bridge.memoryBaseUrl(profile.id, 'owner', 'memory') + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(request.body) });
      assert.equal(scheduled.status, 200); assert.equal((await scheduled.json()).choices[0].message.content, 'Synthetic reply');
      const scheduledStream = await fetch(bridge.memoryBaseUrl(profile.id, 'owner', 'memory') + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ ...request.body, stream: true }) });
      const text = await scheduledStream.text(); assert.match(text, /data: \[DONE\]/); assert.equal(text.includes('hidden synthetic reasoning'), false);
    } finally { await bridge.close(); }
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); }
});
