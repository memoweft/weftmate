import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const invalid = () => Object.assign(new Error('MEMORY_CONFIGURATION_INVALID'), {
  code: 'MEMORY_CONFIGURATION_INVALID',
});

/** Read a deployment-owned path reference; the model key remains in safeStorage. */
export async function loadPersonalMemoryConfig(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw invalid();
  const info = await lstat(file).catch(() => { throw invalid(); });
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > 16 * 1024) throw invalid();
  let value;
  try { value = JSON.parse(await readFile(file, 'utf8')); } catch { throw invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'authRef,baseUrl,model,python,pythonPath' ||
      typeof value.python !== 'string' || !path.isAbsolute(value.python) ||
      typeof value.pythonPath !== 'string' || !path.isAbsolute(value.pythonPath) ||
      value.baseUrl !== 'http://127.0.0.1:8081/v1' ||
      value.model !== '@current' ||
      value.authRef !== 'personal-local-occamy-miniplus-v21') {
    throw invalid();
  }
  const [python, bridge] = await Promise.all([
    lstat(value.python).catch(() => null),
    lstat(path.join(value.pythonPath, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'))
      .catch(() => null),
  ]);
  if (!python?.isFile() || python.isSymbolicLink() || !bridge?.isFile() || bridge.isSymbolicLink()) throw invalid();
  return Object.freeze({ python: path.resolve(value.python), pythonPath: path.resolve(value.pythonPath),
    baseUrl: value.baseUrl, model: value.model, authRef: value.authRef });
}
