import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import {
  assertCandidateVersion,
  assertIsolatedOutput,
  containsDevelopmentPath,
  forbiddenArchiveEntry,
} from '../scripts/windows-package-policy.mjs';
import { sanitizeUpdateFailure } from '../src/update-policy.ts';

describe('Stage 3 Windows package policy', () => {
  it('accepts only explicit Stage 3 prerelease versions', () => {
    assert.equal(assertCandidateVersion('0.1.0-stage3.1'), '0.1.0-stage3.1');
    for (const value of ['0.1.0', '0.1.0-stage3', '1.0.0-stage3.1', '0.1.0-stage3.01']) {
      assert.throws(() => assertCandidateVersion(value), /0\.1\.0-stage3\.N/);
    }
  });

  it('allows external isolated output and only dist below the repository', () => {
    const repo = resolve('D:/AIProjects/WeftMate/Repository');
    assert.equal(assertIsolatedOutput(repo, resolve('D:/AIProjects/WeftMate/Runtime/Stage3/builds/a')), resolve('D:/AIProjects/WeftMate/Runtime/Stage3/builds/a'));
    assert.equal(assertIsolatedOutput(repo, resolve(repo, 'dist/stage3-a')), resolve(repo, 'dist/stage3-a'));
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
    assert.equal(containsDevelopmentPath('C:/Users/yun/private'), true);
    assert.equal(containsDevelopmentPath('resources/dsh-runtime'), false);
    const failure = sanitizeUpdateFailure(new Error('ENOENT C:\\Users\\yun\\private\\latest.yml token=secret'));
    assert.doesNotMatch(failure, /C:|yun|token|secret|ENOENT/);
    assert.match(sanitizeUpdateFailure(new Error('signature mismatch')), /签名/);
  });
});
