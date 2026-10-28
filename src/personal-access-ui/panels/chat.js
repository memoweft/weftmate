WeftPanels.register('chat', {
  title: '侧边聊天', icon: 'chat',
  create(ctx) {
    const node = (tag, className = '', text = '') => { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; };
    const el = node('section', 'panel-chat'); el.setAttribute('aria-label', '侧边聊天');
    const scroll = node('div', 'side-chat-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', '侧边聊天记录');
    const intro = node('div', 'side-chat-intro'); intro.append(WeftIcons.create('chat', 28), node('h2', '', '在旁边聊一聊'), node('p', '', '单独讨论一个问题，主对话继续进行。'));
    const transcript = node('ol', 'transcript'); transcript.setAttribute('aria-label', '侧边聊天消息记录'); transcript.setAttribute('aria-live', 'off');
    const older = node('button', 'chat-more-button', '加载更早内容'); older.type = 'button'; older.hidden = true;
    const notice = node('p', 'side-chat-notice'); notice.setAttribute('role', 'status'); notice.hidden = true;
    scroll.append(older, intro, transcript, notice);
    const latest = node('button', 'button secondary small side-chat-latest', '回到底部'); latest.type = 'button'; latest.hidden = true;
    const composer = node('form', 'side-chat-composer'); composer.setAttribute('aria-label', '侧边聊天输入区');
    const attachmentRoot = node('div', 'composer-attachments'); attachmentRoot.hidden = true;
    const attachmentList = node('div', 'attachment-draft-list'), attachmentStatus = node('p', 'attachment-status'); attachmentStatus.setAttribute('role', 'status'); attachmentRoot.append(attachmentList, attachmentStatus);
    const input = node('textarea', 'side-chat-input'); input.rows = 2; input.placeholder = '聊点什么…'; input.setAttribute('aria-label', '侧边聊天消息');
    const tools = node('div', 'side-chat-tools'), attach = node('button', 'composer-icon attachment-add'); attach.type = 'button'; attach.setAttribute('aria-label', '添加侧聊附件'); attach.title = '添加附件'; attach.append(WeftIcons.create('plus', 18));
    const file = node('input'); file.type = 'file'; file.multiple = true; file.hidden = true;
    const model = node('button', 'model-trigger side-chat-model'); model.type = 'button'; model.setAttribute('aria-label', '侧聊模型');
    const popup = node('div', 'model-popover side-chat-model-popover'); popup.hidden = true;
    const stop = node('button', 'composer-icon side-chat-stop'); stop.type = 'button'; stop.setAttribute('aria-label', '停止侧聊回复'); stop.title = '停止回复'; stop.append(WeftIcons.create('stop', 18)); stop.hidden = true;
    const send = node('button', 'composer-icon composer-send'); send.type = 'submit'; send.setAttribute('aria-label', '发送侧聊消息'); send.title = '发送'; send.append(WeftIcons.create('send', 18));
    tools.append(attach, model, popup, stop, send); composer.append(attachmentRoot, input, tools, file); el.append(scroll, latest, composer);
    const nodes = { 'chat-scroll': scroll, transcript, 'chat-intro': intro, 'timeline-status': notice, 'jump-latest': latest, 'load-older': older,
      'message-text': input, 'message-form': composer, 'composer-attachments': attachmentRoot, 'attachment-draft-list': attachmentList, 'attachment-status': attachmentStatus };
    let disposed = false, picker;
    const ui = { scopedChat: true, element: node, byId: id => nodes[id],
      toast(text) { if (disposed) return; notice.textContent = text; notice.hidden = !text; },
      readMessageDraft: () => input.value,
      clearMessageDraft() { input.value = ''; resizeInput(); },
      restoreMainChatDraft(text) { input.value = text; resizeInput(); },
      loadAttachmentHasher: () => import('../file-sha256.js'),
      paintModels: () => update(), paintConnection: () => update(), paintOperation: () => update(),
      setApprovalModeBusy: () => update(), renderApprovalMode: () => update(), approvalModeReadFailed: () => ui.toast('审批方式暂时无法读取，请重试。'),
      closeApprovalMenu() {}, closeResourcePreview() {},
      updateModelPicker: () => picker?.update(),
      paintSelectedSession() { el.dataset.sessionId = core.state.selectedSessionId || ''; update(); },
      paintDesktopComposer() {}, closePhoneImagePreview() {}, removeResourcePreview() {}, closeRail() {}, showConversation() {},
      renderSessions: () => update(), updateAvailability: () => update(),
      renderConversationApprovals: () => ui.renderMainChat?.(), renderConversationQuestions: () => ui.renderMainChat?.(),
      renderConversationTasks: () => ui.renderMainChat?.(), renderTimeline() {},
      resetMainChatView: () => ui.disposeChatTimeline?.(),
      bindMainMessage() {}, renderChatOrigin() {},
    };
    const scope = WeftPanels.services.createChatScope(ui, ctx.tabId, ctx.computerId), core = scope.core;
    // Lookups stay in this view; UI-02 owns row identity and incremental text.
    Object.assign(ui, WeftUiComponents.factories.messages(core, ui));
    Object.assign(ui, WeftUiComponents.factories.attachments(core, ui));
    Object.assign(ui, WeftUiComponents.factories.mainChat(core, ui));
    ui.conversationScroll = WeftConversationScroll(scroll, transcript, latest);
    const composerObserver = new ResizeObserver(() => { latest.style.bottom = `${composer.offsetHeight + 28}px`; }); composerObserver.observe(composer);
    older.onclick = () => void core.loadOlderHistory().catch(error=>ui.toast(core.failureMessage(error)));
    function resizeInput() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight,160)}px`; }
    function update() {
      if (disposed) return;
      const state = core.composerState(input.value);
      send.disabled = state.sendDisabled; stop.hidden = state.cancelHidden; stop.disabled = state.cancelDisabled;
      input.disabled = state.messageDisabled; attach.disabled = state.attachmentsDisabled; model.disabled = state.modelDisabled;
      input.placeholder = state.running ? state.placeholder : '聊点什么…';
      model.textContent = state.modelName; model.title = state.modelName; picker?.update();
      el.dataset.sessionId = core.state.selectedSessionId || '';
      if (state.hint) ui.toast(state.hint);
    }
    picker = WeftModelPicker.mount({ trigger:model, popup,
      view: () => core.state.modelServices === undefined ? { services:[{serviceId:'legacy',name:'模型',models:core.state.models.map(m=>({...m,modelId:m.id,profileId:m.id}))}],selected:{serviceId:'legacy',modelId:core.state.modelProfileId},modelName:core.composerState(input.value).modelName } : core.modelServicesView(),
      select: item => item.serviceId === 'legacy' ? core.selectModelProfile(item.profileId) : core.selectServiceModel(item), refresh: () => core.refreshModelServices(true),
      add: () => ui.toast('请在主界面的设置中添加模型。'),
      thinking: () => core.thinkingView(), toggleThinking: value => core.setDeepThinking(value), toast:ui.toast });
    model.onclick = () => void picker.open();
    attach.onclick = () => file.click(); file.onchange = () => { core.addAttachmentFiles(file.files); file.value = ''; };
    input.oninput = () => { resizeInput(); update(); };
    input.onkeydown = event => WeftShortcuts.dispatch(event,{send:()=>submit(),queue:()=>submit('queue'),newline:()=>false});
    input.addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if(files.length){event.preventDefault();core.addAttachmentFiles(files);} });
    el.addEventListener('dragover', event => { if(event.dataTransfer?.types.includes('Files'))event.preventDefault(); });
    el.addEventListener('drop', event => { if(event.dataTransfer?.files.length){event.preventDefault();core.addAttachmentFiles(event.dataTransfer.files);} });
    function submit(intent) { if(!scope.sync())return; scope.start(); void core.sendDraft(input.value,intent).then(()=>core.refreshSessions()).catch(error=>ui.toast(core.failureMessage(error))); }
    composer.onsubmit = event => { event.preventDefault(); submit(); };
    stop.onclick = () => { if(scope.sync())void core.stopCurrentTurn().catch(error=>ui.toast(core.failureMessage(error))); };
    ui.mountMainChat();
    void core.startNewConversation(true).then(update);
    return { el,
      show() { scope.sync(); update(); ui.renderMainChat(); ui.conversationScroll.follow(); resizeInput(); },
      hide() { picker.close(false); },
      update() { scope.sync(); update(); },
      dispose() { disposed = true; scope.dispose(); picker.dispose(); composerObserver.disconnect(); ui.conversationScroll.dispose(); ui.disposeChatTimeline(); ui.disposeAttachmentDraftView(); input.value=''; el.replaceChildren(); },
    };
  },
});
