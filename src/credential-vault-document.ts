/**
 * The encrypted-vault seam is deliberately injectable: Electron owns the real
 * safeStorage implementation, while this module owns the fail-closed document
 * semantics that must also hold for its exact encrypted bytes.
 */
export interface CredentialVaultDocument {
  schemaVersion: 2;
  credentials: Record<string, string>;
  legacyPayload?: unknown;
}

export interface EncryptedCredentialVaultStore {
  read(): CredentialVaultDocument;
  save(id: string, apiKey: string): void;
  remove(id: string): void;
}

const invalid = () => { throw new Error('模型凭据保险库不可读或尚未完成迁移。'); };
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
const validKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const unsafeOwnKey = (value: string) => value === '__proto__' || value === 'constructor' || value === 'prototype';

/** Whole-document validation.  In particular, prototype-shaped own keys are
 * rejected rather than copied through assignment into a normal object. */
export function validateCredentialVaultDocument(
  raw: unknown,
  validateLegacyPayload: (value: unknown) => boolean,
): CredentialVaultDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { schemaVersion?: unknown }).schemaVersion !== 2) invalid();
  const credentials = (raw as { credentials?: unknown }).credentials;
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) invalid();
  const checked: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [id, key] of Object.entries(credentials as Record<string, unknown>)) {
    if (!validId(id) || unsafeOwnKey(id) || !validKey(key)) invalid();
    Object.defineProperty(checked, id, { value: key, enumerable: true, configurable: false, writable: false });
  }
  const legacyPayload = (raw as { legacyPayload?: unknown }).legacyPayload;
  if (legacyPayload !== undefined && !validateLegacyPayload(legacyPayload)) invalid();
  return { schemaVersion: 2, credentials: checked, ...(legacyPayload === undefined ? {} : { legacyPayload }) };
}

/**
 * The read/save/remove operations all decrypt then validate the pre-existing
 * document before a write is possible.  This keeps corrupt ciphertext as the
 * only source of truth instead of silently replacing it with an empty vault.
 */
export function createEncryptedCredentialVaultStore(input: {
  exists: () => boolean;
  readBytes: () => Buffer;
  writeBytes: (bytes: Buffer) => void;
  decrypt: (bytes: Buffer) => string;
  encrypt: (text: string) => Buffer;
  validateLegacyPayload: (value: unknown) => boolean;
}): EncryptedCredentialVaultStore {
  const read = (): CredentialVaultDocument => {
    if (!input.exists()) return { schemaVersion: 2, credentials: {} };
    const raw = JSON.parse(input.decrypt(input.readBytes()));
    return validateCredentialVaultDocument(raw, input.validateLegacyPayload);
  };
  const write = (document: CredentialVaultDocument): void => {
    const checked = validateCredentialVaultDocument(document, input.validateLegacyPayload);
    input.writeBytes(input.encrypt(JSON.stringify(checked)));
  };
  return {
    read,
    save(id, apiKey) {
      if (!validId(id) || unsafeOwnKey(id) || !validKey(apiKey)) throw new TypeError('credential input is invalid');
      const current = read();
      write({ ...current, credentials: { ...current.credentials, [id]: apiKey } });
    },
    remove(id) {
      if (!validId(id) || unsafeOwnKey(id)) return;
      const current = read();
      const credentials = { ...current.credentials }; delete credentials[id];
      write({ ...current, credentials });
    },
  };
}
