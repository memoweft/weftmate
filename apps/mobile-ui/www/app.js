const $ = id => document.getElementById(id);
const systemThemeMedia=window.matchMedia('(prefers-color-scheme: dark)');
const state = { page:'chat', conversationId:null, conversations:[], model:null, busy:false, modelSwitching:false, transitionPending:false,
  phase:'idle', progressText:'', loggedIn:false, connection:'local',backgroundSync:'unknown',authEpoch:0,booted:false,
  username:'', owner:'', deviceId:'', ui:null, draft:'', models:[], menu:false, attachmentMenu:false, attachmentPick:null, previewScope:null, previewReturnFocus:null, drawer:false, scrollPinned:true, generation:0,memory:null,lastTerminal:null,sendUncertain:false,
  chatSource:'phone',restorePending:false,sharedSessionId:null,sharedSessions:[],sharedHostAvailable:false,sharedEvents:[],sharedNextSeq:-1,sharedHasOlder:false,sharedNextBeforeSeq:null,sharedOlderLoading:false,
  sharedRunning:false,sharedError:'',sharedPending:null,sharedOutboxLoading:false,sharedAwaiting:null,sharedChecking:null,sharedStopping:false,sharedGeneration:0,sharedLoading:false,sharedPollTimer:null };

const attachmentDrafts = new Map();
const attachmentRevisions = new Map();
let attachmentViewGeneration = 0;
let sequence = 0;
state.activeSend = null;
let liveProgressFrame = null, liveProgressVersion = 0;
let liveMotionFrame = null, liveFollowTop = null, liveRevealStart = null, liveRevealLength = 0;
let drawerFrameGeneration = 0;
function invalidateLiveProgress(){liveProgressVersion++;liveProgressFrame=null;liveMotionFrame=null;
  liveFollowTop=null;liveRevealStart=null;liveRevealLength=0}
let draftReportTimer = null, lastReportedDraft = null;
state.handoffViews=new Map();state.linkedEvents=new Map();state.linkedLoading=false;state.linkedPending=null;
state.linkedPollTimer=null;
state.handoffModelNames=new Map();state.handoffModelLastCheck=0;
state.handoffPickerOpen=new Set();state.handoffSelections=new Map();
state.accountModelCredentialConflict=null;
let memoryTarget = null;
const workspaceNotices = new Map();
function registerWorkspaceNotice(node) { const id = ++sequence; workspaceNotices.set(id, node); return id; }
const androidBridge = WeftUiCore.createAndroidBridge({
  postMessage: window.weftNative?.postMessage ? message => window.weftNative.postMessage(message) : null,
  onEvent: message => processEvent(message),
});
const mobileEffects = {
  nativeCall: (...args) => call(...args),
  readMessageDraft: () => $('draft').value,
  clearMessageDraft: () => { $('draft').value = ''; },
  readChatStatus: () => $('chat-status').textContent,
  isVisible: () => document.visibilityState !== 'hidden',
  status: (...args) => status(...args), toast: (...args) => toast(...args),
  safeError: (...args) => safeError(...args),
  page: name => page(name), selectSharedSession: id => selectSharedSession(id),
  paintWorkspaceNotice: (id, text) => { const node=workspaceNotices.get(id); if(node)node.textContent=text; },
  renderAttachmentDrafts: (...args) => renderAttachmentDrafts(...args),
  markAttachmentRevision: (...args) => markAttachmentRevision(...args),
  clearAcceptedHostAttachments: (...args) => clearAcceptedHostAttachments(...args),
  updateComposer: () => updateComposer(), updateAvailability: () => updateComposer(), paintConnection: () => {}, paintMemoryAvailability: value => paintChatMemoryAvailability(value),
  renderSharedConversation: () => renderSharedConversation(),
  renderOptimisticMessages: () => renderOptimisticMessages(),
  renderConversation: (...args) => renderConversation(...args),
  renderConversationList: () => renderConversationList(), renderSessions: () => renderConversationList(),
  refreshAttachmentDrafts: (...args) => refreshAttachmentDrafts(...args),
  listConversations: () => listConversations(),
  loadSharedHistory: () => loadSharedHistory(), listSharedSessions: () => listSharedSessions(),
  scrollBottom: force => scrollBottom(force), refreshConversationTasks: () => refreshConversationTasks(),
  renderConversationTasks: () => renderConversationTasks(),
  renderConversationApprovals: () => renderConversationApprovals(),
  renderConversationQuestions: () => renderConversationQuestions(),
  scheduleSharedPoll: () => scheduleSharedPoll(), scheduleHandoffPoll: id => scheduleHandoffPoll(id),
  renderMemoryList: (...args) => renderMemoryList(...args), renderMemoryDetail: (...args) => renderMemoryDetail(...args),
  clearHistoryView: () => {}, renderTurnStatus: () => {}, renderOlderControl: () => {},
  beginOlderHistory: () => {}, restoreOlderHistoryPosition: () => {}, renderSelectedPhoneConversation: () => {},
  historyNotice: message => { if (message) {
    if(state.sharedOlderLoading)toast('更早内容暂时无法读取，请重试',true);
    else state.sharedError = '电脑会话暂时无法更新，已读取的内容仍可查看';
  } },
  paintHistoryMessages: events => { for (const event of events) trackSharedAcceptedTurn(event); },
  paintScreen: view => page(view === 'login' ? 'connect' : view),
};
const uiCore = WeftUiCore.create({ fetch: androidBridge.fetch, storage: localStorage,
  crypto: globalThis.crypto, effects: mobileEffects, mobileState: state, attachmentDrafts });
uiCore.android = androidBridge;
const mobileMessageActions = globalThis.WeftMessageActions?.create({core:uiCore, draft:()=>$('draft'),
  selectSession:async id=>{await listSharedSessions();await selectSharedSession(id)},
  copy: text=>call('clipboard.copy',{text}), save:async(blob,name)=>{
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return call('conversation.export',{name,contentType:blob.type.startsWith('image/')?'image/png':'text/markdown',data:btoa(binary)},120000);
  }, notice:message=>toast(message), events:()=>state.sharedEvents,sessionId:()=>state.sharedSessionId,
  title:()=>state.chatSource==='phone'?state.conversations.find(row=>row.id===state.conversationId)?.title:selectedSharedSession()?.title,
  localEvents:async id=>{const result=await call('conversations.messages',{conversationId:id});return [
    ...result.messages.map(message=>({type:message.role==='user'?'user.message':'assistant.message',data:{text:message.text,
      originalAttachments:(message.thumbnails||[]).map(image=>({name:image.name||'图片'}))}})),
    ...(result.receipts||[]).map(receipt=>({type:'step.completed',data:{summary:uiCore.interfaceText(receipt.summary),toolName:receipt.toolName}}))];}});
const conversationTasks=uiCore.mobileDecisions.tasks;
const toolApprovals=uiCore.mobileDecisions.approvals;
const toolQuestions=uiCore.mobileDecisions.questions;














const mediaId=/^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const sessionMediaId=/^sha256:[a-f0-9]{64}$/;
const sessionIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
const receiptIdPattern=/^[A-Za-z0-9._:-]{1,160}$/;





function call(method, params={}, timeoutMs=45000) { return androidBridge.call(method,params,timeoutMs); }

































function page(name){
  if(name==='memory')state.settingsChild=true;
  $('cloud-auth-page')?.classList.remove('active'); $('cloud-settings-page')?.classList.remove('active');
  workspaceNotices.clear();
  closeResourcePage({restoreFocus:false});clearTimeout(state.homePollTimer);
  closeApprovalModeMenu();closeApprovalRisk({restoreFocus:false});
  stopApprovalObservation();stopQuestionObservation();const previousPage=state.page;closeDrawer();closeModelMenu();closeAttachmentMenu();if(name!=='chat'){
    closeImagePreview({restoreFocus:false});invalidateLiveProgress();cancelAttachmentPick();stopSharedPoll();if(state.restorePending){state.restorePending=false;loadDraft();updateComposer()}}state.page=name;state.generation++;
  if(!['chat','home'].includes(name)&&['chat','home'].includes(previousPage))state.returnPage=previousPage;
  $('chat-page').classList.toggle('active',name==='chat');$('generic-page').classList.toggle('active',!['chat','home'].includes(name));
  $('home-page').classList.toggle('active',name==='home');updatePageHeader();
  if(previousPage!==name)globalThis.WeftMobileMotion?.push($(name==='chat'?'chat-page':name==='home'?'home-page':'generic-page'),name==='home'||name==='settings'&&previousPage!=='settings');
  $('conversation-usage').hidden=!(name==='chat' && state.loggedIn && (state.sharedSessionId || uiCore.mobile?.selectedBinding()?.sessionId));
  $('header-subtitle').textContent=name==='chat'?'同一个助手，接着聊。':{
    schedules:'提醒与定时任务',about:'关于',general:'常规',personalization:'个性化',assistant:'助手',approvals:'审批',resources:'资料访问',usage:'用量',memory:'记忆',capabilities:'能力与扩展',workspaces:'项目与成果',devices:'设备',notifications:'通知',settings:'设置',
    account:'账户',password:'修改密码',models:'对话模型',sync:'离线与同步',appearance:'外观',updates:'更新',connect:'连接电脑'
  }[name]||name;
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('current',b.dataset.page===name));
  if(name==='home'){renderHome();if(window.weftNative)void refreshHome();return}
  if(name==='chat'){
    if(state.chatSource==='host'){renderSharedConversation();loadSharedHistory();scheduleSharedPoll()}
    else{if(previousPage!=='chat')refreshAttachmentDrafts();renderConversation()}return}if(globalThis.WeftMobileCloud?.route(name))return;renderPage(name);
}






















































function processEvent(message){const {event,data}=message;
  if(event==='conversation.exported')toast(data.saved?'对话已保存':'导出未完成，请重试',!data.saved);
  if(event==='cloud.callback')void resumeCloudLogin();if(event==='chat.started'){
    invalidateLiveProgress();
    if(state.activeSend)acceptSend(state.activeSend,data.conversationId,data.turnId);
    state.busy=true;state.phase='waiting';state.progressText='';updateComposer();
    if(state.chatSource==='phone'&&state.conversationId===data.conversationId)status('手机模型正在回复…');
    if(state.page==='chat'&&state.chatSource==='phone')renderConversation()}
  if(event==='attachment.result')finishAttachmentPick(data);
  if(event==='sync.finished'&&Number.isSafeInteger(data?.uploaded)&&data.uploaded>0&&
      state.loggedIn&&!state.transitionPending&&state.page==='chat'&&state.chatSource==='phone'&&
      data.conversationId===state.conversationId&&!state.handoffPickerOpen.has(state.conversationId))
    void renderConversation({silent:true});
  if(event==='account.transition'){
    closeResourcePage({restoreFocus:false});clearTimeout(state.homePollTimer);
    if(data.pending){resetToolApprovals();resetToolQuestions();conversationTasks.entries.clear();conversationTasks.inFlight=null;}
    if(data.pending){closeImagePreview({restoreFocus:false});invalidateLiveProgress();stopSharedPoll();clearTimeout(state.linkedPollTimer);state.linkedPollTimer=null;state.handoffViews.clear();state.linkedEvents.clear();state.handoffModelNames.clear();state.handoffPickerOpen.clear();state.handoffSelections.clear();state.accountModelCredentialConflict=null;state.handoffModelLastCheck=0;state.linkedPending=null;state.sharedGeneration++;state.chatSource='phone';state.restorePending=false;state.sharedSessionId=null;state.sharedLoading=false;
      state.sharedSessions=[];state.sharedEvents=[];state.sharedPending=null;state.sharedOutboxLoading=false;state.sharedAwaiting=null;state.sharedChecking=null;state.sharedHostAvailable=false;
      state.conversations=[];state.artifactSaveRequest=null;state.artifactSaveLabel=null;renderConversationList();clear($('chat-content'));
      state.activeSend=null;state.sendUncertain=false;state.authEpoch++;state.transitionPending=true;state.busy=false;state.models=[];closeModelMenu();closeAttachmentMenu();cancelAttachmentPick();resetMemoryForAuthBoundary('正在切换账户，已清除上一个账户的记忆显示。');
      state.progressText='';state.phase='idle';
      status('正在切换账户并停止原回合…');renderAttachmentDrafts()}
    else{state.transitionPending=!!data.oldTurnPending;if(state.transitionPending)status('等待原回合安全结束…')}
    updateComposer();
  }
  if(event==='account.retired'){invalidateLiveProgress();state.transitionPending=false;state.busy=false;updateComposer();
    if(state.page==='chat')renderConversation();}
  if(event==='chat.delegated'&&data?.conversationId===state.conversationId&&state.chatSource==='phone'){
    state.busy=false;invalidateLiveProgress();state.phase='idle';
    status(data.state==='accepted'?'电脑已受理，正在等待真实回复':'电脑送达待核对，原请求编号已保留');
    void listConversations();void listSharedSessions();void refreshHandoff(data.conversationId);
    updateComposer();return}
  if(event==='chat.phase'&&data.conversationId===state.conversationId){state.phase=data.phase;scheduleLiveProgress()}
  if(event==='chat.progress'&&data.conversationId===state.conversationId){state.progressText=data.text||'';state.phase='answering';scheduleLiveProgress()}
  if(event==='chat.finished'){if(state.activeSend)acceptSend(state.activeSend,data.conversationId,data.turnId);
    invalidateLiveProgress();
    const current=state.chatSource==='phone'&&data.conversationId===state.conversationId;
    state.lastTerminal={conversationId:data.conversationId,turnId:data.turnId,status:data.status};
    if(current&&data.errorCode==='CONVERSATION_ROUTING_UNCONFIRMED'&&
      typeof data.retryText==='string'&&!$('draft').value.trim())$('draft').value=data.retryText;
    state.busy=false;state.phase='idle';state.progressText='';updateComposer();if(current){
      if(data.status==='completed')status('回复已保存');
      else if(data.status==='cancelled')status('本轮已停止');
      else{const message=data.errorCode==='CONVERSATION_ROUTING_UNCONFIRMED'
        ? '原目标已保存在手机，执行位置待核对；草稿已保留，重新发送会成为新消息。'
        : `回复未完成 · ${turnFailure(data.turnErrorCode||data.errorCode,data.upstreamHttpStatus)}`;status(message,true)}
      if(state.page==='chat')renderConversation();
      if(data.status==='failed'||data.status==='cancelled')refreshAttachmentDrafts()}listConversations()}
  if(event==='tool.receipt'){status(`${toolLabel(data.toolName)} · ${receiptStatus(data.status)}`);if(state.page==='chat')renderConversation()}
  if(event==='shared.outbox.reconciled'&&state.chatSource==='host'){void loadSharedOutbox();void loadSharedHistory()}
  if(event==='attachment.save'){
    if(data?.status==='saved')toast('文件已保存');
    else if(data?.status==='failed')toast(safeError({message:data.code||'OPERATION_FAILED'}),true)}
  if(event==='profile.photo'){
    if(data.status==='saved'){state.profile=data.profile;showProfile(data.profile);
      toast(data.profile?.localCacheSaved===false?'头像已在电脑保存，本机离线副本未保存':'头像已保存');
      if(state.page==='account')page('account')}
    else if(data.status==='failed')toast(safeError(new Error(data.code||'PHOTO_UNREADABLE')),true);
  }
  if(event==='artifact.save'&&state.artifactSaveRequest===data?.requestId){
    state.artifactSaveRequest=null;
    if(data.status==='saved')toast('文件已保存到手机，并已核对内容');
    else if(data.status==='cancelled')toast('已取消保存');
    else toast(safeError(new Error(data.code||'ARTIFACT_SAVE_FAILED')),true);
    const label=state.artifactSaveLabel;state.artifactSaveLabel=null;if(label)label.textContent=data.status==='saved'?'已保存到手机并核对内容':
      data.status==='cancelled'?'已取消保存':'保存未完成，请重试';
  }
  if(event==='notifications.permission'&&state.page==='notifications')page('notifications');
  if(event==='theme.system')state.nativeSystemDark=!!data.dark;
  if(event==='theme.system'&&state.appearance==='system'){
    document.documentElement.dataset.theme=data.dark?'dark':'light';document.documentElement.style.colorScheme=data.dark?'dark':'light';
  }
  if(event==='navigation.conversation'&&data.conversationId)selectConversation(data.conversationId);
  if(event==='notification.otherAccount')toast('这条提醒属于另一账户，请切回对应账户查看');
  if(event==='update.staged')toast('新界面已准备好，可在设置中应用');
  if(event==='update.applied')toast('新界面已应用，正在重新打开');
  if(event==='voice.result'){
    if(data.outcome==='text'&&state.page==='chat'&&state.generation===data.viewGeneration&&
      (state.chatSource==='host'?'':state.conversationId||'')===data.conversationId&&
      !(state.chatSource==='host'?state.sharedRunning:state.busy)){
      const draft=$('draft');draft.value=draft.value.trim()?`${draft.value.trimEnd()} ${data.text}`:data.text;
      updateComposer();draft.focus();status('语音文字已填入草稿，请确认后发送');
    }else if(data.outcome==='cancelled')status('已取消语音输入');
    else if(data.outcome==='empty')status('没有识别到文字');
    else if(data.outcome==='stale')toast('较早的语音结果未写入当前对话');
  }
}



async function boot(){
  if(!window.weftNative){applyTheme(localStorage.getItem('weftmate.mobile.theme') || 'system');state.booted=true;await WeftMobileCloud.init();return}
  window.weftNative.onmessage=androidBridge.receive;
  try{await call('events.subscribe');const info=await call('app.bootstrap');
    state.loggedIn=info.loggedIn;state.username=info.username;state.owner=info.owner;state.deviceId=info.deviceId||'';state.model=info.model;
    state.busy=info.busy;state.ui=info.ui;state.backgroundSync=info.backgroundSync||'unknown';
    state.connection=info.loggedIn?'checking':'local';
    if(info.cloudApp){
      try{const appearance=await uiCore.mobileAppearance();if(typeof appearance.systemDark==='boolean')state.nativeSystemDark=appearance.systemDark;applyTheme(appearance.value)}catch{applyTheme('system')}
      await call('app.ready',{owner:state.owner||'',hasDraft:hasAnyDraft()});state.booted=true;
      await WeftMobileCloud.init();return;
    }
    showProfile({displayName:info.username||'本机个人空间'});
    // Restore the selected phone/new or host session before updateComposer can persist the
    // initially empty textarea. Otherwise a restart deletes the saved `owner:new` draft.
    $('model-label').textContent=info.model?.displayName||'选择模型';await listConversations();
    try{state.conversationId=info.launchConversationId||localStorage.getItem(selectionKey())||state.conversations[0]?.id||null}
    catch{state.conversationId=info.launchConversationId||state.conversations[0]?.id||null}
    if(!state.conversations.some(item=>item.id===state.conversationId))state.conversationId=null;
    const previousHost=info.launchConversationId?null:savedSharedSelection();
    if(info.launchConversationId)try{localStorage.removeItem(chatSourceKey())}catch{}
    if(previousHost){state.restorePending=true;$('draft').value='';updateComposer();
      const content=$('chat-content');clear(content);content.append(notice('正在核对上次电脑会话…'));
      await restoreSharedSelection(previousHost,state.owner,state.authEpoch)}
    else{loadDraft();if(state.conversationId){await renderConversation();void refreshHandoff(state.conversationId)}else showWelcome();void listSharedSessions()}
    try{const appearance=await uiCore.mobileAppearance();if(typeof appearance.systemDark==='boolean')state.nativeSystemDark=appearance.systemDark;applyTheme(appearance.value)}catch{applyTheme('system')}
    await call('app.ready',{owner:state.owner||'',hasDraft:hasAnyDraft()});state.booted=true;
    if(!info.launchConversationId)page('home');else updatePageHeader();
    void resumeCloudLogin();void refreshCloudDevices();
    globalThis.WeftCloudMobile?.observe(refreshCloudDevices);
    if(info.notificationOtherAccount)toast('这条提醒属于另一账户，请切回对应账户查看');
    {const owner=state.owner,authEpoch=state.authEpoch;
      call('auth.me').then(profile=>{if(state.authEpoch!==authEpoch||state.owner!==owner)return;
        state.profile=profile;state.connection=profile.connectionVerified?'connected':'offline';
      if(!state.loggedIn)state.connection='local';showProfile(profile);
      if(state.page==='chat'&&state.chatSource==='phone'&&!state.restorePending&&!state.conversationId)showWelcome()}).catch(error=>{if(state.authEpoch!==authEpoch||state.owner!==owner)return;
        state.connection=state.loggedIn?(error.message==='UNAUTHORIZED'||error.message==='AUTH_REQUIRED'?'expired':'offline'):'local';
        if(state.page==='chat'&&state.chatSource==='phone'&&!state.restorePending&&!state.conversationId)showWelcome()});}
  }catch(e){status(safeError(e),true);reportBootFailure()}
}
function reportBootFailure(){if(state.booted)return;try{window.weftNative?.postMessage(JSON.stringify({
  id:`fail${++sequence}`,method:'app.failed',params:{}}))}catch{}}
window.addEventListener('error',reportBootFailure);
window.addEventListener('unhandledrejection',reportBootFailure);



function renderPage(name){const target=$('page-content');clear(target);if(name!=='settings')$('generic-page').scrollTop=0;const category=mobileSettingsRegistry.get(name);if(category)return category.mount(target);switch(name){
  case 'usage':return usagePage(target, state.usageSessionId || '');
  case 'memory':return memoryPage(target);
  case 'capabilities':return capabilitiesPage(target);
  case 'devices':return devicesPage(target);
  case 'workspaces':return workspacesPage(target);
  case 'notifications':return notificationPage(target);
  case 'account':return accountPage(target);
  case 'password':return passwordPage(target);
  case 'connect':return connectPage(target);
  case 'models':return modelsPage(target);
  case 'sync':return syncPage(target);
  case 'appearance':return appearancePage(target);
  case 'updates':return updatesPage(target);
  default:return settingsPage(target);
}}




const MEMORY_KINDS={cognition:'理解',entity:'人物与对象',relationship:'关系',event:'共同经历'};










































const projectIdPattern=/^project-[A-Za-z0-9-]{1,128}$/;
const profileIdPattern=/^[A-Za-z0-9._-]{1,128}$/;
const hostIdPattern=/^[A-Za-z0-9_-]{1,128}$/;






















const approvalIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const approvalRequestPattern=/^[A-Za-z0-9_.:-]{1,128}$/;














































































function handleBack(){if(mobileMessageActions?.dismiss())return;if(!$('resource-page').hidden){closeResourcePage();return}
  if(!$('image-preview').hidden){closeImagePreview();return}
  if(approvalModeState.confirmation){closeApprovalRisk();return}if(approvalModeState.menu){closeApprovalModeMenu({restoreFocus:true});return}
  if(state.attachmentMenu){closeAttachmentMenu({restoreFocus:true});return}if(state.attachmentPick){cancelAttachmentPick({announce:true});return}if(state.menu){closeModelMenu();$('model-button').focus();return}
  if(state.drawer){closeDrawer();$('menu-button').focus();return}
  if(state.page==='home')return;
  if(state.settingsChild && state.page!=='settings'){page('settings');state.settingsChild=false;return}
  if(state.page!=='chat'){page(state.returnPage||'chat');return}
  if(document.activeElement===$('draft')){$('draft').blur();return}page('home')}
document.addEventListener('DOMContentLoaded',()=>{
  $('menu-button').addEventListener('click',openDrawer);$('drawer-close').addEventListener('click',closeDrawer);$('drawer-scrim').addEventListener('click',closeDrawer);
  $('page-back').addEventListener('click',()=>{if(state.page==='chat')page('home');else handleBack()});
  document.querySelector('[data-action="temporary-chat"]').addEventListener('click', () => { void mobileNewTemporaryConversation(); });
  $('home-new-chat').addEventListener('click',()=>selectConversation(null));
  $('home-settings').addEventListener('click',()=>page('settings'));
  $('home-search').addEventListener('input',renderHome);
  $('outputs-button').addEventListener('click',()=>{void openConversationResources()});
  $('resource-back').addEventListener('click',()=>closeResourcePage());
  $('profile-link').addEventListener('click',()=>page('settings'));
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>page(button.dataset.page)));
  document.querySelector('[data-action="new-chat"]').addEventListener('click',()=>selectConversation(null));
  $('conversation-search').addEventListener('input',renderConversationList);
  $('draft').addEventListener('input',updateComposer);$('send-button').addEventListener('click',()=> $('send-button').dataset.action==='stop'?stop():send());
  $('draft').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){
    event.preventDefault();if(!$('send-button').disabled)void send({intent:event.ctrlKey||event.metaKey?'queue':undefined});}});
  $('model-button').addEventListener('click',openModels);$('plus-button').addEventListener('click',openAttachmentMenu);
  $('approval-mode-button').addEventListener('click',()=>{void openApprovalModes()});
  $('approval-risk-cancel').addEventListener('click',()=>closeApprovalRisk());
  $('approval-risk-confirm').addEventListener('click',()=>{if(approvalModeState.confirmation)void saveApprovalMode('allow-all',approvalModeState.confirmation)});
  $('approval-risk-dialog').addEventListener('keydown',event=>{if(event.key==='Tab'){
    event.preventDefault();(document.activeElement===$('approval-risk-cancel')?$('approval-risk-confirm'):$('approval-risk-cancel')).focus()}});
  $('approval-mode-popover').addEventListener('keydown',event=>{
    const options=[...$('approval-mode-popover').querySelectorAll('button:not(:disabled)')],index=options.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();
      options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length]?.focus()}});
  $('pick-camera').addEventListener('click',()=>pickAttachment('camera'));
  $('pick-thinking').addEventListener('click',async()=>{closeAttachmentMenu({restoreFocus:true});await uiCore.setDeepThinking(!uiCore.thinkingView().enabled);updateComposer()});
  $('attachment-popover').addEventListener('keydown',event=>{const items=[...$('attachment-popover').querySelectorAll('button:not([hidden]):not(:disabled)')];if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const i=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()});
  $('pick-image').addEventListener('click',()=>pickAttachment('image'));$('pick-file').addEventListener('click',()=>pickAttachment('file'));
  $('attachment-pick-cancel').addEventListener('click',()=>cancelAttachmentPick({announce:true}));
  $('image-preview-close').addEventListener('click',()=>closeImagePreview());
  $('image-preview').addEventListener('click',event=>{if(event.target===$('image-preview')||event.target.classList?.contains('image-preview-stage'))closeImagePreview()});
  $('toast').addEventListener('click',closeToast);
  $('voice-button').addEventListener('click',async()=>{try{await call('voice.start',{conversationId:state.chatSource==='host'?'':state.conversationId||'',viewGeneration:state.generation});
      status('等待系统语音输入；识别结果只会填入草稿')}catch(e){status(safeError(e),true)}});
  ensureConversationScroll();
  const context=$('context-usage'),tooltip=$('context-tooltip');
  const showContext=()=>{tooltip.hidden=false;globalThis.WeftPopover.position(tooltip,context)};
  context.addEventListener('mouseenter',showContext);context.addEventListener('mouseleave',()=>tooltip.hidden=true);
  context.addEventListener('focus',showContext);context.addEventListener('blur',()=>tooltip.hidden=true);
  context.addEventListener('click',showContext);
  document.addEventListener('click',event=>{if(!context.contains(event.target))tooltip.hidden=true});
  context.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();tooltip.hidden=true}});
  $('chat-scroll').addEventListener('scroll',handleChatScroll);
  document.addEventListener('click',event=>{if(state.menu&&!$('model-popover').contains(event.target)&&!$('model-button').contains(event.target))closeModelMenu();
    if(approvalModeState.menu&&!$('approval-mode-popover').contains(event.target)&&!approvalModeState.menu.trigger.contains(event.target))closeApprovalModeMenu();
    if(state.attachmentMenu&&!$('attachment-popover').contains(event.target)&&!$('plus-button').contains(event.target))closeAttachmentMenu()});
  window.addEventListener('weft-back',handleBack);window.addEventListener('keydown',event=>{if(event.key==='Escape')handleBack()});
  window.addEventListener('resize',()=>{if(state.menu)placeModelMenu();if(approvalModeState.menu)placeApprovalModeMenu();if(state.attachmentMenu)placeAttachmentMenu();syncChatInsets()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){stopSharedPoll();
      clearTimeout(state.homePollTimer);
      clearTimeout(toolApprovals.pollTimer);toolApprovals.pollTimer=null;clearTimeout(toolQuestions.pollTimer);toolQuestions.pollTimer=null}
    else if(state.page==='home')void refreshHome();
    else if(state.chatSource==='host'&&state.page==='chat'){void loadSharedHistory();scheduleSharedPoll()}
    else{if(toolApprovals.detail&&approvalViewCurrent(toolApprovals.detail.context))void refreshToolApprovals(toolApprovals.detail.context);
      if(toolQuestions.detail&&approvalViewCurrent(toolQuestions.detail.context))void refreshToolQuestions(toolQuestions.detail.context)}});
  if(window.ResizeObserver)new ResizeObserver(syncChatInsets).observe($('composer-dock'));
  const syncViewport=()=>{if(window.visualViewport){document.documentElement.style.setProperty('--viewport-height',`${window.visualViewport.height}px`);
    if(state.menu)placeModelMenu();if(approvalModeState.menu)placeApprovalModeMenu();if(state.attachmentMenu)placeAttachmentMenu()}};
  window.visualViewport?.addEventListener('resize',syncViewport);syncViewport();
  systemThemeMedia.addEventListener('change',()=>{if(state.appearance==='system')applyTheme('system')});
  boot();
});
