import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from './host-mode.mjs';

export const desktopConfigPath = appData => join(appData, 'WeftMate', 'desktop-config.json');
export const productionEnvironment = Object.freeze({
  cloudIssuer: 'WEFTMATE_CLOUD_ISSUER', cloudDesktopClientId: 'WEFTMATE_CLOUD_DESKTOP_CLIENT_ID',
  cloudDesktopRedirectUri: 'WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI', cloudWebClientId: 'WEFTMATE_CLOUD_WEB_CLIENT_ID',
  relayEnabled: 'WEFTMATE_RELAY_ENABLED', acmeEnabled: 'WEFTMATE_RELAY_ACME_ENABLED',
  acmeDirectoryUrl: 'WEFTMATE_ACME_DIRECTORY_URL', acmeEmail: 'WEFTMATE_ACME_EMAIL',
  frpcFile: 'WEFTMATE_FRPC_FILE', relayCaFile: 'WEFTMATE_RELAY_CA_FILE', relayCertFile: 'WEFTMATE_RELAY_CERT_FILE',
});
export function validateDesktopConfig(value) {
  if (!value || value.schemaVersion !== 1 || !isAbsolute(value.dataDirectory || '') ||
    !Number.isInteger(value.accessPort) || value.accessPort < 0 || value.accessPort > 65535 ||
    !['stable', 'preview'].includes(value.updates?.channel)) throw new Error('DESKTOP_CONFIGURATION_INVALID');
  for (const key of ['mobileUiDirectory', 'personalMemoryConfig', 'localModelConfig', 'androidPackagePath', 'workspaceDirectory'])
    if (value[key] && !isAbsolute(value[key])) throw new Error('DESKTOP_CONFIGURATION_PATH_INVALID');
  if (value.publicOrigin) {
    const url = new URL(value.publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== value.publicOrigin || url.username || url.password || !value.trustLoopbackProxy)
      throw new Error('DESKTOP_PUBLIC_ORIGIN_INVALID');
  }
  for (const [key, item] of Object.entries(value.production || {})) {
    if (!(key in productionEnvironment) || !['string', 'boolean'].includes(typeof item)) throw new Error('DESKTOP_PRODUCTION_CONFIGURATION_INVALID');
  }
  if (value.updates.baseUrl) {
    const url = new URL(value.updates.baseUrl);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' ||
      url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('DESKTOP_UPDATE_SOURCE_INVALID');
  }
  return value;
}
export function saveDesktopConfig(file, value) {
  validateDesktopConfig(value);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
}
export function applyDesktopConfig({ appData, argv = process.argv, env = process.env, packaged = false }) {
  const explicit = argv.find(arg => arg.startsWith('--desktop-config='))?.slice('--desktop-config='.length);
  const file = resolve(explicit || desktopConfigPath(appData));
  if (!explicit && !packaged) return null;
  if (!existsSync(file)) {
    if (explicit) throw new Error('DESKTOP_CONFIGURATION_MISSING');
    const dataDirectory = join(appData, 'com.memoweft.weftmate');
    mkdirSync(dataDirectory, { recursive: true });
    // Only a newly created default profile may receive a marker automatically.
    if (!existsSync(join(dataDirectory, PERSONAL_HOST_MARKER)))
      writeFileSync(join(dataDirectory, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT), { flag: 'wx' });
    saveDesktopConfig(file, { schemaVersion: 1, dataDirectory, accessPort: 18186,
      production: { cloudIssuer: 'https://api.weftmate.com/personal/v1/cloud/oidc', cloudDesktopClientId: 'weftmate-desktop',
        cloudDesktopRedirectUri: 'http://127.0.0.1:18186/personal/v1/ui/', cloudWebClientId: 'weftmate-desktop', relayEnabled: true,
        acmeEnabled: true, acmeDirectoryUrl: 'https://acme-v02.api.letsencrypt.org/directory' },
      updates: { channel: 'stable', baseUrl: 'https://weftmate.com/updates/windows/x64/' } });
  }
  const config = validateDesktopConfig(JSON.parse(readFileSync(file, 'utf8')));
  const options = { 'user-data-dir': config.dataDirectory, 'access-port': config.accessPort,
    'public-origin': config.publicOrigin, 'mobile-ui-dir': config.mobileUiDirectory, 'personal-memory-config': config.personalMemoryConfig,
    'local-model-config': config.localModelConfig, 'android-package-path': config.androidPackagePath, 'workspace-dir': config.workspaceDirectory };
  for (const [name, value] of Object.entries(options)) if (value !== undefined && value !== null && value !== '' && !argv.some(arg => arg.startsWith(`--${name}=`)))
    argv.push(`--${name}=${value}`);
  if (config.trustLoopbackProxy && !argv.includes('--trust-loopback-proxy')) argv.push('--trust-loopback-proxy');
  if (explicit === undefined) argv.push(`--desktop-config=${file}`);
  for (const [key, name] of Object.entries(productionEnvironment)) if (config.production?.[key] !== undefined) env[name] = String(config.production[key]);
  configureUpdateEnvironment(config, env);
  return { file, config };
}
export function configureUpdateEnvironment(config, env = process.env) {
  env.WEFTMATE_UPDATE_CHANNEL = config.updates.channel;
  env.WEFTMATE_UPDATES_DISABLED = config.updates.baseUrl ? 'false' : 'true';
  if (config.updates.baseUrl) {
    const feed = new URL(`${config.updates.channel}/`, config.updates.baseUrl.replace(/\/?$/, '/')).href;
    env.WEFTMATE_UPDATE_FEED = feed;
    env.WEFTMATE_APP_MANIFEST_FEED = feed;
    env.WEFTMATE_UI_UPDATE_FEED = new URL('manifest-ui.json', feed).href;
  } else for (const name of ['WEFTMATE_UPDATE_FEED', 'WEFTMATE_APP_MANIFEST_FEED', 'WEFTMATE_UI_UPDATE_FEED']) delete env[name];
}
