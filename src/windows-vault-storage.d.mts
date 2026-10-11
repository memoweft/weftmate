export function durableReplace(file: string, bytes: Buffer): void;
export function cleanupVaultTemporaries(directory: string, now?: number): void;
export function persistedWindowsStorageKey(storage: { encryptString(text: string): Buffer }, sessionDirectory: string, options?: { timeoutMs?: number }): Promise<void>;
