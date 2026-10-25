import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareWindowsRuntimeComponents } from '../scripts/windows-runtime-components.mjs';
import { packagedRuntimeDirectory, runtimeComponentRelative } from '../src/runtime-components.mjs';

const cache = join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis-3.0.4.1');
const compiler = process.env.MAKENSIS || [cache, ...(existsSync(cache) ? readdirSync(cache).map(name => join(cache, name)) : [])]
  .map(root => join(root, 'Bin/makensis.exe')).find(existsSync);
const vswhere = join(process.env['ProgramFiles(x86)'] || '', 'Microsoft Visual Studio/Installer/vswhere.exe');

test('native component install skips unchanged files, repairs interrupted installs and preserves unrelated data', {
  skip: process.platform !== 'win32' || !compiler || !existsSync(vswhere), timeout: 120000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fix-update2-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''));
    return result.stdout.trim();
  };
  const vs = run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
  const dll = join(root, 'WeftInstaller.dll'), def = join(root, 'components.def');
  await writeFile(def, 'EXPORTS\nPrepareComponents=_PrepareComponents@8\nPrepareComponent=_PrepareComponent@8\nComponentReady=_ComponentReady@8\nCompleteComponent=_CompleteComponent@8\nRemoveComponents=_RemoveComponents@8\n');
  const cmd = join(root, 'compile.cmd');
  await writeFile(cmd, `@call "${vs}\\VC\\Auxiliary\\Build\\vcvars32.bat" >nul\r\n@cl /nologo /LD /std:c++17 /W4 /WX /MT /DUNICODE /D_UNICODE "${resolve('build/installer-components.cpp')}" /Fo"${join(root, 'components.obj')}" /link /DEF:"${def}" /OUT:"${dll}"\r\n`);
  run('cmd.exe', ['/d', '/c', cmd]);
  const build = join(root, 'build-' + 'x'.repeat(100)), installed = join(root, 'installed'), headers = join(root, 'headers');
  const config = { appId: 'test.fixupdate2' };
  const stage = async (dsh: string) => {
    for (const [name, text] of [['dsh-runtime', dsh], ['memory-runtime', 'unchanged memory']]) {
      const dir = join(build, 'resources', name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'entry.js'), text);
      if(name==='dsh-runtime') {
        const deep=join(dir,...Array(10).fill('nested'));
        await mkdir(deep,{recursive:true});await writeFile(join(deep,'long-build-source.js'),'long source, short installation');
      }
    }
    await prepareWindowsRuntimeComponents({ appOutDir: build, packager: { projectDir: root, config } }, headers);
    // Only the production component macro executes, with two synthetic files.
    // There is no app, registration, shortcut, installed profile or uninstaller.
    const script = join(root, 'probe.nsi'), exe = join(root, 'probe.exe');
    await writeFile(script, `Unicode true\nSilentInstall silent\nRequestExecutionLevel user\nOutFile "${exe}"\n!include LogicLib.nsh\n!define APP_ID "${config.appId}"
!macro WeftFail code message
  SetErrorLevel \${code}
  Quit
!macroend
!include "${join(headers, 'runtime-components.nsh')}"
Section
  StrCpy $INSTDIR "${installed}"
  InitPluginsDir
  File /oname=$PLUGINSDIR\\WeftInstaller.dll "${dll}"
  !insertmacro WeftInstallRuntimeComponents
SectionEnd\n`);
    run(compiler!, ['/V2', script]);
    return exe;
  };
  let exe = await stage('DSH first'); run(exe, []);
  const descriptor = JSON.parse(await readFile(join(build, 'resources/runtime-components.json'), 'utf8'));
  const componentPath = (name: string, version = descriptor.components[name]) => join(installed + '.components', runtimeComponentRelative(name, version));
  const memory = join(componentPath('memory-runtime'), 'entry.js');
  await utimes(memory, 1000000000, 1000000000);
  const before = (await stat(memory)).mtimeMs;
  run(exe, []);
  assert.equal((await stat(memory)).mtimeMs, before, 'same version must skip File extraction');
  exe = await stage('DSH second'); run(exe, []);
  assert.equal((await stat(memory)).mtimeMs, before, 'changing DSH must not reinstall memory');
  assert.equal(await readFile(join(componentPath('dsh-runtime'), 'entry.js'), 'utf8'), 'DSH first', 'old runtime remains available for rollback');
  const current = JSON.parse(await readFile(join(build, 'resources/runtime-components.json'), 'utf8'));
  assert.equal(await readFile(join(componentPath('dsh-runtime', current.components['dsh-runtime']), 'entry.js'), 'utf8'), 'DSH second');
  await rm(componentPath('memory-runtime') + '.complete');
  await writeFile(memory, 'interrupted'); run(exe, []);
  assert.equal(await readFile(memory, 'utf8'), 'unchanged memory');
  // The same descriptor resolves from the installed location, independent of build paths.
  await mkdir(join(installed, 'resources'), { recursive: true });
  await writeFile(join(installed, 'resources/runtime-components.json'), JSON.stringify(current));
  assert.equal(packagedRuntimeDirectory(join(installed, 'resources'), 'memory-runtime'), componentPath('memory-runtime'));
  const outside = join(root, 'unrelated'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'keep');
  await symlink(outside, join(installed + '.components', 'linked'), 'junction');
  // Exercise production removal without invoking an app uninstaller.
  const removeScript = join(root, 'remove.nsi'), removeExe = join(root, 'remove.exe');
  await writeFile(removeScript, `Unicode true\nSilentInstall silent\nRequestExecutionLevel user\nOutFile "${removeExe}"\nSection\nInitPluginsDir\nFile /oname=$PLUGINSDIR\\WeftInstaller.dll "${dll}"\nSystem::Call '$PLUGINSDIR\\WeftInstaller.dll::RemoveComponents(w "${installed}.components", w "${config.appId}") i.r0'\nSetErrorLevel $0\nSectionEnd\n`);
  run(compiler!, ['/V2', removeScript]);
  assert.equal(spawnSync(removeExe, [], { windowsHide: true, timeout: 10000 }).status, 1);
  assert.equal(existsSync(installed + '.components'), false);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
});
