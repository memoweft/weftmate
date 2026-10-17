import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadBundledMemoryConfig } from './bundled-runtime.mjs';

const invalid = () => Object.assign(new Error('MEMORY_CONFIGURATION_INVALID'), {
  code: 'MEMORY_CONFIGURATION_INVALID',
});

/** Explicit deployments keep their existing strict startup behavior. Automatic
 * installation failures disable only memory, never ordinary chat or its data. */
export async function loadDesktopMemoryConfig({ explicitPath, directory, manifestSha256, mode }) {
  if (explicitPath) return { config: await loadPersonalMemoryConfig(explicitPath) };
  try { return { config: await loadBundledMemoryConfig({ directory, manifestSha256, mode }) }; }
  catch (cause) { return { config: null, failureCode: cause.code }; }
}

/** Session usage attribution is not a change of the processing model. */
export function processingRouteIdentity(baseUrl) {
  const url = new URL(baseUrl);
  const scoped = url.protocol === 'http:' && url.hostname === '127.0.0.1'
    ? url.pathname.match(/^(.*\/inference\/[^/]+\/scope\/[^/]+\/)[^/]+(\/v1)$/) : null;
  if (!scoped) return { baseUrl, sessionScoped: false };
  url.pathname = `${scoped[1]}none${scoped[2]}`;
  return { baseUrl: url.href.replace(/\/$/, ''), sessionScoped: true };
}

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
      typeof value.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/v1$/.test(value.baseUrl) ||
      value.model !== '@current' ||
      typeof value.authRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.authRef)) {
    throw invalid();
  }
  const [python, bridge] = await Promise.all([
    lstat(value.python).catch(() => null),
    lstat(path.join(value.pythonPath, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'))
      .catch(() => null),
  ]);
  // A macOS venv normally symlinks its interpreter. Preserve that executable
  // path so Python still discovers the venv's dependencies; validate its final
  // target instead of replacing the path with the base interpreter.
  const interpreter = process.platform === 'darwin' && python?.isSymbolicLink()
    ? await realpath(value.python).then(file => lstat(file)).catch(() => null) : python;
  if (!interpreter?.isFile() || interpreter.isSymbolicLink() || !bridge?.isFile() || bridge.isSymbolicLink()) throw invalid();
  return Object.freeze({ python: path.resolve(value.python), pythonPath: path.resolve(value.pythonPath),
    baseUrl: value.baseUrl, model: value.model, authRef: value.authRef });
}
