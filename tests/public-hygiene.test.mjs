import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { identityFindings } from '../.github/scripts/public-hygiene.mjs';
import { hostname, userInfo } from 'node:os';
import { readFileSync } from 'node:fs';

const fakePath = separator => ['Z:', 'Users', 'Fictional Person', 'report.txt'].join(separator);
test('public hygiene checks raw, forward-slash and JSON-escaped paths, with a narrow public-name allowlist', () => {
  for (const separator of ['\\', '/', '\\\\']) assert.deepEqual(identityFindings(fakePath(separator)), ['Windows user directory']);
  assert.deepEqual(identityFindings(['C:', 'Users', '虚构用户', 'file'].join('\\')), ['Windows user directory']);
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
    writeFileSync(join(root, 'wide.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(fakePath('\\'), 'utf16le')]));
    assert.equal(run().status, 1);
    rmSync(join(root, 'wide.txt'));
    writeFileSync(join(root, 'public.txt'), ['C:', 'Users', '<user>', 'report.txt'].join('\\'));
    writeFileSync(join(root, 'image.bin'), Buffer.concat([Buffer.from([0]), Buffer.from(fakePath('\\'))]));
    result = run(); assert.equal(result.status, 0); assert.match(result.stdout, /0 files with local identities/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
test('one-time cleaner reads runtime identity, preserves JSON and source escaping, and is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-cleaner-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const path = ['Q:', 'Users', userInfo().username, 'fixture'].join('/');
    writeFileSync(join(root, 'evidence.json'), JSON.stringify({path, host:hostname()}));
    writeFileSync(join(root, 'runner.mjs'), `export default ${JSON.stringify(path)};`);
    writeFileSync(join(root, 'wide.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(path, 'utf16le')]));
    const run = () => JSON.parse(execFileSync(process.execPath, [resolve('scripts/clean-public-identities.mjs')], {cwd:root, encoding:'utf8'}));
    assert.equal(run().changed, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'evidence.json'), 'utf8')), {path:['C:', 'Users', '<user>', 'fixture'].join('\\') .replace('\\fixture', '/fixture'), host:'<host>'});
    execFileSync(process.execPath, ['--check', join(root, 'runner.mjs')]);
    assert.equal(readFileSync(join(root, 'wide.txt'))[0], 0xff);
    assert.equal(run().changed, 0);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
