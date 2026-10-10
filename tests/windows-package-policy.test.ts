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

describe('Windows candidate package policy', () => {
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
