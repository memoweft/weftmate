import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runRecoverableProfileMutation } from '../src/model-mutation-transaction.ts';

describe('recoverable profile mutation transaction', () => {
  for (const failingStep of ['public', 'vault', 'patch', 'backfill', 'runtime-start', 'corrupt-delete']) {
    it(`restores one old shared runtime after ${failingStep} fails`, async () => {
      const old = { public: 'A', vault: Buffer.from([1, 2]), patch: Buffer.from([3]), runtime: 'one-old-runtime' };
      let state = structuredClone(old); let journal: unknown = null; let runtimes = 1;
      await assert.rejects(() => runRecoverableProfileMutation({
        snapshot: old,
        writeJournal: (snapshot) => { journal = { ...snapshot, vault: snapshot.vault.toString('base64') }; assert.equal(JSON.stringify(journal).includes('plaintext-secret'), false); },
        apply: async () => { state.public = 'B'; if (failingStep === 'public' || failingStep === 'backfill') throw new Error(failingStep); state.vault = Buffer.from([9]); if (failingStep === 'vault') throw new Error('vault'); state.patch = Buffer.from([8]); if (failingStep === 'patch') throw new Error('patch'); runtimes = 0; if (failingStep === 'runtime-start') throw new Error('runtime'); if (failingStep === 'corrupt-delete') throw new Error('corrupt'); return 'ok'; },
        restore: async (snapshot) => { state = structuredClone(snapshot); runtimes = 1; }, clearJournal: () => { journal = null; },
      }));
      assert.equal(state.public, old.public); assert.equal(state.runtime, old.runtime); assert.deepEqual(Buffer.from(state.vault), old.vault); assert.deepEqual(Buffer.from(state.patch), old.patch); assert.equal(runtimes, 1); assert.equal(journal, null);
    });
  }
});
