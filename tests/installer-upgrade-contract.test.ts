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
  assert.match(installer, /\$installMode == "all"/);
  assert.match(installer, /--launch/);
  assert.doesNotMatch(installer, /!insertmacro _CHECK_APP_RUNNING/);
});
