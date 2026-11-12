// 日用脚本共享工具；入口使用 parseOptions()，先验证参数再访问文件。
// --builds <builds> --version 0.2.0-preview.N 为所有入口的共同参数。
// 安装位置、配置位置和数据目录均从当前环境及配置推导。
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export { sha } from './retained.mjs';
export const repository = resolve(import.meta.dirname, '../..');
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const pause = ms => new Promise(done => setTimeout(done, ms));

export function parseOptions(script, extra = []) {
  const required = ['builds', 'version', ...extra];
  const usage = `Usage: node scripts/daily/${script}.mjs --builds <builds> --version <version>` +
    extra.map(name => ` --${name} <${name}>`).join('');
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(required.map(name => [name, { type: 'string' }])),
      strict: true, allowPositionals: false,
    });
    for (const name of required) {
      const value = values[name];
      if (!value || value !== value.trim() || value.startsWith('--') || /\0/.test(value))
        throw Error(`Missing or invalid --${name}`);
    }
    const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
    for (const name of ['version', 'previous']) {
      if (values[name] !== undefined && !versionPattern.test(values[name]))
        throw Error(`Invalid --${name}: expected a version such as 0.2.0-preview.N`);
    }
    if (/["<>|?*\x00-\x1f]/.test(values.builds)) throw Error('Invalid --builds directory');
    if (values.commit !== undefined && (/^[-]|\s/.test(values.commit))) throw Error('Invalid --commit');
    const builds = resolve(values.builds);
    return { ...values, builds, output: join(builds, values.version),
      previousDirectory: values.previous ? join(builds, values.previous) : undefined };
  } catch (error) {
    console.error(`${error.message}\n${usage}`);
    process.exit(1);
  }
}

export async function until(check, message, timeout = 90000, interval = 600) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await pause(interval);
  } while (Date.now() < deadline);
  throw Error(message);
}

export async function shaFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function dailyPaths() {
  const installation = join(process.env.LOCALAPPDATA, 'Programs/WeftMate');
  return { installation, exe: join(installation, 'WeftMate.exe'),
    archive: join(installation, 'resources/app.asar'),
    configFile: join(process.env.APPDATA, 'WeftMate/desktop-config.json') };
}

export const dailyEnv = () => Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^ELECTRON_RUN_AS_NODE$|^(https?_proxy|all_proxy|no_proxy)$/i.test(key)));

export function processes(exe, env = dailyEnv()) {
  const command = '@(Get-Process WeftMate -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $env:WM_DAILY_EXE} | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
    { env: { ...env, WM_DAILY_EXE: resolve(exe) }, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Could not inspect daily installation processes');
  return [JSON.parse(result.stdout.trim() || '[]')].flat();
}

export function startDaily(exe, configFile, env = dailyEnv()) {
  const child = spawn(exe, ['--desktop-config=' + configFile],
    { env, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { pid: child.pid };
}
