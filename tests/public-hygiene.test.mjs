import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { identityFindings } from '../.github/scripts/public-hygiene.mjs';

const fakePath = separator => ['Z:', 'Users', 'Fictional Person', 'report.txt'].join(separator);
test('public hygiene checks raw, forward-slash and JSON-escaped paths, with a narrow public-name allowlist', () => {
  for (const separator of ['\\', '/', '\\\\']) assert.deepEqual(identityFindings(fakePath(separator)), ['Windows user directory']);
  for (const name of ['<user>', 'runneradmin', 'runner', 'Public', 'Default', 'Default User', 'All Users']) {
    assert.deepEqual(identityFindings(['C:', 'Users', name, 'file'].join('\\')), []);
  }
  for (const name of ['DESKTOP-' + 'AB12CD3', 'LAPTOP-' + 'AB12CD34']) assert.deepEqual(identityFindings(name), ['default machine name']);
  assert.deepEqual(identityFindings('desktop-actions laptop-settings'), []);
});
test('CLI rejects a fake identity by file name without echoing the identity and ignores binary data', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-hygiene-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const script = resolve('.github/scripts/public-hygiene.mjs');
    const run = () => spawnSync(process.execPath, [script], {cwd:root, encoding:'utf8'});
    writeFileSync(join(root, 'public.txt'), fakePath('\\'));
    let result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /public.txt/);
    assert.ok(!result.stderr.includes('Fictional Person'));
    writeFileSync(join(root, 'public.txt'), ['C:', 'Users', '<user>', 'report.txt'].join('\\'));
    writeFileSync(join(root, 'image.bin'), Buffer.concat([Buffer.from([0]), Buffer.from(fakePath('\\'))]));
    result = run(); assert.equal(result.status, 0); assert.match(result.stdout, /0 files with local identities/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
