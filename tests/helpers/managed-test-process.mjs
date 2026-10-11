import { spawn } from 'node:child_process';
import { cleanupOwnedProcesses } from './process-evidence.mjs';

/** Await termination before the caller removes its isolated temp scope. */
export async function runManagedTestProcess(command, args, { env, commandRoots = [], executables = [command], maxBuffer = 64 * 1024 * 1024, onOutput } = {}) {
  const startedAt = Date.now();
  const child = spawn(command, args, { env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', error, interrupted = null;
  const stop = signal => {
    if (interrupted) return;
    interrupted = signal;
    if (process.platform === 'win32') {
      // Creation time + executable + explicit suite paths, never a reused parent PID.
      cleanupOwnedProcesses({ startedAt, executables, commandRoots });
      if (child.exitCode === null && child.signalCode === null) child.kill();
    } else {
      try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
    }
  };
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
    return { ...result, stdout, stderr, error, interrupted };
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    // A successful test runner can still leave Electron grandchildren holding
    // its isolated scope. Recheck all three ownership conditions before cleanup.
    if (process.platform === 'win32' && commandRoots.length) {
      const cleanup=cleanupOwnedProcesses({ startedAt, executables, commandRoots });
      if(cleanup.cleaned||cleanup.failed)console.log(`Managed test cleanup: ${JSON.stringify(cleanup)}`);
    }
  }
}
