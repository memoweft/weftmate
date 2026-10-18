import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const migration = resolve('scripts/migrate-installed-desktop.ps1');
const sourceTask = resolve('scripts/run-personal-host-task.ps1');

async function prepare(root, source, { runtime, rehearsal = true } = {}) {
  const output = join(root, 'entry-output.log'), fd = openSync(output, 'w');
  const args = ['-NoProfile', '-NonInteractive', '-File', migration, '-Action', 'Prepare',
    '-SourceTaskScript', source, '-DataDirectory', join(root, 'original-data'),
    '-ConfigFile', join(root, 'desktop-config.json'), '-MigrationDirectory', join(root, 'migration'),
    '-InstalledExe', join(root, 'unused-installation/WeftMate.exe')];
  if (runtime !== undefined) args.push('-RuntimeDirectory', runtime);
  if (rehearsal) args.push('-Rehearsal');
  let child, timer, timedOut = false;
  try {
    child = spawn('pwsh', args, { windowsHide: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, APPDATA: root, LOCALAPPDATA: root } });
    timer = setTimeout(() => {
      timedOut = true;
      if (child.exitCode === null && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', timeout: 5_000 });
    }, 15_000);
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    assert.equal(timedOut, false, 'migration entry exceeded its timeout; its process tree was stopped');
    return { code, output: await readFile(output, 'utf8') };
  } finally {
    clearTimeout(timer); closeSync(fd);
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5_000 });
    }
  }
}

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-migration-entry-')));
  try {
    await mkdir(join(root, 'original-data'));
    await writeFile(join(root, 'original-data/keep.txt'), 'synthetic original data');
    await writeFile(join(root, 'desktop-config.json'), '{"previous":"synthetic config"}\n');
    await run(root);
    assert.equal(await readFile(join(root, 'original-data/keep.txt'), 'utf8'), 'synthetic original data');
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const rehearsal of [true, false]) test(`installed migration Prepare forwards explicit runtime (rehearsal=${rehearsal})`,
  { skip: process.platform !== 'win32' }, async () => fixture(async root => {
    const runtime = join(root, '显式 runtime directory'); await mkdir(runtime);
    const result = await prepare(root, sourceTask, { runtime, rehearsal });
    assert.equal(result.code, 0, result.output);
    const config = JSON.parse(await readFile(join(root, 'desktop-config.json'), 'utf8'));
    const state = JSON.parse(await readFile(join(root, 'migration/state.json'), 'utf8'));
    assert.equal(state.phase, 'prepared'); assert.equal(state.hadConfig, true);
    assert.equal(await readFile(join(root, 'migration/previous-config.json'), 'utf8'), '{"previous":"synthetic config"}\n');
    assert.equal(config.dataDirectory, join(root, 'original-data'));
    assert.equal(config.accessPort, rehearsal ? 0 : 18186);
    assert.equal(config.production.relayEnabled, !rehearsal);
    if (rehearsal) assert.equal(config.personalMemoryConfig, undefined);
    else {
      assert.equal(config.personalMemoryConfig, join(runtime, 'personal-memory-config-20260927.json'));
      assert.equal(config.mobileUiDirectory, join(runtime, 'mobile-ui-releases'));
      assert.equal(config.androidPackagePath, join(runtime, 'android-candidate.apk'));
    }
  }));

test('installed migration missing runtime explains the required entry argument without changing configuration',
  { skip: process.platform !== 'win32' }, async () => fixture(async root => {
    const result = await prepare(root, sourceTask);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /-RuntimeDirectory/);
    assert.match(result.output, /--runtime/);
    assert.equal(await readFile(join(root, 'desktop-config.json'), 'utf8'), '{"previous":"synthetic config"}\n');
    await assert.rejects(access(join(root, 'migration/state.json')), { code: 'ENOENT' });
    const relative = await prepare(root, sourceTask, { runtime: 'relative-runtime' });
    assert.notEqual(relative.code, 0);
    assert.match(relative.output, /-RuntimeDirectory/);
    assert.match(relative.output, /--runtime/);
    assert.equal(await readFile(join(root, 'desktop-config.json'), 'utf8'), '{"previous":"synthetic config"}\n');
  }));

test('installed migration retains legacy explicit runtime literals and never executes the source task',
  { skip: process.platform !== 'win32' }, async () => fixture(async root => {
    const source = join(root, 'legacy-source-task.ps1');
    const runtime = join(root, 'legacy runtime');
    await writeFile(source, `throw 'source task must never execute'\n$runtime = '${runtime.replaceAll("'", "''")}'\n` +
      "$profile = Join-Path $runtime 'personal-account-synthetic'\n$port = '0'\n" +
      "$mobileUi = Join-Path $runtime 'mobile'\n$memoryConfig = Join-Path $runtime 'memory.json'\n" +
      "$androidPackage = Join-Path $runtime 'synthetic.apk'\n$options = @('--public-origin', 'https://synthetic.invalid')\n");
    const result = await prepare(root, source, { rehearsal: false });
    assert.equal(result.code, 0, result.output);
    const config = JSON.parse(await readFile(join(root, 'desktop-config.json'), 'utf8'));
    assert.equal(config.personalMemoryConfig, join(runtime, 'memory.json'));
  }));
