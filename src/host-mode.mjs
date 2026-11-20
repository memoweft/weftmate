/** Personal host is an Electron main-process mode, not a separate runtime. */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const PERSONAL_HOST_MARKER = '.weftmate-personal-host-profile.json';
export const PERSONAL_HOST_MARKER_CONTENT = { schemaVersion: 1, purpose: 'isolated-personal-host' };

export function validatePersonalHostProfile(candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) {
    throw new Error('personal-host requires an absolute marked userData directory');
  }
  let canonical, marker;
  try {
    canonical = realpathSync(candidate);
    if (!statSync(canonical).isDirectory()) throw new Error('not a directory');
    marker = JSON.parse(readFileSync(join(canonical, PERSONAL_HOST_MARKER), 'utf8'));
  } catch {
    throw new Error('personal-host requires an existing isolated profile marker');
  }
  if (marker?.schemaVersion !== PERSONAL_HOST_MARKER_CONTENT.schemaVersion
    || marker?.purpose !== PERSONAL_HOST_MARKER_CONTENT.purpose) {
    throw new Error('personal-host profile marker is invalid');
  }
  return canonical;
}

export function observeHostChild(child, input, onFinish) {
  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    input?.pause?.();
    onFinish(result);
  };
  child.once('error', (error) => finish({ error }));
  child.once('close', (code, signal) => finish({ code, signal }));
}

export function hostRuntimeState(lifecycle, origin) {
  if (lifecycle === 'stopping' || lifecycle === 'stopped') return { state: lifecycle, origin: null };
  return { state: origin ? 'listening' : 'unavailable', origin: origin ?? null };
}
export function personalHostRequested(argv) {
  return argv.includes('--personal-host');
}

/** Select the normal cwd for new personal-host sessions; policies remain unchanged. */
export function personalWorkspaceDirectory(argv, hostMode, userData) {
  const values = argv.filter((arg) => arg.startsWith('--workspace-dir'));
  if (!values.length) return join(userData, 'workspace');
  if (!hostMode || values.length !== 1 || !values[0].startsWith('--workspace-dir=')) {
    throw new Error('workspace directory requires one explicit personal-host option');
  }
  const requested = values[0].slice('--workspace-dir='.length);
  if (!isAbsolute(requested)) throw new Error('workspace directory must be absolute');
  try {
    const canonical = realpathSync(requested);
    if (!statSync(canonical).isDirectory()) throw new Error('not a directory');
    return canonical;
  } catch {
    throw new Error('workspace directory must be an existing directory');
  }
}

export function personalAccessPort(argv, hostMode) {
  const values = argv.filter((arg) => arg.startsWith('--access-port'))
  if (!values.length) return null
  if (!hostMode || values.length !== 1 || !/^--access-port=(?:0|[1-9]\d{0,4})$/.test(values[0])) {
    throw new Error('personal access requires one valid --access-port in personal-host mode')
  }
  const port = Number(values[0].slice('--access-port='.length))
  if (port > 65535) throw new Error('personal access port is out of range')
  return port
}

/** Explicit public TLS origin; the managed HTTP socket still stays on 127.0.0.1. */
export function personalPublicOrigin(argv, hostMode, accessPort) {
  const values = argv.filter((arg) => arg.startsWith('--public-origin'));
  const trustFlags = argv.filter((arg) => arg === '--trust-loopback-proxy');
  if (!values.length && !trustFlags.length) return null;
  if (!hostMode || accessPort === null || values.length !== 1 || trustFlags.length !== 1 ||
      !values[0].startsWith('--public-origin=')) throw new Error('public origin requires personal access and explicit loopback proxy trust');
  const text = values[0].slice('--public-origin='.length);
  let value;
  try { value = new URL(text); } catch { throw new Error('public origin must be an exact HTTPS origin'); }
  if (value.origin !== text || value.protocol !== 'https:' || value.username || value.password ||
      value.pathname !== '/' || value.search || value.hash || !value.hostname) {
    throw new Error('public origin must be an exact HTTPS origin');
  }
  return value.origin;
}

export function assertLoopbackOrigin(origin) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('managed DSH did not publish a valid origin'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('managed DSH origin must be an exact loopback HTTP origin');
  }
  return url.origin;
}

export function assertManagedDshUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('managed DSH did not publish a valid origin'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.hash
    || (url.search && !/^\?token=[^&#\s]+$/.test(url.search))) {
    throw new Error('managed DSH origin must be an exact loopback HTTP origin');
  }
  return url.origin;
}

const runtimeCookies = new Map();

export async function fetchRuntimeWithCookie(launchUrl, path, init = {}) {
  const parsed = new URL(launchUrl);
  let cookie;
  if (parsed.searchParams.has('token')) {
    let pending = runtimeCookies.get(launchUrl);
    if (!pending) {
      pending = (async () => {
        const ex = await fetch(launchUrl, { redirect: 'manual' });
        const raw = ex.headers.get('set-cookie');
        return raw ? raw.split(';', 1)[0] : '';
      })().catch((error) => { runtimeCookies.delete(launchUrl); throw error; });
      runtimeCookies.set(launchUrl, pending);
    }
    cookie = await pending;
  }
  return fetch(new URL(path, parsed.origin), {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
}

export async function startPersonalHost({ startRuntime, migrateRoutes, hydrateBindings, log }) {
  let launchUrl = await startRuntime();
  assertManagedDshUrl(launchUrl);
  launchUrl = await migrateRoutes(launchUrl);
  const origin = assertManagedDshUrl(launchUrl);
  await hydrateBindings();
  await log(`[weftmate] ✓ personal-host ready origin=${origin}`);
  return origin;
}
