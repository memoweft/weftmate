/** Launch the existing Electron host with an explicitly isolated profile. */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureMemoWeft } from '../dogfood/memoweft-config.mjs';
import { assertLoopbackOrigin, observeHostChild, personalPublicOrigin, personalWorkspaceDirectory, PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT, validatePersonalHostProfile } from '../src/host-mode.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../src/private-host-storage.mjs';
import { loadPersonalMemoryConfig } from '../src/personal-memory/config.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
if (dryRun) args.splice(args.indexOf('--dry-run'), 1);
const trustFlags = args.filter((value) => value === '--trust-loopback-proxy');
if (trustFlags.length > 1) { console.error('[personal-host] duplicate proxy trust option'); process.exit(2); }
if (trustFlags.length === 1) args.splice(args.indexOf('--trust-loopback-proxy'), 1);
let requestedProfile = null;
let memoryConfig = null;
let accountMemoryConfig = null;
let accessPort = null;
let publicOrigin = null;
let androidPackagePath = null;
let mobileUiDir = null;
let requestedWorkspaceDir = null;
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) { console.error(`[personal-host] ${flag} requires a value`); process.exit(2); }
  if (flag === '--user-data-dir' && requestedProfile === null) requestedProfile = value;
  else if (flag === '--memoweft-config' && memoryConfig === null) memoryConfig = value;
  else if (flag === '--personal-memory-config' && accountMemoryConfig === null) accountMemoryConfig = value;
  else if (flag === '--access-port' && accessPort === null && /^(?:0|[1-9]\d{0,4})$/.test(value) && Number(value) <= 65535) accessPort = Number(value);
  else if (flag === '--public-origin' && publicOrigin === null) publicOrigin = value;
  else if (flag === '--android-package-path' && androidPackagePath === null && isAbsolute(value) &&
    basename(value).toLowerCase() === 'android-candidate.apk') androidPackagePath = resolve(value);
  else if (flag === '--mobile-ui-dir' && mobileUiDir === null && isAbsolute(value)) mobileUiDir = resolve(value);
  else if (flag === '--workspace-dir' && requestedWorkspaceDir === null) requestedWorkspaceDir = value;
  else { console.error(`[personal-host] unknown or duplicate option: ${flag}`); process.exit(2); }
}
try {
  publicOrigin = personalPublicOrigin([
    ...(publicOrigin === null ? [] : [`--public-origin=${publicOrigin}`]),
    ...(trustFlags.length ? ['--trust-loopback-proxy'] : []),
  ], true, accessPort);
} catch (error) { console.error('[personal-host] public origin refused:', error.message); process.exit(2); }
if ((androidPackagePath || mobileUiDir || accountMemoryConfig) && accessPort === null) {
  console.error('[personal-host] Android package, mobile UI and account memory require personal access');
  process.exit(2);
}
if (!requestedProfile || !isAbsolute(requestedProfile)) {
  console.error('usage: node scripts/run-personal-host.mjs --user-data-dir <absolute isolated directory> [--workspace-dir <absolute existing directory>] [--access-port <0..65535>] [--public-origin <https-origin> --trust-loopback-proxy] [--android-package-path <absolute android-candidate.apk>] [--mobile-ui-dir <absolute release directory>] [--personal-memory-config <absolute config.json>] [--dry-run]');
  process.exit(2);
}
if (memoryConfig !== null) {
  console.error('[personal-host] account-scoped memory is not connected; --memoweft-config is unavailable');
  process.exit(2);
}
if (accountMemoryConfig !== null) {
  try { await loadPersonalMemoryConfig(accountMemoryConfig); }
  catch { console.error('[personal-host] account memory configuration refused'); process.exit(2); }
  accountMemoryConfig = resolve(accountMemoryConfig);
}
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_')) delete env[key];
try { configureMemoWeft(memoryConfig, env); }
catch (error) { console.error('[personal-host] ' + error.message); process.exit(2); }
const candidate = resolve(requestedProfile);
let workspaceDir;
try {
  workspaceDir = personalWorkspaceDirectory(
    requestedWorkspaceDir === null ? [] : [`--workspace-dir=${requestedWorkspaceDir}`], true, candidate);
} catch (error) {
  console.error('[personal-host] workspace directory refused:', error.message);
  process.exit(2);
}
let profile = candidate;
try {
  if (existsSync(candidate)) profile = validatePersonalHostProfile(candidate);
  else if (!dryRun) {
    mkdirSync(dirname(candidate), { recursive: true });
    mkdirSync(candidate); // A concurrent creation fails before we could mark an unrelated profile.
    writeFileSync(join(candidate, PERSONAL_HOST_MARKER), `${JSON.stringify(PERSONAL_HOST_MARKER_CONTENT)}\n`, { flag: 'wx', mode: 0o600 });
    profile = validatePersonalHostProfile(candidate);
  }
} catch (error) {
  console.error('[personal-host] refusing profile:', error.message);
  process.exit(2);
}
console.log(`[personal-host] profile=${profile}`);
console.log(`[personal-host] workspace=${workspaceDir}`);
console.log('[personal-host] mode=personal-host; DSH address will be OS-assigned loopback');
console.log(`[personal-host] memoweft=${memoryConfig ? 'explicit-config' : 'disabled'} aiGame=not-configured phoneExecution=disabled`);
console.log(`[personal-host] accountMemory=${accountMemoryConfig ? 'explicit-config' : 'disabled'}`);
console.log(`[personal-host] personalAccess=${accessPort === null ? 'disabled' : `loopback-port-${accessPort}`}`);
console.log(`[personal-host] publicOrigin=${publicOrigin ?? 'disabled'}`);
console.log(`[personal-host] androidPackage=${androidPackagePath ? 'explicit-candidate' : 'disabled'}`);
console.log(`[personal-host] mobileUi=${mobileUiDir ? 'explicit-release-directory' : 'disabled'}`);
if (dryRun) process.exit(0);
try { profile = await ensurePrivateDirectory(profile); }
catch { console.error('[personal-host] isolated profile permissions could not be secured'); process.exit(2); }

const require = createRequire(import.meta.url);
const electron = require('electron');
env.WEFTMATE_USER_DATA = profile;
env.WEFTMATE_DOGFOOD_CONTROL = '1';
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host',
  ...(requestedWorkspaceDir === null ? [] : [`--workspace-dir=${workspaceDir}`]),
  ...(accessPort === null ? [] : [`--access-port=${accessPort}`]),
  ...(publicOrigin === null ? [] : [`--public-origin=${publicOrigin}`, '--trust-loopback-proxy']),
  ...(androidPackagePath === null ? [] : [`--android-package-path=${androidPackagePath}`]),
  ...(mobileUiDir === null ? [] : [`--mobile-ui-dir=${mobileUiDir}`]),
  ...(accountMemoryConfig === null ? [] : [`--personal-memory-config=${accountMemoryConfig}`])], {
  cwd: repository,
  env,
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
let stopping = false;
let timeout;
const pendingManagement = new Map();
child.on('message', (message) => {
  if (message?.type !== 'weftmate:manage-result' || typeof message.requestId !== 'string') return;
  const pending = pendingManagement.get(message.requestId);
  if (!pending) return;
  pendingManagement.delete(message.requestId);
  clearTimeout(pending.timer);
  if (message.ok === true) pending.resolve(message.result);
  else pending.reject(Object.assign(new Error('management failed'), { code: message.code ?? 'MANAGEMENT_FAILED' }));
});
function manage(action, payload = {}) {
  if (accessPort === null || stopping || !child.connected) return Promise.reject(Object.assign(new Error('unavailable'), { code: 'RUNTIME_UNAVAILABLE' }));
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingManagement.delete(requestId);
      reject(Object.assign(new Error('timeout'), { code: 'MANAGEMENT_TIMEOUT' }));
    }, 15_000);
    pendingManagement.set(requestId, { resolve, reject, timer });
    child.send({ type: 'weftmate:manage', requestId, action, ...payload }, (error) => {
      if (!error || !pendingManagement.has(requestId)) return;
      pendingManagement.delete(requestId);
      clearTimeout(timer);
      reject(Object.assign(new Error('send failed'), { code: 'MANAGEMENT_UNAVAILABLE' }));
    });
  });
}
async function runManagementCommand(line) {
  let command;
  try { command = JSON.parse(line); } catch { console.error('[personal-host] enter one JSON command per line'); return; }
  if (!command || typeof command !== 'object' || Array.isArray(command)) return;
  try {
    if (command.action === 'model.configure-local-catalog') {
      if (Object.keys(command).some((key) => key !== 'action')) throw Object.assign(
        new Error('invalid catalog request'), { code: 'INVALID_COMMAND' });
      const configured = await manage('model.configure-local-catalog');
      if (configured?.configured !== true || configured.total !== 9 ||
          !Number.isInteger(configured.added) || !Number.isInteger(configured.reused) ||
          ![0, 1].includes(configured.reloads) || configured.added + configured.reused !== 9 ||
          configured.verification !== 'catalog_only' || configured.inferenceVerified !== false) {
        throw Object.assign(new Error('invalid catalog receipt'), { code: 'MANAGEMENT_FAILED' });
      }
      console.log(`[personal-host] localCatalog count=9 added=${configured.added} reused=${configured.reused} reloads=${configured.reloads} verification=catalog_only inferenceVerified=false`);
      return;
    }
    if (command.action === 'model.configure-local') {
      if (typeof command.modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.modelId) ||
          (command.name !== undefined && (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 120))) {
        throw Object.assign(new Error('invalid model configuration'), { code: 'INVALID_COMMAND' });
      }
      const configured = await manage('model.configure-local', { modelId: command.modelId,
        ...(command.name === undefined ? {} : { name: command.name }) });
      if (configured?.configured !== true || configured.modelId !== command.modelId ||
          configured.verification !== 'catalog_only' || configured.inferenceVerified !== false) {
        throw Object.assign(new Error('invalid model configuration receipt'), { code: 'MANAGEMENT_FAILED' });
      }
      console.log(`[personal-host] modelId=${configured.modelId} profileId=${configured.profileId} verification=catalog_only inferenceVerified=false`);
      return;
    }
    if (command.action === 'account.setup') {
      if (command.open !== undefined && typeof command.open !== 'boolean') {
        throw Object.assign(new Error('invalid setup option'), { code: 'INVALID_COMMAND' });
      }
      if (command.open === true) {
        const opened = await manage('account.setup', { open: true });
        if (opened?.opened !== true || typeof opened.expiresAt !== 'string') throw new Error('invalid setup receipt');
        console.log(`[personal-host] setup page opened expiresAt=${opened.expiresAt}`);
        return;
      }
      const setupDir = await ensurePrivateDirectory(join(profile, 'personal-access', 'setup'));
      const output = join(setupDir, `setup-${randomUUID()}.json`);
      let fd = null;
      try {
        fd = openSync(output, 'wx', 0o600);
        await ensurePrivateFile(output);
        const issued = await manage('account.setup');
        if (typeof issued?.grant !== 'string' || typeof issued?.expiresAt !== 'string') throw new Error('invalid setup receipt');
        const url = new URL('/personal/v1/ui', assertLoopbackOrigin(issued.origin));
        url.hash = `setup=${encodeURIComponent(issued.grant)}`;
        writeFileSync(fd, `${JSON.stringify({ url: url.href, expiresAt: issued.expiresAt })}\n`);
        closeSync(fd); fd = null;
        console.log(`[personal-host] setupLinkFile=${output} expiresAt=${issued.expiresAt}`);
        return;
      } catch (error) {
        if (fd !== null) { try { closeSync(fd) } catch { /* closing */ } }
        try { rmSync(output, { force: true }) } catch { /* retain diagnostic path only */ }
        throw error;
      }
    }
    if (command.action === 'device.add') {
      const requestedOutput = command.tokenOutputFile;
      const tokensDir = join(profile, 'personal-access', 'tokens');
      if (typeof requestedOutput !== 'string' || !isAbsolute(requestedOutput)
        || dirname(resolve(requestedOutput)).toLowerCase() !== tokensDir.toLowerCase()
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.token$/.test(basename(requestedOutput))) {
        throw Object.assign(new Error('invalid output'), { code: 'INVALID_COMMAND' });
      }
      const privateTokensDir = await ensurePrivateDirectory(tokensDir);
      const relativeDir = relative(realpathSync(profile), realpathSync(privateTokensDir));
      if (relativeDir.toLowerCase() !== join('personal-access', 'tokens').toLowerCase()) {
        throw Object.assign(new Error('output escaped profile'), { code: 'INVALID_COMMAND' });
      }
      const output = join(privateTokensDir, basename(requestedOutput));
      let fd = null;
      let reserved = false;
      let enrolled = null;
      try {
        fd = openSync(output, 'wx', 0o600);
        reserved = true;
        await ensurePrivateFile(output);
        enrolled = await manage('device.add', { name: command.name, scopes: command.scopes });
        if (!enrolled || typeof enrolled.deviceId !== 'string' || typeof enrolled.token !== 'string') throw new Error('invalid enrollment receipt');
        writeFileSync(fd, `${enrolled.token}\n`);
        closeSync(fd); fd = null;
        console.log(`[personal-host] deviceId=${enrolled.deviceId} tokenFile=${output}`);
        return;
      } catch (error) {
        if (fd !== null) { try { closeSync(fd) } catch { /* file is already closing */ } }
        if (reserved) { try { rmSync(output, { force: true }) } catch { /* preserve failure for manual inspection */ } }
        if (enrolled?.deviceId) { try { await manage('device.revoke', { deviceId: enrolled.deviceId }) } catch { /* report uncertain below */ } }
        throw error;
      }
    }
    if (command.action === 'device.revoke') {
      await manage('device.revoke', { deviceId: command.deviceId });
      console.log(`[personal-host] revoked deviceId=${command.deviceId}`);
      return;
    }
    if (command.action === 'device.list') {
      const devices = await manage('device.list');
      console.log('[personal-host] devices=' + JSON.stringify(Array.isArray(devices) ? devices.map(({ deviceId, name, scopes, revoked, revokedAt }) => ({ deviceId, name, scopes, revoked, revokedAt })) : []));
      return;
    }
    if (command.action === 'session.attach') {
      await manage('session.attach', { sessionId: command.sessionId });
      console.log(`[personal-host] attached sessionId=${command.sessionId}`);
      return;
    }
    if (command.action === 'status') {
      const status = await manage('status');
      console.log('[personal-host] status=' + JSON.stringify({ state: status?.state ?? 'unknown', origin: status?.origin ?? null }));
      return;
    }
    console.error('[personal-host] unknown management action');
  } catch (error) {
    console.error(`[personal-host] management failed code=${typeof error?.code === 'string' ? error.code : 'MANAGEMENT_FAILED'}`);
  }
}
const stop = (reason) => {
  if (stopping) return;
  stopping = true;
  console.log(`[personal-host] ${reason}: requesting managed shutdown`);
  if (child.connected) {
    try { child.send({ type: 'weftmate:quit', source: 'personal-host-launcher' }, () => {}); }
    catch { /* The bounded process-tree stop still applies. */ }
  }
  timeout = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    console.error('[personal-host] shutdown exceeded 10 seconds; stopping this exact process tree');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
    } else child.kill('SIGKILL');
  }, 10_000);
  timeout.unref?.();
};
observeHostChild(child, process.stdin, ({ error, code, signal }) => {
  if (timeout) clearTimeout(timeout);
  for (const [requestId, pending] of pendingManagement) {
    clearTimeout(pending.timer);
    pending.reject(Object.assign(new Error('host closed'), { code: 'RUNTIME_UNAVAILABLE' }));
    pendingManagement.delete(requestId);
  }
  if (error) {
    console.error('[personal-host] Electron launch failed:', error.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = signal ? 1 : (code ?? 1);
  console.log(`[personal-host] Electron exited code=${code ?? 'null'} signal=${signal ?? 'none'}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
process.stdin.setEncoding('utf8');
process.stdin.resume();
if (process.stdin.isTTY) console.log('[personal-host] type q to stop, or one JSON management command per line');
let inputBuffer = '';
let commandQueue = Promise.resolve();
process.stdin.on('data', (input) => {
    inputBuffer += input;
    const lines = inputBuffer.split(/[\r\n]+/);
    inputBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(q|quit)$/i.test(trimmed)) commandQueue = commandQueue.then(() => stop('terminal q'));
      else commandQueue = commandQueue.then(() => runManagementCommand(trimmed));
    }
});
