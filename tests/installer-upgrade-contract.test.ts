import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const installer = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
test('silent setup guards drawing, preserves upstream /D resolution and refuses unavailable elevation', () => {
  for (const name of ['WeftChoose', 'WeftProgress', 'un.WeftProgress']) {
    const body = installer.split(`Function ${name}\n`)[1]?.split('FunctionEnd')[0];
    assert.ok(body, name);
    assert.match(body, /\$\{(?:If|IfNot)\} \$\{Silent\}/);
  }
  assert.match(installer, /ADMIN_REQUIRED/);
  assert.match(installer, /WeftFail 740/);
  assert.match(installer, /WeftFail 1633/);
  assert.match(installer, /!macro customUnInstallCheck\s+\$\{If\} \$\{Errors\}/);
  assert.match(installer, /\$installMode == "all"/);
  assert.match(installer, /\$\{If\} \$\{isForCurrentUser\}\s+StrCpy \$hasPerMachineInstallation "0"/);
  assert.match(installer, /StrCpy \$installMode "all"\s+!insertmacro uninstallOldVersion HKEY_LOCAL_MACHINE\s+StrCpy \$installMode "CurrentUser"/);
  assert.match(installer, /--launch/);
  assert.doesNotMatch(installer, /!insertmacro _CHECK_APP_RUNNING/);
});
