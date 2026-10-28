globalThis.WeftUiComponents.factories.workAndChat = (core, ui) => {
  let toolbar, fold, subtitle, computer, folder, error, draftModes;
  const node = ui.element;
  const project = () => core.currentFolderProject?.();
  function selectLabel(control, label, icon) {if(control.dataset.label===label)return;control.dataset.label=label;
    control.replaceChildren(WeftIcons.create(icon,18),node('span','work-select-label',label),WeftIcons.create('chevron',16));control.title=label;}
  const button = (label, icon, action) => { const b = node('button', 'folder-pill work-select', label); b.type = 'button';
    b.setAttribute('aria-haspopup','menu');selectLabel(b,label,icon);b.onclick = () => Promise.resolve(action(b)).catch(cause => ui.toast(core.failureMessage(cause))); return b; };
  function computerName(id) { const row = core.workComputers().find(row => row.hostId === id); return row?.displayName || row?.name || core.state.hostName || '这台电脑'; }
  function paintWorkMode() {
    if (!toolbar) return;
    const enabled = core.supportsWorkModes(), working = core.currentConversationMode() === 'work';
    draftModes.hidden = !enabled || !core.state.newConversation;
    const freshPage=!!core.state.newConversation;
    document.body.classList.toggle('new-conversation-page',freshPage);
    if(freshPage)ui.byId('chat-intro').querySelector('h1').textContent=working?'让电脑帮你完成':'今天，从哪里开始？';
    for (const b of draftModes.children) {
      const selected = b.dataset.draftMode === core.currentConversationMode();
      b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1;
      b.disabled = !!core.state.submitting || !!core.state.unresolvedSubmission;
    }
    const newLabel = ui.byId('new-session').querySelector('.rail-new-label'); if (newLabel) newLabel.textContent = '新对话';
    ui.byId('new-session').setAttribute('aria-label','新建对话');
    const form = ui.byId('message-form'), phoneLayout = globalThis.WeftPhoneUnify?.isPhone() === true;
    if (phoneLayout && fold.nextSibling !== form) form.before(fold);
    else if (!phoneLayout && fold.nextSibling !== form.querySelector('.composer-actions')) form.querySelector('.composer-actions').before(fold);
    if(phoneLayout&&draftModes.parentElement!==ui.byId('chat-intro'))ui.byId('chat-intro').append(draftModes);
    else if(!phoneLayout&&draftModes.nextSibling!==ui.byId('approval-picker'))ui.byId('approval-picker').before(draftModes);
    const approval = ui.byId('approval-picker');
    if (approval.parentElement !== ui.byId('model-picker').parentElement) ui.byId('model-picker').before(approval);
    const fresh = core.state.newConversation, selected = project(), id = (fresh ? core.state.workDraftHostId : null) || core.currentExecutionComputer?.() || core.state.hostId;
    const showToolbar=enabled&&working&&core.state.activeChatSource!=='phone';
    if (showToolbar) {
      const choices = core.workComputers(), online = choices.filter(row => row.online);
      selectLabel(computer,computerName(id),'desktop');computer.hidden = false;
      computer.disabled = !fresh || !choices.length; computer.setAttribute('aria-label', `电脑：${computerName(id)}`);
      selectLabel(folder,selected?.name || '选择项目或文件夹','folder');
      folder.setAttribute('aria-label', selected ? `项目或文件夹：${selected.name}` : '选择项目或文件夹');
      folder.title = selected ? `${selected.name}\n${selected.rootPath || selected.pathHint || ''}` : '选择项目或文件夹';
      folder.disabled = core.state.online === false || !!core.folderChoiceBusy?.();
      error.textContent = !online.length ? '电脑不在线' : !selected ? '先选文件夹' : selected.permission==='write'?'可读写':'只读';
      toolbar.title = !online.length ? '电脑暂时不在线。连接后就能在文件夹里工作。' : '只在所选文件夹里工作，写入仍按权限设置确认。';
      error.hidden = !error.textContent;
    }
    fold.classList.toggle('is-open',showToolbar);fold.inert=!showToolbar;fold.setAttribute('aria-hidden',String(!showToolbar));
    const phone = core.state.activeChatSource === 'phone';
    subtitle.textContent = enabled || phone ? working ? ''
      : phone ? '手机自己答的' : `由 ${computerName(id)} 回答` : '';
    subtitle.hidden = !subtitle.textContent;
    document.body.classList.toggle('work-mode-active', enabled && working);
    document.body.classList.toggle('work-modes-supported', enabled);
  }
  async function chooseFolder(trigger) {
    const entries = (core.state.projects || []).filter(row => !row.revoked && (!row.hostId || row.hostId === core.currentExecutionComputer?.() || row.hostId === core.state.hostId))
      .map(row => ({ name: row.name, icon: 'folder', checked: row.projectId === project()?.projectId, description: row.pathHint,
        action: async () => { await core.chooseFolderProject(row); paintWorkMode(); } }));
    if (!entries.length) entries.push({ name: core.state.projectsError ? '项目暂时无法读取' : '还没有项目或文件夹', disabled: true, icon: 'folder' });
    entries.push({ separator: true });
    if (globalThis.weftmateDesktop?.pickProjectFolder && !core.remoteComputerSelected?.()) entries.push({ name: '选择文件夹…', icon: 'folder-open', action: () => ui.folderChoice?.pick() });
    else entries.push({ name: '新文件夹请在电脑上添加', icon: 'desktop', disabled: true });
    entries.push({ name: '重新读取项目', icon: 'refresh', action: async () => { await core.refreshSessionProjects(); return chooseFolder(trigger); } });
    WeftPopover.openMenu(trigger, entries, { label: '选择项目或文件夹' });
  }
  function renderWorkSwitch(context, row, target, locked = false) {
    target.classList.add('work-switch-host');
    const card = node('section', 'work-switch-card'); card.setAttribute('aria-label', '切换到工作'); card.dataset.workSwitch = row.approvalId;
    card.hidden = core.state.workProjectSelecting === row.approvalId;
    const heading=node('header','work-switch-heading'),copy=node('div','work-switch-copy');
    copy.append(node('h3', '', '这件事需要在电脑上做。要切换到工作吗？'));heading.append(WeftIcons.create('desktop',20),copy);card.append(heading);
    const hostId = core.currentExecutionComputer?.() || core.state.hostId, computers = core.workComputers(), online = computers.some(r => r.hostId === hostId && r.online);
    copy.append(node('p', 'muted', online ? `在 ${computerName(hostId)} 上做，原来的消息都会保留。` : computers.length ? '需要一台在线的电脑' : '在电脑上安装 WeftMate，用同一账号登录，就能在电脑上做事。'));
    const choices = node('div', 'work-choice-list'); choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', '选择项目或文件夹');
    let selected = project()?.projectId || core.defaultFolderProject?.()?.projectId || null;
    const projects = (core.state.projects || []).filter(r => !r.revoked && (!r.hostId || r.hostId === hostId));
    if (!projects.some(p => p.projectId === selected)) selected = projects[0]?.projectId || null;
    const controls = [];
    const choose = (p) => { selected = p.projectId; for (const b of controls) b.setAttribute('aria-checked', String(b.dataset.projectId === selected)); };
    if (computers.length > 1) {
      const hostChoices = node('div', 'work-choice-list'); hostChoices.setAttribute('aria-label', '电脑');
      for (const host of computers) { const b = node('button', 'work-choice', host.displayName || host.name); b.type = 'button'; b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(host.hostId === hostId)); b.disabled = host.hostId !== hostId || !host.online;
        b.append(node('small', 'muted', !host.online ? '不在线' : host.hostId !== hostId ? '这段对话由另一台电脑回答' : '这段对话所在的电脑')); hostChoices.append(b); }
      card.append(hostChoices);
    }
    for (const p of projects) { const b = node('button', 'work-choice', p.name); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.projectId = p.projectId;
      b.setAttribute('aria-checked', String(p.projectId === selected)); b.disabled = locked || !online; b.onclick = () => choose(p); b.prepend(WeftIcons.create('folder', 18)); controls.push(b); choices.append(b); }
    if (!projects.length) choices.append(node('p', 'muted', '先在这台电脑上添加项目或文件夹。'));
    if (globalThis.weftmateDesktop?.pickProjectFolder && !core.remoteComputerSelected?.()) {
      const pick = node('button', 'button secondary', '选择文件夹…'); pick.type = 'button'; pick.disabled = locked || !online;
      pick.onclick = async () => { core.state.workProjectSelecting=row.approvalId;card.hidden=true;
        try { await ui.folderChoice.pickWorkProject(chosen => {if(chosen&&core.approvalContextCurrent(context))core.rememberFolder(chosen.projectId);}); }
        finally {core.state.workProjectSelecting=null;const bar=ui.byId('approval-bar');delete bar.dataset.workSignature;
          for(const child of bar.children)delete child.dataset.signature;ui.renderConversationApprovals();} }; choices.append(pick);
    }
    card.append(node('p','work-switch-label','选择项目或文件夹'),choices);
    const actions = node('div', 'work-switch-actions'), status = node('p', 'form-error'); status.setAttribute('role', 'status'); status.hidden = true;
    const later = node('button', 'button secondary', '先不用'); later.type = 'button'; later.disabled = locked;
    later.onclick = () => core.submitApproval(core.approvalContext(), row, 'rejected');
    const start = node('button', 'button primary', '切换到工作'); start.type = 'button'; start.disabled = locked || !online || !selected;
    start.onclick = async () => { start.disabled = later.disabled = true;
      try { await core.switchConversationWork(context, row, selected); } catch (cause) { status.textContent = core.failureMessage(cause); status.hidden = false; ui.toast(status.textContent); start.disabled = later.disabled = false; } };
    actions.append(later, start);
    if (!online && core.offlineWorkReady?.()) { start.hidden=true;const queue=node('button','button primary','交给电脑，上线后做');queue.type='button';
      queue.onclick=()=>core.openOfflineWorkMode(core.conversationTasks.entries.get(row.taskId)?.task?.sourceText || ui.readMessageDraft());actions.append(queue); }
    if (!computers.length) {const add=node('button','button secondary','添加电脑');add.type='button';add.onclick=()=>ui.openSettings('devices');actions.prepend(add);}
    card.append(status, actions); target.replaceChildren(card); return card;
  }
  function mountWorkMode() {
    const rail=ui.byId('session-rail'),navigation=ui.fixedPageNavigation?.(),top=rail.querySelector('.rail-top'),search=rail.querySelector('.search-entry');
    if(navigation){const memory=ui.byId('rail-memory');memory.hidden=false;navigation.prepend(memory);navigation.setAttribute('aria-label','记忆、动态、健康、目标与成果库');}
    const brand=ui.byId('rail-brand-row'),brandActions=ui.byId('rail-brand-actions');
    if(search){search.setAttribute('aria-label','搜索');search.title='搜索 · Ctrl K';brandActions.append(search);}
    const notices=node('button','rail-brand-notices');notices.type='button';notices.setAttribute('aria-label','查看动态通知');notices.title='动态通知';notices.append(WeftIcons.create('bell',18));notices.onclick=()=>ui.openActivity?.();brandActions.append(notices);
    const badge=node('span','rail-brand-badge');notices.append(badge);
    const paintBadge=()=>{const count=core.activity?.unreadCount||0;badge.hidden=!count;badge.textContent=count>99?'99+':String(count);notices.setAttribute('aria-description',count?`${count} 条未读`:'');notices.hidden=core.state.personalCapabilities?.activity!==1;};
    const activityBadge=ui.renderActivityBadge,activityPaint=ui.renderActivity;ui.renderActivityBadge=(...args)=>{activityBadge?.(...args);paintBadge();};ui.renderActivity=(...args)=>{activityPaint?.(...args);paintBadge();};paintBadge();
    rail.prepend(brand);brand.after(top);if(navigation){navigation.classList.add('shell-navigation');top.after(navigation);}
    draftModes=node('div','rail-mode-switch conversation-mode-switch');draftModes.setAttribute('role','tablist');draftModes.setAttribute('aria-label','新对话模式');
    for(const [mode,label,icon] of [['chat','对话','chat'],['work','工作','folder']]) {const b=node('button','',label);b.type='button';b.dataset.mode=mode;b.setAttribute('role','tab');b.prepend(WeftIcons.create(icon,16));draftModes.append(b);}
    for (const b of draftModes.children) {
      b.dataset.draftMode = b.dataset.mode; delete b.dataset.mode;
      b.setAttribute('aria-label', `新对话：${b.dataset.draftMode === 'work' ? '工作' : '对话'}`);
      b.setAttribute('aria-controls', 'conversation-pane');
      b.onclick = async () => { if(core.currentConversationMode()===b.dataset.draftMode)return;core.cancelNextSuggestions?.();
        const draft=ui.readMessageDraft();
        try {await (b.dataset.draftMode==='work'?core.startNewWork():core.startNewConversation());
          if(draft){ui.byId('message-text').value=draft;ui.updateAvailability();}}
        catch(cause){ui.toast(core.failureMessage(cause));} };
    }
    draftModes.onkeydown = event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - [...draftModes.children].indexOf(document.activeElement);
      draftModes.children[index]?.focus(); draftModes.children[index]?.click(); };
    const intro=ui.byId('chat-intro');ui.byId('approval-picker').before(draftModes);
    const learn=intro.querySelector(':scope > button');if(learn){learn.className='composer-help';ui.byId('message-form').after(learn);}
    if(globalThis.weftmateDesktop)ui.byId('message-form').parentElement.prepend(intro);
    fold=node('div','work-mode-fold');const clip=node('div','work-mode-clip');fold.append(clip);
    toolbar = node('div', 'work-mode-toolbar'); toolbar.setAttribute('aria-label', '工作电脑与文件夹');clip.append(toolbar);
    computer = button('电脑', 'desktop', trigger => WeftPopover.openMenu(trigger, core.workComputers().map(row => ({ name: row.displayName || row.name, icon: 'desktop',
      checked: row.hostId === core.state.workDraftHostId, description: row.online ? '在线' : '不在线', disabled: !row.online,
      action: () => core.chooseWorkComputer(row.hostId) })), { label: '选择电脑' }));
    folder = button('选择项目或文件夹', 'folder', chooseFolder); ui.bindWorkspaceInfo(folder, () => ({title:project()?.name || '选择项目或文件夹',project:project()})); error = node('p', 'work-mode-hint'); error.setAttribute('role', 'status');
    toolbar.append(computer, folder, error); ui.byId('message-form').querySelector('.composer-actions').before(fold);
    subtitle = node('p', 'conversation-mode-subtitle'); subtitle.setAttribute('role', 'status'); ui.byId('assistant-title').after(subtitle);
    const update = ui.updateAvailability; ui.updateAvailability = (...args) => { const result = update(...args); paintWorkMode(); return result; };
    const paint = ui.paintSelectedSession; ui.paintSelectedSession = (...args) => { const result = paint(...args); paintWorkMode(); return result; };
    paintWorkMode();
  }
  return { mountWorkMode, paintWorkMode, renderWorkSwitch };
};
