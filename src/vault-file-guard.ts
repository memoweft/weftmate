/** Generic fail-closed order for encrypted vault mutations. */
export function mutateReadableVault<T>(input: {
  exists: boolean;
  read: () => T;
  mutate: (current: T | null) => T;
  write: (next: T) => void;
}): void {
  // Reading happens before the mutation callback or any write. If a preexisting
  // encrypted document cannot be read/decrypted/validated, callers throw and
  // its original bytes remain the sole source of truth.
  const current = input.exists ? input.read() : null;
  input.write(input.mutate(current));
}
