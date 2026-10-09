/** Seed an isolated legacy host session for UI regressions unrelated to cloud login.
 * LG-1a exercises the actual visible account journey against the real cloud. */
import assert from 'node:assert/strict';
export async function localUiSession(page, credentials, deviceName = 'Synthetic UI regression', { mainChat = false } = {}) {
  if (!mainChat) await page.route('**/personal/v1/status', async route => {
    const response = await route.fetch(), body = await response.json();
    // Existing feature regressions also cover hosts before IA-2 capabilities.
    await route.fulfill({ response, json: { ...body, personalCapabilities: {} } });
  });
  const result = await page.evaluate(async input => {
    const response = await fetch('/personal/v1/auth/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return response.status;
  }, { ...credentials, deviceName });
  assert.equal(result, 200); await page.reload();
  // Legacy feature scenarios still exercise their seeded native side conversation.
  // IA-3 explicitly requests the product's new main-chat landing surface.
  if (!mainChat) {
    const sessions = await page.evaluate(async () => (await (await fetch('/personal/v1/sessions')).json()).sessions || []);
    if (sessions.length) {
      const title = sessions.find(row => !row.archived)?.title;
      if (title) await page.getByRole('button', { name: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
    }
  }
}
