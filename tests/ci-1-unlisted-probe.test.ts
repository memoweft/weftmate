// Temporary CI-1 fault injection. Removed before the final six runs.
import test from 'node:test';
import assert from 'node:assert/strict';
test('CI-1 temporary unlisted functional failure must block', () => {
  assert.equal('deliberate failure', 'must remain red');
});
