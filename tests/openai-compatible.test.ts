import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOpenAICompatibleModels, parseVerifiedOpenAICompletion } from '../src/openai-compatible.ts';
import { discoverOpenAICompatibleModels, openAICompatibleEndpoint, verifyOpenAICompatibleModel } from '../src/openai-compatible-client.ts';

describe('OpenAI-compatible real discovery response validation', () => {
  it('returns deduplicated, trimmed service model ids', () => {
    assert.deepEqual(parseOpenAICompatibleModels({ data: [{ id: ' qwen ' }, { id: 'qwen' }, { id: 'other' }] }), ['qwen', 'other']);
  });

  it('rejects malformed, empty, and unusable discovery envelopes', () => {
    for (const value of [null, {}, { data: {} }, { data: [] }, { data: [{ id: '' }] }, { data: [{ name: 'not-an-id' }] }]) {
      assert.throws(() => parseOpenAICompatibleModels(value));
    }
  });

  it('rejects credential-smuggling endpoints and permits only loopback HTTP or HTTPS', () => {
    assert.equal(openAICompatibleEndpoint('http://127.0.0.1:8080/v1/', 'models').toString(), 'http://127.0.0.1:8080/v1/models');
    for (const endpoint of ['http://example.test/v1', 'http://user:pass@127.0.0.1/v1', 'https://example.test/v1?token=x', 'https://example.test/v1#key']) {
      assert.throws(() => openAICompatibleEndpoint(endpoint, 'models'));
    }
  });

  it('uses redirect:error and rejects malformed/empty/non-stop completion results', async () => {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const fetchImpl = async (url: URL, init: Record<string, unknown>) => {
      calls.push({ url: url.toString(), init });
      return { ok: true, json: async () => url.pathname.endsWith('/models') ? { data: [{ id: 'model-a' }] } : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] } };
    };
    await verifyOpenAICompatibleModel({ baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'test-only', model: 'model-a', fetchImpl });
    assert.equal(calls.length, 2); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[1].init.redirect, 'error');
    for (const body of [{ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }, { choices: [{ message: { content: 'OK' }, finish_reason: 'length' }] }, {}]) assert.throws(() => parseVerifiedOpenAICompletion(body));
  });

  it('fails before network access for a rejected endpoint', async () => {
    let calls = 0;
    await assert.rejects(() => discoverOpenAICompatibleModels({ baseUrl: 'http://attacker.invalid/v1', apiKey: 'test-only', fetchImpl: async () => { calls++; throw new Error('must not fetch'); } }));
    assert.equal(calls, 0);
  });
});
