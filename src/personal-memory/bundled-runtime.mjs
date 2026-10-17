import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { MemoWeftRpc } from './rpc.mjs';

const fail = code => Object.assign(new Error(code), { code });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invocation = ['-B', '-m', 'memoweft.integrations.dsh_bridge'];

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
    if (digest(bytes) !== manifestSha256) throw fail('MEMORY_COMPONENT_INVALID');
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
        if (!info.isFile() || !expected || expected.bytes !== info.size ||
            digest(await readFile(file)) !== expected.sha256) throw fail('MEMORY_COMPONENT_INVALID');
        found.add(name);
      }
    }
    await visit(root);
    if (found.size !== Object.keys(manifest.files ?? {}).length ||
        !found.has('python/python.exe') || !found.has('core/src/memoweft/integrations/dsh_bridge/__main__.py'))
      throw fail('MEMORY_COMPONENT_INVALID');
    return Object.freeze({ python: join(root, 'python', 'python.exe'), pythonPath: join(root, 'core', 'src'),
      baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'bundled-current',
      semanticCacheDirectory: mode === 'full' ? join(root, 'models') : null });
  } catch (cause) {
    throw fail(cause?.code === 'ENOENT' ? 'MEMORY_COMPONENT_MISSING' : 'MEMORY_COMPONENT_INVALID');
  }
}

/** Use the manager's existing factory seam; preserve explicit configurations. */
export function bundledMemoryRpcFactory(config, onFailure = () => {}) {
  return options => {
    const rpc = new MemoWeftRpc({ ...options, pythonArgs: invocation,
      env: { ...options.env, MEMOWEFT_SEMANTIC_CACHE_DIR: config.semanticCacheDirectory ?? '' } });
    const request = rpc.request.bind(rpc);
    rpc.request = async (...args) => {
      try { return await request(...args); }
      catch (cause) {
        try { onFailure(/^[A-Z_]{2,80}$/.test(cause?.code ?? '') ? cause.code : 'MEMORY_UNAVAILABLE'); } catch { /* Observation only. */ }
        throw cause;
      }
    };
    return rpc;
  };
}
