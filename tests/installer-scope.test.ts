import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cache = join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis-3.0.4.1');
const compiler = process.env.MAKENSIS || [cache, ...(existsSync(cache) ? readdirSync(cache).map(name => join(cache, name)) : [])]
  .map(root => join(root, 'Bin/makensis.exe')).find(existsSync);
test('NSIS scope selection forces per-user installation even after detecting an all-users install', {
  skip: process.platform !== 'win32' || !compiler,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-scope-unit-'));
  try {
    for (const uninstall of [false, true]) {
      const exe = join(root, 'scope.exe'), output = join(root, 'scope.txt'), script = join(root, 'scope.nsi');
      // Only execute the production scope-selection macro: no app payload,
      // registry writes, installation or uninstallation takes place.
      await writeFile(script, `Unicode true\nSilentInstall silent\nRequestExecutionLevel user\nOutFile "${exe}"\n!include LogicLib.nsh\n${uninstall ? '!define BUILD_UNINSTALLER\n' : ''}
Var installMode
Var isForceCurrentInstall
Var isForceMachineInstall
!include "${resolve('build/installer-scope.nsh')}"
Section
  StrCpy $installMode "all"
  !insertmacro customInstallMode
  FileOpen $0 "${output}" w
  FileWrite $0 "$isForceCurrentInstall,$isForceMachineInstall"
  FileClose $0
SectionEnd\n`);
      const compiled = spawnSync(compiler, ['/V2', script], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
      assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
      const run = spawnSync(exe, [], { windowsHide: true, timeout: 10000 }); assert.equal(run.status, 0);
      assert.equal(await readFile(output, 'utf8'), uninstall ? '0,1' : '1,0');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
