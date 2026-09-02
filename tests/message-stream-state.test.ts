import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyMessageUpdate } from '../src/web/message-stream-state.js';

describe('stream message keyed incremental updates', () => {
  it('updates the current assistant node for deltas instead of re-adding/re-announcing history', () => {
    const messages: Array<{ id: string; kind: string; text: string }> = []; let next = 0;
    const createId = () => `m-${++next}`;
    const first = applyMessageUpdate(messages, 'assistant.delta', 'Hel', createId);
    const delta = applyMessageUpdate(messages, 'assistant.delta', 'lo', createId);
    const done = applyMessageUpdate(messages, 'assistant.completed', 'Hello', createId);
    assert.equal(first.mode, 'append'); assert.equal(delta.mode, 'update'); assert.equal(done.mode, 'update');
    assert.equal(messages.length, 1); assert.equal(messages[0].id, 'm-1'); assert.equal(messages[0].text, 'Hello');
    assert.equal(delta.announce, ''); assert.equal(done.announce, '助手回复完成');
  });
});
