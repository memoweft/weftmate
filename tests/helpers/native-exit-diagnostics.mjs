import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectReport } from './native-exit-observer.cjs';
import { redactEvidenceText } from './process-evidence.mjs';

/** Best effort only. Caller retains the exact exit status, streams and error. */
export function prepareNativeExitDiagnostics(directory, args, env) {
  try {
    const snapshots = join(directory, 'native-exit'); mkdirSync(snapshots, { recursive: true });
    return { args: ['--report-on-fatalerror', '--report-exclude-env', '--report-exclude-network',
      `--report-directory=${snapshots}`, '--require', fileURLToPath(new URL('./native-exit-observer.cjs', import.meta.url)),
      ...args.filter(arg => !arg.startsWith('--report-directory='))],
      env: { ...env, WEFTMATE_NATIVE_EXIT_DIR: snapshots }, directory: snapshots };
  } catch { return null; }
}

export function collectNativeExitDiagnostics(directory, { runnerPid, stdout, stderr, roots = [] }) {
  try {
    const snapshots = [], reports = [], unreadable = [];
    for (const file of readdirSync(directory)) {
      if (!/^(?:native-\d+-\d+|report\..+)\.json$/.test(file)) continue;
      try {
        const data = JSON.parse(readFileSync(join(directory, file), 'utf8'));
        if (file.startsWith('native-')) snapshots.push(data);
        else reports.push({ file, ...projectReport(data) });
      } catch { unreadable.push(file); }
    }
    // Only the observer's metadata fields belong in the public summary.
    const safeSnapshots = snapshots.map(row => ({ pid: row.pid, ppid: row.ppid, threadId: row.threadId,
      nodeVersion: row.nodeVersion, platform: row.platform, arch: row.arch, phase: row.phase,
      capturedAt: row.capturedAt, reportAvailable: row.reportAvailable,
      sharedObjects: row.sharedObjects, nativeStack: row.nativeStack, resources: row.resources,
      activeChildren: row.activeChildren, lastChildExit: row.lastChildExit }));
    const tail = text => redactEvidenceText(text.slice(-8192), roots).split(/\r?\n/).slice(-80);
    return { runnerPid, snapshots: safeSnapshots, reports, unreadable,
      outputTail: tail(stdout), stderrTail: tail(stderr), tailLines: 80,
      coverage: 'Node runner/file workers only; child_process async spawns; last snapshot may precede native failure; missing data is unknown' };
  } catch { return { runnerPid, available: false }; }
}
