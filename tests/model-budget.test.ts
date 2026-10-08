import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readModelCapacity, outputBudget, DEFAULT_MODEL_CAPACITY, messagesForModelInput } from '../src/model-budget.mjs';

const model = { baseUrl: 'http://localhost:8080/v1', modelId: 'qwen' };
function responses(bodies: Record<string, unknown>) {
  const hits: string[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    hits.push(new URL(url).pathname);
    assert.equal(init.method ?? 'GET', 'GET');
    const body = bodies[new URL(url).pathname];
    return new Response(body === undefined ? '' : JSON.stringify(body), { status: body === undefined ? 404 : 200 });
  }) as typeof fetch;
  return { fetchImpl, hits };
}
describe('service model capacity', () => {
  it('reads llama.cpp generation n_ctx and replaces an oversized configured window', async () => {
    const fixture = responses({ '/props': { default_generation_settings: { n_ctx: 92160 }, n_ctx: 262144 } });
    assert.deepEqual(await readModelCapacity({ ...model, contextWindow: 262144 }, fixture),
      { contextWindow: 92160, maxTokens: 32768, source: 'props' });
    assert.deepEqual(fixture.hits, ['/props']);
  });
  it('reads root n_ctx and preserves a reverse-proxy prefix', async () => {
    const fixture = responses({ '/llama/props': { n_ctx: 40960 } });
    assert.equal((await readModelCapacity({ ...model, baseUrl: 'http://localhost/llama/v1' }, fixture)).contextWindow, 40960);
  });
  for (const field of ['max_model_len', 'context_length', 'context_window', 'n_ctx']) {
    it(`reads matching /v1/models ${field}, ignoring other model capacities`, async () => {
      const fixture = responses({ '/v1/models': { data: [{ id: 'other', [field]: 999999 },
        { id: 'qwen', [field]: 90000, max_output_tokens: 16384 }] } });
      assert.deepEqual(await readModelCapacity(model, fixture), { contextWindow: 90000, maxTokens: 16384, source: 'models' });
    });
  }
  it('falls back on configured values after missing or malformed metadata', async () => {
    const fixture = responses({ '/props': { n_ctx: -3 }, '/v1/models': { data: [{ id: 'qwen', context_length: '90000' }] } });
    assert.deepEqual(await readModelCapacity({ ...model, contextWindow: 65536, maxTokens: 12000 }, fixture),
      { contextWindow: 65536, maxTokens: 12000, source: 'config' });
  });
  it('uses at most 32768 without configuration after network or JSON failure', async () => {
    const fetchImpl = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.deepEqual(await readModelCapacity(model, { fetchImpl }), { ...DEFAULT_MODEL_CAPACITY, source: 'default' });
    assert.deepEqual(await readModelCapacity(model, { fetchImpl: (async () => new Response('bad JSON')) as typeof fetch }),
      { ...DEFAULT_MODEL_CAPACITY, source: 'default' });
  });
  it('retains known official MiMo metadata without guessing from model name alone', async () => {
    const fetchImpl = (async () => { assert.fail('known metadata requires no probe'); }) as typeof fetch;
    assert.deepEqual(await readModelCapacity({ baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' }, { fetchImpl }),
      { contextWindow: 1_000_000, maxTokens: 128_000, source: 'metadata' });
  });
});
describe('per-request output budget', () => {
  it('shrinks with input, respects an output capability, and includes safety headroom', () => {
    assert.equal(outputBudget({ contextWindow: 92160, inputTokens: 1000 }), 32768);
    assert.equal(outputBudget({ contextWindow: 92160, inputTokens: 80000 }), 8064);
    assert.equal(outputBudget({ contextWindow: 92160, inputTokens: 80000, maxTokens: 4096 }), 4096);
    assert.equal(outputBudget({ contextWindow: 32768, inputTokens: 0 }), 28672);
  });
  it('rounds input upward and handles exact remaining capacity and overflow', () => {
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 4094.1 }), 1);
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 4094 }), 2);
    assert.equal(outputBudget({ contextWindow: 4096, inputTokens: 5000 }), 1);
    assert.equal(outputBudget({ contextWindow: 1, inputTokens: 0 }), 1);
  });
});

it('text-only model drops image bytes recursively while retaining tool descriptions and image metadata', () => {
  const image = { type: 'image', data: 'PRIVATE_IMAGE_BYTES', mediaType: 'image/png', name: '截图', width: 800, height: 600 };
  const messages = [{ role: 'tool', content: [{ type: 'tool-result', content: [
    { type: 'text', text: '当前页面有一个保存按钮' }, image,
  ] }] }, { role: 'user', content: [image] }];
  const result = messagesForModelInput(messages, ['text']);
  assert.equal(JSON.stringify(result).includes('PRIVATE_IMAGE_BYTES'), false);
  assert.match(JSON.stringify(result), /保存按钮/);
  assert.match(JSON.stringify(result), /800×600/);
  assert.equal(messagesForModelInput(messages, ['text', 'image']), messages);
  assert.equal(messages[0].content[0].content[1], image, 'durable image stays unchanged');
});
