import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createRouteMutationJournal, recoverRouteMutationJournalFiles } from '../src/route-mutation-journal.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function scene() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-route-journal-')); roots.push(root);
  const settings = join(root, 'settings.json'); const vault = join(root, 'vault.enc'); const patch = join(root, 'routes.patch'); const journal = join(root, 'recovery.json');
  writeFileSync(settings, 'new-public'); writeFileSync(vault, Buffer.from('new-vault')); writeFileSync(patch, Buffer.from('new-patch'));
  const restoreSettingsBytes = (value: Buffer | null) => { if (value === null) rmSync(settings, { force: true }); else writeFileSync(settings, value); };
  const restoreVaultBytes = (value: Buffer | null) => { if (value === null) rmSync(vault, { force: true }); else writeFileSync(vault, value); };
  return { settings, vault, patch, journal, api: createRouteMutationJournal({ journalPath: journal, patchPath: patch, restoreSettingsBytes, restoreVaultBytes }) };
}

describe('Stage 2 route mutation crash recovery', () => {
  for (const point of ['public', 'vault', 'patch'] as const) {
    it(`recovers old public/vault/patch bytes after a crash immediately after ${point} write`, () => {
      const value = scene(); const oldSettings = Buffer.from('{\n  "appearance": { "theme": "light" }\n}\n'); const oldVault = Buffer.from([0, 1, 255]); const oldPatch = Buffer.from('old-patch');
      value.api.write({ settingsSnapshot: oldSettings, vaultSnapshot: oldVault, patchSnapshot: oldPatch });
      const text = readFileSync(value.journal, 'utf8'); assert.equal(text.includes('stage2-plaintext-test-secret'), false);
      value.api.recover();
      assert.deepEqual(readFileSync(value.settings), oldSettings); assert.deepEqual(readFileSync(value.vault), oldVault); assert.deepEqual(readFileSync(value.patch), oldPatch); assert.equal(existsSync(value.journal), false);
    });
  }

  it('fails closed on corrupt journal and leaves all original files untouched', () => {
    const value = scene(); const originals = [readFileSync(value.settings), readFileSync(value.vault), readFileSync(value.patch)];
    writeFileSync(value.journal, '{"version":1,"settingsBytes":null,"vaultCiphertext":"***bad***","patchBytes":null}');
    assert.throws(() => value.api.recover(), /恢复记录损坏/);
    assert.deepEqual(readFileSync(value.settings), originals[0]); assert.deepEqual(readFileSync(value.vault), originals[1]); assert.deepEqual(readFileSync(value.patch), originals[2]); assert.equal(existsSync(value.journal), true);
  });

  it('recovers bytes with the bootstrap-only file seam before settings or vault modules can migrate them', () => {
    const value = scene(); const oldSettings = Buffer.from('old-public'); const oldVault = Buffer.from([9, 8, 7]); const oldPatch = Buffer.from('old-patch');
    value.api.write({ settingsSnapshot: oldSettings, vaultSnapshot: oldVault, patchSnapshot: oldPatch });
    recoverRouteMutationJournalFiles({ journalPath: value.journal, settingsPath: value.settings, vaultPath: value.vault, patchPath: value.patch });
    assert.deepEqual(readFileSync(value.settings), oldSettings); assert.deepEqual(readFileSync(value.vault), oldVault); assert.deepEqual(readFileSync(value.patch), oldPatch);
    assert.equal(existsSync(value.journal), false);
  });
});
