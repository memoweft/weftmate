import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertModelProfileMutationAllowed } from '../src/model-profile-guard.ts';

describe('persistent model profile mutation guard', () => {
  it('rejects cold-start edit/delete mutations for a persisted session binding', () => {
    // `referenced` is intentionally an injected persisted fact; no sidebar or
    // in-memory session scan is needed before this guard decides.
    assert.throws(() => assertModelProfileMutationAllowed({ referenced: true, operation: 'edit', displayNameOnly: false }), /历史会话引用/);
    assert.throws(() => assertModelProfileMutationAllowed({ referenced: true, operation: 'delete' }), /历史会话引用/);
    assert.doesNotThrow(() => assertModelProfileMutationAllowed({ referenced: true, operation: 'edit', displayNameOnly: true }));
  });
});
