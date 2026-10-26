import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { identityFindings, brokenLinks, relativeLinks, productionPathFindings } from '../.github/scripts/public-hygiene.mjs';
import { hostname, userInfo } from 'node:os';
import { readFileSync } from 'node:fs';

const fakePath = separator => ['Z:', 'Users', 'Fictional Person', 'report.txt'].join(separator);
test('production path rule covers all four roots and retains OS paths, redaction, tests and virtual vendor homes', () => {
  const source = `const source = '${['Q:', 'workspace', 'source'].join('/')}';`;
  for (const root of ['src', 'scripts', 'apps', 'services']) assert.equal(productionPathFindings(`${root}/config.mjs`, source).length, 1);
  for (const file of ['tests/config.test.ts', 'apps/apple/Tests/fixture.swift', 'services/cloud/test/config.test.mjs', 'src/personal-access-ui/render-vendor/pdfjs/pdf.worker.js']) {
    assert.deepEqual(productionPathFindings(file, source), []);
  }
  for (const value of ["const system = 'C:/Windows/System32';", "const system = 'C:/Program Files (x86)/app';",
    "const label = 'C:/Users/<user>/file';", 'const pattern = /^\\d\\d:\\d\\d$/;',
    "const url = 'https://example.test/home/docs';"]) assert.deepEqual(productionPathFindings('src/config.mjs', value), []);
});
test('CLI rejects machine-specific production paths without echoing them', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-production-paths-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'src'));
    const run = () => spawnSync(process.execPath, [resolve('.github/scripts/public-hygiene.mjs')],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    for (const path of [['Q:', 'PrivateWorkspace', 'core'].join('/'),
      ['Q:', 'PrivateWorkspace', 'core'].join('\\'), ['Q:', 'PrivateWorkspace', 'core'].join('\\\\'),
      ['', 'home', 'fictional', 'core'].join('/'), ['~', '.private', 'core'].join('/')]) {
      writeFileSync(join(root, 'src/config.mjs'), `export const source = '${path}';`);
      const result = run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /src\/config.mjs.*machine-specific path/);
      assert.ok(!result.stderr.includes('PrivateWorkspace'));
    }
    writeFileSync(join(root, 'src/config.mjs'), "export const source = process.env.EXPLICIT_SOURCE; // http://localhost/path\n");
    assert.equal(run().status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('public hygiene checks raw, forward-slash and JSON-escaped paths, with a narrow public-name allowlist', () => {
  for (const separator of ['\\', '/', '\\\\']) assert.deepEqual(identityFindings(fakePath(separator)), ['Windows user directory']);
  assert.deepEqual(identityFindings(['C:', 'Users', '虚构用户', 'file'].join('\\')), ['Windows user directory']);
  for (const name of ['<user>', 'runneradmin', 'runner', 'Public', 'Default', 'Default User', 'All Users']) {
    assert.deepEqual(identityFindings(['C:', 'Users', name, 'file'].join('\\')), []);
  }
  for (const name of ['DESKTOP-' + 'AB12CD3', 'LAPTOP-' + 'AB12CD34']) assert.deepEqual(identityFindings(name), ['default machine name']);
  assert.deepEqual(identityFindings('desktop-actions laptop-settings'), []);
});
test('public hygiene finds macOS homes in text, JSON and file URLs, but not drives, web paths or patterns', () => {
  const home = ['', 'Users', 'fictional', '.codex', 'image.png'].join('/');
  for (const text of [home, JSON.stringify({source: home}), `cd ${home}`]) assert.deepEqual(identityFindings(text), ['macOS user directory']);
  assert.ok(identityFindings(`file://${home}`).includes('macOS user directory'));
  for (const name of ['<user>', 'Shared', 'runner']) assert.deepEqual(identityFindings(['', 'Users', name, 'x'].join('/')), []);
  assert.deepEqual(identityFindings(['C:', 'Users', 'fictional', 'x'].join('/')), ['Windows user directory']);
  assert.deepEqual(identityFindings(['https://example.test', 'Users', 'fictional'].join('/')), []);
  assert.deepEqual(identityFindings('#"(?:/Users/|/home/)[^\\s]+"#'), []);
});
test('relative links ignore code, URLs and anchors, and resolve from the linking file', () => {
  const page = ['[a](b.md) [up](../README.md#top) ![img](<img/one.png>) [dir](./sub/)', '[web](https://example.test/x) [mail](mailto:a@example.test) [here](#part) `[code](missing.md)`',
    '```', '[fenced](missing.md)', '```', '[encoded](%E8%AF%B4%E6%98%8E.md "title")'].join('\n');
  assert.deepEqual(relativeLinks(page), ['b.md', '../README.md#top', 'img/one.png', './sub/', '%E8%AF%B4%E6%98%8E.md']);
  const present = new Set(['.', 'README.md', 'docs', 'docs/b.md', 'docs/img', 'docs/img/one.png', 'docs/sub', 'docs/sub/x.md', 'docs/说明.md']);
  assert.deepEqual(brokenLinks('docs/a.md', page, present), []);
  present.delete('docs/b.md'); present.delete('docs/说明.md');
  assert.deepEqual(brokenLinks('docs/a.md', page, present), ['b.md', '%E8%AF%B4%E6%98%8E.md']);
  assert.deepEqual(brokenLinks('README.md', '[escape](../outside.md)', present), ['../outside.md']);
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
    result = run(); assert.equal(result.status, 0); assert.match(result.stdout, /0 repository violations/);
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

test('CLI rejects tracked evidence even when ignored or absent, oversized entry pages and broken links; recovery passes', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-governance-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const run = () => spawnSync(process.execPath, [resolve('.github/scripts/public-hygiene.mjs')], {cwd:root, encoding:'utf8'});
    mkdirSync(join(root, 'tests/evidence'), {recursive:true});
    mkdirSync(join(root, 'docs'), {recursive:true});
    writeFileSync(join(root, '.gitignore'), 'tests/evidence/\n.local/\n');
    const evidence = join(root, 'tests/evidence/capture.png');
    writeFileSync(evidence, Buffer.from([0, 1]));
    assert.equal(run().status, 0, 'ignored untracked output is allowed');
    execFileSync('git', ['add', '-f', 'tests/evidence/capture.png'], {cwd:root});
    let result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /git rm -r tests\/evidence/);
    rmSync(evidence);
    assert.equal(run().status, 1, 'missing working file is still tracked');
    execFileSync('git', ['rm', '--cached', '-f', 'tests/evidence/capture.png'], {cwd:root});
    writeFileSync(join(root, 'PROJECT-MAP.md'), '现'.repeat(2667));
    result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /PROJECT-MAP.md exceeds 8 KB/);
    writeFileSync(join(root, 'PROJECT-MAP.md'), 'a'.repeat(8_000));
    assert.equal(run().status, 0, 'exact byte limit is allowed');
    writeFileSync(join(root, 'AGENTS.md'), 'a'.repeat(4_001));
    result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /AGENTS.md exceeds 4 KB/);
    writeFileSync(join(root, 'AGENTS.md'), '读 [地图](PROJECT-MAP.md)，决定见 [记录](docs/DECISIONS.md)。\n');
    result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /AGENTS.md: broken relative links.*docs\/DECISIONS.md/);
    writeFileSync(join(root, 'docs/DECISIONS.md'), '# 决定\n');
    assert.equal(run().status, 0, 'every violation recovers without changing checks');
  } finally { rmSync(root, {recursive:true, force:true}); }
});
