// Shared, dependency-free directory policy for host and browser model services.
export const SERVICE_CATALOG_TTL_MS = 60 * 60 * 1000;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,128}$/;
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '';

export function canonicalServiceBaseUrl(input) {
  try {
    const url = new URL(input.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === 'http:') {
      const host = url.hostname.toLowerCase().replace(/\.$/, ''), parts = host.split('.').map(Number);
      const privateIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && parts.every(value => Number.isInteger(value) && value >= 0 && value <= 255) &&
        (parts[0] === 127 || parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168);
      if (!(host === 'localhost' || host === '[::1]' || host.endsWith('.local') || privateIPv4)) return null;
    }
    url.pathname = url.pathname.replace(/\/(?:chat\/completions|models|messages)\/?$/, '').replace(/\/+$/, '');
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}

export function modelDisplayName(modelId, supplied) {
  if (text(supplied)) return text(supplied);
  const brands = { mimo: 'MiMo', gpt: 'GPT', claude: 'Claude', deepseek: 'DeepSeek', qwen: 'Qwen', gemini: 'Gemini', llama: 'Llama' };
  return modelId.split(/[-_]+/).map(part => brands[part.toLowerCase()] ?? (/^v?\d/i.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))).join(' ');
}

export function isChatModel(row) {
  const modelId = typeof row === 'string' ? row : row?.id ?? row?.modelId;
  if (!MODEL_ID.test(modelId ?? '')) return false;
  const type = typeof row === 'object' ? row.type ?? row.task ?? row.category : undefined;
  if (typeof type === 'string' && /embedding|speech|audio|image|moderation|rerank|transcription/i.test(type)) return false;
  return !/(?:^|[-_/.])(embedding|embeddings|embed|rerank|tts|stt|asr|audio|whisper|dall-e|moderation|image|imagegen|imagen|flux|stable-diffusion|video|veo|sora|speech|transcription)(?:$|[-_/.\d])/i.test(modelId)
    && !/^(?:text-embedding|omni-moderation|gpt-image)/i.test(modelId);
}

export function normalizeServiceModels(rows) {
  const models = new Map();
  for (const row of rows ?? []) {
    if (!isChatModel(row)) continue;
    const modelId = row.id ?? row.modelId;
    const capabilities = {};
    const declared = row.capabilities;
    if (typeof declared?.vision === 'boolean') capabilities.vision = declared.vision;
    else if (typeof declared?.image_input?.supported === 'boolean') capabilities.vision = declared.image_input.supported;
    else if (Array.isArray(row.input_modalities)) capabilities.vision = row.input_modalities.includes('image');
    const contextWindow = row.context_window ?? row.context_length ?? row.max_context_length ?? row.max_input_tokens ?? declared?.contextWindow;
    if (Number.isSafeInteger(contextWindow) && contextWindow > 0) capabilities.contextWindow = contextWindow;
    const reasoning = declared?.reasoning ?? declared?.thinking?.supported ?? row.supports_reasoning ?? row.deepThinking?.supported;
    const adaptiveOnly = declared?.thinking?.types?.adaptive?.supported === true && declared?.thinking?.types?.enabled?.supported !== true;
    const deepThinking = typeof reasoning === 'boolean' ? { supported: reasoning, ...(reasoning ? { effort: 'high', ...(adaptiveOnly ? { type: 'adaptive' } : {}) } : {}) } : null;
    models.set(modelId, { modelId, name: modelDisplayName(modelId, row.display_name ?? row.displayName ?? row.name), enabled: true,
      ...(Object.keys(capabilities).length ? { capabilities, capabilitySource: 'service-directory' } : {}),
      ...(deepThinking ? { deepThinking, capabilitySource: 'service-directory' } : {}) });
  }
  return [...models.values()];
}

export function mergeServiceModels(previous, discovered) {
  const old = new Map((previous ?? []).map(row => [row.modelId, row]));
  const result = discovered.map(row => ({ ...old.get(row.modelId), ...row, enabled: old.get(row.modelId)?.enabled !== false,
    ...(old.get(row.modelId)?.profileId ? { profileId: old.get(row.modelId).profileId } : {}) }));
  const ids = new Set(result.map(row => row.modelId));
  // Manually enabled/historical models survive directories that are partial or temporarily shorter.
  for (const row of previous ?? []) if (!ids.has(row.modelId)) result.push({ ...row });
  return result;
}

export function recommendServiceModel(models, preferred) {
  if (models.some(row => row.modelId === preferred && row.enabled !== false)) return preferred;
  return models.find(row => row.enabled !== false && /(?:flash|mini|haiku)(?:$|[-_.])/i.test(row.modelId))?.modelId
    ?? models.find(row => row.enabled !== false)?.modelId ?? null;
}

export async function queryServiceCatalog({ baseUrl, apiKey, interfaceType = 'openai-compatible', fetchImpl = fetch, signal }) {
  const checkedAt = new Date().toISOString();
  const answer = (status, message, extra = {}) => ({ status, message, checkedAt, models: [], ...extra });
  const canonical = canonicalServiceBaseUrl(baseUrl);
  if (!canonical || !['openai-compatible', 'anthropic'].includes(interfaceType)) return answer('invalid', '模型服务地址或接口类型不正确。');
  if (typeof apiKey !== 'string' || !apiKey) return answer('authentication_failed', '请填写这个模型服务的密钥。');
  let response;
  const headers = interfaceType === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${apiKey}` };
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  try {
    response = await fetchImpl(`${canonical}/models`, { redirect: 'error', signal: requestSignal, headers });
  } catch { return answer('offline', '暂时连不上这个模型服务，已保留原来的模型。也可以手填型号。'); }
  const httpStatus = response.status;
  if ([401, 403].includes(httpStatus)) return answer('authentication_failed', '这个模型服务的密钥不正确或没有访问权限，请检查密钥。', { httpStatus });
  if ([404, 405, 501].includes(httpStatus)) return answer('unsupported', '这个模型服务不提供模型清单，请手填一个型号。', { httpStatus });
  if (!response.ok) return answer('failed', '这个模型服务暂时无法返回模型清单，可以稍后重试或手填型号。', { httpStatus });
  try {
    let value = await response.json();
    if (!Array.isArray(value?.data)) return answer('invalid', '这个模型服务返回的清单无法读取，请手填一个型号。', { httpStatus });
    const entries = [...value.data], cursors = new Set();
    while (interfaceType === 'anthropic' && value.has_more === true) {
      const cursor = value.last_id ?? value.data.at(-1)?.id;
      if (!MODEL_ID.test(cursor ?? '') || cursors.has(cursor)) return answer('invalid', '这个模型服务的清单暂时无法读完整，已保留原来的模型。', { httpStatus });
      cursors.add(cursor);
      const next = await fetchImpl(`${canonical}/models?after_id=${encodeURIComponent(cursor)}`, { redirect: 'error', signal: requestSignal, headers });
      if (!next.ok) return answer([401, 403].includes(next.status) ? 'authentication_failed' : 'failed', [401, 403].includes(next.status)
        ? '这个模型服务的密钥不正确或没有访问权限，请检查密钥。' : '这个模型服务暂时无法返回完整清单，可以稍后重试。', { httpStatus: next.status });
      value = await next.json();
      if (!Array.isArray(value?.data)) return answer('invalid', '这个模型服务返回的清单无法读取，请手填一个型号。', { httpStatus });
      entries.push(...value.data);
    }
    const models = normalizeServiceModels(entries);
    return answer('available', models.length ? `已找到 ${models.length} 个聊天模型。` : '清单里没有聊天模型，请手填一个型号。', { models, httpStatus });
  } catch { return answer('invalid', '这个模型服务返回的清单无法读取，请手填一个型号。', { httpStatus }); }
}
