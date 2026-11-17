import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';
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
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 4094.1 }), null);
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 4094 }), null);
    assert.equal(outputBudget({ contextWindow: 4096, inputTokens: 5000 }), null);
    assert.equal(outputBudget({ contextWindow: 1, inputTokens: 0 }), null);
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 2048 }), 2048);
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 2048.1 }), null);
    assert.equal(outputBudget({ contextWindow: 8192, inputTokens: 3000, maxTokens: 1024 }), 1024);
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

for (const modern of [false, true]) it(`budget adapter supports ${modern ? 'Volatile providers and prepared calls' : 'plain providers and legacy streams'}`, async t => {
  const rowSchema = { dict: { streamIdleTimeoutMs: { meta: { default: 300000 } } } };
  const nativeSchema = { dict: { providers: { inner: modern ? { inner: rowSchema } : rowSchema } } };
  const modules: Record<string, string> = {
    '@deepseek-ai/dsh-llm-pi-ai': `export const Config = ${JSON.stringify(nativeSchema)};
      export const apply = (ctx, config) => ctx.mount(ctx, config, Config);`,
    '@deepseek-ai/schemastery': 'export default class Schema { constructor(value) { Object.assign(this, value); } }',
    '@deepseek-ai/dsh-llm': `export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED';
      export class LlmError extends Error { constructor(message, code) { super(message); this.code = code; } }`,
  };
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (modules[specifier]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]) };
    return next(specifier, context);
  } });
  let plugin: any;
  try { plugin = await import(`../src/plugins/weftmate-model-budget.mjs?modern=${modern}`); }
  finally { hooks.deregister(); }
  const schema = plugin.Config.dict.providers.inner;
  assert.equal((modern ? schema.inner : schema).dict.streamIdleTimeoutMs.meta.default, undefined);
  assert.equal(rowSchema.dict.streamIdleTimeoutMs.meta.default, 300000);
  const previousScheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL;
  process.env.WEFTMATE_MODEL_SCHEDULER_URL = 'http://scheduler.test';
  t.after(() => {
    if (previousScheduler === undefined) delete process.env.WEFTMATE_MODEL_SCHEDULER_URL;
    else process.env.WEFTMATE_MODEL_SCHEDULER_URL = previousScheduler;
  });
  let contextWindow = 16384, metadataReads = 0, releases = 0, credential = 'initial';
  const requests: any[] = [], wires: any[] = [], preparations: string[] = [], effects: Promise<any>[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/props') {
      metadataReads++;
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${credential}`);
      return Response.json({ n_ctx: contextWindow });
    }
    requests.push({ path: parsed.pathname, query: parsed.searchParams, body: init.body ? JSON.parse(init.body) : undefined });
    if (parsed.pathname === '/route') return Response.json({ provider: 'alternate', model: 'qwen' });
    if (parsed.pathname === '/lease') return new Response(new ReadableStream({ cancel() { releases++; } }));
    if (parsed.pathname === '/usage/start') return Response.json({ requestId: 'usage-ticket' });
    if (parsed.pathname === '/usage/finish' || parsed.pathname === '/progress') return Response.json({});
    assert.fail(`unexpected fetch ${url}`);
  });
  const row = { baseURL: 'http://model.test/v1', apiKeyEnv: 'KEY', models: [{ id: 'qwen', contextWindow: 262144, maxTokens: 8192 }] };
  let providers: any = { local: row, alternate: { ...row, baseURL: 'http://alternate.test/v1' }, native: { api: 'anthropic-messages' } };
  const config = { providers: modern ? { get: () => providers } : providers };
  const handlers: Record<string, any> = {};
  let adapter: any, readProjected: any, watch: any;
  const session: any = { header: {}, requestHeader: () => ({ system: 'different' }),
    [Symbol.for('weftmate.memoryRecall')]: { memories: ['optional'] } };
  const native: any = {
    async resolveModel(provider: string) {
      assert.equal(this, native);
      return { id: 'qwen', defaultMaxTokens: 8192, inputModalities: ['text'], contextWindow: readProjected()[provider]?.models?.[0]?.contextWindow };
    },
    async *stream(options: any) { assert.equal(this, native); wires.push(options); yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 10 } }; },
  };
  if (modern) native.prepareCall = async function(provider: string, model: string, signal: AbortSignal) {
    assert.equal(this, native); assert.equal(model, 'qwen'); assert.ok(signal);
    if (provider !== 'native') assert.equal(readProjected()[provider].models[0].contextWindow, contextWindow, 'capacity is warmed before native preparation');
    preparations.push(provider);
    const prepared = { model: await native.resolveModel(provider), async *stream(options: any) {
      assert.equal(this, prepared); assert.equal(options.provider, provider);
      wires.push(options); yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 10 } };
    } };
    return prepared;
  };
  const ctx: any = {
    on: (event: string, listener: any) => { handlers[event] = listener; },
    get: (name: string) => name === 'credentials' ? { resolve: async () => ({ value: credential }) }
      : name === 'sessions' ? { get: () => session } : undefined,
    tokenMeter: { estimateMessage: (message: any) => message.id === 'large' || message.id === 'memory' ? 15000 : 1000 },
    llm: { registerAdapter: (_providers: any, value: any) => { adapter = value; } },
    inject: (_names: any, callback: any) => callback(ctx),
    settings: { register: (_name: string, schema: any) => {
      assert.equal(schema, plugin.Config); return { get: () => config, watch: (callback: any) => { watch = callback; } };
    } },
    effect: (callback: any) => { effects.push(callback()); },
    mount(nativeCtx: any, projectedConfig: any, nativeConfig: any) {
      if (modern) {
        readProjected = () => projectedConfig.providers.get();
        assert.equal(projectedConfig.providers.local, readProjected().local);
      }
      else nativeCtx.inject(['settings'], (child: any) => {
        const scope = child.settings.register('llm-pi-ai', nativeConfig);
        readProjected = () => scope.get().providers;
      });
      nativeCtx.llm.registerAdapter(Object.keys(providers), native);
    },
  };
  plugin.apply(ctx, config); await Promise.all(effects);
  assert.equal(readProjected().local.streamIdleTimeoutMs, 90000);
  assert.equal(readProjected(), readProjected(), 'unchanged projection has stable identity');
  const signal = new AbortController().signal;
  const prepared = modern ? await adapter.prepareCall('local', 'qwen', signal) : undefined;
  const info = prepared?.model ?? await adapter.resolveModel('local', 'qwen', signal);
  assert.equal(info.defaultMaxTokens, undefined); assert.equal(info.contextWindow, 16384);
  const memory = { id: 'memory', role: 'user', source: { [modern ? 'kind' : 'plugin']: 'weftmate-personal-memory' }, content: [{ type: 'text', text: 'optional' }] };
  const user = { id: 'user', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', data: 'PRIVATE_IMAGE_BYTES', mediaType: 'image/png' }] };
  const options = { provider: 'local', model: 'qwen', sessionId: 'session', signal, messages: [user, memory] };
  const collect = async (stream: AsyncIterable<any>) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
  const chunks = await collect(modern ? prepared.stream(options) : adapter.stream(options));
  assert.equal(chunks[0].type, 'usage'); assert.equal(wires.length, 1);
  assert.deepEqual(wires[0].messages.map((message: any) => message.id), ['user']);
  assert.equal(JSON.stringify(wires[0]).includes('PRIVATE_IMAGE_BYTES'), false);
  assert.equal(options.messages.length, 2); assert.deepEqual(session[Symbol.for('weftmate.memoryRecall')].memories, []);
  assert.equal(wires[0].maxTokens, outputBudget({ contextWindow: 16384, maxTokens: 8192, inputTokens: 1000 }));
  assert.equal(requests.find(request => request.path === '/lease').query.get('priority'), 'foreground');
  assert.equal(requests.find(request => request.path === '/usage/finish').body.usage.outputTokens, 10);
  assert.equal(releases, 1);
  const beforeCredential = metadataReads;
  credential = 'updated'; contextWindow = 12288;
  await handlers[modern ? 'credentials/reference-updated' : 'credentials/updated']('KEY');
  assert.ok(metadataReads > beforeCredential); assert.equal(readProjected().local.models[0].contextWindow, 12288);
  const beforeVolatile = metadataReads;
  providers = { ...providers, local: { ...row, streamIdleTimeoutMs: 1234 } };
  if (!modern) config.providers = providers;
  contextWindow = 14000;
  await (modern ? handlers['loader/volatile-update']() : watch());
  assert.ok(metadataReads > beforeVolatile); assert.equal(readProjected().local.models[0].contextWindow, 14000);
  assert.equal(readProjected().local.streamIdleTimeoutMs, 1234);
  const background = { ...options, purpose: 'session-title', messages: [user] };
  const next = modern ? await adapter.prepareCall('local', 'qwen', signal) : undefined;
  await collect(modern ? next.stream(background) : adapter.stream(background));
  assert.equal(wires.at(-1).provider, 'alternate');
  assert.equal(wires.at(-1).maxTokens, outputBudget({ contextWindow: 14000, maxTokens: 8192, inputTokens: 1000 }));
  assert.equal(requests.filter(request => request.path === '/lease').at(-1).query.get('priority'), 'background');
  assert.equal(requests.filter(request => request.path === '/usage/start').at(-1).body.profileId, 'alternate');
  if (modern) assert.equal(preparations.at(-1), 'alternate');
  const nativeCall = modern ? await adapter.prepareCall('native', 'qwen', signal) : undefined;
  assert.equal((nativeCall?.model ?? await adapter.resolveModel('native', 'qwen', signal)).defaultMaxTokens, 8192);
  const nativeOptions = { ...options, provider: 'native', messages: [user], maxTokens: 123 };
  await collect(modern ? nativeCall.stream(nativeOptions) : adapter.stream(nativeOptions));
  assert.equal(wires.at(-1).maxTokens, 123);
  const beforeFailure = wires.length, beforeRelease = releases;
  const overflow = { ...options, messages: [{ ...user, id: 'large' }] };
  await assert.rejects(collect(modern ? next.stream(overflow) : adapter.stream(overflow)), { code: 'CONTEXT_WINDOW_EXCEEDED' });
  assert.equal(wires.length, beforeFailure); assert.equal(releases, beforeRelease + 1);
  if (!modern) assert.equal(adapter.prepareCall, undefined);
});
