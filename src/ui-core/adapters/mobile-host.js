/* Shared host actions with Android's cached history and phone presentation effects. */
globalThis.WeftUiCore.factories.mobileHost = (core, effects, environment) => {
  if (!environment.mobileState) return {};
  const state = environment.mobileState;
  const sharedPhoneBinding = core.phoneBinding;
  let historyScope = null;
  function phoneBinding(conversationId = core.state.selectedPhoneConversationId) {
    // Native status marks an offline cached handoff as uncertain. The phone's
    // cached conversation still identifies its original session for reading.
    if (state.chatSource === 'phone' && conversationId === state.conversationId)
      return core.mobile.selectedBinding();
    return sharedPhoneBinding(conversationId);
  }
  function syncMobileIdentity() {
    if (core.state.ownerId !== (state.owner || null)) {
      core.state.models = [];
      core.state.sessionGroups = []; core.state.projects = []; core.state.projectCanManage = false; core.state.projectsError = '';
    }
    Object.assign(core.state, {
      ownerId: state.owner || null, account: state.loggedIn ? { ownerId: state.owner, username: state.username } : null,
      device: state.loggedIn ? { id: state.deviceId || state.profile?.device?.id || '' } : null,
      // Presence marker only. Actual CSRF and cookies are supplied inside Kotlin.
      csrfToken: state.loggedIn && !state.transitionPending ? `native:${state.authEpoch}` : null,
      identityGeneration: state.authEpoch,
      currentView: state.page === 'chat' ? 'assistant' : state.page,
      selectedSessionId: state.sharedSessionId, selectedPhoneConversationId: state.conversationId,
      activeChatSource: state.chatSource === 'host' ? 'desktop' : 'phone',
      sessions: state.sharedSessions, online: state.sharedHostAvailable, phoneBindings: state.handoffViews,
    });
    const scope = JSON.stringify([state.owner, state.authEpoch, state.sharedGeneration, state.sharedSessionId]);
    const changed = scope !== historyScope;
    if (changed) { historyScope = scope; core.state.historyGeneration++; }
    if (changed || !core.state.historyInFlight && !core.state.olderLoading) {
      core.state.historyEvents = new Map(state.sharedEvents.map(event => [event.seq, event]));
      core.state.seenSeq = new Set(core.state.historyEvents.keys());
      core.state.afterSeq = state.sharedNextSeq;
      core.state.nextBeforeSeq = state.sharedNextBeforeSeq;
      core.state.hasOlder = state.sharedHasOlder;
    }
    for (const [id, view] of state.linkedEvents) {
      core.state.phoneHostEvents.set(id, view.events || []);
      core.state.phoneHistoryCursors.set(id, { nextSeq: view.nextSeq, hasOlder: view.hasOlder, nextBeforeSeq: view.nextBeforeSeq });
    }
  }
  async function loadMobileHistory() {
    if (state.chatSource !== 'host' || !state.sharedSessionId || state.sharedLoading || !effects.isVisible()) return;
    const owner = state.owner, epoch = state.authEpoch, generation = state.sharedGeneration, sessionId = state.sharedSessionId;
    syncMobileIdentity(); core.state.online = true;
    state.sharedLoading = true; state.sharedError = '';
    await core.refreshHistory(state.sharedNextSeq === -1);
    if (!core.mobile.sharedViewCurrent(owner, epoch, generation, sessionId)) return;
    state.sharedEvents = [...core.state.historyEvents.values()].sort((a,b) => a.seq-b.seq);
    state.sharedNextSeq = core.state.afterSeq; state.sharedHasOlder = core.state.hasOlder;
    state.sharedNextBeforeSeq = core.state.nextBeforeSeq; state.sharedLoading = false;
    await core.mobile.reconcileSharedDelivery();
    if (!core.mobile.sharedViewCurrent(owner, epoch, generation, sessionId)) return;
    effects.renderSharedConversation(); void effects.refreshConversationTasks();
  }
  function mobileOutput(item) {
    const output = {...item.artifact};
    delete output.versions;
    if (item.versions.length) output.versions = item.versions;
    return output;
  }
  async function mobileResources(context) {
    syncMobileIdentity();
    const key = `weftmate-resources:${context.owner}:${context.sessionId}`;
    if (!context.sessionId) return {outputs:[],sources:[]};
    try {
      const data = await core.loadConversationResources();
      const collection = {outputs:data.outputs.map(mobileOutput),sources:data.sources};
      try { environment.storage.setItem(key, JSON.stringify(collection)); } catch {}
      return collection;
    } catch (error) {
      if (!core.mobileDecisions.current(context)) throw error;
      try { const saved=JSON.parse(environment.storage.getItem(key)); if(saved) return {...saved,sources:(saved.sources||[]).map(item=>({...item,toolName:item.toolName||(item.kind==='tool'?item.name:undefined),name:item.kind==='tool'&&!/[\u4e00-\u9fff]/.test(item.name)?core.toolLabel(item.name):item.name,uses:(item.uses||[]).map(use=>({...use,summary:item.kind==='tool'&&use.summary===(item.toolName||item.name)?core.toolLabel(item.toolName||item.name):core.interfaceText(use.summary)}))})),
        outputs:core.deduplicateOutputs((saved.outputs||[]).flatMap(item=>[item,...(item.versions||[])]))
          .map(mobileOutput),offline:true}; } catch {}
      throw error;
    }
  }
  async function loadMobileOlderHistory() {
    if (!state.sharedHasOlder || state.sharedOlderLoading) return false;
    syncMobileIdentity();
    const context = core.conversationTaskContext();
    state.sharedOlderLoading = true;
    try {
      await core.loadOlderHistory();
      const events = context.source === 'phone' ? core.state.phoneHostEvents.get(context.conversationId) || [] : [...core.state.historyEvents.values()];
      const hasOlder = core.state.hasOlder, nextBeforeSeq = core.state.nextBeforeSeq;
      if (!core.conversationTaskCurrent(context)) return false;
      state.sharedEvents = [...events].sort((a,b) => a.seq-b.seq);
      state.sharedHasOlder = hasOlder; state.sharedNextBeforeSeq = nextBeforeSeq;
      if (context.source === 'phone') {
        const view = state.linkedEvents.get(context.conversationId);
        if (view) { view.events=state.sharedEvents; view.hasOlder=hasOlder; view.nextBeforeSeq=nextBeforeSeq; }
      }
      return true;
    } finally {
      if (core.conversationTaskCurrent(context)) state.sharedOlderLoading = false;
    }
  }
  async function refreshMobileMemoryAvailability() {
    const owner = state.owner, epoch = state.authEpoch;
    try { const result = await core.accessApi('/memory/status');
      if (owner === state.owner && epoch === state.authEpoch && result.ownerId === owner)
        effects.paintMemoryAvailability?.(result);
    } catch { if (owner === state.owner && epoch === state.authEpoch) effects.paintMemoryAvailability?.({state:'unavailable'}); }
  }
  async function listMobileSessions(){if(!state.loggedIn||state.transitionPending)return;
  const owner=state.owner,epoch=state.authEpoch,generation=state.sharedGeneration;
  syncMobileIdentity();
  void core.loadPersonalization().catch(() => {});
  void refreshMobileMemoryAvailability();
  if (!core.state.models.length) void core.refreshThinkingModels().then(() => {
    if(owner===state.owner&&epoch===state.authEpoch)effects.updateComposer();
  }).catch(() => {});
  try{const result=await core.accessApi('/sessions?archived=all');if(owner!==state.owner||epoch!==state.authEpoch||generation!==state.sharedGeneration)return;
    core.state.sessionGroups = result.groups || [];
    void core.refreshSessionProjects().then(() => {
      if (owner === state.owner && epoch === state.authEpoch && generation === state.sharedGeneration) effects.renderConversationList();
    });
    if(result?.source!=='host'||!Array.isArray(result.sessions))throw new Error('OPERATION_FAILED');
    state.sharedSessions=result.sessions.filter(item=>item?.source==='host'&&typeof item.sessionId==='string'&&item.sessionId);
    state.sharedHostAvailable=result.hostAvailable===true;effects.renderConversationList();
    if(state.chatSource==='host'){state.sharedRunning=!!core.mobile.selectedSharedSession()?.running;effects.updateComposer();effects.renderSharedConversation()}
    else if(core.mobile.selectedBinding()){state.sharedRunning=!!core.mobile.selectedSharedSession()?.running;
      effects.updateComposer();if(state.page==='chat')void effects.renderConversation({silent:true})}
  }catch(e){if(owner!==state.owner||epoch!==state.authEpoch||generation!==state.sharedGeneration)return;
    state.sharedHostAvailable=false;effects.renderConversationList();if(state.chatSource==='host'){
      state.sharedError='电脑暂不可达，已显示上次读取的内容';effects.updateComposer();effects.renderSharedConversation()}
    else if(core.mobile.selectedBinding()){effects.updateComposer();if(state.page==='chat')void effects.renderConversation({silent:true})}}}
  function groupTaskActivities(activities){const byTask=new Map(),result=[];
  for(const item of activities){if(item.source!=='host'||!item.taskId&&item.kind!=='session.message'){result.push(item);continue}
    const taskId=item.rootTaskId||item.taskId||item.commandId;if(!taskId)continue;
    let task=byTask.get(taskId);if(!task){task={source:'host',kind:'session.message',commandId:taskId,taskId,
      sessionId:item.sessionId,conversationId:item.conversationId,status:'pending',children:[]};byTask.set(taskId,task);result.push(task)}
    if(item.kind==='session.message'&&!item.rootTaskId){task.status=item.status;task.sessionId=item.sessionId||task.sessionId}
    else task.children.push(item);
  }return result}
  function sessionExpired() {
    // Native auth remains authoritative. Retain its saved login, caches and draft,
    // as the existing phone does while awaiting a verified reconnect or logout.
    state.connection = 'expired'; core.state.online = false;
    effects.updateComposer();
  }
  return { groupTaskActivities, listMobileSessions, syncMobileIdentity, loadMobileHistory, loadMobileOlderHistory, mobileResources, sessionExpired, phoneBinding };
};
