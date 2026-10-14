import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';
import { phasedTestProcess } from './helpers/phased-test-process.mjs';
import { cleanupOwnedProcesses } from './helpers/process-evidence.mjs';

const root = managedMkdtempSync('weftmate-bl29-config-'), startedAt = Date.now();
let probe;
before(async () => {
  const env = { ...process.env, TMPDIR: root, TMP: root, TEMP: root,
    BL29_EVIDENCE_DIR: root, WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
  delete env.ELECTRON_RUN_AS_NODE;
  probe = phasedTestProcess(process.execPath, ['tests/integration/bl29-rework/ui-extra.mjs', '--phased'], { env, roots: [root] });
  await probe.ready();
});

test('BL-29c N4 real Electron and mobile independently sync catalog, settings, personalization, rename and list within 7s', { timeout: 60000 }, async t => {
  const { report: r } = await probe.run(55000);
  t.diagnostic(JSON.stringify({ kind: 'independent-config-sync', ...r }));
  assert.equal(r.failure, undefined, JSON.stringify(r)); assert.deepEqual(r.errors, []);
  assert.deepEqual(r.individualChanges.map(row => row.kind), ['modelSettings', 'personalization', 'modelCatalog', 'modelRename', 'sessionList']);
  for (const change of r.individualChanges) for (const row of change.rows) {
    assert.equal(row.error, undefined, JSON.stringify(change)); assert.ok(row.ms <= 7000, JSON.stringify(change));
  }
  for (const row of r.rows) if (row.kind === 'rename') {
    assert.ok(row.desktop <= 6000, JSON.stringify(row)); assert.ok(row.mobile <= 6000, JSON.stringify(row));
  } else { assert.equal(row.error, undefined); assert.ok(row.ms <= 1000, JSON.stringify(row)); }
});

after(async () => {
  try {
    const exit = await probe?.done;
    if (exit) {
      console.log('BL-29 config phases:', JSON.stringify(exit.evidence));
      assert.equal(exit.code, 0, JSON.stringify(exit.evidence));
    }
  } finally {
    if (process.platform === 'win32') {
      const cleanup = cleanupOwnedProcesses({ startedAt, commandRoots: [root],
        executables: [process.execPath, createRequire(import.meta.url)('electron')] });
      assert.equal(cleanup.available, true); assert.equal(cleanup.failed, 0);
    }
    disposeManagedTemp(root);
  }
});
