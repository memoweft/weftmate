import assert from 'node:assert/strict';
import { localUiSession } from '../../helpers/local-ui-session.mjs';

/** Prepare real synthetic cloud authority before any latency/budget measurement. */
export async function createMobileCloud() {
  const { fixture: cloudFixture } = await import('../../../services/cloud/test/identity-helpers.mjs');
  const cleanups = [];
  const close = async () => { for (const cleanup of cleanups.reverse()) await cleanup(); };
  try {
    const cloud = await cloudFixture({ after: cleanup => cleanups.push(cleanup) }, { realProcess: true });
    return { cloud, configuration: { issuer: cloud.config.issuer, allowInsecureLoopback: true }, close };
  } catch (error) { await close(); throw error; }
}

export async function authorizeMobile(fixture, cloud) {
  const { registration, appDevice, control, refresh, proof } = await import('../../../services/cloud/test/app-helpers.mjs');
  await registration(cloud);
  const desktop = await appDevice(cloud, 'synthetic-bl29-binding');
  const claim = await fixture.request('/cloud/claims', {});
  await fixture.request('/cloud/binding', { claimId: claim.claimId, accessToken: desktop.tokens.access_token });
  const mobile = await appDevice(cloud, 'synthetic-bl29-mobile');
  const hostId = (await fixture.request('/status')).hostId;
  const connection = (await control(mobile, '/hosts/connect', { hostId })).data;
  await refresh(mobile, connection.resource);
  const nonce = await fixture.request('/auth/cloud-nonce', {});
  const url = fixture.origin + '/personal/v1/auth/cloud-session';
  const response = await fetch(url, { method: 'POST', headers: { origin: fixture.origin,
    'content-type': 'application/json', dpop: await proof(mobile, url, mobile.tokens.access_token, { nonce: nonce.nonce }) },
    body: JSON.stringify({ accessToken: mobile.tokens.access_token, deviceName: 'synthetic-bl29-mobile' }) });
  const session = await response.json();
  assert.equal(response.status, 200, JSON.stringify(session));
  assert.equal(session.device.authKind, 'cloud');
  assert.equal(session.account.ownerId, fixture.debug.auth.account.ownerId);
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const request = async (path, body, method = body ? 'POST' : 'GET') => {
    const result = await fetch(fixture.origin + '/personal/v1' + path, { method,
      headers: { origin: fixture.origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': session.csrfToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await result.json(); assert.ok(result.ok, JSON.stringify(value)); return value;
  };
  fixture.setMobileTransport(request, session);
}

/** Reload only to install the existing probe's source projection, then use native bootstrap. */
export async function initializeDesktopSession(page, fixture, { legacy = false, deviceName = 'synthetic-bl29' } = {}) {
  await page.waitForURL(fixture.origin + '/personal/v1/ui');
  if (legacy) {
    // Historical UI has no native /auth/desktop bootstrap. Keep its existing
    // direct-local password API; mobile still receives a verified cloud session.
    await localUiSession(page, fixture.credentials, deviceName, { interceptLegacyStatus: false });
    return;
  }
  await page.reload();
  await page.waitForFunction(() => {
    const core = globalThis.__revCore || globalThis.__streamCore;
    return core?.state.account && core.state.device?.authKind === 'desktop' && core.state.ownerId &&
      core.state.mainChat && core.state.modelsKnown && !core.state.refreshing && !core.state.sessionSelecting;
  });
}
