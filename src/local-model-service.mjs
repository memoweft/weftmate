import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function loadLocalModelConfig(file) {
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (!isAbsolute(config.executable ?? '') || !isAbsolute(config.model ?? '') ||
      !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      config.contextSize !== undefined && (!Number.isInteger(config.contextSize) || config.contextSize < 4096) ||
      !['q8_0', 'q4_0', 'f16'].includes(config.cacheType ?? 'q4_0') ||
      ['cacheTypeK', 'cacheTypeV'].some(key => config[key] !== undefined && !['q8_0', 'q4_0', 'f16'].includes(config[key])) ||
      ['batchSize', 'ubatchSize', 'threads', 'threadsBatch'].some(key => config[key] !== undefined && (!Number.isInteger(config[key]) || config[key] <= 0)) ||
      ['cacheRamMiB', 'contextCheckpoints'].some(key => config[key] !== undefined && (!Number.isInteger(config[key]) || config[key] < 0)) ||
      config.gpuLayers !== undefined && (!Number.isInteger(config.gpuLayers) || config.gpuLayers < 0) ||
      config.mmproj !== undefined && !isAbsolute(config.mmproj) ||
      typeof config.alias !== 'string' || !/^[A-Za-z0-9._-]+$/.test(config.alias)) {
    throw new Error('LOCAL_MODEL_CONFIGURATION_INVALID');
  }
  return config;
}
export function localModelArguments(config) {
  return ['--model', config.model, '--alias', config.alias, '--host', '127.0.0.1',
    '--port', String(config.port), '--ctx-size', String(config.contextSize ?? 92160),
    '--parallel', '1', '--n-gpu-layers', String(config.gpuLayers ?? 99), '--flash-attn', 'on',
    '--cache-type-k', config.cacheTypeK ?? config.cacheType ?? 'q4_0', '--cache-type-v', config.cacheTypeV ?? config.cacheType ?? 'q4_0',
    '--batch-size', String(config.batchSize ?? 4096), '--ubatch-size', String(config.ubatchSize ?? 512),
    '--threads', String(config.threads ?? 8), '--threads-batch', String(config.threadsBatch ?? 16),
    '--fit', 'off', '--jinja',
    ...(config.cacheRamMiB !== undefined ? ['--cache-ram', String(config.cacheRamMiB)] : []),
    ...(config.contextCheckpoints !== undefined ? ['--ctx-checkpoints', String(config.contextCheckpoints)] : []),
    '--reasoning-format', 'deepseek', '--verbosity', '4',
    ...(config.mmproj ? ['--mmproj', config.mmproj] : []),
  ];
}
async function processIdentity(pid) {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$p = Get-Process -Id ([int]$env:WEFTMATE_MODEL_PID) -ErrorAction SilentlyContinue; if ($p) { @{ executable=$p.Path; started=$p.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress }'],
    { windowsHide: true, env: { ...process.env, WEFTMATE_MODEL_PID: String(pid) } });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
export function createLocalModelController(configFile) {
  configFile = resolve(configFile);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configRelative = relative(packageRoot, configFile);
  if (!configRelative || !configRelative.startsWith(`..${sep}`) && !isAbsolute(configRelative)) {
    throw new Error('LOCAL_MODEL_CONFIG_MUST_BE_OUTSIDE_REPOSITORY');
  }
  const stateFile = `${configFile}.process.json`, logFile = `${configFile}.server.log`;
  let mutation = Promise.resolve();
  const config = () => loadLocalModelConfig(configFile);
  const owned = async () => {
    const record = JSON.parse(await readFile(stateFile, 'utf8').catch(() => 'null'));
    if (!record) return null;
    const actual = await processIdentity(record.pid);
    return actual?.started === record.started && actual.executable?.toLowerCase() === record.executable.toLowerCase()
      ? record : null;
  };
  async function status() {
    const cfg = await config();
    try {
      const origin = `http://127.0.0.1:${cfg.port}`;
      const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
      if (!health.ok) return { state: health.status === 503 ? 'starting' : 'unavailable', version: null,
        contextWindow: null, lastError: `MODEL_HTTP_${health.status}` };
      const metadata = await fetch(`${origin}/props`, { signal: AbortSignal.timeout(2000) });
      if (!metadata.ok) return { state: 'unavailable', version: null, contextWindow: null, lastError: `MODEL_HTTP_${metadata.status}` };
      const props = await metadata.json();
      return { state: 'ready', version: props.build_info ?? null,
        contextWindow: props.default_generation_settings?.n_ctx ?? props.n_ctx ?? null,
        slots: props.total_slots ?? null, lastError: null };
    } catch { return { state: 'stopped', version: null, contextWindow: null, lastError: 'MODEL_UNAVAILABLE' }; }
  }
  async function stop() {
    const record = await owned();
    if (record) {
      // The identity is checked again in the same PowerShell process that stops it.
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$p = Get-Process -Id ([int]$env:WEFTMATE_MODEL_PID) -ErrorAction SilentlyContinue; if ($p -and $p.Path -eq $env:WEFTMATE_MODEL_EXE -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $env:WEFTMATE_MODEL_STARTED) { Stop-Process -InputObject $p; $p.WaitForExit() }'],
        { windowsHide: true, env: { ...process.env, WEFTMATE_MODEL_PID: String(record.pid),
          WEFTMATE_MODEL_EXE: record.executable, WEFTMATE_MODEL_STARTED: record.started } });
    }
    await rm(stateFile, { force: true });
  }
  async function start() {
    if ((await status()).state === 'ready') return status();
    const cfg = await config();
    // Refuse any listener, including an unhealthy service, before spawning.
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-NetTCPConnection -State Listen -LocalPort ([int]$env:WEFTMATE_MODEL_PORT) -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess; exit 0'],
      { windowsHide: true, env: { ...process.env, WEFTMATE_MODEL_PORT: String(cfg.port) } });
    if (stdout.trim()) throw new Error('LOCAL_MODEL_PORT_IN_USE');
    await mkdir(dirname(configFile), { recursive: true });
    const log = await open(logFile, 'w', 0o600);
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('LLAMA_')));
    const child = spawn(cfg.executable, localModelArguments(cfg), { cwd: dirname(cfg.executable), env,
      windowsHide: true, detached: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    await log.close(); child.unref();
    const identity = await processIdentity(child.pid);
    if (!identity) throw new Error('LOCAL_MODEL_START_FAILED');
    await writeFile(stateFile, JSON.stringify({ pid: child.pid, ...identity }), { mode: 0o600 });
    for (let attempt = 0; attempt < 120; attempt++) {
      const current = await status();
      if (current.state === 'ready') return current;
      if (!await owned()) throw new Error('LOCAL_MODEL_START_FAILED');
      await pause(1000);
    }
    throw new Error('LOCAL_MODEL_START_TIMEOUT');
  }
  return { status, async control(action) {
    const work = mutation.catch(() => {}).then(async () => {
      if (!['start', 'stop', 'restart'].includes(action)) throw new Error('LOCAL_MODEL_ACTION_INVALID');
      if (action === 'restart' && (await status()).state === 'ready' && !await owned()) {
        throw new Error('LOCAL_MODEL_PROCESS_NOT_MANAGED');
      }
      if (action !== 'start') await stop();
      return action === 'stop' ? status() : start();
    });
    mutation = work; return work;
  } };
}
