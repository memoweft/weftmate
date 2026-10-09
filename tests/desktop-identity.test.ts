import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('development desktop identity installs idempotently in isolation and restores an existing shortcut', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'weftmate-shortcut-test-'));
  const script = resolve('scripts/register-desktop-identity.ps1'), shortcut = join(directory, 'WeftMate.lnk');
  const run = (...extra: string[]) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProgramsDirectory', directory, ...extra], { encoding: 'utf8', windowsHide: true });
  try {
    assert.match(run(), /AppUserModelID: com\.memoweft\.weftmate/);
    assert.match(run(), /AppUserModelID: com\.memoweft\.weftmate/);
    assert.ok(existsSync(shortcut));
    run('-Undo'); assert.equal(existsSync(shortcut), false);
    const original = Buffer.from('synthetic existing shortcut'); writeFileSync(shortcut, original);
    run(); run(); run('-Undo'); assert.deepEqual(readFileSync(shortcut), original);
    run('-Undo'); assert.deepEqual(readFileSync(shortcut), original);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
