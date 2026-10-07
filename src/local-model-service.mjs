import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUserModelSwitcherKey } from './local-model-config.mjs';

export async function loadLocalModelConfig(file) {
  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('LOCAL_MODEL_CONFIGURATION_INVALID'); }
  try {
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        !url.pathname.replace(/\/+$/, '').endsWith('/v1') ||
        config.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv) ||
        config.restartPath !== undefined && config.restartPath !== '/switch/restart') throw new Error();
  } catch { throw new Error('LOCAL_MODEL_CONFIGURATION_INVALID'); }
  return config;
}

/** Observe existing ModelSwitcher; its lease-aware maintenance owns processes and parameters. */
export function createLocalModelController(configFile, { fetchImpl = fetch,
  credentialFor = async config => config.apiKeyEnv === 'MODEL_SWITCH_UNIFIED_KEY'
    ? readUserModelSwitcherKey() : config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined } = {}) {
  configFile = resolve(configFile);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configRelative = relative(packageRoot, configFile);
  if (!configRelative || !configRelative.startsWith(`..${sep}`) && !isAbsolute(configRelative)) {
    throw new Error('LOCAL_MODEL_CONFIG_MUST_BE_OUTSIDE_REPOSITORY');
  }
  let mutation = Promise.resolve();
  const empty = (state, lastError = null) => ({ state, version: null, contextWindow: null,
    slots: null, currentModelId: null, lastSwitch: null, canRestart: false, lastError });
  const endpoint = (config, path) => new URL(config.baseUrl.replace(/\/?v1\/?$/, path));
  async function request(config, path, method = 'GET') {
    const key = await credentialFor(config);
    if (config.apiKeyEnv && !key) throw new Error('LOCAL_MODEL_CREDENTIAL_UNAVAILABLE');
    const response = await fetchImpl(endpoint(config, path), { method,
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(method === 'POST' ? 300_000 : 2000) });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    return response.json();
  }
  async function status() {
    let cfg;
    try { cfg = await loadLocalModelConfig(configFile); }
    catch { return empty('unavailable', 'LOCAL_MODEL_CONFIGURATION_INVALID'); }
    if (!cfg) return empty('unconfigured');
    try {
      const switcher = await request(cfg, '/switch/status');
      // Never expose switcher state, model paths, catalog or script output.
      const currentModelId = switcher.currentModelId ?? null;
      const lastSwitch = switcher.lastSwitch ? {
        action: switcher.lastSwitch.action ?? 'switch', modelId: switcher.lastSwitch.dshModelId ?? null,
        at: switcher.lastSwitch.at ?? null, ok: switcher.lastSwitch.ok === true,
      } : null;
      const observed = { currentModelId, lastSwitch, canRestart: !!cfg.restartPath && !!currentModelId };
      let props;
      try { props = await request(cfg, '/props'); }
      catch { return { ...empty(switcher.switching ? 'starting' : 'unavailable', 'MODEL_UNAVAILABLE'), ...observed }; }
      const contextWindow = props.default_generation_settings?.n_ctx ?? props.n_ctx;
      const slots = props.total_slots;
      if (!Number.isSafeInteger(contextWindow) || contextWindow < 1 || !Number.isSafeInteger(slots) || slots < 1) {
        return { ...empty('unavailable', 'MODEL_PROPS_INVALID'), ...observed };
      }
      return { state: switcher.switching ? 'starting' : 'ready',
        version: typeof props.build_info === 'string' ? props.build_info : null,
        contextWindow, slots, ...observed, lastError: null };
    } catch { return empty('unavailable', 'MODEL_UNAVAILABLE'); }
  }
  return { status, async control(action) {
    const work = mutation.catch(() => {}).then(async () => {
      if (action !== 'restart') throw new Error('LOCAL_MODEL_ACTION_INVALID');
      const cfg = await loadLocalModelConfig(configFile);
      if (!cfg?.restartPath) throw Object.assign(new Error('unconfigured'), { code: 'CAPABILITY_UNAVAILABLE' });
      try {
        const result = await request(cfg, cfg.restartPath, 'POST');
        if (result.ok !== true || result.restarted !== true) throw new Error();
      } catch { throw Object.assign(new Error('MODEL_RESTART_FAILED'), { code: 'MODEL_RESTART_FAILED' }); }
      return status();
    });
    mutation = work; return work;
  } };
}
