import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { bundledMemoryConfiguration, bundledMemoryRpcFactory } from '../src/personal-memory/bundled-runtime.mjs';
import { memoryRuntimeFixture } from './helpers/memory-runtime-fixture.mjs';

const owner = 'owner-00000000-0000-4000-8000-000000000001';
const fixture = fileURLToPath(new URL('./fixtures/memory-startup-failure.mjs', import.meta.url));

async function harness(t, mode, configure = async root => ({ semanticCacheDirectory: null }), managerOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mem-auto-failure-'));
  const spawn = childProcess.spawn;
  let starts = 0;
  const mocked = t.mock.method(childProcess, 'spawn', () => {
    starts++;
    return spawn(mode === 'execution-error' ? join(root, 'missing-python.exe') : process.execPath,
      mode === 'execution-error' ? [] : [fixture, mode], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
  });
  syncBuiltinESMExports();
  const config = await configure(root);
  const factory = bundledMemoryRpcFactory(config);
  const rpcFactory = Object.assign(options => {
    const rpc = factory(options);
    rpc.requestTimeoutMs = 1000;
    return rpc;
  }, { managedRuntime: factory.managedRuntime, validate: factory.validate });
  const createManager = () => createPersonalMemoryManager({ root, enabled: true,
    python: process.execPath, pythonPath: root, baseUrl: 'http://127.0.0.1:1/v1',
    model: '@current', credential: () => 'synthetic',
    rpcFactory, ...managerOptions });
  let manager = createManager();
  return { root, config, get manager() { return manager; }, starts: () => starts, setMode: value => { mode = value; },
    async restart() { await manager.close(); manager = createManager(); }, async close() {
    try { await manager.close(); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); await rm(root, { recursive: true, force: true }); }
  } };
}

test('a deterministic bundled startup failure stops automatic process starts and retains its source', async t => {
  const h = await harness(t, 'exit');
  try {
    await h.manager.ingest(owner, { event_id: 'synthetic-startup-source',
      parent_session_id: 'synthetic-session', source_messages: [{ role: 'user', content: 'Synthetic source retained for repair.' }] });
    await delay(9500);
    const pending = await h.manager.pendingStatus(owner);
    assert.equal(pending.pendingBoundaryCount, 1);
    assert.equal(pending.discardedBoundaryCount, 0);
    console.log(JSON.stringify({ reproduction: 'persistent-startup-failure', starts: h.starts(),
      pending: pending.pendingBoundaryCount, discarded: pending.discardedBoundaryCount }));
    assert.equal(h.starts(), 1, 'deterministic startup failure must not spawn automatic replacements');
  } finally { await h.close(); }
});

const source = { event_id: 'synthetic-recovery-source', parent_session_id: 'synthetic-session',
  source_messages: [{ role: 'user', content: 'Keep the entire synthetic source after repair.' }] };
async function until(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  assert.fail('memory recovery condition did not settle');
}
async function assertDelivered(h) {
  await until(async () => (await h.manager.pendingStatus(owner)).pendingBoundaryCount === 0);
  const delivered = (await readFile(join(h.root, 'accounts', owner, 'memory-home/synthetic-delivered.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(delivered, [source]);
  assert.equal((await h.manager.pendingStatus(owner)).discardedBoundaryCount, 0);
}

for (const fault of ['missing', 'hash']) test(`${fault} component never executes and repairing its original bytes resumes the source`, async t => {
  let component, original;
  const h = await harness(t, 'ready', async root => {
    const directory = join(root, 'resources/memory-runtime');
    await memoryRuntimeFixture(directory);
    const config = bundledMemoryConfiguration({ directory, mode: 'base', manifestSha256:
      createHash('sha256').update(await readFile(join(directory, 'MEMORY-RUNTIME.json'))).digest('hex') });
    component = config.python; original = await readFile(component);
    if (fault === 'missing') await rm(component); else await writeFile(component, 'broken');
    return config;
  });
  try {
    await h.manager.ingest(owner, source);
    for (let i = 0; i < 4; i++) { assert.equal((await h.manager.status(owner)).state, 'unavailable'); await h.manager.flushPending(owner); }
    assert.equal(h.starts(), 0);
    assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    await writeFile(component, original);
    await h.manager.repairRuntime(owner); await assertDelivered(h);
    assert.equal(h.starts(), 1);
  } finally { await h.close(); }
});

test('the real repair control resets the stopped manager through the existing system repair action', async t => {
  const h = await harness(t, 'initialize-error');
  try {
    await h.manager.ingest(owner, source);
    const status = await h.manager.status(owner);
    let clicked, repairs = 0;
    const context: any = { WeftUiComponents: { factories: {} }, weftmateDesktop: { async repairSystem(id) {
      assert.equal(id, 'memory'); repairs++; await h.manager.repairRuntime(owner);
    } } };
    runInNewContext(await readFile(new URL('../src/personal-access-ui/components/memory.js', import.meta.url), 'utf8'), context);
    const node: any = { textContent: '', children: [], classList: { toggle() {} }, append(...items) { this.children.push(...items); } };
    const core = { memory: { status }, async openMemory() { this.memory.status = await h.manager.status(owner); } };
    const component = context.WeftUiComponents.factories.memory(core, {
      byId: () => node, element: (tag, className, textContent) => ({ tag, className, textContent,
        addEventListener(event, callback) { assert.equal(event, 'click'); clicked = callback; } }),
    });
    component.memoryStatus('fallback', true); assert.equal(typeof clicked, 'function');
    h.setMode('ready'); await clicked(); await assertDelivered(h);
    assert.equal(repairs, 1); assert.equal(h.starts(), 2);
  } finally { await h.close(); }
});

for (const recovery of ['repair', 'restart']) test(`initialization rejection keeps a replayable source for ${recovery}`, async t => {
  const h = await harness(t, 'initialize-error');
  try {
    await h.manager.ingest(owner, source);
    const pending = await h.manager.pendingStatus(owner);
    assert.equal(pending.pendingBoundaryCount, 1); assert.equal(pending.blockedBoundaryCount, 0);
    for (let i = 0; i < 4; i++) { await h.manager.status(owner); await h.manager.flushPending(owner); }
    assert.equal(h.starts(), 1, 'status and explicit flush cannot bypass a stopped runtime');
    h.setMode('ready');
    if (recovery === 'restart') await h.restart(); else await h.manager.repairRuntime(owner);
    await assertDelivered(h);
    assert.equal(h.starts(), 2);
  } finally { await h.close(); }
});

test('an interpreter execution error is permanent until explicit repair', async t => {
  const h = await harness(t, 'execution-error');
  try {
    await h.manager.ingest(owner, source);
    for (let i = 0; i < 4; i++) { assert.equal((await h.manager.status(owner)).state, 'unavailable'); await h.manager.flushPending(owner); }
    assert.equal(h.starts(), 1);
    assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    h.setMode('ready'); await h.manager.repairRuntime(owner); await assertDelivered(h);
    assert.equal(h.starts(), 2);
  } finally { await h.close(); }
});

for (const mode of ['disconnect', 'initialize-disconnect', 'timeout']) test(`${mode} permits only two automatic retries and repair clears the budget`, async t => {
  const h = await harness(t, mode);
  try {
    await h.manager.ingest(owner, source);
    await until(async () => h.starts() >= 3 && (await h.manager.status(owner)).state === 'unavailable');
    await delay(4500);
    assert.equal(h.starts(), 3, 'initial attempt plus two automatic retries is the lifetime budget until repair');
    for (let i = 0; i < 4; i++) { await h.manager.status(owner); await h.manager.flushPending(owner); }
    assert.equal(h.starts(), 3);
    const pending = await h.manager.pendingStatus(owner);
    assert.equal(pending.pendingBoundaryCount, 1); assert.equal(pending.blockedBoundaryCount, 0);
    // A manual repair starts a fresh budget even when the same fault persists.
    await h.manager.repairRuntime(owner);
    await until(async () => h.starts() >= 6 && (await h.manager.status(owner)).state === 'unavailable');
    await delay(2500); assert.equal(h.starts(), 6);
    h.setMode('ready');
    if (mode === 'timeout') await h.restart(); else await h.manager.repairRuntime(owner);
    await assertDelivered(h); assert.equal(h.starts(), 7);
  } finally { await h.close(); }
});

test('Core initialize internal_error reaches the real memory component with a repair link', async t => {
  const h = await harness(t, 'initialize-error');
  try {
    const status = await h.manager.status(owner);
    assert.equal(status.state, 'unavailable');
    assert.equal(status.reasonCode, 'internal_error');
    const context: any = { WeftUiComponents: { factories: {} } };
    runInNewContext(await readFile(new URL('../src/personal-access-ui/components/memory.js', import.meta.url), 'utf8'), context);
    const node: any = { textContent: '', children: [], classList: { toggle() {} },
      append(...items) { this.children.push(...items); } };
    const component = context.WeftUiComponents.factories.memory({ memory: { status } }, {
      byId: () => node, element: (tag, className, textContent) => ({ tag, className, textContent }),
    });
    component.memoryStatus('记忆服务暂时不可用，请稍后刷新。', true);
    const links = node.children.filter(item => item?.tag === 'a' && item.href);
    console.log(JSON.stringify({ reproduction: 'initialize-internal-error', state: status.state,
      reasonCode: status.reasonCode, repairLinks: links.length }));
    assert.equal(links.length, 1, 'every unavailable bundled memory status must offer a repair action');
    assert.ok(links[0].textContent);
    assert.doesNotMatch(node.textContent, /internal_error|Core|Python/);
    for (const reasonCode of ['unknown_future_failure', undefined, 'MEMORY_MODEL_UNAVAILABLE']) {
      status.reasonCode = reasonCode; node.children = [];
      component.memoryStatus('记忆服务暂时不可用，请稍后刷新。', true);
      assert.equal(node.children.filter(item => item?.tag === 'a' && item.href).length, 1);
    }
  } finally { await h.close(); }
});

test('disconnects between requests also consume the same finite retry budget', async t => {
  const h = await harness(t, 'idle-disconnect');
  try {
    for (let i = 0; i < 8; i++) { await h.manager.status(owner); await delay(100); }
    assert.equal(h.starts(), 3);
    assert.equal((await h.manager.status(owner)).state, 'unavailable');
    await delay(2500); assert.equal(h.starts(), 3);
    h.setMode('ready'); await h.manager.repairRuntime(owner);
    assert.equal((await h.manager.status(owner)).state, 'ready'); assert.equal(h.starts(), 4);
  } finally { await h.close(); }
});

test('switching a ready model route revalidates components before replacing its process', async t => {
  let profileId = 'synthetic-route-a', component, original;
  const route = () => ({ profileId, baseUrl: 'http://127.0.0.1:1/v1', model: '@current',
    credential: 'synthetic', routeFingerprint: null, modelTier: 'local' });
  const h = await harness(t, 'ready', async root => {
    const directory = join(root, 'resources/memory-runtime'); await memoryRuntimeFixture(directory);
    const config = bundledMemoryConfiguration({ directory, mode: 'base', manifestSha256:
      createHash('sha256').update(await readFile(join(directory, 'MEMORY-RUNTIME.json'))).digest('hex') });
    component = config.python; original = await readFile(component); return config;
  }, { processingRoute: route, defaultProcessingRoute: route });
  try {
    assert.equal((await h.manager.status(owner)).state, 'ready'); assert.equal(h.starts(), 1);
    profileId = 'synthetic-route-b'; await writeFile(component, 'broken');
    await h.manager.ingest(owner, source);
    assert.equal(h.starts(), 1, 'a route switch cannot execute changed components');
    assert.equal((await h.manager.status(owner)).reasonCode, 'MEMORY_COMPONENT_INVALID');
    assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    await writeFile(component, original); await h.manager.repairRuntime(owner); await assertDelivered(h);
    assert.equal(h.starts(), 2);
  } finally { await h.close(); }
});
