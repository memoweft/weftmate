import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps/android/app/src/main/assets/native-chat-route.js', import.meta.url), 'utf8');
function setup() {
  const pages: string[] = [], selected: string[] = [];
  const content = { textContent: 'another conversation' };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const context = vm.createContext({
    state: { booted: true, chatSource: 'host', conversationId: 'old-phone' },
    page: (name: string) => pages.push(name), setTimeout,
    document: { querySelectorAll: () => [], getElementById: (id: string) => id === 'chat-content' ? content : null, documentElement: { style: { setProperty() {} } } },
    core: { state: { mainChat: { chatId: 'main-chat' } }, selectLogicalSession: async (id: string) => { await pending; selected.push(id); }, selectMainChat: async () => { selected.push('main'); } },
  });
  vm.runInContext('const uiCore = core; window = globalThis;', context);
  vm.runInContext(source, context);
  return { context, pages, selected, content, release, open: (entry: object) => context.WeftNativeChatRoute({ name: 'chat', embedded: true, ...entry }) };
}
test('native full web chat selects the current side session through lexical uiCore before rendering', async () => {
  const s = setup(); assert.equal(s.context.uiCore, undefined);
  const opened = s.open({ chatId: 'chat-current', sessionId: 'session-current' });
  assert.deepEqual(s.pages, []);
  assert.equal(s.content.textContent, '正在打开这段对话…');
  s.release(); await opened;
  assert.deepEqual(s.selected, ['session-current']); assert.deepEqual(s.pages, ['chat']);
});
test('main without a session and phone conversations retain their own identities', async () => {
  const s = setup(); await s.open({ chatId: 'main-chat', sessionId: '' });
  assert.deepEqual(s.selected, ['main']);
  await s.open({ phone: true, phoneId: 'current-phone' });
  assert.equal(s.context.state.chatSource, 'phone'); assert.equal(s.context.state.conversationId, 'current-phone');
});
test('returning to native or opening another page prevents late chat selection from reopening it', async () => {
  const s = setup(); const opened = s.open({ sessionId: 'session-current' });
  await s.open({ name: 'home' }); s.release(); await opened;
  assert.deepEqual(s.pages, ['home']);
});
test('a failed selection replaces the old conversation with a retry message', async () => {
  const s = setup(); s.context.core.selectLogicalSession = async () => { throw new Error('unavailable'); };
  await s.open({ sessionId: 'session-current' });
  assert.equal(s.content.textContent, '这段对话暂时无法打开，请返回后重试。');
  assert.deepEqual(s.pages, []);
});
test('a sessionless side conversation cannot accidentally fall back to main', async () => {
  const s = setup(); await s.open({ chatId: 'side-chat', sessionId: '' });
  assert.deepEqual(s.selected, []); assert.deepEqual(s.pages, []);
  assert.equal(s.content.textContent, '这段对话暂时无法打开，请返回后重试。');
});
