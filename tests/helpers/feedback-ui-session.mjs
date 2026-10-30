import assert from 'node:assert/strict';
import { nativeFixtureFetchOptions } from './local-ui-session.mjs';

// Login preparation for feedback regressions, using actual AUTH-1 authority.
// Native windows bootstrap themselves; remote pages accept only a server-verified cloud session.
export async function feedbackUiSession(page, fixture, { native = false } = {}) {
  if (native) await page.waitForURL(fixture.origin + '/personal/v1/ui');
  await page.addInitScript(() => {
    let value;
    Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => value, set(next) {
      value = next; const create = next.create;
      next.create = function (...args) {
        const core = create.apply(this, args), enter=core.enterAssistant;
        core.enterAssistant=function(...args){const pending=enter.apply(this,args);globalThis.__feedbackSessionLoaded=Promise.resolve(pending);return pending;};
        globalThis.__feedbackSessionCore = core; return core;
      };
    } });
  });
  await page.route('**/personal/v1/status', async route => {
    const response = await route.fetch(native ? nativeFixtureFetchOptions(route, fixture) : undefined);
    await route.fulfill({ response, json: { ...await response.json(), personalCapabilities: {} } });
  });
  if (!native) {
    assert.equal(fixture.mobileAuth.device.authKind, 'cloud');
    const [name, ...value] = fixture.mobileCookie.split('=');
    await page.context().addCookies([{ name, value: value.join('='), url: fixture.origin, httpOnly: true, sameSite: 'Strict' }]);
  }
  await page.reload();
  await page.waitForFunction(() => !!globalThis.__feedbackSessionCore);
  if (!native) {
    await page.waitForFunction(() => typeof state === 'undefined' || state.booted && !!globalThis.WeftMobileCloud?.core);
    const kind = await page.evaluate(async () => {
      const core = globalThis.WeftMobileCloud?.core || globalThis.__feedbackSessionCore;
      const session = await core.api('/me');
      if (session.device.authKind !== 'cloud') throw Error('Remote feedback requires verified cloud login');
      core.state.cloudAuth.mode = 'authenticated'; await core.acceptSession(session); await core.enterAssistant();
      return session.device.authKind;
    });
    assert.equal(kind, 'cloud');
  } else {
    await page.waitForFunction(() => globalThis.__feedbackSessionCore?.state.device?.authKind === 'desktop');
    // Authentication precedes the initial conversation load. Await its actual
    // completion so a late startup show('assistant') cannot close test settings.
    await page.waitForFunction(()=>!!globalThis.__feedbackSessionLoaded);
    await page.evaluate(()=>globalThis.__feedbackSessionLoaded);
  }
}
