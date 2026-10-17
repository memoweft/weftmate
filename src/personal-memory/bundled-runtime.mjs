import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { MemoWeftRpc } from './rpc.mjs';

const fail = code => Object.assign(new Error(code), { code });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invocation = ['-B', '-m', 'memoweft.integrations.dsh_bridge'];

// An unavailable installation still needs the same manager/outbox so repair
// can resume it. The factory validates these paths before any process starts.
export function bundledMemoryConfiguration({ directory, manifestSha256, mode }) {
  const root = resolve(directory);
  return Object.freeze({ python: join(root, 'python', 'python.exe'), pythonPath: join(root, 'core', 'src'),
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'bundled-current',
    semanticCacheDirectory: mode === 'full' ? join(root, 'models') : null,
    verification: { directory: root, manifestSha256, mode } });
}

/** The application metadata pins the manifest verified by the package builder.
 * Nothing in this check executes Python, downloads files or writes user data. */
export async function loadBundledMemoryConfig({ directory, manifestSha256, mode }) {
  const root = resolve(directory);
  try {
    if (!/^[a-f0-9]{64}$/.test(manifestSha256 ?? '') || !['base', 'full'].includes(mode))
      throw fail('MEMORY_COMPONENT_INVALID');
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw fail('MEMORY_COMPONENT_INVALID');
    const manifestPath = join(root, 'MEMORY-RUNTIME.json');
    const manifestInfo = await lstat(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw fail('MEMORY_COMPONENT_INVALID');
    const bytes = await readFile(manifestPath);
    if (digest(bytes) !== manifestSha256) throw fail('MEMORY_COMPONENT_HASH_MISMATCH');
    const manifest = JSON.parse(bytes);
    if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32-x64' || manifest.mode !== mode ||
        manifest.invocation?.executable !== 'python/python.exe' ||
        JSON.stringify(manifest.invocation?.args) !== JSON.stringify(invocation))
      throw fail('MEMORY_COMPONENT_INVALID');
    const found = new Set();
    async function visit(directory) {
      for (const entry of await readdir(directory)) {
        const file = join(directory, entry), info = await lstat(file);
        if (info.isSymbolicLink()) throw fail('MEMORY_COMPONENT_INVALID');
        if (info.isDirectory()) { await visit(file); continue; }
        const name = relative(root, file).replaceAll('\\', '/');
        if (name === 'MEMORY-RUNTIME.json') continue;
        const expected = manifest.files?.[name];
        if (!info.isFile() || !expected) throw fail('MEMORY_COMPONENT_INVALID');
        const content = await readFile(file);
        if (digest(content) !== expected.sha256) throw fail('MEMORY_COMPONENT_HASH_MISMATCH');
        if (expected.bytes !== info.size) throw fail('MEMORY_COMPONENT_INVALID');
        found.add(name);
      }
    }
    await visit(root);
    for (const name of Object.keys(manifest.files ?? {})) if (!found.has(name)) {
      if (isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) throw fail('MEMORY_COMPONENT_INVALID');
      // Obtain ENOENT from the filesystem; a list/metadata discrepancy alone
      // is not sufficient evidence to disable retries permanently.
      await lstat(join(root, name));
    }
    if (found.size !== Object.keys(manifest.files ?? {}).length ||
        !found.has('python/python.exe') || !found.has('core/src/memoweft/integrations/dsh_bridge/__main__.py'))
      throw fail('MEMORY_COMPONENT_INVALID');
    return bundledMemoryConfiguration({ directory: root, manifestSha256, mode });
  } catch (cause) {
    if (cause?.code === 'ENOENT') throw fail('MEMORY_COMPONENT_MISSING');
    if (['MEMORY_COMPONENT_HASH_MISMATCH', 'MEMORY_COMPONENT_INVALID'].includes(cause?.code)) throw cause;
    throw fail('MEMORY_COMPONENT_CHECK_UNAVAILABLE');
  }
}

/** Use the manager's existing factory seam; preserve explicit configurations. */
export function bundledMemoryRpcFactory(config, onFailure = () => {}) {
  const observe = cause => {
    try { onFailure(/^[A-Za-z_]{2,80}$/.test(cause?.code ?? '') ? cause.code : 'MEMORY_UNAVAILABLE'); } catch { /* Observation only. */ }
  };
  const factory = options => {
    const rpc = new MemoWeftRpc({ ...options, pythonArgs: invocation,
      env: { ...options.env, MEMOWEFT_SEMANTIC_CACHE_DIR: config.semanticCacheDirectory ?? '' } });
    const request = rpc.request.bind(rpc);
    rpc.request = async (...args) => {
      try { return await request(...args); }
      catch (cause) {
        observe(cause);
        throw cause;
      }
    };
    return rpc;
  };
  // The manager owns the retry budget and durable pending sources. Explicit
  // deployments retain their existing lifecycle without this opt-in.
  factory.managedRuntime = true;
  factory.validate = config.verification ? async () => {
    try { return await loadBundledMemoryConfig(config.verification); }
    catch (cause) { observe(cause); throw cause; }
  } : null;
  return factory;
}
