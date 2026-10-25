import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const installer = [readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8'),
  readFileSync(new URL('../build/installer-scope.nsh', import.meta.url), 'utf8')].join('\n').replaceAll('\r\n', '\n');
test('silent setup guards drawing, preserves upstream /D resolution and refuses unavailable elevation', () => {
  for (const name of ['WeftChoose', 'WeftProgress', 'un.WeftProgress']) {
    const body = installer.split(`Function ${name}\n`)[1]?.split('FunctionEnd')[0];
    assert.ok(body, name);
    assert.match(body, /\$\{(?:If|IfNot)\} \$\{Silent\}/);
  }
  assert.match(installer, /ADMIN_REQUIRED/);
  assert.match(installer, /WeftFail 740/);
  assert.match(installer, /WeftFail 1633/);
  assert.match(installer, /!macro WeftUninstallCheck ROOT\s+\$\{If\} \$\{Errors\}/);
  // The update monitor has already moved the old tree (and its uninstaller) aside.
  assert.match(installer, /\$\{If\} \$\{FileExists\} "\$R1"\s+!insertmacro WeftFail 2 "UNINSTALL_FAILED: previous uninstaller could not be started"/);
  assert.match(installer, /!macro customUnInstallCheck\s+!insertmacro WeftUninstallCheck SHELL_CONTEXT/);
  assert.match(installer, /\$installMode == "all"/);
  assert.match(installer, /StrCpy \$hasPerMachineInstallation "0"\s+StrCpy \$hasPerUserInstallation "1"\s+!insertmacro setInstallModePerUser/);
  assert.match(installer, /StrCpy \$installMode "all"\s+!insertmacro uninstallOldVersion HKEY_LOCAL_MACHINE\s+StrCpy \$installMode "CurrentUser"/);
  assert.match(installer, /--launch/);
  assert.doesNotMatch(installer, /!insertmacro _CHECK_APP_RUNNING/);
});
