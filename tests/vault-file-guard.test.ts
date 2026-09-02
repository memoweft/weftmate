import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { mutateReadableVault } from '../src/vault-file-guard.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('encrypted vault mutation guard', () => {
  it('leaves corrupt ciphertext bytes untouched when a save/remove pre-read fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-vault-guard-')); roots.push(root); const file = join(root, 'weftmate-model.enc'); const original = Buffer.from([0, 255, 1, 7, 3]); writeFileSync(file, original);
    for (const operation of ['save', 'remove']) {
      assert.throws(() => mutateReadableVault({ exists: true, read: () => { throw new Error('cannot decrypt'); }, mutate: () => ({ operation }), write: (next) => writeFileSync(file, JSON.stringify(next)) }));
      assert.deepEqual(readFileSync(file), original);
    }
  });
});
