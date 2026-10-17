import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import fsPromises from 'node:fs/promises';
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
  let starts = 0, validationCalls = 0;
  const mocked = t.mock.method(childProcess, 'spawn', () => {
    starts++;
    const selectedMode = typeof mode === 'function' ? mode(starts) : mode;
    if (selectedMode === 'spawn-eagain') throw Object.assign(new Error('Synthetic temporary process resource failure'), { code: 'EAGAIN' });
    if (selectedMode.startsWith('spawn-code:')) throw Object.assign(new Error('Synthetic OS spawn error'), { code: selectedMode.slice('spawn-code:'.length) });
    return spawn(selectedMode === 'execution-error' ? join(root, 'missing-python.exe') : process.execPath,
      selectedMode === 'execution-error' ? [] : [fixture, selectedMode], {
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
  }, { managedRuntime: factory.managedRuntime, validate: factory.validate ? async () => {
    validationCalls++; return factory.validate();
  } : null });
  const createManager = () => createPersonalMemoryManager({ root, enabled: true,
    python: process.execPath, pythonPath: root, baseUrl: 'http://127.0.0.1:1/v1',
    model: '@current', credential: () => 'synthetic',
    rpcFactory, ...managerOptions });
  let manager = createManager();
  return { root, config, get manager() { return manager; }, starts: () => starts, checks: () => validationCalls, setMode: value => { mode = value; },
    async restart() { await manager.close(); manager = createManager(); }, async close() {
    try { await manager.close(); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); await rm(root, { recursive: true, force: true }); }
  } };
}

test('a deterministic bundled startup failure stops automatic process starts and retains its source', async t => {
  // Only the verified invalid-subject contract proves this initialization cause.
  const h = await harness(t, 'initialize-code:invalid_subject_id');
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

test('two Core internal_error initialization responses recover on the third start', async t => {
  const h = await harness(t, attempt => attempt <= 2 ? 'initialize-error' : 'ready');
  try {
    await h.manager.ingest(owner, source); await delay(9500);
    console.log(JSON.stringify({ reproduction: 'internal-error-twice', starts: h.starts(), pending: (await h.manager.pendingStatus(owner)).pendingBoundaryCount }));
    assert.equal(h.starts(), 3); await assertDelivered(h);
    assert.equal((await h.manager.status(owner)).state, 'ready');
  } finally { await h.close(); }
});

async function checkedFixture(root) {
  const directory = join(root, 'resources/memory-runtime'); await memoryRuntimeFixture(directory);
  return bundledMemoryConfiguration({ directory, mode: 'base', manifestSha256:
    createHash('sha256').update(await readFile(join(directory, 'MEMORY-RUNTIME.json'))).digest('hex') });
}

test('temporary EMFILE while reading a valid interpreter retries validation and delivers its source', async t => {
  const h = await harness(t, 'ready', checkedFixture);
  const originalRead = fsPromises.readFile;
  let checks = 0;
  const mockedRead = t.mock.method(fsPromises, 'readFile', (file, ...args) => {
    if (String(file) === h.config.python && ++checks <= 2) return Promise.reject(Object.assign(new Error('Synthetic read resource shortage'), { code: 'EMFILE' }));
    return originalRead(file, ...args);
  });
  syncBuiltinESMExports();
  try {
    await h.manager.ingest(owner, source); await delay(9500);
    console.log(JSON.stringify({ reproduction: 'read-emfile-twice', checks, starts: h.starts(), pending: (await h.manager.pendingStatus(owner)).pendingBoundaryCount }));
    assert.equal(checks, 3); assert.equal(h.starts(), 1); await assertDelivered(h);
  } finally { try { await h.close(); } finally { mockedRead.mock.restore(); syncBuiltinESMExports(); } }
});

test('two unknown early exits with code 75 recover on the third start and deliver one source', async t => {
  const h = await harness(t, attempt => attempt <= 2 ? 'exit-75' : 'ready');
  try {
    await h.manager.ingest(owner, source);
    await delay(9500);
    const pending = await h.manager.pendingStatus(owner);
    console.log(JSON.stringify({ reproduction: 'two-exit-75-then-ready', starts: h.starts(), pending: pending.pendingBoundaryCount }));
    assert.equal(h.starts(), 3);
    await assertDelivered(h);
    assert.equal((await h.manager.status(owner)).state, 'ready');
    console.log(JSON.stringify({ reproduction: 'two-exit-75-then-ready', delivered: 1 }));
  } finally { await h.close(); }
});

test('persistent unknown early exits with code 75 stop after exactly three starts', async t => {
  const h = await harness(t, 'exit-75');
  try {
    await h.manager.ingest(owner, source);
    await delay(9500);
    assert.equal(h.starts(), 3);
    assert.equal((await h.manager.status(owner)).state, 'unavailable');
    await h.manager.flushPending(owner); await delay(4500);
    assert.equal(h.starts(), 3);
    const pending = await h.manager.pendingStatus(owner);
    assert.equal(pending.pendingBoundaryCount, 1); assert.equal(pending.blockedBoundaryCount, 0);
    assert.equal(pending.discardedBoundaryCount, 0);
    console.log(JSON.stringify({ reproduction: 'persistent-exit-75', starts: h.starts(), pending: pending.pendingBoundaryCount }));
  } finally { await h.close(); }
});

test('temporary spawn EAGAIN is not evidence of an invalid interpreter', async t => {
  const h = await harness(t, attempt => attempt <= 2 ? 'spawn-eagain' : 'ready');
  try {
    await h.manager.ingest(owner, source); await delay(9500);
    assert.equal(h.starts(), 3); await assertDelivered(h);
    assert.equal((await h.manager.status(owner)).state, 'ready');
  } finally { await h.close(); }
});
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
    assert.equal(h.checks(), 1, 'confirmed missing/hash failure is checked once with zero automatic retries');
    assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    await writeFile(component, original);
    await h.manager.repairRuntime(owner); await assertDelivered(h);
    assert.equal(h.starts(), 1);
    assert.equal(h.checks(), 2, 'only explicit repair permits another component check');
  } finally { await h.close(); }
});

test('the real repair control resets the stopped manager through the existing system repair action', async t => {
  const h = await harness(t, 'initialize-code:invalid_subject_id');
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
  const h = await harness(t, 'initialize-code:invalid_subject_id');
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

test('confirmed ENOEXEC permits zero automatic retries', async t => {
  const h = await harness(t, 'spawn-code:ENOEXEC');
  try {
    await h.manager.ingest(owner, source); await delay(4500);
    for (let i = 0; i < 3; i++) { await h.manager.status(owner); await h.manager.flushPending(owner); }
    assert.equal(h.starts(), 1); assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
  } finally { await h.close(); }
});

for (const code of ['internal_error', 'dsh_boundary_error', 'unknown_error', '']) test(`Core error outside the allowlist (${code || 'no code'}) stops after three attempts`, async t => {
  const h = await harness(t, `initialize-code:${code}`);
  try {
    await h.manager.ingest(owner, source); await until(async () => h.starts() >= 3);
    assert.equal((await h.manager.status(owner)).state, 'unavailable'); await delay(4500);
    assert.equal(h.starts(), 3);
    const pending = await h.manager.pendingStatus(owner);
    assert.equal(pending.pendingBoundaryCount, 1); assert.equal(pending.blockedBoundaryCount, 0); assert.equal(pending.discardedBoundaryCount, 0);
  } finally { await h.close(); }
});

for (const code of ['EACCES', 'EPERM', 'UNKNOWN']) test(`OS ${code} is not proof of a permanently unusable interpreter`, async t => {
  const h = await harness(t, `spawn-code:${code}`);
  try {
    await h.manager.ingest(owner, source); await until(async () => h.starts() >= 3);
    assert.equal((await h.manager.status(owner)).state, 'unavailable'); await delay(4500);
    assert.equal(h.starts(), 3); assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
  } finally { await h.close(); }
});

for (const [operation, code] of [['readFile', 'EMFILE'], ['readFile', 'EACCES'], ['lstat', 'EPERM'], ['readdir', 'EBUSY']])
test(`${operation} ${code} is a temporary check failure and stops after three checks`, async t => {
  const h = await harness(t, 'ready', checkedFixture);
  const original = fsPromises[operation]; let checks = 0;
  const target = operation === 'readdir' ? h.config.verification.directory : h.config.python;
  const mocked = t.mock.method(fsPromises, operation, (file, ...args) => {
    if (String(file) === target) { checks++; return Promise.reject(Object.assign(new Error('Synthetic component check failure'), { code })); }
    return original(file, ...args);
  });
  syncBuiltinESMExports();
  try {
    await h.manager.ingest(owner, source); await until(async () => checks >= 3);
    const status = await h.manager.status(owner);
    assert.equal(status.state, 'unavailable'); assert.equal(status.reasonCode, 'MEMORY_COMPONENT_CHECK_UNAVAILABLE');
    await delay(4500); assert.equal(checks, 3); assert.equal(h.starts(), 0);
    const pending = await h.manager.pendingStatus(owner);
    assert.equal(pending.pendingBoundaryCount, 1); assert.equal(pending.blockedBoundaryCount, 0); assert.equal(pending.discardedBoundaryCount, 0);
  } finally { try { await h.close(); } finally { mocked.mock.restore(); syncBuiltinESMExports(); } }
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
    for (const reasonCode of ['unknown_future_failure', undefined]) {
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
    assert.equal((await h.manager.status(owner)).reasonCode, 'MEMORY_COMPONENT_HASH_MISMATCH');
    assert.equal((await h.manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    await writeFile(component, original); await h.manager.repairRuntime(owner); await assertDelivered(h);
    assert.equal(h.starts(), 2);
  } finally { await h.close(); }
});
