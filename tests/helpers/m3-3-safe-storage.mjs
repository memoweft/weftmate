/** Test-only authenticated encryption. It never opens a system keychain. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const key = Buffer.from(process.env.M3_3_TEST_VAULT_KEY || '', 'base64');
delete process.env.M3_3_TEST_VAULT_KEY;
if (key.length !== 32) throw Error('M3_3_TEST_VAULT_KEY must be generated in the fixture parent');
export const fixtureSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(text) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    const content = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), content]);
  },
  decryptString(bytes) {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  },
};
