import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { switchActiveModel } from '../src/model-switch-transaction.ts';

describe('Stage 2 active-model future-session preference', () => {
  it('does not mutate activeId when the requested profile has no credential', async () => {
    let activeId: string | null = 'old'; let writes = 0;
    await assert.rejects(() => switchActiveModel({ id: 'missing-key', list: () => ({ profiles: [{ id: 'old' }, { id: 'missing-key' }], activeId }), hasCredential: (id) => id === 'old', setActive: (id) => { writes++; activeId = id; return true; } }));
    assert.equal(activeId, 'old'); assert.equal(writes, 0);
  });

  it('changes only the persisted preference and does not own a runtime restart operation', async () => {
    let activeId: string | null = 'old'; let writes = 0;
    await switchActiveModel({ id: 'new', list: () => ({ profiles: [{ id: 'old' }, { id: 'new' }], activeId }), hasCredential: () => true, setActive: (id) => { writes++; activeId = id; return true; } });
    assert.equal(activeId, 'new'); assert.equal(writes, 1);
    assert.doesNotMatch(switchActiveModel.toString(), /restart|\.close\(/);
  });
});
