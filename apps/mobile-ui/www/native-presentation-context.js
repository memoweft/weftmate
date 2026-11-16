/* Environment glue for the native renderer. Account and business operations remain in ui-core. */
const nativeContext = {
  state, core:uiCore, accountCore:globalThis.WeftMobileCloud?.core||uiCore, phone:globalThis.WeftPhone,
  call, hasDraft:hasAnyDraft, memoryKinds:MEMORY_KINDS, systemComponents:mobileSystemComponents, systemMetric:mobileSystemMetricText,
  humanError(error,page){if(/[\u3400-\u9fff]/.test(error?.message||''))return error.message;return /^(login|connect|account|profile)/.test(page)?(globalThis.WeftMobileCloud?.core||uiCore).cloudError(error):safeError(error);},
  diagnosticSummary:value=>JSON.stringify(value,null,2),
  appearance:()=>mobileAppearanceStore.value,
  async setAppearance(patch){mobileAppearanceStore.set({...mobileAppearanceStore.value,...patch});applyTheme(state.appearance||'system');},
  async legal(kind){const response=await fetch('legal/'+kind+'-zh.txt');if(!response.ok)throw Error('内容暂时无法读取，请重试。');return response.text();},
  prepareMemory(){if(state.page!=='memory')page('memory');},
  prepareSettings(id){if(state.page!==id)page(id);},
  async adoptCloud(){const core=globalThis.WeftMobileCloud?.core||uiCore;if(core.cloudAuthView().error)throw Error(core.cloudAuthView().error);await core.enterAssistant();},
  async adoptPersonal(account){
    state.authEpoch++;state.accountModelCredentialConflict=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.handoffModelLastCheck=0;clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;
    Object.assign(state,{loggedIn:true,connection:account.connectionVerified?'connected':'checking',username:account.username,owner:account.owner||'',deviceId:account.deviceId||account.device?.id||'',profile:account,conversationId:null});
    resetMemoryForAuthBoundary('账户已切换。请重新读取新账户的记忆。');
    const current=await call('app.bootstrap');state.model=current.model?.source?current.model:null;state.backgroundSync=account.backgroundSync||current.backgroundSync||'unknown';
    try{applyAppearancePreference(await uiCore.mobileAppearance())}catch{applyTheme('system')}
    showProfile(account);await listConversations();loadDraft();await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});
  },
  offline:()=>uiCore.nativeOffline||globalThis.WeftMobileCloud?.core?.nativeOffline,
};
