import test from 'node:test';
import assert from 'node:assert/strict';
import { browserConversationScope } from '../src/personal-browser/scope.mjs';
import { DesktopBrowser } from '../src/personal-browser/desktop.mjs';

test('browser belongs to the logical conversation across execution segments', () => {
  const account = { sessions: { a: {}, b: {}, other: {}, deleting: { deleting: true } },
    chatIdentity: { chats: { chat: {}, second: {} }, segments: {
      first: { sessionId: 'a', chatId: 'chat' }, next: { sessionId: 'b', chatId: 'chat' },
      other: { sessionId: 'other', chatId: 'second' },
    } } };
  assert.equal(browserConversationScope(account, 'a'), 'chat');
  assert.equal(browserConversationScope(account, 'b'), 'chat');
  assert.equal(browserConversationScope(account, 'chat'), 'chat');
  assert.equal(browserConversationScope(account, 'other'), 'second');
  assert.throws(() => browserConversationScope(account, 'missing'), /BROWSER_CONVERSATION_UNAVAILABLE/);
  assert.throws(() => browserConversationScope({ sessions: {} }, '__proto__'), /BROWSER_CONVERSATION_UNAVAILABLE/);
  assert.throws(() => browserConversationScope(account, 'deleting'), /BROWSER_CONVERSATION_UNAVAILABLE/);
  account.sessions.a.deleting = true;
  assert.throws(() => browserConversationScope(account, 'chat'), /BROWSER_CONVERSATION_UNAVAILABLE/);
  assert.equal(browserConversationScope(account, 'a', true), 'chat', 'deletion can still release its browser');
});

test('deleting an account conversation with no desktop tabs does not require browser authority', async () => {
  const browser = new DesktopBrowser({ resolveScope: () => { throw new Error('not the installation owner'); } });
  await browser.releaseSession('another-account', 'its-conversation');
  assert.equal(browser.tabs.size, 0);
});
