/** Decorate the native pi-ai adapter; its protocols, settings and credentials remain native. */
import { Config as NativeConfig, apply as applyPiAi } from '@deepseek-ai/dsh-llm-pi-ai';
import Schema from '@deepseek-ai/schemastery';
import { LlmError, CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';
import { readModelCapacity, modelCapacityFor, outputBudget, messagesForModelInput } from '../model-budget.mjs';
import { acquireModelSlot, isBackgroundPurpose } from '../model-scheduler-client.mjs';
import { meteredNativeStream, usageSessionId } from '../personal-access/usage-native.mjs';

// Keep every native field/validation. Leave this one default to the host's
// projection, otherwise native schema resolution inserts 300000 before get().
export const Config = new Schema(JSON.parse(JSON.stringify(NativeConfig)));
delete Config.dict.providers.inner.dict.streamIdleTimeoutMs.meta.default;
export const name = 'llm-pi-ai';
export const inject = ['llm', 'tokenMeter'];

// Native DSH cancels and retries a stalled stream. Ninety seconds accommodates
// model startup while avoiding QA3-07's five-minute wait without any increments.
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000;

export function apply(ctx, config) {
  const probes = new Map();
  const capacities = new Map();
  const slowRetries = new Set();
  let rawSource = () => config;
  let lastRaw, lastVersion, projected;
  let version = 0;
  const identity = (provider, row, model) => JSON.stringify([provider, row.baseURL, row.apiKeyEnv, model]);
  const compatible = row => row?.baseURL && (!row.api || row.api === 'openai-completions');

  async function capacity(provider, row, model) {
    const key = identity(provider, row, model);
    if (!probes.has(key)) probes.set(key, (async () => {
      let apiKey;
      try { apiKey = row.apiKeyEnv ? (await ctx.get('credentials')?.resolve(row.apiKeyEnv))?.value : undefined; }
      catch { /* Metadata reads fall back even while the credential service is unavailable. */ }
      const value = await readModelCapacity({ baseUrl: row.baseURL, modelId: model.id,
        contextWindow: model.contextWindow, maxTokens: model.maxTokens, apiKey });
      capacities.set(key, value);
      version++;
      return value;
    })());
    return probes.get(key);
  }
  async function refresh() {
    await Promise.all(Object.entries(rawSource().providers ?? {}).flatMap(([provider, row]) =>
      compatible(row) ? (row.models ?? []).map(model => capacity(provider, row, model)) : []));
  }
  ctx.on('credentials/updated', async ref => {
    const pending = [];
    for (const [provider, row] of Object.entries(rawSource().providers ?? {})) {
      if (!compatible(row) || row.apiKeyEnv !== ref) continue;
      for (const model of row.models ?? []) {
        const key = identity(provider, row, model);
        probes.delete(key); capacities.delete(key); version++;
        pending.push(capacity(provider, row, model));
      }
    }
    await Promise.all(pending);
  });
  function source() {
    const raw = rawSource();
    if (raw === lastRaw && lastVersion === version) return projected;
    lastRaw = raw; lastVersion = version;
    projected = { ...raw, providers: Object.fromEntries(Object.entries(raw.providers ?? {}).map(([provider, row]) => {
      const streamIdleTimeoutMs = row.streamIdleTimeoutMs ?? Number(process.env.WEFTMATE_STREAM_IDLE_TIMEOUT_MS || DEFAULT_STREAM_IDLE_TIMEOUT_MS);
      if (!compatible(row) || !row.models) return [provider, { ...row, streamIdleTimeoutMs }];
      return [provider, { ...row, streamIdleTimeoutMs, models: row.models.map(model => {
        const value = capacities.get(identity(provider, row, model)) ?? modelCapacityFor({
          baseUrl: row.baseURL, modelId: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens });
        return { ...model, contextWindow: value.contextWindow, maxTokens: value.maxTokens };
      }) }];
    })) };
    return projected;
  }
  // The native settings consumer reads a projected scope. Stored configuration
  // remains the fallback, so a later restart probes the service again.
  const settingsContext = sctx => new Proxy(sctx, { get(target, prop) {
    if (prop !== 'settings') return Reflect.get(target, prop);
    return new Proxy(target.settings, { get(settings, method) {
      if (method !== 'register') return Reflect.get(settings, method);
      return (...args) => {
        if (args[1] === NativeConfig) args[1] = Config;
        const scope = settings.register(...args);
        rawSource = () => scope.get();
        scope.watch(() => { probes.clear(); capacities.clear(); version++; return refresh(); });
        sctx.effect(async () => { await refresh(); });
        return { ...scope, get: source };
      };
    } });
  } });
  const llm = new Proxy(ctx.llm, { get(service, method) {
    if (method === 'registerAdapter') return (providers, adapter) => {
      const wrapped = new Proxy(adapter, { get(target, operation) {
        if (operation === 'resolveModel') return async (provider, model, signal) => {
          const row = rawSource().providers?.[provider];
          const entry = row?.models?.find(item => item.id === model);
          if (compatible(row) && entry) await capacity(provider, row, entry);
          const info = await target.resolveModel(provider, model, signal);
          // Output capability must not become a fixed request default.
          if (compatible(row)) { const { defaultMaxTokens, ...rest } = info; return rest; }
          return info;
        };
        if (operation === 'stream') return async function* (options) {
          const background = isBackgroundPurpose(options.purpose);
          const scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL;
          const billingSessionId = usageSessionId(options.sessionId, ctx.get('sessions'));
          if (background && scheduler) {
            const query = new URLSearchParams({ sessionId: billingSessionId ?? '',
              profileId: options.provider, model: options.model });
            const response = await fetch(`${scheduler}/route?${query}`, { signal: options.signal });
            if (!response.ok) throw new Error('BACKGROUND_MODEL_UNAVAILABLE');
            options = { ...options, ...await response.json() };
          }
          const release = await acquireModelSlot(background ? 'background' : 'foreground', options.signal,
            scheduler, { profileId: options.provider, ...(background ? {} : { sessionId: options.sessionId ?? '' }) });
          try {
          if (slowRetries.delete(options.sessionId) && scheduler && !background) {
            await fetch(`${scheduler}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId: options.sessionId, phase: 'retrying' }), signal: AbortSignal.timeout(1000) }).catch(() => {});
          }
          const modelInfo = await target.resolveModel(options.provider, options.model, options.signal);
          options = { ...options, messages: messagesForModelInput(options.messages, modelInfo.inputModalities) };
          const row = rawSource().providers?.[options.provider];
          const entry = row?.models?.find(item => item.id === options.model);
          if (!compatible(row) || !entry) { yield* meteredNativeStream(options, value => target.stream(value), scheduler, billingSessionId); return; }
          const limits = await capacity(options.provider, row, entry);
          let inputTokens = options.messages.reduce((sum, message) => sum + ctx.tokenMeter.estimateMessage(message), 0) +
            (options.system ? Math.ceil(options.system.length / 4) + 4 : 0) +
            (options.tools?.length ? Math.ceil(JSON.stringify(options.tools).length / 4) + 4 : 0);
          const session = options.sessionId ? ctx.get('sessions')?.get(options.sessionId) : undefined;
          const header = session?.requestHeader();
          const visible = messages => JSON.stringify(messages.map(message => [message.role, message.content]));
          // Reuse DSH's provider-usage anchor for the conversation envelope;
          // auxiliary summaries carry different messages and use the native estimate.
          if (session && options.system === header?.system &&
              JSON.stringify(options.tools) === JSON.stringify(header?.tools) &&
              visible(options.messages) === visible(session.deriveMessages())) {
            inputTokens = ctx.tokenMeter.measure(session).totalTokens;
          }
          // Memory is optional context. Keep the native conversation/compaction
          // budget authoritative and leave framing + a useful output reserve.
          if (inputTokens + Math.max(4096, Math.ceil(limits.contextWindow * 0.02)) +
              Math.min(4096, limits.maxTokens) > limits.contextWindow) {
            const memoryMessages = options.messages.filter(message => message.source?.plugin === 'weftmate-personal-memory');
            if (memoryMessages.length) {
              options = { ...options, messages: options.messages.filter(message => !memoryMessages.includes(message)) };
              inputTokens -= memoryMessages.reduce((sum, message) => sum + ctx.tokenMeter.estimateMessage(message), 0);
              if (session?.[Symbol.for('weftmate.memoryRecall')]) session[Symbol.for('weftmate.memoryRecall')].memories = [];
            }
          }
          const maxTokens = outputBudget({ ...limits, inputTokens,
            maxTokens: Math.min(limits.maxTokens, options.maxTokens ?? limits.maxTokens) });
          if (maxTokens === null) {
            // The agent's native request-error handler compacts and rebuilds the
            // envelope before retrying. Do not recurse while holding a model slot.
            throw new LlmError('Context has no useful output reserve; compact before continuing',
              CONTEXT_WINDOW_EXCEEDED_CODE);
          }
          yield* meteredNativeStream({ ...options, maxTokens }, value => target.stream(value), scheduler, billingSessionId);
          } finally { await release(); }
        };
        const value = Reflect.get(target, operation);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      return service.registerAdapter(providers, wrapped);
    };
    const value = Reflect.get(service, method);
    return typeof value === 'function' ? value.bind(service) : value;
  } });
  const nativeContext = new Proxy(ctx, { get(target, prop) {
    if (prop === 'llm') return llm;
    if (prop === 'inject') return (names, callback) => target.inject(names,
      sctx => callback(names.includes('settings') ? settingsContext(sctx) : sctx));
    return Reflect.get(target, prop);
  } });
  applyPiAi(nativeContext, config);
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') { slowRetries.delete(session.id); return; }
    if (event.type !== 'llm/retry' || event.data?.failure?.code !== 'TIMEOUT') return;
    slowRetries.add(session.id);
    const scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL;
    if (scheduler) void fetch(`${scheduler}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, phase: 'retrying' }), signal: AbortSignal.timeout(1000) }).catch(() => {});
  });
}

export default { name, inject, Config, apply };
