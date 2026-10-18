import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';
import { runScene } from '../scripts/review-gallery/common.mjs';
import { observePageFailures, sceneFailureDetails, sceneFailureSummary } from '../scripts/review-gallery/scene-diagnostics.mjs';

async function failedScene(t, { phase = 'diagram-ready', publish = undefined, pageDiagnostics = undefined,
  page = { isClosed: () => false }, prepareError = undefined } = {}) {
  const out = managedMkdtempSync('scene-diagnostics-', { prune: false });
  t.after(() => disposeManagedTemp(out, { log() {} }));
  const error = prepareError ?? Object.assign(new Error('private-error-sentinel'), { name: 'TimeoutError', scenePhase: phase });
  const record = await runScene({ page, out, platform: 'mobile-web', scene: 'rendering', theme: 'dark',
    prepare: async () => { throw error; }, publish, pageDiagnostics });
  const stored = JSON.parse(await readFile(join(out, 'review-mobile-web-rendering-dark.json'), 'utf8'));
  return { record, stored };
}

test('prepare timeout keeps its fixed phase in the record and failure log', async t => {
  const messages = [];
  t.mock.method(console, 'log', value => { messages.push(value); });
  const { record, stored } = await failedScene(t);
  assert.equal(record.status, 'failed');
  assert.equal(stored.phase, 'diagram-ready');
  assert.match(messages.join('\n'), /phase=diagram-ready/);
  assert.doesNotMatch(JSON.stringify({ record, stored, messages }), /private-error-sentinel/);
});

test('unknown caller phase is replaced by the fixed prepare fallback', async t => {
  const messages = [];
  t.mock.method(console, 'log', value => { messages.push(value); });
  const { record, stored } = await failedScene(t, { phase: 'private-phase-sentinel' });
  assert.equal(record.phase, 'prepare');
  assert.equal(stored.phase, 'prepare');
  assert.doesNotMatch(JSON.stringify({ record, stored, messages }), /private-phase-sentinel|private-error-sentinel/);
});

test('synchronous diagnostic publication failure cannot replace the scene failure', async t => {
  t.mock.method(console, 'log', () => { throw Error('private-publisher-sentinel'); });
  const { record, stored } = await failedScene(t);
  assert.equal(record.status, 'failed');
  assert.deepEqual(stored, record);
});

test('asynchronous diagnostic rejection cannot replace or escape the scene failure', async t => {
  let publications = 0;
  const { record, stored } = await failedScene(t, { publish: async () => {
    publications++;
    throw Error('private-publisher-sentinel');
  } });
  await new Promise(setImmediate);
  assert.equal(publications, 1);
  assert.equal(record.status, 'failed');
  assert.deepEqual(stored, record);
});

test('a pending publisher adds no wait to the failure outcome', { timeout: 2000 }, async t => {
  let publications = 0;
  const { record } = await failedScene(t, { publish: () => { publications++; return new Promise(() => {}); } });
  assert.equal(publications, 1);
  assert.equal(record.status, 'failed');
});

test('actual observed page counts reach the JSON, log and final failure summary', async t => {
  const page = Object.assign(new EventEmitter(), { isClosed: () => false });
  const otherPage = new EventEmitter();
  const diagnostics = observePageFailures(page);
  t.after(() => diagnostics.dispose());
  const originalListener = () => {};
  page.on('pageerror', originalListener);
  const privateArgument = { get message() { throw Error('event arguments must not be read'); } };
  page.emit('pageerror', privateArgument);
  page.emit('pageerror', privateArgument);
  page.emit('crash', privateArgument);
  otherPage.emit('pageerror', privateArgument);
  const messages = [];
  const { record, stored } = await failedScene(t, { page, pageDiagnostics: diagnostics, publish: value => messages.push(value) });
  assert.equal(stored.pageErrors, 2);
  assert.equal(stored.pageCrashes, 1);
  assert.deepEqual(sceneFailureSummary(record), { scene: 'rendering', theme: 'dark', reason: record.reason,
    phase: 'diagram-ready', pageErrors: 2, pageCrashes: 1 });
  assert.match(messages[0], /phase=diagram-ready pageErrors=2 pageCrashes=1/);
  assert.doesNotMatch(JSON.stringify({ record, messages }), /private-error-sentinel|event arguments/);
  diagnostics.dispose();
  assert.equal(page.listenerCount('pageerror'), 1);
  assert.equal(page.listenerCount('crash'), 0);
  page.emit('pageerror', privateArgument);
  assert.deepEqual(diagnostics.snapshot(), { pageErrors: 2, pageCrashes: 1 });
});

test('fixed phases and finite event counts are the only diagnostic fields retained', () => {
  for (const phase of ['fixture-create', 'navigate', 'login-ready', 'session-list', 'drawer-open',
    'session-select', 'heading-scroll', 'diagram-ready']) assert.equal(sceneFailureDetails({ phase }).phase, phase);
  for (const invalid of [NaN, Infinity, -1, 0.5, 'private-count-sentinel']) {
    assert.deepEqual(sceneFailureDetails({ phase: 'unknown', pageErrors: invalid, pageCrashes: invalid, secret: 'private-field' }),
      { phase: 'prepare', pageErrors: 0, pageCrashes: 0 });
  }
  assert.deepEqual(sceneFailureDetails({ phase: 'prepare' }), { phase: 'prepare' });
});

test('closed pages and non-navigation prepare errors remain fatal with their original cause', async t => {
  for (const closed of [false, true]) {
    const cause = Object.assign(new Error('original-infrastructure-sentinel'), { name: closed ? 'TimeoutError' : 'Error' });
    let publications = 0;
    await assert.rejects(failedScene(t, { page: { isClosed: () => closed }, prepareError: cause,
      publish: () => { publications++; } }), error => error.message === 'Scene infrastructure failed' && error.cause === cause);
    assert.equal(publications, 0);
  }
});
