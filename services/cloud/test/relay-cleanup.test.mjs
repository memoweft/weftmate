import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackRelayChild } from './relay-processes.mjs';
import { freePort, waitFor } from './relay-fixture.mjs';

test('a failed scenario exits and reaps all children even if another cleanup rejects', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wm-relay-cleanup-'));
  const fixture = join(root, 'failure.test.mjs');
  const helper = new URL('./relay-processes.mjs', import.meta.url).href;
  await writeFile(fixture, `
    import test from 'node:test';
    import { fork } from 'node:child_process';
    import { once } from 'node:events';
    import { closeRelayProcesses } from ${JSON.stringify(helper)};
    test('injected scenario failure', async () => {
      const procs = [];
      for (let i = 0; i < 2; i++) {
        const child = fork(${JSON.stringify(fileURLToPath(new URL('./fixtures/relay-idle.mjs', import.meta.url)))}, [], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], windowsHide: true });
        process.send({ pid: child.pid });
        await once(child, 'message');
        procs.push({ close: async () => {
          const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
        }});
      }
      procs.push({ close: async () => { throw new Error('injected cleanup failure'); } });
      try { throw new Error('injected scenario failure'); }
      finally { await closeRelayProcesses(procs); }
    });
  `);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = fork(fixture, [], { env, execArgv: ['--test', '--test-isolation=none'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const owned = []; let output = '', expired = false;
  child.on('message', value => { if (value.pid) owned.push(value.pid); });
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const exited = once(child, 'exit');
  const timer = setTimeout(() => {
    expired = true;
    for (const pid of owned) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    child.kill('SIGKILL');
  }, 5000);
  try {
    const [code] = await exited;
    assert.equal(expired, false, `failed node --test stayed alive past 5000ms\n${output}`);
    assert.equal(code, 1, output);
    assert.match(output, /injected cleanup failure/);
    assert.equal(owned.length, 2);
    for (const pid of owned) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    clearTimeout(timer);
    for (const pid of owned) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});

test('closing an owned sidecar also reaps its real frpc child', {
  skip: !process.env.WEFTMATE_FRP_DIR && 'official frp directory required', timeout: 15_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wm-relay-frpc-cleanup-'));
  const config = join(root, 'frpc.toml'), port = await freePort();
  await writeFile(config, `serverAddr="127.0.0.1"\nserverPort=${port}\nloginFailExit=false\nlog.to="console"\nlog.level="info"\n`);
  const binary = join(process.env.WEFTMATE_FRP_DIR, process.platform === 'win32' ? 'frpc.exe' : 'frpc');
  const child = fork(new URL('../../../src/personal-relay/sidecar.mjs', import.meta.url), [binary, config], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], windowsHide: true,
  });
  const tracked = trackRelayChild(child, 'host-frpc-sidecar'); let frpcPid;
  try {
    const [message] = await once(child, 'message');
    assert.equal(message.kind, 'frpc.spawned'); frpcPid = message.pid;
    assert.ok(frpcPid);
    await waitFor(() => tracked.logs().includes('start frpc service'), 'frpc did not start', 3000);
    assert.equal(child.exitCode, null, tracked.logs());
    assert.doesNotThrow(() => process.kill(frpcPid, 0));
    await tracked.close();
    assert.throws(() => process.kill(frpcPid, 0), { code: 'ESRCH' });
  } finally {
    await tracked.close();
    if (frpcPid) { try { process.kill(frpcPid, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});
