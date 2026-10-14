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
  const s = setup(); await s.open({ kind: 'main', chatId: 'main-chat', sessionId: '' });
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

// Run the shipped selection and history window, including the sidebar refresh
// that only lists side chats. Transport responses and presentation effects are fixtures.
function realSelection(staleMain: object | null) {
  const s = setup(), noop = () => {}, main = { chatId: 'main-chat', kind: 'main', activeSessionId: 'session-first-main' };
  const side = { chatId: 'side-chat', kind: 'side', activeSessionId: 'session-side' };
  Object.assign(s.context, { URLSearchParams, AbortController });
  s.context.WeftUiCore = { factories: {} };
  for (const file of ['chat-window.js', 'main-chat.js'])
    vm.runInContext(readFileSync(new URL(`../src/ui-core/${file}`, import.meta.url), 'utf8'), s.context);
  const core = s.context.core, reads: string[] = [], sideSelections: string[] = [];
  Object.assign(core, {
    state: { ownerId: 'synthetic', identityGeneration: 0, historyGeneration: 0, mainChat: staleMain,
      selectedChatId: 'old-chat', selectedSessionId: 'old-session', activeChatSource: 'desktop',
      sessions: [], chats: [side], personalCapabilities: { chats: 1, chatTimeline: 1 }, historyEvents: new Map(), seenSeq: new Set() },
    conversationTasks: { generation: 0, entries: new Map() }, cancelAttachmentUpload: noop,
    resetConversationApprovals: noop, resetConversationQuestions: noop, observeOptimistic: noop,
    refreshSessionProjects: async () => {}, refreshConversationTasks: async () => {}, refreshApprovalMode: async () => {},
    refreshConversationApprovals: async () => {}, refreshConversationQuestions: async () => {},
    historyReadResult: (kind: string) => ({ kind }), readMainChat: async () => ({ chat: main }),
    readChat: async (id: string) => ({ chat: id === main.chatId ? main : side }),
    accessApi: async (path: string) => path.startsWith('/sessions?') ? { sessions: [] }
      : path.startsWith('/chats?') ? { items: [side] } : { chatId: main.chatId },
    readChatDates: async () => ({ days: [], contentRevision: 1 }),
    readChatEvents: async (id: string) => {
      reads.push(id);
      return { contentRevision: 1, items: [{ eventId: `${id}-reply`, orderKey: '1', at: '2026-10-14T00:00:00Z',
        type: 'assistant.message', data: { text: id === main.chatId ? 'current main reply' : 'current side reply' } }] };
    },
  });
  const effects = new Proxy({
    readMessageDraft: () => '',
    paintSelectedSession: (id: string) => { s.context.state.sharedSessionId = id; },
    renderMainChat: () => { if (core.inMainChat?.()) s.content.textContent = core.state.chatWindow.events.values().next().value?.data.text || ''; },
    selectNativeSideSession: async (id: string) => {
      sideSelections.push(id); core.state.selectedSessionId = id;
      await core.refreshLogicalSessions();
      // A side-only sidebar cannot select a newly created main session.
      const chat = core.state.chats.find((row: any) => row.activeSessionId === id);
      s.context.state.sharedSessionId = chat?.activeSessionId || null;
      if (chat) s.content.textContent = (await core.readChatEvents(chat.chatId)).items[0].data.text;
    },
  }, { get: (target, key) => target[key] || noop });
  Object.assign(core, s.context.WeftUiCore.factories.mainChat(core, effects, { mobileState: s.context.state, logicalChats: true }));
  return { ...s, core, reads, sideSelections };
}
for (const [label, cached] of [
  ['empty main session', { chatId: 'main-chat', kind: 'main', activeSessionId: null }],
  ['previous main session', { chatId: 'main-chat', kind: 'main', activeSessionId: 'session-old-main' }],
  ['main not yet synchronized', null],
] as const) {
  test(`native main identity wins over ${label} in the actual shared selector`, async () => {
    const s = realSelection(cached);
    await s.open({ kind: 'main', chatId: 'main-chat', sessionId: 'session-first-main' });
    assert.equal(s.core.state.selectedChatId, 'main-chat');
    assert.equal(s.core.state.selectedSessionId, 'session-first-main');
    assert.equal(s.context.state.sharedSessionId, 'session-first-main');
    assert.equal(s.core.inMainChat(), true);
    assert.deepEqual(s.sideSelections, []);
    assert.deepEqual(s.reads, ['main-chat']);
    assert.equal(s.content.textContent, 'current main reply');
    assert.deepEqual(s.pages, ['chat']);
  });
}
test('native side identity still selects and reads the side chat through the actual shared selector', async () => {
  const s = realSelection({ chatId: 'main-chat', kind: 'main', activeSessionId: null });
  await s.open({ kind: 'side', chatId: 'side-chat', sessionId: 'session-side' });
  assert.equal(s.core.state.selectedChatId, 'side-chat');
  assert.equal(s.core.state.selectedSessionId, 'session-side');
  assert.equal(s.context.state.sharedSessionId, 'session-side');
  assert.equal(s.core.inMainChat(), false);
  assert.deepEqual(s.sideSelections, ['session-side']);
  assert.deepEqual(s.reads, ['side-chat']);
  assert.equal(s.content.textContent, 'current side reply');
});
