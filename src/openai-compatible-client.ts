import { normalizeApiBaseUrl } from './stage2-config.ts';
import { parseOpenAICompatibleModels, parseVerifiedOpenAICompletion } from './openai-compatible.ts';

type FetchLike = (url: URL, init: Record<string, unknown>) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export function openAICompatibleEndpoint(baseUrl: unknown, suffix: string): URL {
  const normalized = normalizeApiBaseUrl(baseUrl);
  if (!normalized) throw new TypeError('API 地址必须是 HTTPS，或不含凭据/查询参数/片段的本机 HTTP 地址');
  return new URL(`${normalized}/${suffix}`);
}

function requestFetch(fetchImpl: FetchLike, url: URL, init: Record<string, unknown>) {
  return fetchImpl(url, { ...init, redirect: 'error' });
}

export async function discoverOpenAICompatibleModels(input: { baseUrl: string; apiKey: string; fetchImpl?: FetchLike }): Promise<string[]> {
  if (!input.baseUrl?.trim() || !input.apiKey?.trim()) throw new TypeError('配置项不能为空');
  const fetchImpl = input.fetchImpl ?? fetch as unknown as FetchLike;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await requestFetch(fetchImpl, openAICompatibleEndpoint(input.baseUrl, 'models'), { signal: controller.signal, headers: { authorization: `Bearer ${input.apiKey}` } });
    if (!response.ok) throw new Error('model discovery rejected');
    return parseOpenAICompatibleModels(await response.json());
  } finally { clearTimeout(timer); }
}

export async function verifyOpenAICompatibleModel(input: { baseUrl: string; apiKey: string; model: string; fetchImpl?: FetchLike }): Promise<void> {
  if (!input.baseUrl?.trim() || !input.apiKey?.trim() || !input.model?.trim()) throw new TypeError('配置项不能为空');
  const models = await discoverOpenAICompatibleModels(input);
  if (!models.includes(input.model.trim())) throw new Error('selected model was not returned by service');
  const fetchImpl = input.fetchImpl ?? fetch as unknown as FetchLike;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await requestFetch(fetchImpl, openAICompatibleEndpoint(input.baseUrl, 'chat/completions'), {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ model: input.model.trim(), messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 256, stream: false }),
    });
    if (!response.ok) throw new Error('model rejected configuration');
    parseVerifiedOpenAICompletion(await response.json());
  } finally { clearTimeout(timer); }
}
