import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { runInNewContext } from 'node:vm';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';
import { runScene } from '../scripts/review-gallery/common.mjs';
import { sceneFailureSummary } from '../scripts/review-gallery/scene-diagnostics.mjs';
import { readRenderingSnapshot, renderingFailureSampler, sanitizeRenderingSnapshot, sampleFailureSnapshot } from '../scripts/review-gallery/rendering-snapshot.mjs';

const resource = () => ({ state: 'not-recorded', entryCount: 0, durationMs: 0, responseEndMs: 0, statusBucket: 'unknown' });
const emptySnapshot = () => ({ totalBlocks: 0, totalImages: 0, blocksTruncated: false,
  blocks: [{ slot: 1, expected: 'valid', state: 'missing' }, { slot: 2, expected: 'invalid', state: 'missing' }],
  resources: { module: resource(), library: resource() } });
async function fixture(t) {
  const out = managedMkdtempSync('rendering-snapshot-', { prune: false });
  t.after(() => disposeManagedTemp(out, { log() {} }));
  const error = Object.assign(new Error('private-original-sentinel'), { name: 'TimeoutError', scenePhase: 'diagram-ready' });
  const messages = [];
  return { out, error, messages, options: { page: { isClosed: () => false }, out, platform: 'mobile-web',
    scene: 'rendering', theme: 'light', prepare: async () => { throw error; }, publish: value => messages.push(value) },
    stored: async () => JSON.parse(await readFile(join(out, 'review-mobile-web-rendering-light.json'), 'utf8')) };
}

test('failed prepare samples once and keeps the safe snapshot in JSON, log and final summary', async t => {
  const f = await fixture(t);
  let calls = 0;
  const snapshot = emptySnapshot();
  const record = await runScene({ ...f.options, failureSampler: () => { calls++; return snapshot; } });
  assert.equal(record.status, 'failed');
  assert.equal(record.sampleStatus, 'ok');
  assert.equal(calls, 1);
  assert.deepEqual(record.renderingSnapshot, snapshot);
  assert.deepEqual(await f.stored(), record);
  assert.deepEqual(sceneFailureSummary(record).renderingSnapshot, snapshot);
  assert.match(f.messages[0], /sampleStatus=ok/);
  assert.ok(f.messages[0].includes('"blocksTruncated":false'));
  assert.doesNotMatch(JSON.stringify({ record, messages: f.messages }), /private-original-sentinel/);
});

test('sampler synchronous throw preserves the original failed reason and phase', async t => {
  const f = await fixture(t);
  const record = await runScene({ ...f.options, failureSampler: () => { throw Error('private-sampler-sentinel'); } });
  assert.equal(record.status, 'failed');
  assert.equal(record.phase, 'diagram-ready');
  assert.equal(record.sampleStatus, 'error');
  assert.match(record.reason, /页面元素超时/);
  assert.deepEqual(await f.stored(), record);
  assert.doesNotMatch(JSON.stringify(record), /private-sampler-sentinel/);
});

test('invalid sampler structure produces only a fixed diagnostic status', async t => {
  const f = await fixture(t);
  const record = await runScene({ ...f.options, failureSampler: () => ({ private: 'private-snapshot-sentinel' }) });
  assert.equal(record.status, 'failed');
  assert.equal(record.sampleStatus, 'invalid');
  assert.equal(record.renderingSnapshot, undefined);
  assert.doesNotMatch(JSON.stringify(record), /private-snapshot-sentinel/);
});

test('the single post-failure allowance is 250ms and late completion or rejection is discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const lateReject of [false, true]) {
    const f = await fixture(t), entered = Promise.withResolvers(), late = Promise.withResolvers();
    let calls = 0, returned = false;
    const pending = runScene({ ...f.options, failureSampler: () => { calls++; entered.resolve(); return late.promise; } });
    pending.then(() => { returned = true; });
    await entered.promise;
    t.mock.timers.tick(249);
    await Promise.resolve();
    assert.equal(returned, false);
    t.mock.timers.tick(1);
    const record = await pending;
    assert.equal(record.status, 'failed');
    assert.equal(record.sampleStatus, 'timeout');
    assert.equal(record.phase, 'diagram-ready');
    assert.equal(calls, 1);
    assert.equal(record.renderingSnapshot, undefined);
    const stored = await f.stored(), messages = [...f.messages];
    if (lateReject) late.reject(Error('private-late-sentinel'));
    else late.resolve(emptySnapshot());
    await new Promise(setImmediate);
    assert.deepEqual(await f.stored(), stored);
    assert.deepEqual(f.messages, messages);
    assert.equal(f.messages.length, 1);
  }
});

test('settled sampling cancels its timer and rejection or unavailable remain diagnostic only', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clear = t.mock.method(globalThis, 'clearTimeout');
  for (const [sample, status] of [[() => emptySnapshot(), 'ok'], [async () => { throw Error('private-rejection'); }, 'error'],
    [() => undefined, 'unavailable']]) {
    const result = await sampleFailureSnapshot(sample);
    assert.equal(result.sampleStatus, status);
    t.mock.timers.tick(250);
    assert.equal(result.sampleStatus, status);
  }
  assert.equal(clear.mock.callCount(), 3);
});

test('successful prepare, other scenes and original infrastructure failures do not sample', async t => {
  const f = await fixture(t);
  let calls = 0;
  const failureSampler = () => { calls++; return emptySnapshot(); };
  const captureError = Error('original-capture-failure');
  await assert.rejects(runScene({ ...f.options, prepare: async () => {},
    page: { evaluate: async () => { throw captureError; } }, failureSampler }), error => error === captureError);
  const other = await runScene({ ...f.options, scene: 'login', failureSampler });
  assert.equal(other.sampleStatus, undefined);
  const cause = Error('original-infrastructure-failure');
  await assert.rejects(runScene({ ...f.options, prepare: async () => { throw cause; }, failureSampler }), error => error.cause === cause);
  assert.equal(calls, 0);
});

test('snapshot output cannot hide an original evidence write failure', async t => {
  const f = await fixture(t);
  await assert.rejects(runScene({ ...f.options, failureSampler: () => {
    mkdirSync(join(f.out, 'review-mobile-web-rendering-light.json'));
    return emptySnapshot();
  } }), error => ['EISDIR', 'EACCES', 'EPERM'].includes(error.code));
  assert.equal(f.messages.length, 0);
});

test('original Git provenance failure remains fatal before sampling', async t => {
  const f = await fixture(t), cause = Error('original-provenance-failure');
  let calls = 0;
  t.mock.method(childProcess, 'execFileSync', () => { throw cause; });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(runScene({ ...f.options, failureSampler: () => { calls++; return emptySnapshot(); } }), error => error === cause);
  assert.equal(calls, 0);
  assert.equal(f.messages.length, 0);
});

function staticPage() {
  const box = (x, y, width, height) => ({ x, y, width, height, top: y, bottom: y + height, left: x, right: x + width });
  const element = (bounds, classes = []) => {
    const result = { parentElement: null, style: { display: 'block', visibility: 'visible', overflowX: 'visible', overflowY: 'visible' },
      getBoundingClientRect: () => bounds, classList: { contains: name => classes.includes(name) } };
    for (const property of ['textContent', 'innerText', 'innerHTML', 'src', 'href']) Object.defineProperty(result, property,
      { get() { throw Error('Content and URL properties must not be read'); } });
    return result;
  };
  const clip = element(box(0, 0, 390, 500)); clip.style.overflowY = 'auto';
  const image = Object.assign(element(box(20, 610, 100, 60)), { complete: true, naturalWidth: 0, naturalHeight: 0 });
  const first = element(box(20, 600, 350, 180)), second = element(box(20, 900, 350, 180), ['diagram-failed', 'is-source']);
  first.parentElement = clip; image.parentElement = first; second.parentElement = clip;
  for (const [block, images, status] of [[first, [image], false], [second, [], true]]) {
    block.querySelector = selector => selector === '.render-diagram' ? { hidden: false } : selector === '.render-status' ? (status ? {} : null) : null;
    block.querySelectorAll = selector => { assert.equal(selector, '.render-diagram img'); return images; };
  }
  const ignored = new Proxy({}, { get() { throw Error('Only the first two blocks may be read'); } });
  const blocks = [first, second, ignored], requests = [];
  const record = { duration: 7, responseEnd: 20, responseStatus: 200 };
  Object.defineProperty(record, 'name', { get() { throw Error('Resource name must not be read'); } });
  const context = { innerWidth: 390, innerHeight: 844, getComputedStyle: node => node.style,
    document: { querySelectorAll: selector => selector === '.render-mermaid' ? blocks : selector === '.render-diagram img' ? [image] : [] },
    performance: { getEntriesByName: (key, type) => { requests.push({ key, type }); return key === 'known-module-key' ? [record] : []; } } };
  const read = () => runInNewContext(`(${readRenderingSnapshot.toString()})`, context)({ resourceKeys: ['known-module-key', 'known-library-key'] });
  return { read, context, requests, first, image, record };
}

test('static DOM sampling distinguishes fallback, broken complete images, clip geometry and existing resources', () => {
  const page = staticPage(), result = sanitizeRenderingSnapshot(page.read());
  assert.equal(result.totalBlocks, 3);
  assert.equal(result.blocksTruncated, true);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].state, 'image');
  assert.equal(result.blocks[0].cssVisible, true);
  assert.equal(result.blocks[0].intersectsClip, false);
  assert.equal(result.blocks[0].imageComplete, true);
  assert.equal(result.blocks[0].loaded, false);
  assert.equal(result.blocks[1].expected, 'invalid');
  assert.equal(result.blocks[1].state, 'fallback');
  assert.equal(result.resources.module.statusBucket, '2xx');
  assert.equal(result.resources.library.state, 'not-recorded');
  assert.deepEqual(page.requests, [{ key: 'known-module-key', type: 'resource' }, { key: 'known-library-key', type: 'resource' }]);
  page.image.naturalWidth = 100; page.image.naturalHeight = 60;
  assert.equal(sanitizeRenderingSnapshot(page.read()).blocks[0].loaded, true);
  page.first.style.display = 'none';
  assert.equal(sanitizeRenderingSnapshot(page.read()).blocks[0].cssVisible, false);
});

for (const boundary of [
  { name: 'positive overlap control', clip: [20, 100, 300, 300], child: [30, 120, 100, 50], intersects: true },
  { name: 'ancestor below viewport', clip: [0, 1000, 390, 100], child: [20, 800, 100, 400], intersects: false },
  { name: 'zero-height ancestor', clip: [0, 300, 390, 0], child: [20, 250, 100, 100], intersects: false },
  { name: 'ancestor right of viewport', clip: [500, 0, 100, 844], child: [350, 100, 200, 50], intersects: false },
  { name: 'zero-width ancestor', clip: [100, 0, 0, 844], child: [50, 100, 100, 50], intersects: false },
]) test(`cumulative clip boundary: ${boundary.name}`, () => {
  const page = staticPage(), clip = page.first.parentElement;
  const rectangle = ([x, y, width, height]) => ({ x, y, width, height, top: y, bottom: y + height, left: x, right: x + width });
  clip.style.overflowX = clip.style.overflowY = 'hidden';
  clip.getBoundingClientRect = () => rectangle(boundary.clip);
  page.first.getBoundingClientRect = page.image.getBoundingClientRect = () => rectangle(boundary.child);
  const first = sanitizeRenderingSnapshot(page.read()).blocks[0];
  assert.equal(first.cssVisible, true);
  assert.equal(first.imageCssVisible, true);
  assert.equal(first.intersectsClip, boundary.intersects);
  assert.equal(first.imageIntersectsClip, boundary.intersects);
});

test('placeholder is only status and missing resource capabilities remain unavailable', () => {
  const page = staticPage();
  page.first.querySelector = selector => selector === '.render-status' ? {} : null;
  page.first.querySelectorAll = () => [];
  delete page.context.performance;
  const result = sanitizeRenderingSnapshot(page.read());
  assert.equal(result.blocks[0].state, 'status');
  assert.equal('pending' in result.blocks[0], false);
  assert.equal('ioTriggered' in result.blocks[0], false);
  assert.equal(result.resources.module.state, 'unavailable');
  page.context.document.querySelectorAll = () => [];
  assert.deepEqual(sanitizeRenderingSnapshot(page.read()).blocks, emptySnapshot().blocks);
});

test('projection drops unknown fields, derives loaded, and rejects illegal shapes and values', () => {
  const raw = staticPage().read();
  raw.private = 'private-snapshot-sentinel';
  raw.blocks[0].private = 'private-block-sentinel';
  raw.blocks[0].loaded = true;
  raw.blocks.map = () => { throw Error('Input array methods must not be invoked'); };
  raw.resources.module.url = 'private-resource-sentinel';
  const safe = sanitizeRenderingSnapshot(raw);
  assert.equal(safe.blocks[0].loaded, false);
  assert.doesNotMatch(JSON.stringify(safe), /private-|sentinel/);
  for (const mutate of [value => { value.blocks[0].blockRect.x = Infinity; }, value => { value.totalBlocks = NaN; },
    value => { value.blocks[0].state = 'private-state'; }, value => { value.resources.module.statusBucket = 'private-status'; }]) {
    const value = staticPage().read(); mutate(value);
    assert.equal(sanitizeRenderingSnapshot(value), undefined);
  }
});

test('page sampler uses only known resource keys and a closed page is unavailable', async () => {
  let invocation;
  const page = { isClosed: () => false, evaluate: async (reader, arg) => { invocation = { reader, arg }; return emptySnapshot(); } };
  const sample = renderingFailureSampler(page, () => 'http://127.0.0.1:1/');
  assert.equal((await sampleFailureSnapshot(sample)).sampleStatus, 'ok');
  assert.equal(invocation.reader, readRenderingSnapshot);
  assert.deepEqual(invocation.arg.resourceKeys, ['http://127.0.0.1:1/render-vendor/mermaid.js', 'http://127.0.0.1:1/render-vendor/mermaid.tiny.js']);
  page.isClosed = () => true;
  page.evaluate = async () => { throw Error('Closed page must not be evaluated'); };
  assert.equal((await sampleFailureSnapshot(sample)).sampleStatus, 'unavailable');
});
