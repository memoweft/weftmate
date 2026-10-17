export function durableReplace(file: string, bytes: Buffer): void;
export function cleanupVaultTemporaries(directory: string, now?: number): void;
export type WindowsStorageDiagnosticCode = 'none'|'unknown'|'EACCES'|'EPERM'|'ENOENT'|'EIO'|'EINVAL'|'ENOSPC'|'ETIMEDOUT'|'ENOBUFS'|'EAGAIN'|'ENOMEM';
export interface WindowsStorageReadinessDiagnostic {
  readonly version: 1;
  readonly phase: 'availability'|'probe'|'local-state-read'|'local-state-parse'|'proof-child'|'proof-auth'|'local-state-open'|'local-state-fsync'|'local-state-close'|'complete';
  readonly outcome: 'ready'|'deadline'|'exception';
  readonly elapsedMs: number|null;
  readonly availabilityChecks: number;
  readonly lastAvailability: boolean|null;
  readonly probeCreated: boolean;
  readonly probeVersion: 'not-checked'|'v10'|'other';
  readonly localState: 'not-read'|'string-key'|'missing-key'|'non-string-key'|'read-error'|'parse-or-shape-error';
  readonly proofAttempts: number;
  readonly childStatus: number|null;
  readonly childSignal: 'SIGTERM'|'SIGKILL'|'SIGINT'|'SIGABRT'|'SIGSEGV'|'SIGBREAK'|'unknown'|null;
  readonly childError: WindowsStorageDiagnosticCode;
  readonly childTimedOut: boolean;
  readonly childTimeoutMs: number|null;
  /** Proof process lifetime, including waiting for Chromium's persisted key on stdin. */
  readonly childElapsedMs: number|null;
  readonly childStdoutBytes: number|null;
  readonly childStderrBytes: number|null;
  readonly authResult: 'not-attempted'|'matched'|'mismatched'|'failed';
  readonly fsyncAttempted: boolean;
  readonly fsyncSucceeded: boolean;
  readonly closeAttempted: boolean;
  readonly closeSucceeded: boolean;
  readonly exceptionCode: WindowsStorageDiagnosticCode;
}
export function persistedWindowsStorageKey(storage: { isEncryptionAvailable(): boolean; encryptString(text: string): Buffer }, sessionDirectory: string, options?: { timeoutMs?: number; onDiagnostic?: (diagnostic: Readonly<WindowsStorageReadinessDiagnostic>)=>unknown }): Promise<void>;
