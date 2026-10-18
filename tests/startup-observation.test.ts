import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStartupObservation, observeStartupEvents } from '../src/startup-observation.mjs';

test('early startup records real events, first window stages and monotonic timing without arbitrary values', t => {
  const root = mkdtempSync(join(tmpdir(), 'startup-observation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'startup.jsonl');
  let clock = 1;
  const record = createStartupObservation({ file, now: () => 100 + clock, elapsed: () => clock++, pid: 42 });
  const app = Object.assign(new EventEmitter(), { isReady: () => false });
  observeStartupEvents(app, record);
  record('private-account');
  app.emit('ready');
  const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
  app.emit('browser-window-created', {}, window);
  window.emit('ready-to-show'); window.webContents.emit('dom-ready'); window.webContents.emit('did-finish-load');
  app.emit('browser-window-created', {}, Object.assign(new EventEmitter(), { webContents: new EventEmitter() }));
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.phase), ['module-entry', 'app-ready', 'window-created', 'window-ready-to-show', 'window-dom-ready', 'window-load-finished']);
  assert.deepEqual(rows.map(row => row.elapsedMs), [1, 2, 3, 4, 5, 6]);
  assert.equal(rows.every(row => row.pid === 42 && Object.keys(row).length === 4), true);
});

test('disk, clock, optional listener and synchronous/asynchronous publisher failures stay observational', async () => {
  const original = Error('original');
  for (const options of [
    { write() { throw original; } }, { now() { throw original; } }, { elapsed() { throw original; } },
  ]) assert.doesNotThrow(() => createStartupObservation({ file: 'unused', ...options })('bootstrap'));
  for (const record of [() => { throw original; }, () => Promise.reject(original)]) {
    const app = Object.assign(new EventEmitter(), { isReady: () => true });
    assert.doesNotThrow(() => observeStartupEvents(app, record));
    const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
    assert.equal(app.emit('browser-window-created', {}, window), true);
    assert.equal(window.emit('ready-to-show'), true);
    assert.equal(window.webContents.emit('did-finish-load'), true);
    assert.doesNotThrow(() => app.emit('browser-window-created', {}, null));
  }
  assert.doesNotThrow(() => observeStartupEvents({ isReady() { throw original; } }));
  let calls = 0;
  createStartupObservation({ write() { calls++; } })('bootstrap');
  assert.equal(calls, 0, 'ordinary launches do not write a trace');
  await new Promise(resolve => setImmediate(resolve));
});
