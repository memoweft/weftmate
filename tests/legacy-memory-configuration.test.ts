import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Exercise the shipped module with only the unrelated tool declaration stubbed.
// The spawn seam never executes Python or reads a developer's Core checkout.
test('legacy bridge requires an explicit source and preserves explicit invocation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-legacy-config-'));
  const before = { ...process.env };
  const calls = [];
  const stub = t.mock.method(childProcess, 'spawn', (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', bytes => {
      const request = JSON.parse(String(bytes));
      queueMicrotask(() => child.stdout.write(JSON.stringify({ ...request, ok: true, result: {} }) + '\n'));
    });
    child.kill = () => true;
    return child;
  });
  syncBuiltinESMExports();
  try {
    const tools = join(root, 'node_modules/@deepseek-ai/dsh-tools');
    await mkdir(tools, { recursive: true });
    await writeFile(join(tools, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
    await writeFile(join(tools, 'index.js'), 'export const defineTool = value => value;');
    await copyFile(new URL('../src/plugins/weftmate-memory.mjs', import.meta.url), join(root, 'plugin.mjs'));
    const { MemoWeftBridge, apply } = await import(pathToFileURL(join(root, 'plugin.mjs')));
    await t.test('disabled plugin does not touch configuration or register memory', () => {
      delete process.env.WEFTMATE_MEMOWEFT_ENABLED;
      apply({ logger: { info() {} }, get() { assert.fail('disabled plugin must not read services'); } });
      assert.equal(calls.length, 0);
    });
    delete process.env.WEFTMATE_MEMOWEFT_PYTHONPATH;
    delete process.env.WEFTMATE_MEMOWEFT_PYTHON;
    process.env.PYTHONPATH = join(root, 'ambient-source');
    process.env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    process.env.DSH_HOME = root;
    await t.test('missing source fails before spawn, even with ambient PYTHONPATH', () => {
      const bridge = new MemoWeftBridge();
      assert.throws(() => bridge.start(), /记忆未配置/);
      assert.equal(calls.length, 0);
      assert.equal(bridge.child, null);
    });
    await t.test('existing management route reports missing configuration', async () => {
      calls.length = 0;
      let handler;
      const disposers = [];
      apply({ logger: { info() {} }, on() {}, get(name) {
        if (name === 'webServer') return { register(route) { handler = route.handler; return () => {}; } };
      }, effect(create) { const dispose = create(); if (typeof dispose === 'function') disposers.push(dispose); } });
      try {
        let status, body;
        await handler({ method: 'GET', url: '/weftmate/memory/health.json', headers: {} }, {
          writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); },
        });
        assert.equal(status, 500);
        assert.match(body.error, /记忆未配置/);
        assert.equal(calls.length, 0);
      } finally { while (disposers.length) await disposers.pop()(); }
    });
    await t.test('explicit environment retains executable, arguments and source', () => {
      calls.length = 0;
      process.env.WEFTMATE_MEMOWEFT_PYTHON = join(root, 'explicit-python');
      process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = join(root, 'explicit-source');
      const bridge = new MemoWeftBridge(); bridge.start();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], process.env.WEFTMATE_MEMOWEFT_PYTHON);
      assert.deepEqual(calls[0][1], ['-m', 'memoweft.integrations.dsh_bridge']);
      assert.equal(calls[0][2].env.PYTHONPATH, process.env.WEFTMATE_MEMOWEFT_PYTHONPATH);
      assert.equal(calls[0][2].windowsHide, true);
      bridge.child = null;
    });
  } finally {
    stub.mock.restore(); syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    await rm(root, { recursive: true, force: true });
  }
});
