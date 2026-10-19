import assert from 'node:assert/strict';
import test from 'node:test';
import { toolNeedsComputer, workContinuationPrompt, WORK_SWITCH_REASON } from '../src/plugins/personal-work-mode.mjs';
import { bindConversationWork, conversationMode, modeProjection } from '../src/personal-access/work-and-chat.mjs';
import { reconcileChatIdentity, validateChatIdentity } from '../src/personal-access/chat-identity.mjs';

(globalThis as any).WeftUiCore ??= { factories: {} };
await import('../src/ui-core/work-and-chat.js');

test('W3 acknowledgement requires this turn\'s granted switch and expires at stop or the next user turn', () => {
  const start = { type: 'turn/start', data: { turn: 1 } };
  const asked = { type: 'approval/asked', data: { id: 'switch-1', reason: WORK_SWITCH_REASON } };
  const answer = (outcome = 'allowed-once', id = 'switch-1') => ({ type: 'approval/decided', data: { id, outcome } });
  const policy = { conversationMode: 'work', project: { name: '已选目录', rootPath: '/synthetic/selected' } };
  const prompt = (events: any[], selected = policy) => workContinuationPrompt({ events }, selected);
  assert.equal(prompt([start, asked]), null, 'pending selection is not consent');
  assert.equal(prompt([start, asked, answer('rejected')]), null);
  assert.equal(prompt([start, asked, answer('cancelled')]), null);
  assert.equal(prompt([start, asked, answer('allowed-once', 'other')]), null);
  assert.equal(prompt([start, asked, answer()], { ...policy, conversationMode: 'chat' }), null);
  const completed = [start, asked, answer()];
  assert.match(prompt(completed)!, /文件夹选择已完成：已选目录/);
  assert.match(prompt([...completed, { type: 'tool/result', data: { isError: true } }])!, /继续遵守原有权限、审批、拒绝和停止决定/);
  assert.equal(prompt([...completed, { type: 'turn/end', data: { reason: { kind: 'aborted' } } }]), null);
  assert.equal(prompt([...completed, { type: 'turn/end' }, { type: 'turn/start', data: { turn: 2 } }]), null, 'do not revive the previous task in a later user turn');
  assert.equal(prompt([start, { ...asked, data: { ...asked.data, reason: 'ordinary risk approval' } }, answer()]), null);
});

test('MODE-1 sidebar selection is account scoped, new follows it and opening a notified session selects its actual mode', async () => {
  const saved = new Map<string,string>(), storage = {getItem:(key:string)=>saved.get(key),setItem:(key:string,value:string)=>saved.set(key,value)};
  const make = (ownerId: string) => {
    const state: any = {ownerId,personalCapabilities:{workAndChat:1},hostId:'computer-a',sessions:[{sessionId:'chat-a',mode:'chat'},{sessionId:'work-a',mode:'work',projectId:'project-a'}]};
    const core: any = {state, composerState:()=>({}),clearSession(){},sendDraft(){},currentExecutionComputer:()=>state.hostId,
      startNewConversation:async()=>{state.newConversation=true;state.selectedSessionId=null;},
      selectSession:async(id:string)=>{state.selectedSessionId=id;state.newConversation=false;}};
    Object.assign(core,(globalThis as any).WeftUiCore.factories.workAndChat(core,{updateAvailability(){},renderSessions(){}},{storage}));return core;
  };
  const first = make('owner-a'); first.chooseSidebarMode('work'); await first.startSidebarConversation();
  assert.equal(first.currentConversationMode(),'work'); assert.equal(make('owner-a').sidebarConversationMode(),'work');
  assert.equal(make('owner-b').sidebarConversationMode(),'chat');
  await first.selectSession('chat-a'); assert.equal(first.sidebarConversationMode(),'chat');
  await first.selectSession('work-a'); assert.equal(first.sidebarConversationMode(),'work');
  first.chooseSidebarMode('chat'); await first.startSidebarConversation(); assert.equal(first.currentConversationMode(),'chat');
  const computerA = make('local-owner-a'); computerA.state.cloudAuth={sub:'same-cloud-account'}; computerA.chooseSidebarMode('work');
  const computerB = make('local-owner-b'); computerB.state.cloudAuth={sub:'same-cloud-account'};
  assert.equal(computerB.sidebarConversationMode(),'work','the same cloud account keeps its selected view when changing computers');
});

test('MODE-1 new work blocks before directory selection, rejects offline computers and retains legacy capability behavior', async () => {
  let project: any = null, selected = 'computer-a', sends = 0;
  const state: any = { personalCapabilities: { workAndChat: 1 }, hostId: 'computer-a', online: true, sessions: [],
    newConversation: true, newConversationMode: 'chat', computers: [{ hostId: 'computer-a', online: true }, { hostId: 'computer-b', online: false }] };
  const core: any = { state, composerState: () => ({ sendDisabled: false }), sendDraft: () => { sends++; },
    startNewConversation: async () => { state.newConversation = true; }, clearSession() {}, currentFolderProject: () => project,
    currentExecutionComputer: () => selected, selectExecutionComputer: async (id: string) => { selected = id; } };
  Object.assign(core, (globalThis as any).WeftUiCore.factories.workAndChat(core, { updateAvailability() {}, readMessageDraft: () => '', toast() {} }, {}));
  await core.startNewWork(); assert.equal(core.currentConversationMode(), 'work'); assert.equal(core.composerState().sendDisabled, true);
  core.sendDraft(); assert.equal(sends, 0);
  await assert.rejects(core.chooseWorkComputer('computer-b'), (error: any) => error.code === 'COMPUTER_OFFLINE'); assert.equal(selected, 'computer-a');
  project = { projectId: 'synthetic-project' }; assert.equal(core.composerState().sendDisabled, false);
  core.sendDraft(); assert.equal(sends, 1);
  state.computers[0].online = false; assert.equal(core.composerState().sendDisabled, true);
  state.computers = []; state.cloudAuth = { cloudOnly: true }; assert.deepEqual(core.workComputers(), []);
  state.personalCapabilities = {}; assert.equal(core.composerState().sendDisabled, false, 'an old computer retains its original controls');
  await core.startNewConversation(); assert.equal(core.currentConversationMode(), 'chat');
});

test('MODE-1 existing main and side chats stay chat, project and browser sessions become work without migrating history', () => {
  for (const row of [{}, { origin: 'personal-remote' }, { phoneHistory: true, projectId: 'project-1' }]) assert.equal(conversationMode(row), 'chat');
  for (const row of [{ projectId: 'project-1' }, { workspaceKind: 'browser' }, { mode: 'work' }]) assert.equal(conversationMode(row), 'work');
  assert.equal(conversationMode({ mode: 'chat', projectId: 'project-1' }), 'chat');
});

test('MODE-1 every actual computer tool gates, while account data and code orchestration retain their data semantics', () => {
  for (const name of ['read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'bash', 'shell', 'browser',
    'subagent', 'job_output', 'weftmod_script', 'new_valid_execution_tool']) assert.equal(toolNeedsComputer(name), true, name);
  for (const name of ['load_tools', 'web_fetch', 'web_search', 'health_query', 'memory_query', 'memory_forget', 'memory_correct', 'current_time', 'sleep', 'todo_write', 'ask_user_question',
    'get_goal', 'create_goal', 'update_goal', 'run_code']) assert.equal(toolNeedsComputer(name), false, name);
  assert.equal(toolNeedsComputer('mcp__c_test', {}, { category: 'read' }), false);
  for (const category of ['write', 'delete', 'external', 'unknown']) assert.equal(toolNeedsComputer('mcp__c_test', {}, { category }), true);
  assert.equal(toolNeedsComputer('schedule_create', { prompt: JSON.stringify({ weftmate: 1, kind: 'reminder', text: '合成提醒' }) }), false);
  assert.equal(toolNeedsComputer('schedule_create', { prompt: JSON.stringify({ weftmate: 1, kind: 'task', text: '合成任务' }) }), true);
  assert.equal(toolNeedsComputer('schedule_create', { prompt: 'arbitrary native executable prompt' }), true);
  assert.equal(toolNeedsComputer('schedule_manage', { action: 'list' }), false);
  assert.equal(toolNeedsComputer('schedule_manage', { action: 'run' }), true);
});

test('MODE-1 conversion retains native identity, all main segments and the immutable command without a replacement main', () => {
  const at = '2026-10-14T00:00:00Z';
  const account: any = { hostId: 'synthetic-host', sessions: { 'session-1': { origin: 'personal-remote' }, 'session-2': { origin: 'personal-remote' } },
    commands: { 'cmd-1': { sessionId: 'session-2', payload: { text: '合成请求' }, payloadHash: 'original-hash' } },
    projects: { 'project-1': { projectId: 'project-1', name: '合成项目', revision: 1, revoked: false } } };
  reconcileChatIdentity(account, account.hostId, at);
  const identity = account.chatIdentity, oldMain = identity.mainChatId;
  for (const segment of Object.values(identity.segments) as any[]) { delete identity.chats[segment.chatId]; segment.chatId = oldMain; }
  identity.chats[oldMain].activeSegmentId = identity.sessionSegments['session-2'];
  const original = JSON.stringify(account.commands['cmd-1'].payload), history = JSON.stringify(identity.segments);
  bindConversationWork(account, 'session-2', 'project-1', { at, commandId: 'cmd-1' });
  assert.equal(identity.mainChatId, oldMain); assert.equal(identity.chats[oldMain].kind, 'main');
  assert.equal(identity.chats[oldMain].wasMain, undefined); assert.equal(JSON.stringify(identity.segments), history);
  assert.equal(Object.values(identity.chats).filter((chat: any) => chat.kind === 'main').length, 1);
  assert.equal(JSON.stringify(account.commands['cmd-1'].payload), original); assert.equal(account.commands['cmd-1'].payloadHash, 'original-hash');
  assert.equal(account.sessions['session-2'].projectId, 'project-1'); assert.equal(account.sessions['session-1'].mode, 'work');
  assert.equal(account.sessions['session-1'].projectId,'project-1');
  assert.equal(modeProjection(account.sessions['session-2'], account).workDirectory.name, '合成项目');
  validateChatIdentity(account);
  account.projects['project-1'].revoked = true;
  assert.equal(modeProjection(account.sessions['session-2'], account).workDirectory, null);
  assert.throws(() => bindConversationWork(account, 'session-2', 'project-1', { at }), (e: any) => e.code === 'PROJECT_NOT_SELECTED');
});
