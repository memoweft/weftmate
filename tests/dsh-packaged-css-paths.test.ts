import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { buildMachineIdentity, containsBuildMachineIdentity, packagedTextViolation } from '../scripts/windows-package-policy.mjs';

test('pinned vendor CSS virtual modules use portable source IDs instead of build-machine paths', () => {
  const bundle = readFileSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', 'utf8');
  assert.match(bundle, /@deepseek-ai\/dsh-client-ui-conversation\/ConversationRoot\.module\.css/, 'must exercise actual emitted CSS modules');
  assert.doesNotMatch(bundle, /dsh-css:(?:[a-z]:[\\/]|\/)/i);
  assert.equal(containsBuildMachineIdentity(bundle, buildMachineIdentity()), false);
});

test('packaged DevTools chunks use relative CSS virtual module IDs', () => {
  const directory = 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/chunks';
  const chunks = readdirSync(directory).filter(file => file.endsWith('.js'));
  assert.ok(chunks.length > 0, 'must exercise actual emitted DevTools chunks');
  const identity = buildMachineIdentity();
  let cssIds = 0;
  for (const file of chunks) {
    const bundle = readFileSync(`${directory}/${file}`, 'utf8');
    assert.doesNotMatch(bundle, /dsh-devtools:css:(?:[a-z]:[\\/]|\/)/i, file);
    const checkIdentity = /^lighthouse-/.test(file) && identity.username === 'runner' ? { ...identity, username: null } : identity;
    assert.equal(containsBuildMachineIdentity(bundle, checkIdentity), false, file);
    for (const match of bundle.matchAll(/dsh-devtools:css:([^\r\n]+?\.css\.mjs)/g)) {
      cssIds++;
      assert.match(match[1], /^[a-zA-Z0-9_-]+\//, file);
      assert.doesNotMatch(match[1], /[:\\]|(?:^|\/)\.\.(?:\/|$)/, file);
    }
  }
  assert.ok(cssIds > 0, 'must exercise actual emitted CSS virtual module IDs');
});

test('exact upstream DSH vocabulary bytes allow name collisions but reject tampering and paths', () => {
  const identity = { home: ['C:', 'Users', 'Synthetic Builder'].join('/'), username: 'Synthetic Builder', hostname: 'SYNTHETIC-BUILD-HOST', roots: ['D:/synthetic-build'] };
  const files = [
    'dsh-runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/entrypoints/lighthouse_worker/lighthouse_worker.js',
  ];
  if (process.platform === 'win32' && process.arch === 'x64') {
    files.push(
      'dsh-runtime/node_modules/@deepseek-ai/libreoffice-kit-win32-x64/program/share/liblangtag/language-subtag-registry.xml',
      'dsh-runtime/node_modules/@deepseek-ai/libreoffice-kit-win32-x64/program/share/liblangtag/common/bcp47/currency.xml',
    );
  }
  for (const file of files) {
    const text = readFileSync(`vendor/${file}`, 'utf8');
    for (const coincidental of [{ ...identity, username: 'yun' }, { ...identity, hostname: 'yun' }]) {
      assert.equal(packagedTextViolation(text, file, coincidental), null, file);
      assert.equal(packagedTextViolation(text + '\n', file, coincidental), 'build-machine-identity', file);
      assert.equal(packagedTextViolation(text, file + '.copy', coincidental), 'build-machine-identity', file);
      assert.equal(packagedTextViolation(text, file, { ...coincidental, home: 'yun' }), 'build-machine-identity', file);
      assert.equal(packagedTextViolation(text, file, { ...coincidental, roots: ['yun'] }), 'build-machine-identity', file);
    }
    const repoSource = ['Y:', 'AIProjects', 'WeftMate', 'Repository', 'source'].join('/');
    for (const inserted of [identity.home + '/private', identity.hostname, identity.roots[0] + '/source', identity.username, repoSource]) {
      assert.equal(packagedTextViolation(text + '\n' + inserted, file, identity), 'build-machine-identity', file);
    }
  }
});
