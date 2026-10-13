import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { cleanupOwnedProcesses } from './process-evidence.mjs';

export function probe(name, output, timeout = 60000, args = []) {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-bl29-regression-'));
  const startedAt = Date.now();
  try {
    // Every nested Electron profile belongs to this probe, including when its
    // Node controller times out before Playwright can close the application.
    const env = { ...process.env, TMPDIR:root, TMP:root, TEMP:root, BL29_EVIDENCE_DIR:root, WEFTMATE_TEST_HOST_NAME:'synthetic-host' };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.execPath, ['--report-on-fatalerror', '--report-exclude-env', `--report-directory=${root}`,
      `tests/integration/bl29-rework/${name}.mjs`, ...args], {
      env, windowsHide:true, encoding:'utf8', timeout, killSignal:'SIGKILL', maxBuffer:8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, JSON.stringify({probe:name,status:result.status,
      hex:typeof result.status==='number'?'0x'+(result.status>>>0).toString(16).toUpperCase().padStart(8,'0'):null,
      signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr,
      probeEvidence:result.status!==0&&existsSync(join(root,output))?readFileSync(join(root,output),'utf8'):null,
      fatalReports:result.status===0?[]:readdirSync(root).filter(file=>/^report.*\.json$/.test(file))
        .map(file=>({file,report:readFileSync(join(root,file),'utf8')}))}));
    return JSON.parse(readFileSync(join(root, output), 'utf8'));
  } finally {
    if (process.platform === 'win32') {
      const cleanup = cleanupOwnedProcesses({ startedAt, commandRoots:[root], executables:[process.execPath, createRequire(import.meta.url)('electron')] });
      assert.equal(cleanup.available, true, 'probe process cleanup must be available');
      assert.equal(cleanup.failed, 0, 'probe must not leave its owned processes running');
    }
    rmSync(root, {recursive:true, force:true, maxRetries:5, retryDelay:100});
  }
}

