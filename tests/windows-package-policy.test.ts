import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import {
  assertCandidateVersion,
  assertIsolatedOutput,
  containsDevelopmentPath,
  forbiddenArchiveEntry,
  packagedTextViolation,
  redactBuildMachineIdentity,
  stageRuntimeEntry,
} from '../scripts/windows-package-policy.mjs';
import { sanitizeUpdateFailure } from '../src/update-policy.ts';

describe('Windows candidate package policy', () => {
  const identity = { home: ['C:', 'Users', 'Synthetic Builder'].join('/'), username: 'Synthetic Builder', hostname: 'SYNTHETIC-BUILD-HOST', roots: ['D:/synthetic-build'] };
  it('allows upstream examples only in third-party files while rejecting local identity in every layer', () => {
    const upstream = ['C:', 'Users', 'Upstream Example', 'Desktop', 'test script.bat'].join('\\');
    const thirdParty = 'node_modules/node-pty/src/windowsPtyAgent.test.ts';
    assert.equal(packagedTextViolation(upstream, thirdParty, identity), null);
    for (const file of [thirdParty, 'src/main.mjs', 'plugins/weftmate-tools/index.js', 'node_modules/@weftmate/tools/index.js', 'desktop-config.json', 'relay/config.ini']) {
      for (const value of [identity.home + '/private', identity.home.replaceAll('/', '\\'), JSON.stringify(identity.home.replaceAll('/', '\\')), identity.username, identity.hostname, identity.roots[0] + '/source']) {
        assert.equal(packagedTextViolation(value, file, identity), 'build-machine-identity', file);
      }
    }
    for (const file of ['src/main.mjs', 'plugins/weftmate-tools/index.js', 'node_modules/weftmate-tools/index.js', 'config.json']) {
      assert.equal(packagedTextViolation(upstream, file, identity), 'development-path', file);
    }
    assert.equal(packagedTextViolation('unrelated Synthetic BuilderExtended word', thirdParty, identity), null);
    assert.equal(packagedTextViolation('D:/AIProjects/Shared/Dependencies/source.js', thirdParty, identity), 'build-machine-identity');
  });
  it('redacts runtime-read identities before serializing smoke diagnostics', () => {
    assert.equal(redactBuildMachineIdentity(identity.home + '/private on ' + identity.hostname, identity), 'C:/Users/<user>/private on <host>');
    assert.equal(redactBuildMachineIdentity('Synthetic BuilderExtended', identity), 'Synthetic BuilderExtended');
  });
  it('omits generated package-manager state while retaining runtime code, native bindings and upstream sources', () => {
    for (const path of ['tarballs/pkg.tgz', 'node_modules/.bin/dsh.cmd', 'node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm-workspace-state-v1.json']) assert.equal(stageRuntimeEntry(path), false, path);
    for (const path of ['VENDOR-MANIFEST.json', 'bin/dsh-web.cmd', 'node_modules/@deepseek-ai/dsh/lib/bin.js', 'node_modules/node-pty/src/example.test.ts', 'node_modules/node-pty/prebuilds/win32-x64/pty.node']) assert.equal(stageRuntimeEntry(path), true, path);
  });
  it('accepts explicit candidate revisions independently of the old Stage 3 name', () => {
    assert.equal(assertCandidateVersion('0.1.0-stage3.1'), '0.1.0-stage3.1');
    assert.equal(assertCandidateVersion('0.1.0-candidate.1'), '0.1.0-candidate.1');
    assert.equal(assertCandidateVersion('1.2.3-preview.2'), '1.2.3-preview.2');
    for (const value of ['0.1.0', '0.1.0-candidate', '1.0.0-candidate.01', '0.1.0-stage3.01']) {
      assert.throws(() => assertCandidateVersion(value), /major\.minor\.patch-label\.N/);
    }
  });

  it('allows external isolated output and only dist below the repository', () => {
    const repo = resolve('D:/AIProjects/WeftMate/Repository');
    assert.equal(assertIsolatedOutput(repo, resolve('D:/isolated-weftmate-builds/a')), resolve('D:/isolated-weftmate-builds/a'));
    assert.equal(assertIsolatedOutput(repo, resolve(repo, 'dist/candidate-a')), resolve(repo, 'dist/candidate-a'));
    assert.throws(() => assertIsolatedOutput(repo, resolve(repo, 'src/build-output')), /below dist/);
  });

  it('rejects repository tests, dogfood state, credentials and user-data files from app.asar', () => {
    for (const entry of ['/tests/a.test.ts', '/dogfood/data/vault', '/scripts/build.mjs', '/src/.credentials.yaml', '/src/weftmate-model.enc']) {
      assert.equal(forbiddenArchiveEntry(entry), true, entry);
    }
    assert.equal(forbiddenArchiveEntry('/src/main.mjs'), false);
  });

  it('detects development-machine paths and bounds updater errors', () => {
    assert.equal(containsDevelopmentPath('D:\\AIProjects\\WeftMate\\Repository\\src'), true);
    assert.equal(containsDevelopmentPath('C:/Users/<user>/private'), true);
    assert.equal(containsDevelopmentPath('resources/dsh-runtime'), false);
    const failure = sanitizeUpdateFailure(new Error('ENOENT C:\\Users\\<user>\\private\\latest.yml token=secret'));
    assert.doesNotMatch(failure, /C:|<user>|token|secret|ENOENT/);
    assert.match(sanitizeUpdateFailure(new Error('signature mismatch')), /签名/);
  });
});
