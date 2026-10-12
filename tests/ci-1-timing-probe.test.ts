// Temporary CI-1 fault injection. Removed before the final six runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
test('CI-1 temporary clock budget passes only on second file attempt', () => {
  const marker = '.local/ci-1-timing-probe-attempt';
  const repeated = existsSync(marker);
  mkdirSync('.local', {recursive:true}); writeFileSync(marker,'synthetic attempt');
  const started = Date.now() - (repeated ? 0 : 6000);
  assert.ok(Date.now() - started <= 5000, 'synthetic wall-clock budget');
});
