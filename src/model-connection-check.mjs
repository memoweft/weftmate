import { openAICompatibleEndpoint } from './openai-compatible-client.ts';

// MiMo's official IDs are lowercase; other providers retain their exact IDs.
export function canonicalProviderModelId(baseUrl, modelId) {
  const host = new URL(baseUrl).hostname;
  return ['api.xiaomimimo.com', 'token-plan-cn.xiaomimimo.com'].includes(host)
    ? modelId.toLowerCase() : modelId;
}

export async function checkModelConnection({ baseUrl, modelId, apiKey, sendTestMessage = false, fetchImpl = fetch }) {
  const result = { configured: !!apiKey, reachable: false, modelListed: false, inferenceVerified: false,
    address: 'unreachable', authentication: apiKey ? 'unchecked' : 'missing', catalog: 'unchecked', model: 'unchecked' };
  if (!apiKey) return result;
  const canonical = canonicalProviderModelId(baseUrl, modelId);
  if (canonical !== modelId) result.suggestedModelId = canonical;
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  let response;
  try { response = await fetchImpl(openAICompatibleEndpoint(baseUrl, 'models'), {
    headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { return result; }
  result.reachable = true; result.address = 'reachable'; result.httpStatus = response.status;
  if ([401, 403].includes(response.status)) { result.authentication = 'rejected'; return result; }
  if ([404, 405, 501].includes(response.status)) {
    result.catalog = 'unsupported'; result.requiresTestMessage = true;
  } else if (!response.ok) { result.catalog = 'failed'; return result; }
  else {
    result.authentication = 'accepted';
    try {
      const value = await response.json();
      if (!Array.isArray(value?.data)) { result.catalog = 'invalid'; return result; }
      result.catalog = 'available';
      result.modelListed = value.data.some(row => row?.id === canonical);
      result.model = result.modelListed ? 'listed' : 'missing';
    } catch { result.catalog = 'invalid'; return result; }
  }
  // A directory probe never implicitly becomes paid inference.
  if (!sendTestMessage || result.catalog !== 'unsupported') return result;
  try {
    const tested = await fetchImpl(openAICompatibleEndpoint(baseUrl, 'chat/completions'), {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: canonical, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, stream: false }) });
    result.httpStatus = tested.status;
    if ([401, 403].includes(tested.status)) { result.authentication = 'rejected'; return result; }
    if (!tested.ok) { result.model = 'test_failed'; return result; }
    result.authentication = 'accepted';
    const value = await tested.json();
    result.inferenceVerified = Array.isArray(value?.choices) && value.choices.length > 0;
    result.model = result.inferenceVerified ? 'tested' : 'test_failed';
  } catch { result.model = 'test_failed'; }
  return result;
}
