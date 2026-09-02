import { normalizeApiBaseUrl, type PublicModelProfile } from './stage2-config.ts';

export interface ModelDiscoveryRequest {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
}

/**
 * Resolve the secret used by a real model-discovery request without widening
 * the renderer boundary. A stored credential is read only after the supplied
 * profile id, provider, and canonical endpoint all match public saved state.
 */
export function resolveModelDiscoveryRequest(
  input: { id?: unknown; provider?: unknown; baseUrl?: unknown; apiKey?: unknown },
  profiles: readonly PublicModelProfile[],
  readStoredCredential: (profileId: string) => string | null,
): ModelDiscoveryRequest {
  if (input.provider !== 'openai-compatible') throw new TypeError('unsupported provider');

  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  if (!baseUrl) throw new TypeError('invalid API base URL');

  const providedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (providedKey) {
    if (providedKey.length > 4_096) throw new TypeError('credential input is invalid');
    return { provider: input.provider, baseUrl, apiKey: providedKey };
  }

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const prior = id ? profiles.find((profile) => profile.id === id) : undefined;
  if (!prior || prior.provider !== input.provider || prior.baseUrl !== baseUrl) {
    throw new Error('a credential is required for a new or changed endpoint');
  }

  // Deliberately defer the safeStorage read until after the public scope
  // matches. This prevents a blank edit form from replaying a saved key to a
  // newly typed endpoint, even transiently.
  const storedKey = readStoredCredential(prior.id);
  if (!storedKey || storedKey.length > 4_096) throw new Error('stored credential is unavailable');
  return { provider: input.provider, baseUrl, apiKey: storedKey };
}
