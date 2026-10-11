import assert from 'node:assert/strict';

/** Use the production native bootstrap; the fixture's original seed owner stays intact. */
export async function loadNativeReviewSession(page, fixture) {
  // firstWindow can resolve before createPersonalDesktop's initial load does.
  // Finish that load before replacing the document to install capture routes.
  await page.waitForURL(fixture.origin + '/personal/v1/ui', { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 30000 });
  await page.goto(fixture.origin + '/personal/v1/ui', { timeout: 30000 });
  await page.waitForFunction(() => {
    const core = globalThis.__ux7core;
    return core?.state.account && core.state.device?.authKind === 'desktop' && core.state.ownerId &&
      core.state.modelsKnown && Array.isArray(core.state.sessions) && core.state.sessions.length &&
      !core.state.refreshing && !core.state.sessionSelecting;
  });
  const identity = await page.evaluate(async () => {
    const response = await fetch('/personal/v1/auth/me');
    if (!response.ok) throw Error('Isolated native desktop authentication failed');
    return response.json();
  });
  assert.equal(identity.device.authKind, 'desktop');
  assert.equal(identity.account.username, fixture.credentials.username);
  return identity.account.ownerId;
}
