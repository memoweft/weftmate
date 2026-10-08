/** Model capability metadata, separate from each request's output budget. */
export const DEFAULT_MODEL_CAPACITY = Object.freeze({ contextWindow: 32768, maxTokens: 32768 });

export function knownModelCapacity({ baseUrl, modelId }) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'https:' && url.hostname === 'api.xiaomimimo.com' && !url.port &&
        modelId === 'mimo-v2.6-flash') return { contextWindow: 1_000_000, maxTokens: 128_000 };
  } catch { /* No known metadata for an invalid destination. */ }
  return undefined;
}

export function modelCapacityFor(input) {
  const defaults = knownModelCapacity(input) ?? DEFAULT_MODEL_CAPACITY;
  const result = { contextWindow: input.contextWindow ?? defaults.contextWindow,
    maxTokens: input.maxTokens ?? defaults.maxTokens };
  for (const value of Object.values(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('model capacity must contain positive safe integers');
  }
  return result;
}

const positive = value => Number.isSafeInteger(value) && value > 0 ? value : undefined;
const contextOf = row => positive(row?.max_model_len) ?? positive(row?.context_length) ??
  positive(row?.context_window) ?? positive(row?.n_ctx);

/** GET metadata only; a failed probe must not prevent offline configuration. */
export async function readModelCapacity(input, { fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  if (knownModelCapacity(input)) return { ...modelCapacityFor(input), source: 'metadata' };
  const fallback = modelCapacityFor(input);
  const get = async url => {
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json',
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs) });
      return response.ok ? await response.json() : undefined;
    } catch { return undefined; }
  };
  let base;
  try { base = new URL(input.baseUrl.replace(/\/+$/, '') + '/'); }
  catch { return { ...fallback, source: input.contextWindow ? 'config' : 'default' }; }
  // Preserve reverse-proxy prefixes: /llama/v1 -> /llama/props.
  const propsUrl = new URL(base);
  propsUrl.pathname = propsUrl.pathname.replace(/(?:v1\/)?$/, 'props');
  const props = await get(propsUrl);
  const propsContext = positive(props?.default_generation_settings?.n_ctx) ?? positive(props?.n_ctx);
  if (propsContext) return { ...fallback, contextWindow: propsContext, source: 'props' };
  const listing = await get(new URL('models', base));
  const row = Array.isArray(listing?.data) ? listing.data.find(entry => entry?.id === input.modelId) : undefined;
  const contextWindow = contextOf(row);
  if (contextWindow) return { contextWindow,
    maxTokens: positive(row.max_output_tokens) ?? positive(row.max_tokens) ?? fallback.maxTokens, source: 'models' };
  return { ...fallback, source: input.contextWindow ? 'config' : 'default' };
}

/** Leave room for framing/token-estimator error; the cap is capability, not a fixed request size. */
export function outputBudget({ contextWindow, inputTokens, maxTokens = 32768, safetyTokens }) {
  // pi-ai reserves 4096 itself; use at least that much before its final clamp.
  const safety = safetyTokens ?? Math.max(4096, Math.ceil(contextWindow * 0.02));
  return Math.max(1, Math.floor(Math.min(maxTokens, contextWindow - Math.ceil(inputTokens) - safety)));
}

/** Keep existing tool text and durable image metadata for text-only routes. */
export function messagesForModelInput(messages, inputModalities) {
  if (inputModalities?.includes('image')) return messages;
  const parts = content => Array.isArray(content) ? content.map(part => {
    if (part?.type === 'image') {
      const image = part.attachment ?? part;
      const description = [image.name, image.mediaType, image.width && image.height
        ? `${image.width}×${image.height}` : null].filter(Boolean).join(' · ');
      return { type: 'text', text: `图片${description ? `（${description}）` : ''}：当前模型仅接收文字，请依据工具返回的文字描述处理。` };
    }
    return Array.isArray(part?.content) ? { ...part, content: parts(part.content) } : part;
  }) : content;
  return messages.map(message => ({ ...message, content: parts(message.content) }));
}
