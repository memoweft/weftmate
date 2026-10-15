// Temporary CI-5 proof: use exactly the canonical temp ownership of ordinary CI.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { managedMkdtempSync, disposeManagedTemp, startManagedTempLease } from '../../tests/helpers/managed-temp.mjs';
import { runManagedTestProcess } from '../../tests/helpers/managed-test-process.mjs';

const require = createRequire(import.meta.url);
const files = ['bl-29-timing-approval', 'bl-29-timing-config', 'bl-29-rework', 'personal-access-desktop',
  'rob-1-electron', 'rob-1-storage', 'ci-test-policy'].map(name => `tests/${name}.test.ts`);
const output = resolve('.local/evidence/ci-5'); mkdirSync(output, { recursive: true });
for (let round = 1; round <= 5; round++) {
  const root = managedMkdtempSync('weftmate-ci5-'), stopLease = startManagedTempLease(root);
  const log = resolve(output, `round-${round}.log`); writeFileSync(log, '');
  console.log(`CI-5 strict round ${round} of 5; canonical isolated temp`);
  try {
    const env = { ...process.env, TMPDIR: root, TMP: root, TEMP: root, WEFTMATE_TEST_TEMP_SCOPE: root,
      WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
    const run = await runManagedTestProcess(process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap', `--report-directory=${root}`, ...files],
      { env, timeoutMs: 20 * 60 * 1000, commandRoots: [root, process.cwd()],
        executables: [process.execPath, require('electron'), require('playwright').chromium.executablePath()],
        onOutput(stream, chunk) { process[stream].write(chunk); appendFileSync(log, chunk); } });
    assert.equal(run.status, 0, JSON.stringify(run.evidence));
    assert.equal(run.timedOut, false); assert.equal(run.error, undefined);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Round ${round} passed\n`);
  } finally {
    stopLease(); disposeManagedTemp(root); assert.equal(existsSync(root), false, 'proof temp fully removed');
  }
}
