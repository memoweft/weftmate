import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createEncryptedCredentialVaultStore } from '../src/credential-vault-document.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function encryptedStore(payload: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-vault-bytes-')); roots.push(root);
  const file = join(root, 'weftmate-model.enc');
  // This is a real encode/decode store seam: bytes on disk are opaque to the
  // vault operations and each operation decrypts them again before mutation.
  const encrypt = (text: string) => Buffer.from(`cipher:${Buffer.from(text).toString('base64')}`, 'utf8');
  const decrypt = (bytes: Buffer) => {
    const value = bytes.toString('utf8'); if (!value.startsWith('cipher:')) throw new Error('cannot decrypt');
    return Buffer.from(value.slice('cipher:'.length), 'base64').toString('utf8');
  };
  writeFileSync(file, encrypt(JSON.stringify(payload)));
  return { file, store: createEncryptedCredentialVaultStore({ exists: () => true, readBytes: () => readFileSync(file), writeBytes: (bytes) => writeFileSync(file, bytes), encrypt, decrypt,
    validateLegacyPayload: (value) => !!value && typeof value === 'object' && (value as { source?: unknown }).source === 'stage1-combined' && !!(value as { document?: unknown }).document }) };
}

describe('Stage 2 encrypted credential vault byte preservation', () => {
  for (const [name, payload] of [
    ['one invalid credential entry', { schemaVersion: 2, credentials: { good: 'valid-key', broken: '' } }],
    ['an invalid retained legacyPayload', { schemaVersion: 2, credentials: { good: 'valid-key' }, legacyPayload: { source: 'wrong', document: {} } }],
    ['an own __proto__ credential key', JSON.parse('{"schemaVersion":2,"credentials":{"good":"valid-key","__proto__":"evil-key"}}')],
  ] as const) {
    it(`read, save and remove reject ${name} without changing original encrypted bytes`, () => {
      const { file, store } = encryptedStore(payload); const original = readFileSync(file);
      assert.throws(() => store.read(), /保险库不可读/);
      assert.deepEqual(readFileSync(file), original);
      assert.throws(() => store.save('new', 'new-valid-key'), /保险库不可读/);
      assert.deepEqual(readFileSync(file), original);
      assert.throws(() => store.remove('good'), /保险库不可读/);
      assert.deepEqual(readFileSync(file), original);
    });
  }
});
