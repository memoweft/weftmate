import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import '../src/ui-core/offline.js';

const W = (globalThis as any).WeftOffline;
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'queue transition completed');
};
async function fixture(initial?: any) {
  let saved = initial || { snapshot: null, turns: [], conversations: [] };
  const calls: any[] = [], releases: (() => void)[] = [];
  const engine = await W.create({
    identity: {}, crypto: webcrypto, accountCheck: async () => {}, phoneModel: () => ({ modelId: 'test-model' }),
    vault: { load: async () => structuredClone(saved), save: async (value: any) => { saved = structuredClone(value); }, close() {},
      complete: async (body: any, _snapshot: any, signal: AbortSignal, progress: any) => {
        const text = body.messages.at(-1).content; calls.push(body); progress(`partial:${text}`);
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
          signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
          releases.push(resolve);
        });
        return { choices: [{ message: { content: `answer:${text}` } }] };
      } },
  });
  return { engine, calls, releases, saved: () => saved };
}

test('phone accepts three inputs immediately, persists queued messages, and replies in order in one conversation', async () => {
  const f = await fixture();
  const first = await f.engine.enqueue('one'); await until(() => f.calls.length === 1);
  await f.engine.enqueue('two', first.conversationId);
  await f.engine.enqueue('three', first.conversationId);
  assert.deepEqual(f.saved().pendingMessages.map((m: any) => m.text), ['two', 'three']);
  assert.equal(f.calls.length, 1);
  f.releases.shift()!(); await until(() => f.calls.length === 2);
  assert.deepEqual(f.calls[1].messages.slice(-3).map((m: any) => m.content), ['one', 'answer:one', 'two']);
  f.releases.shift()!(); await until(() => f.calls.length === 3);
  f.releases.shift()!(); await until(() => !f.engine.view().running);
  const conversations = f.engine.view().conversations;
  assert.equal(conversations.length, 1);
  assert.deepEqual(conversations[0].turns.flatMap((t: any) => t.messages.map((m: any) => m.text)),
    ['one', 'answer:one', 'two', 'answer:two', 'three', 'answer:three']);
  assert.equal(f.saved().pendingMessages.length, 0); f.engine.close();
});

test('stop cancels the active transport immediately and continues the queued input without losing partial text', async () => {
  const f = await fixture(); const first = await f.engine.enqueue('one'); await until(() => f.calls.length === 1);
  await f.engine.enqueue('two', first.conversationId); f.engine.stop();
  await until(() => f.calls.length === 2);
  assert.equal(f.engine.view().conversations[0].turns[0].messages[1].text, 'partial:one');
  f.releases.at(-1)!(); await until(() => !f.engine.view().running); f.engine.close();
});

test('encrypted vault payload restores pending messages to their original conversation after restart', async () => {
  const first = await fixture(); const receipt = await first.engine.enqueue('one'); await until(() => first.calls.length === 1);
  await first.engine.enqueue('two', receipt.conversationId); first.engine.close();
  const second = await fixture(first.saved()); second.engine.resumeQueue();
  await until(() => second.calls.length === 1);
  second.releases.shift()!(); await until(() => !second.engine.view().running);
  assert.equal(second.engine.view().conversations[0].id, receipt.conversationId);
  assert.equal(second.engine.view().conversations[0].turns.at(-1).messages[0].text, 'two'); second.engine.close();
});

test('steer interrupts the active phone response and handles the follow-up before queued messages', async () => {
  const f = await fixture(); const first = await f.engine.enqueue('one'); await until(() => f.calls.length === 1);
  await f.engine.enqueue('later', first.conversationId);
  await f.engine.enqueue('adjust', first.conversationId, 'steer'); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].messages.at(-1).content, 'adjust');
  f.releases.at(-1)!(); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].messages.at(-1).content, 'later');
  f.releases.at(-1)!(); await until(() => !f.engine.view().running); f.engine.close();
});
