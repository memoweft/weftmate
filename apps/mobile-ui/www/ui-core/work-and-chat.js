/* Product modes share the existing sessions, projects and native approvals. */
globalThis.WeftUiCore.conversationMode = row => row?.phoneHistory ? 'chat' : row?.mode || (row?.projectId || row?.workspaceKind === 'browser' ? 'work' : 'chat');
globalThis.WeftUiCore.factories.workAndChat = (core, effects, environment) => {
  const mode = globalThis.WeftUiCore.conversationMode;
  const originalState = core.composerState, newConversation = core.startNewConversation;
  const send = core.sendDraft;
  const clear = core.clearSession;
  const enabled = () => core.state.personalCapabilities?.workAndChat === 1;
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
  async function startNewWork(hostId, project) {
    if (core.state.submitting || core.state.unresolvedSubmission) return;
    if (hostId) {
      await core.selectExecutionComputer?.(hostId);
      if (hostId !== (core.currentExecutionComputer?.() || core.state.hostId)) throw { code: 'TARGET_UNAVAILABLE' };
    }
    await newConversation(true);
    core.state.newConversationMode = 'work';
    core.state.newConversationProjectId = project?.projectId || null;
    core.state.workDraftHostId = hostId || core.currentExecutionComputer?.() || core.state.hostId;
    effects.paintSelectedSession?.(null); effects.updateAvailability(); effects.paintWorkMode?.();
  }
  async function chooseWorkComputer(id) {
    if (!workComputers().find(row => row.hostId === id)?.online) throw { code: 'COMPUTER_OFFLINE' };
    const draft = effects.readMessageDraft();
    await startNewWork(id); effects.restoreMainChatDraft?.(draft);
  }
  async function switchConversationWork(context, row, projectId) {
    const result = await core.submitApproval(context, row, 'allowed-once', 'once', { workProjectId: projectId });
    const fresh = core.conversationApprovals.entries.get(row.approvalId)?.row;
    if (fresh?.decisionOutcome === 'allowed-once') {
      await core.refreshSessions();
      await core.selectSession(row.sessionId);
    }
    return result;
  }
  core.composerState = (...args) => {
    const state = originalState(...args);
    if (enabled() && currentMode() === 'work' && (!core.currentFolderProject?.() ||
        !workComputers().some(row => row.hostId === ((core.state.newConversation ? core.state.workDraftHostId : null) || core.currentExecutionComputer?.() || core.state.hostId) && row.online)))
      return { ...state, sendDisabled: true, messageDisabled: true, voiceDisabled: true, placeholder: '先选择电脑和文件夹' };
    return state;
  };
  core.startNewConversation = async (...args) => { core.state.newConversationMode = 'chat'; return newConversation(...args); };
  core.sendDraft = (...args) => {
    if (enabled() && currentMode() === 'work' && !core.currentFolderProject?.()) return effects.toast('先选择项目或文件夹，再开始工作。');
    return send(...args);
  };
  core.clearSession = (...args) => { core.state.workTimeline = null; core.state.workDraftHostId = null; core.state.workProjectSelecting=null; core.state.newConversationMode = 'chat'; return clear(...args); };
  return { supportsWorkModes: enabled, currentConversationMode: currentMode, workComputers, startNewWork, chooseWorkComputer,
    switchConversationWork, conversationMode: mode };
};
