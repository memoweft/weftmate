import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { desktopAuthStorage } from '../src/personal-desktop-auth.mjs';

function storage() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-auth-presence-'));
  const file = join(root, 'synthetic.enc'); let available = true;
  const encryption = { isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(value).map(byte => byte ^ 0xa7),
    decryptString: (value: Buffer) => Buffer.from(value).map(byte => byte ^ 0xa7).toString() };
  return { file, encryption, store: desktopAuthStorage(file, encryption),
    unavailable: () => { available = false; }, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test('native presence query distinguishes no cloud credentials from configuration and account caches without changing storage', () => {
  const f = storage();
  try {
    assert.equal(f.store.cloudCredentialsPresent(['owner-a', 'owner-b']), false);
    f.store.key('synthetic-device');
    f.store.credentials('offline-config:http://127.0.0.1:31001', { issuer: 'https://cloud.example.test/personal/v1/cloud/oidc', clientId: 'synthetic', hostId: 'synthetic-host', capabilities: { cloudChannel: 1 } });
    f.store.credentials('offline-account', { sub: 'synthetic-sub', email: 'synthetic@example.test', deviceName: 'Synthetic' });
    f.store.credentials('draft:synthetic-sub', 'Synthetic draft text');
    f.store.credentials('trusted-host:synthetic-host', { tlsSpki: 'synthetic-public-pin', publicJwk: { kty: 'EC' }, origin: 'https://host.example.test' });
    for (const owner of ['owner-a', 'owner-b']) {
      f.store.credentials('weftmate:message-mode:' + owner, 'steer');
      f.store.credentials('weftmate:message-feedback:' + owner, '[]');
      f.store.credentials('weftmate:sent-feedback:' + owner, '[]');
    }
    const before = readFileSync(f.file);
    assert.equal(f.store.cloudCredentialsPresent(['owner-a', 'owner-b']), false);
    assert.deepEqual(readFileSync(f.file), before, 'The boolean query must not rewrite keys, drafts or other account caches');
    assert.equal(f.store.credentials('draft:synthetic-sub'), 'Synthetic draft text');
  } finally { f.dispose(); }
});

test('native presence query recognizes current and legacy token records and returns only a boolean', () => {
  for (const value of [{ refreshToken: 'synthetic-refresh', cloud: { token: 'synthetic-access', expiresAt: 1 }, sub: 'synthetic-sub' },
    { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', sub: 'synthetic-sub' }]) {
    const f = storage();
    try {
      f.store.credentials('synthetic-hidden-token-key', value);
      const before = readFileSync(f.file), present = f.store.cloudCredentialsPresent([]);
      assert.equal(present, true); assert.equal(typeof present, 'boolean');
      assert.deepEqual(readFileSync(f.file), before);
      assert.deepEqual(f.store.credentials('synthetic-hidden-token-key'), value);
    } finally { f.dispose(); }
  }
});

test('unknown stored credential shapes cannot be reported as absent or deleted', () => {
  for (const value of [{ opaqueSecret: 'synthetic-other-value' }, 'synthetic-unknown-legacy-record',
    { issuer: 'synthetic', clientId: 'synthetic', hostId: 'synthetic', unknownField: 'synthetic' }]) {
    const f = storage();
    try {
      f.store.credentials('synthetic-other-credential', value);
      const before = readFileSync(f.file);
      assert.throws(() => f.store.cloudCredentialsPresent([]), (error: any) => error.message === 'STORAGE_UNAVAILABLE');
      assert.deepEqual(readFileSync(f.file), before);
    } finally { f.dispose(); }
  }
});

test('unexpected offline account fields are not mistaken for harmless account metadata', () => {
  const f = storage();
  try {
    f.store.credentials('offline-account', { sub: 'synthetic-sub', opaqueSecret: 'synthetic-legacy-value' });
    assert.throws(() => f.store.cloudCredentialsPresent([]), (error: any) => error.message === 'STORAGE_UNAVAILABLE');
  } finally { f.dispose(); }
});

test('native presence query fails closed on unavailable encryption, damaged JSON and unknown store roots', () => {
  for (const failure of ['encryption', 'json', 'root']) {
    const f = storage();
    try {
      if (failure === 'encryption') f.unavailable();
      else writeFileSync(f.file, f.encryption.encryptString(failure === 'json' ? '{damaged' : '[]'));
      assert.throws(() => f.store.cloudCredentialsPresent([]), (error: any) => error.message === 'STORAGE_UNAVAILABLE');
    } finally { f.dispose(); }
  }
});

test('the native preload presence query exposes no key or enumeration arguments', async () => {
  let api: any; const calls: unknown[][] = [];
  const electron = { contextBridge: { exposeInMainWorld: (_name: string, value: any) => { api = value; } },
    ipcRenderer: { on: () => {}, invoke: async (...args: unknown[]) => { calls.push(args); return false; } }, webUtils: {} };
  runInNewContext(readFileSync(new URL('../src/personal-desktop-preload.cjs', import.meta.url), 'utf8'),
    { require: () => electron, process: { platform: 'win32' } });
  assert.equal(await api.cloudCredentialsPresent('forged-key', ['forged-owner']), false);
  assert.deepEqual(calls, [['wm:desktop:cloud-credentials-present']]);
});
