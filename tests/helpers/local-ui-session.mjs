/** Seed an isolated legacy host session for UI regressions unrelated to cloud login.
 * LG-1a exercises the actual visible account journey against the real cloud. */
import assert from 'node:assert/strict';
/** route.fetch uses an API client, so the native window header hook does not run.
 * Apply an explicitly supplied fixture identity only to that fixture's own origin. */
export function nativeFixtureFetchOptions(route, nativeIdentity) {
  if (!nativeIdentity?.libraryDesktopToken || new URL(route.request().url()).origin !== nativeIdentity.origin) return undefined;
  return { maxRedirects: 0, headers: { ...route.request().headers(), origin: nativeIdentity.origin,
    'x-weftmate-desktop': nativeIdentity.libraryDesktopToken } };
}
export async function localUiSession(page, credentials, deviceName = 'Synthetic UI regression', { mainChat = false, interceptLegacyStatus = !mainChat, nativeIdentity, preserveCapabilities = [] } = {}) {
  if (interceptLegacyStatus) await page.route('**/personal/v1/status', async route => {
    try {
      const response = await route.fetch(nativeFixtureFetchOptions(route, nativeIdentity)), body = await response.json();
      // Existing feature regressions also cover hosts before IA-2 capabilities.
      const capabilities=Object.fromEntries(preserveCapabilities.filter(name=>body.personalCapabilities?.[name]===1).map(name=>[name,1]));
      await route.fulfill({ response, json: { ...body, personalCapabilities: capabilities } });
    } catch { await route.abort().catch(() => {}); }
  });
  const result = await page.evaluate(async input => {
    const response = await fetch('/personal/v1/auth/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return response.status;
  }, { ...credentials, deviceName });
  assert.equal(result, 200); await page.reload();
  // Hosts without IA capabilities use their existing native-session landing flow.
}
