/** Classify the configured endpoint without DNS lookup; users can override proxies. */
export function isLocalModelUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== 'string') return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host === '[::1]' || host.endsWith('.local')) return true;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return octets[0] === 127 || octets[0] === 10 ||
      octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 ||
      octets[0] === 192 && octets[1] === 168;
  } catch { return false; }
}

export function modelTierFor(profile?: { baseUrl?: string; modelTier?: string } | null): 'local' | 'cloud' {
  if (profile?.modelTier === 'local' || profile?.modelTier === 'cloud') return profile.modelTier;
  return isLocalModelUrl(profile?.baseUrl) ? 'local' : 'cloud';
}
