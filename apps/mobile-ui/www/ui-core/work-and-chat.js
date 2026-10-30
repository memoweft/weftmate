/* Product modes share the existing sessions, projects and native approvals. */
globalThis.WeftUiCore.conversationMode = row => row?.phoneHistory ? 'chat' : row?.mode || (row?.projectId || row?.workspaceKind === 'browser' ? 'work' : 'chat');
globalThis.WeftUiCore.factories.workAndChat = (core, effects, environment) => {
  const mode = globalThis.WeftUiCore.conversationMode;
  const originalState = core.composerState, newConversation = core.startNewConversation;
  const send = core.sendDraft;
  const clear = core.clearSession;
  const selectSession = core.selectSession, selectMain = core.selectMainChat, selectPhone = core.selectPhoneConversation;
  const enabled = () => core.state.personalCapabilities?.workAndChat === 1;
  let preferenceOwner, sidebarMode;
  function sidebarConversationMode() {
    const owner = core.state.cloudAuth?.sub || core.state.cloudAuth?.accountId || core.state.ownerId || '';
    if (preferenceOwner !== owner || !sidebarMode) {
      preferenceOwner = owner;
      try { sidebarMode = environment.storage?.getItem(`weftmate-conversation-mode:${owner}`); } catch {}
      sidebarMode = sidebarMode === 'work' ? 'work' : 'chat';
    }
    return sidebarMode;
  }
  function chooseSidebarMode(value) {
    sidebarConversationMode(); sidebarMode = value === 'work' ? 'work' : 'chat';
    try { environment.storage?.setItem(`weftmate-conversation-mode:${preferenceOwner}`, sidebarMode); } catch {}
    effects.renderSessions?.(); effects.paintWorkMode?.();
  }
  function currentMode() {
    if (core.state.activeChatSource === 'phone') return 'chat';
    if (core.state.newConversation) return core.state.newConversationMode || 'chat';
    return mode(core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId) ||
      (core.state.selectedChatId === core.state.mainChat?.chatId ? core.state.mainChat : null));
  }
  function workComputers() {
    if (core.state.computers?.length) return core.state.computers;
    if (!core.state.hostId || core.state.hostId === 'unconnected' || core.state.cloudAuth?.cloudOnly) return [];
    return [{ hostId: core.state.hostId, name: core.state.hostName || core.computerName?.(core.state.hostId) || '这台电脑', online: core.state.online !== false }];
  }
  async function startNewWork(hostId, project, { restore = false } = {}) {
    if (core.state.submitting || core.state.unresolvedSubmission) return;
    core.rememberConversationDraft?.();
    if (hostId) {
      await core.selectExecutionComputer?.(hostId);
      if (hostId !== (core.currentExecutionComputer?.() || core.state.hostId)) throw { code: 'TARGET_UNAVAILABLE' };
    }
    core.state.selectedChatId = null; core.state.workTimeline = null;
    await newConversation(true, false, { restore });
    core.state.newConversationMode = 'work';
    chooseSidebarMode('work');
    core.state.newConversationProjectId = project?.projectId || null;
    core.state.workDraftHostId = hostId || core.currentExecutionComputer?.() || core.state.hostId;
    effects.paintSelectedSession?.(null); effects.updateAvailability(); effects.paintWorkMode?.();
  }
  async function startSidebarConversation({ restore = false } = {}) {
    return enabled() && sidebarConversationMode() === 'work' ? startNewWork(undefined, undefined, { restore }) : core.startNewConversation(false, false, { restore });
  }
  async function chooseWorkComputer(id) {
    if (!workComputers().find(row => row.hostId === id)?.online) throw { code: 'COMPUTER_OFFLINE' };
    const draft = effects.readMessageDraft();
    await startNewWork(id); effects.restoreMainChatDraft?.(draft);
  }
  async function switchConversationWork(context, row, projectId) {
    const current = core.approvalContext();
    if (!['ownerId','identity','deviceId','source','sessionId','conversationId'].every(key => current[key] === context[key])) throw { code: 'REQUEST_FAILED' };
    const result = await core.submitApproval(current, row, 'allowed-once', 'once', { workProjectId: projectId });
    if (!result?.approval?.workSessionId) throw { code: 'REQUEST_FAILED' };
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!['ownerId','identity','deviceId','source','sessionId','conversationId'].every(key => core.approvalContext()[key] === current[key])) return;
      const { command } = await core.accessApi(`/commands/${encodeURIComponent(result.approval.workCreateCommandId)}`);
      if (command.state === 'accepted_by_dsh') {
        await core.refreshSessions();
        await core.selectSession(result.approval.workSessionId);
        return result;
      }
      if (!['pending','dispatching'].includes(command.state)) throw { code: command.errorCode || 'REQUEST_FAILED' };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw { code: 'REQUEST_FAILED' };
  }
  core.composerState = (...args) => {
    const state = originalState(...args);
    if (enabled() && currentMode() === 'work' && (!core.currentFolderProject?.() ||
        !workComputers().some(row => row.hostId === ((core.state.newConversation ? core.state.workDraftHostId : null) || core.currentExecutionComputer?.() || core.state.hostId) && row.online)))
      return { ...state, sendDisabled: true, messageDisabled: true, voiceDisabled: true, placeholder: '先选择电脑和文件夹' };
    return state;
  };
  core.startNewConversation = async (...args) => {
    core.rememberConversationDraft?.();
    core.state.newConversationMode = 'chat';
    if (enabled()) { core.state.selectedChatId = null; core.state.workTimeline = null; chooseSidebarMode('chat'); return newConversation(true, args[1], args[2]); }
    return newConversation(...args);
  };
  if (selectSession) core.selectSession = async (id, ...args) => {
    if (core.state.activeChatSource === 'desktop' && core.state.selectedSessionId === id && !core.state.newConversation) { effects.showConversation({ restore: args[0]?.restore }); if (!args[0]?.restore) effects.closeRail(); return; }
    const result = await selectSession(id, ...args);
    if (enabled() && core.state.selectedSessionId === id) chooseSidebarMode(currentMode()); return result; };
  if (selectMain) core.selectMainChat = async (...args) => {
    if (!args[0] && core.state.activeChatSource === 'desktop' && core.state.mainChat && core.state.selectedChatId === core.state.mainChat.chatId && !core.state.newConversation) { effects.showConversation({ restore: args[1]?.restore }); if (!args[1]?.restore) effects.closeRail(); return; }
    const result = await selectMain(...args);
    if (enabled() && core.state.selectedChatId === core.state.mainChat?.chatId) chooseSidebarMode(currentMode()); return result; };
  if (selectPhone) core.selectPhoneConversation = (...args) => { const result = selectPhone(...args); if (enabled()) chooseSidebarMode('chat'); return result; };
  core.sendDraft = (...args) => {
    if (enabled() && currentMode() === 'work' && !core.currentFolderProject?.()) return effects.toast('先选择项目或文件夹，再开始工作。');
    return send(...args);
  };
  core.clearSession = (...args) => { core.state.workTimeline = null; core.state.workDraftHostId = null; core.state.workProjectSelecting=null; core.state.newConversationMode = 'chat'; return clear(...args); };
  return { supportsWorkModes: enabled, currentConversationMode: currentMode, sidebarConversationMode, chooseSidebarMode, startSidebarConversation, workComputers, startNewWork, chooseWorkComputer,
    switchConversationWork, conversationMode: mode };
};
