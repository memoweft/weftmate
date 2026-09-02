import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendMessageNode, updateMessageNode } from '../src/web/message-dom-updates.js';
import { retryPromptForSession } from '../src/web/session-retry.js';

describe('Stage 2 incremental interaction state', () => {
  it('appends a new message and updates a delta without replacing historical node identity', () => {
    const old = { dataset: { messageId: 'old' }, textContent: 'history' };
    const root = {
      children: [old] as any[],
      append(node: any) { this.children.push(node); },
      querySelector(selector: string) { const id = selector.match(/message-id="([^"]+)/)?.[1]; return this.children.find((node) => node.dataset.messageId === id) ?? null; },
    };
    const fresh = appendMessageNode(root, { id: 'new', text: 'first' }, (item: any) => ({ dataset: { messageId: item.id }, textContent: item.text }));
    assert.equal(root.children[0], old); assert.equal(root.children[1], fresh);
    assert.equal(updateMessageNode(root, 'new', 'streamed'), fresh); assert.equal(fresh.textContent, 'streamed'); assert.equal(root.children[0], old);
  });

  it('derives retry input from the selected session only', () => {
    const prompts = new Map([['session-a', 'A prompt']]);
    const messages = new Map([['session-b', [{ kind: 'user', text: 'B prompt' }]]]);
    assert.equal(retryPromptForSession(prompts, messages, 'session-b'), 'B prompt');
    assert.equal(retryPromptForSession(prompts, messages, 'session-a'), 'A prompt');
  });
});
