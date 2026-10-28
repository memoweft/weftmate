import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';

test('unchanged model names do not force layout; a width change still refits the full name', () => {
  let width = 70, reads = 0, text = '', writes = 0, resized;
  const label = { dataset: {}, title: '', get textContent() { return text; }, set textContent(value) { text = value; writes++; },
    get clientWidth() { reads++; return width; }, get scrollWidth() { reads++; return Array.from(text).length * 10; } };
  const context: any = { ResizeObserver: class { constructor(callback) { resized = callback; } observe() {} } };
  runInNewContext(readFileSync('src/ui-core/model-label.js', 'utf8'), context);
  const name = 'synthetic-long-model';
  context.WeftModelLabel(label, name);
  assert.match(text, /…/); assert.equal(label.title, name);
  reads = writes = 0;
  for (let n = 0; n < 20; n++) context.WeftModelLabel(label, name);
  assert.equal(reads, 0); assert.equal(writes, 0);
  width = 300; resized(); assert.equal(text, name);
});

// The 60Hz budget is measured on the controlled local host. Shared CI runs the
// existing process/phone functional suites and the layout regression above.
test('conversation switching stays smooth and restores reading, draft and stream state in local Windows Electron', {
  skip: process.platform !== 'win32' || !!process.env.CI, timeout: 185000,
}, async () => {
  const output = process.env.WEFTMATE_PERF_SWITCH_OUTPUT || await mkdtemp(join(tmpdir(), 'weftmate-perf-switch-'));
  try {
    const env = { ...process.env, WEFTMATE_PERF_SWITCH_OUTPUT: output }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.execPath, ['tests/integration/perf-switch.mjs'], { env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    if (!process.env.WEFTMATE_PERF_SWITCH_OUTPUT) await rm(output, { recursive: true, force: true });
  }
});
