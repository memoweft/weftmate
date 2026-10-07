import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { loadPersonalDevelopmentTools } from '../src/personal-development-tools.mjs';

test('ordinary startup does not resolve any synthetic fixture or observation module', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (/synthetic-.*-fixture-policy|personal-model-observation/.test(specifier)) {
        throw new Error('development module entered ordinary startup');
      }
      return nextResolve(specifier, context);
    } });
    const { loadPersonalDevelopmentTools } = await import('./src/personal-development-tools.mjs');
    const tools = await loadPersonalDevelopmentTools({});
    if (tools.syntheticStopFixtureRoute({}) !== null ||
        Object.keys(tools.syntheticBrowserFixtureSettings()).length ||
        tools.createObservationRecorder !== undefined) throw new Error('unexpected development tools');
    console.log('ordinary-startup');
  `], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.trim(), 'ordinary-startup');
});

test('existing explicit switches load the real fixture and observation functions', async () => {
  const tools = await loadPersonalDevelopmentTools({
    WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', WEFTMATE_SYNTHETIC_BROWSER_PORT: '43129',
    WEFTMATE_STAGE14_R2_OBSERVE: '1',
  });
  assert.equal(typeof tools.syntheticStopFixtureRoute, 'function');
  assert.equal(tools.syntheticStopFixtureRoute({}, { enabled: false }), null);
  assert.throws(() => tools.syntheticBrowserFixtureSettings({
    WEFTMATE_SYNTHETIC_BROWSER_PORT: '43129',
  }, ''), /synthetic browser fixture.*refused/);
  assert.equal(typeof tools.createObservationRecorder, 'function');
  assert.equal(typeof tools.createPersonalModelObservationProxy, 'function');
  assert.equal(typeof tools.stage14R2ObservationProfile, 'function');
});
