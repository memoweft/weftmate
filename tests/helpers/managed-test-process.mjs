import { spawn } from 'node:child_process';
import { cleanupOwnedProcesses, describeExit, redactEvidenceText, systemCommitMemory } from './process-evidence.mjs';
import { prepareNativeExitDiagnostics, collectNativeExitDiagnostics } from './native-exit-diagnostics.mjs';

/** Await termination before the caller removes its isolated temp scope. */
export async function runManagedTestProcess(command, args, { env, commandRoots = [], executables = [command], maxBuffer = 64 * 1024 * 1024, onOutput, timeoutMs, diagnosticDirectory } = {}) {
  const startedAt = Date.now();
  const diagnostics = diagnosticDirectory ? prepareNativeExitDiagnostics(diagnosticDirectory, args, env ?? process.env) : null;
  const child = spawn(command, diagnostics?.args ?? args, { env: diagnostics?.env ?? env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', error, interrupted = null, timedOut = false, escalation;
  const stop = signal => {
    if (interrupted) return;
    interrupted = signal;
    if (process.platform === 'win32') {
      // Creation time + executable + explicit suite paths, never a reused parent PID.
      cleanupOwnedProcesses({ startedAt, executables, commandRoots });
      if (child.exitCode === null && child.signalCode === null) child.kill();
      // An exited root can leave inherited pipes open in an owned descendant.
      // Close our readers after cleanup so the deadline also bounds `close`.
      child.stdout.destroy(); child.stderr.destroy();
    } else {
      try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
      escalation = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        child.stdout.destroy(); child.stderr.destroy(); }, 2000);
    }
  };
  const deadline = timeoutMs ? setTimeout(() => {
    timedOut = true;
    console.error(`Test file deadline exceeded (${timeoutMs}ms): ${redactEvidenceText(args.join(' '), commandRoots)}`);
    console.error(`Process evidence: ${JSON.stringify({ phase: 'file-timeout', systemCommit: systemCommitMemory(),
      stdoutTail: redactEvidenceText(stdout.slice(-8192), commandRoots), stderrTail: redactEvidenceText(stderr.slice(-8192), commandRoots) })}`);
    stop('SIGTERM');
  }, timeoutMs) : undefined;
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => stop(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  child.on('error', failure => { error = failure; });
  const collect = (stream, chunk) => {
    if (stream === 'stdout') stdout += chunk; else stderr += chunk;
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) { error = Error('Test output exceeded maxBuffer'); stop('SIGTERM'); }
    onOutput?.(stream, chunk);
  };
  child.stdout.on('data', chunk => collect('stdout', chunk));
  child.stderr.on('data', chunk => collect('stderr', chunk));
  try {
    const result = await new Promise(resolve => child.once('close', (status, signal) => resolve({ status, signal })));
    if (timedOut) console.error(`Timed-out process exit: ${JSON.stringify(describeExit(result.status, result.signal))}`);
    const evidence = result.status !== 0 || result.signal || error ? {
      ...describeExit(result.status, result.signal), phase: timedOut ? 'file-timeout' : 'file-exit',
      elapsedMs: Date.now() - startedAt, spawnErrorCode: error?.code ?? null,
      systemCommit: systemCommitMemory(), stdoutTail: redactEvidenceText(stdout.slice(-8192), commandRoots),
      stderrTail: redactEvidenceText(stderr.slice(-8192), commandRoots),
    } : undefined;
    if (evidence && diagnostics) {
      try {
        evidence.nativeExit = collectNativeExitDiagnostics(diagnostics.directory, { runnerPid: child.pid, stdout, stderr, roots: commandRoots });
      } catch { /* Observation must never change the process result. */ }
    }
    if (evidence) console.error(`Failed test process evidence: ${JSON.stringify(evidence)}`);
    return { ...result, stdout, stderr, error, interrupted, timedOut, evidence };
  } finally {
    clearTimeout(deadline); clearTimeout(escalation);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    // A successful test runner can still leave Electron grandchildren holding
    // its isolated scope. Recheck all three ownership conditions before cleanup.
    if (process.platform === 'win32' && commandRoots.length) {
      const cleanup=cleanupOwnedProcesses({ startedAt, executables, commandRoots });
      if(cleanup.cleaned||cleanup.failed)console.log(`Managed test cleanup: ${JSON.stringify(cleanup)}`);
    }
  }
}
