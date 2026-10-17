import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyDesktopConfig, saveDesktopConfig, desktopConfigPath } from '../src/desktop-config.mjs';
import { memoryRuntimeFixture } from './helpers/memory-runtime-fixture.mjs';
import { loadDesktopMemoryConfig } from '../src/personal-memory/config.mjs';
import { bundledMemoryRpcFactory } from '../src/personal-memory/bundled-runtime.mjs';
import { bundledMemoryConfiguration } from '../src/personal-memory/bundled-runtime.mjs';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';

const owner = 'owner-00000000-0000-4000-8000-000000000001';
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
const metadata = async directory => ({ directory, mode: 'base', manifestSha256:
  createHash('sha256').update(await readFile(join(directory, 'MEMORY-RUNTIME.json'))).digest('hex') });

test('fresh packaged Windows startup selects its bundled memory without an explicit configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-memory-auto-'));
  try {
    const resourcesPath = join(root, 'installation', 'resources');
    await mkdir(resourcesPath, { recursive: true });
    await memoryRuntimeFixture(join(resourcesPath, 'memory-runtime'));
    const startup = applyDesktopConfig({ appData: join(root, 'user'), packaged: true,
      platform: 'win32', resourcesPath, argv: ['app'], env: {} });
    assert.equal(startup.memoryRuntimeDirectory, join(resourcesPath, 'memory-runtime'),
      'a fresh installation must select its own memory runtime');
    const { config } = await loadDesktopMemoryConfig(await metadata(startup.memoryRuntimeDirectory));
    assert.equal(config.python, join(resourcesPath, 'memory-runtime/python/python.exe'));
    assert.equal(config.pythonPath, join(resourcesPath, 'memory-runtime/core/src'));
    assert.equal(startup.config.personalMemoryConfig, undefined, 'automatic paths must not become explicit overrides');
    let initializedHome;
    const manager = createPersonalMemoryManager({ ...config, enabled: true,
      root: join(startup.config.dataDirectory, 'personal-access'), credential: () => 'synthetic',
      rpcFactory: options => {
        const transport = bundledMemoryRpcFactory(config)(options);
        assert.equal(transport.python, config.python);
        assert.deepEqual(transport.pythonArgs, ['-B', '-m', 'memoweft.integrations.dsh_bridge']);
        return { child: {}, async close() {}, async request(method, params = {}) {
          if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
          if (method === 'initialize') {
            initializedHome = params.dsh_home;
            return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft/memoweft.sqlite3') },
              capabilities: { subject_id: owner, methods, services: { command: { operations: [] } } } };
          }
          if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
          return { world_revision: 0 };
        } };
      } });
    try {
      assert.equal((await manager.status(owner)).state, 'ready');
      assert.equal(initializedHome, join(startup.config.dataDirectory, 'personal-access/accounts', owner, 'memory-home'));
      assert.ok(!initializedHome.startsWith(resourcesPath));
      const retained = join(initializedHome, 'memoweft', 'synthetic-memory.txt');
      await writeFile(retained, 'synthetic retained fact');
      const upgraded = applyDesktopConfig({ appData: join(root, 'user'), packaged: true, platform: 'win32',
        resourcesPath: join(root, 'upgraded/resources'), argv: ['app'], env: {} });
      assert.equal(upgraded.memoryRuntimeDirectory, join(root, 'upgraded/resources/memory-runtime'));
      assert.equal(upgraded.config.dataDirectory, startup.config.dataDirectory);
      assert.equal(await readFile(retained, 'utf8'), 'synthetic retained fact');
    } finally { await manager.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit file and CLI configurations keep their bytes and take precedence; macOS and source mode stay unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-memory-explicit-'));
  try {
    const configFile = desktopConfigPath(root, 'win32'), explicitPath = join(root, 'existing-memory.json');
    const runtime = join(root, 'original-runtime'); await memoryRuntimeFixture(runtime);
    const value = { python: join(runtime, 'python/python.exe'), pythonPath: join(runtime, 'core/src'),
      baseUrl: 'http://127.0.0.1:12345/v1', model: '@current', authRef: 'synthetic-existing' };
    await writeFile(explicitPath, JSON.stringify(value));
    saveDesktopConfig(configFile, { schemaVersion: 1, dataDirectory: join(root, 'data'), accessPort: 0,
      personalMemoryConfig: explicitPath, updates: { channel: 'stable' } });
    const before = await readFile(configFile, 'utf8');
    const argv = ['app'];
    const startup = applyDesktopConfig({ appData: root, packaged: true, platform: 'win32', resourcesPath: join(root, 'missing'), argv, env: {} });
    assert.equal(startup.memoryRuntimeDirectory, null);
    assert.ok(argv.includes(`--personal-memory-config=${explicitPath}`));
    assert.deepEqual((await loadDesktopMemoryConfig({ explicitPath, directory: join(root, 'missing') })).config, value);
    assert.equal(await readFile(configFile, 'utf8'), before);
    assert.equal(await readFile(explicitPath, 'utf8'), JSON.stringify(value));
    const cli = applyDesktopConfig({ appData: join(root, 'cli'), packaged: true, platform: 'win32', resourcesPath: runtime,
      argv: ['app', `--personal-memory-config=${explicitPath}`], env: {} });
    assert.equal(cli.memoryRuntimeDirectory, null);
    assert.equal(applyDesktopConfig({ appData: join(root, 'source'), packaged: false, argv: ['app'], env: {} }), null);
    assert.equal(applyDesktopConfig({ appData: join(root, 'mac'), packaged: true, platform: 'darwin', resourcesPath: runtime,
      argv: ['app'], env: {} }).memoryRuntimeDirectory, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing, altered and replaced components fail closed without changing user data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-memory-corrupt-'));
  try {
    const runtime = join(root, 'runtime'); await memoryRuntimeFixture(runtime);
    const options = await metadata(runtime), retained = join(root, 'user-memory');
    await writeFile(retained, 'synthetic retained fact');
    await writeFile(join(runtime, 'python/python.exe'), 'corrupt');
    assert.deepEqual(await loadDesktopMemoryConfig(options), { config: null, failureCode: 'MEMORY_COMPONENT_HASH_MISMATCH' });
    await memoryRuntimeFixture(runtime);
    await writeFile(join(runtime, 'MEMORY-RUNTIME.json'), '{}');
    assert.equal((await loadDesktopMemoryConfig(options)).failureCode, 'MEMORY_COMPONENT_HASH_MISMATCH');
    assert.equal((await loadDesktopMemoryConfig({ ...options, directory: join(root, 'absent') })).failureCode, 'MEMORY_COMPONENT_MISSING');
    assert.equal(await readFile(retained, 'utf8'), 'synthetic retained fact');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Python launch failure is observed without leaking content or changing its failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-memory-start-'));
  try {
    const events = [];
    const rpc = bundledMemoryRpcFactory({ semanticCacheDirectory: join(root, 'models') }, code => {
      events.push(code); throw new Error('synthetic observer failure');
    })({ python: join(root, 'missing-python.exe'), pythonPath: root, env: { MEMOWEFT_BASE_URL: 'http://127.0.0.1:1/v1' } });
    assert.equal(rpc.env.MEMOWEFT_SEMANTIC_CACHE_DIR, join(root, 'models'));
    try { await assert.rejects(rpc.request('capabilities'), { code: 'MEMORY_PROCESS_UNAVAILABLE' }); }
    finally { await rpc.close(); }
    assert.deepEqual(events, ['MEMORY_PROCESS_UNAVAILABLE', 'MEMORY_PROCESS_UNAVAILABLE'],
      'capabilities and the existing close/shutdown attempt retain their failure');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('automatic configuration defers its first component check to the manager budget and observes failures safely', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-memory-first-check-'));
  try {
    const config = bundledMemoryConfiguration({ directory: join(root, 'absent'), mode: 'base', manifestSha256: 'a'.repeat(64) });
    const observed = [];
    const factory = bundledMemoryRpcFactory(config, code => { observed.push(code); throw Error('Synthetic observer failure'); });
    let checks = 0;
    const validate = factory.validate;
    factory.validate = async () => { checks++; return validate(); };
    assert.equal(checks, 0); assert.deepEqual(observed, []);
    const manager = createPersonalMemoryManager({ ...config, root: join(root, 'data'), enabled: true,
      credential: () => 'synthetic', rpcFactory: factory });
    try {
      await manager.ingest(owner, { event_id: 'synthetic-missing-component', parent_session_id: 'synthetic' });
      for (let i = 0; i < 4; i++) await manager.status(owner);
      assert.equal(checks, 1); assert.deepEqual(observed, ['MEMORY_COMPONENT_MISSING']);
      assert.equal((await manager.pendingStatus(owner)).pendingBoundaryCount, 1);
    } finally { await manager.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
