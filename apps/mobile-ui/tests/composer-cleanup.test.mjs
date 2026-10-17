import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { observedRoutes } from './observed-routes.mjs';
import { withTestCleanup } from './test-cleanup.mjs';

const injectionKey = 'weftmate.composer.cleanup-test';
let nextRun = 0;
const moduleSource = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

async function injectedComposerFailure({ fixtureError } = {}) {
  const businessError = Error('synthetic business failure');
  const removeError = Error('synthetic route removal failure');
  const browserError = Error('synthetic browser close failure');
  const calls = [], tests = new Map();
  let release, handler;
  const stalled = new Promise(resolve => { release = resolve; });
  const page = {
    async route(pattern, callback) {
      if (pattern === '**/bridge.js') handler = callback({ fulfill: () => stalled });
    },
    async goto() { throw businessError; },
    async unrouteAll() { calls.push('routes'); throw removeError; },
  };
  const injection = {
    register: (name, run) => tests.set(name, run),
    fixture: { async close() { calls.push('fixture'); if (fixtureError) throw fixtureError; } },
    browser: { async newPage() { return page; }, async close() { calls.push('browser'); throw browserError; } },
    routes(page) {
      const routes = observedRoutes(page);
      return { ...routes, close: () => routes.close({ timeoutMs: 10 }) };
    },
  };
  globalThis[Symbol.for(injectionKey)] = injection;
  const readInjection = `globalThis[Symbol.for(${JSON.stringify(injectionKey)})]`;
  const replacements = new Map([
    ['node:test', moduleSource(`export default (name, run) => ${readInjection}.register(name, run);`)],
    ['playwright', moduleSource(`export const chromium = { launch: async () => ${readInjection}.browser };`)],
    ['../../../tests/integration/main-chat-candidate.mjs', moduleSource(`export const startMainChatCandidate = async () => ${readInjection}.fixture;`)],
    ['./observed-routes.mjs', moduleSource(`export const observedRoutes = page => ${readInjection}.routes(page);`)],
  ]);
  const composerUrl = new URL('./composer-viewport.test.mjs', import.meta.url);
  composerUrl.searchParams.set('cleanup-injection', String(++nextRun));
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === composerUrl.href && replacements.has(specifier))
      return { url: replacements.get(specifier), shortCircuit: true };
    return next(specifier, context);
  } });
  let error;
  try {
    // Execute the actual registered caller, with its actual observedRoutes().
    // Only UI/browser dependencies and the teardown deadline are injected.
    await import(composerUrl.href);
    const run = tests.get('the fifth mobile tab opens health, keeps other tabs reachable and quotes without sending');
    assert.equal(typeof run, 'function');
    try { await run({ diagnostic() {} }); }
    catch (caught) { error = caught; }
  } finally {
    release(); await handler;
    hooks.deregister(); delete globalThis[Symbol.for(injectionKey)];
  }
  return { error, businessError, removeError, browserError, calls };
}

function causes(error) {
  return error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
}

test('the composer preserves business failure before route timeout, removal failure and browser failure', async () => {
  const { error, businessError, removeError, browserError, calls } = await injectedComposerFailure();
  const failures = causes(error);
  assert.equal(failures.length, 4, 'all four original failure causes must survive cleanup');
  assert.equal(failures[0], businessError);
  assert.equal(failures[1].code, 'ROUTE_TEARDOWN_TIMEOUT');
  assert.equal(failures[2], removeError); assert.equal(failures[3], browserError);
  assert.equal(error.cause, businessError, 'the business failure remains primary');
  assert.deepEqual(calls, ['routes', 'browser', 'fixture']);
});

test('the composer also preserves fixture failure and still attempts every cleanup', async () => {
  const fixtureError = Error('synthetic fixture close failure');
  const { error, businessError, removeError, browserError, calls } = await injectedComposerFailure({ fixtureError });
  const failures = causes(error);
  assert.equal(failures.length, 5);
  assert.equal(failures[0], businessError); assert.equal(failures[1].code, 'ROUTE_TEARDOWN_TIMEOUT');
  assert.equal(failures[2], removeError); assert.equal(failures[3], browserError); assert.equal(failures[4], fixtureError);
  assert.equal(error.cause, businessError);
  assert.deepEqual(calls, ['routes', 'browser', 'fixture']);
});

test('a single body or cleanup failure is rethrown by identity, including aggregates and undefined', async () => {
  for (const error of [Error('single failure'), new AggregateError([Error('nested')], 'single aggregate'), undefined]) {
    for (const failingStage of ['body', 'routes', 'browser', 'fixture']) {
      const calls = [];
      const stage = name => async () => { calls.push(name); if (name === failingStage) throw error; };
      let failed = false;
      try { await withTestCleanup(stage('body'), [stage('routes'), stage('browser'), stage('fixture')]); }
      catch (actual) { failed = true; assert.equal(actual, error); }
      assert.equal(failed, true);
      assert.deepEqual(calls, ['body', 'routes', 'browser', 'fixture']);
    }
  }
});

test('cleanup errors retain order and the first cleanup remains primary when the body succeeds', async () => {
  const first = Error('route failure'), second = Error('browser failure'), calls = [];
  await assert.rejects(withTestCleanup(() => { calls.push('body'); }, [
    () => { calls.push('routes'); throw new AggregateError([first], 'nested route failure'); },
    async () => { calls.push('browser'); throw second; },
    () => { calls.push('fixture'); },
  ]), error => {
    assert.deepEqual(error.errors, [first, second]);
    assert.deepEqual(error.cause.errors, [first]);
    return true;
  });
  assert.deepEqual(calls, ['body', 'routes', 'browser', 'fixture']);
});

test('a successful body returns its value after all cleanups', async () => {
  const calls = [], value = {};
  const result = await withTestCleanup(() => { calls.push('body'); return value; }, [
    () => { calls.push('routes'); }, async () => { calls.push('browser'); }, () => { calls.push('fixture'); },
  ]);
  assert.equal(result, value); assert.deepEqual(calls, ['body', 'routes', 'browser', 'fixture']);
});
