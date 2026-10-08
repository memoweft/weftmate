/** Seed an isolated legacy host session for UI regressions unrelated to cloud login.
 * LG-1a exercises the actual visible account journey against the real cloud. */
import assert from 'node:assert/strict';
export async function localUiSession(page, credentials, deviceName = 'Synthetic UI regression') {
  const result = await page.evaluate(async input => {
    const response = await fetch('/personal/v1/auth/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return response.status;
  }, { ...credentials, deviceName });
  assert.equal(result, 200); await page.reload();
}
