export function durableReplace(file: string, bytes: Buffer): void;
export function readWrappedStorageKey(directory: string): string;
export function persistWrappedStorageKey(directory: string, wrappedKey: string): void;
export function restoreVaultLocalState(directory: string, sessionDirectory?: string): void;
export function persistedWindowsStorageKey(storage: { encryptString(text: string): Buffer }, sessionDirectory: string, options?: { timeoutMs?: number }): Promise<string>;
