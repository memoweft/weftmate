globalThis.WeftUiComponents.factories.workAndChat = (core, ui) => {
  let toolbar, subtitle, computer, folder, error, modes, draftModes;
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
    modes.hidden = !enabled;
    draftModes.hidden = !enabled || !core.state.newConversation;
    for (const b of draftModes.children) {
      const selected = b.dataset.draftMode === core.currentConversationMode();
      b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1;
      b.disabled = !!core.state.submitting || !!core.state.unresolvedSubmission;
    }
    const newLabel = ui.byId('new-session').querySelector('.rail-new-label'); if (newLabel) newLabel.textContent = enabled ? '新建' : '新对话';
    for (const b of modes.children) { const selected = b.dataset.mode === core.sidebarConversationMode(); b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; }
    ui.byId('new-session').setAttribute('aria-label', enabled ? core.sidebarConversationMode() === 'work' ? '新建工作' : '新建对话' : '新对话');
    const form = ui.byId('message-form'), phoneLayout = globalThis.WeftPhoneUnify?.isPhone() === true;
    if (phoneLayout && toolbar.nextSibling !== form) form.before(toolbar);
    else if (!phoneLayout && toolbar.previousSibling !== form) form.after(toolbar);
    const approval = ui.byId('approval-picker');
    if (enabled && working && !phoneLayout) {
      if (approval.parentElement !== toolbar) toolbar.insertBefore(approval, error);
    } else if (approval.parentElement === toolbar) ui.byId('model-picker').before(approval);
    const fresh = core.state.newConversation, selected = project(), id = (fresh ? core.state.workDraftHostId : null) || core.currentExecutionComputer?.() || core.state.hostId;
    toolbar.hidden = !enabled || !working || core.state.activeChatSource === 'phone';
    if (!toolbar.hidden) {
      const choices = core.workComputers(), online = choices.filter(row => row.online);
      selectLabel(computer,computerName(id),'desktop');computer.hidden = fresh && online.length === 1;
      computer.disabled = !fresh || !choices.length; computer.setAttribute('aria-label', `电脑：${computerName(id)}`);
      selectLabel(folder,selected?.name || '选择项目或文件夹','folder');
      folder.setAttribute('aria-label', selected ? `项目或文件夹：${selected.name}` : '选择项目或文件夹');
      folder.disabled = core.state.online === false || !!core.folderChoiceBusy?.();
      error.textContent = !online.length ? '需要一台在线的电脑' : !selected ? '选好项目或文件夹，就能开始工作。' : '';
      error.hidden = !error.textContent;
    }
    const phone = core.state.activeChatSource === 'phone';
    subtitle.textContent = enabled || phone ? working ? `${computerName(id)} · ${selected?.name || '选择项目或文件夹'}`
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
    card.append(node('h3', '', '这件事需要在电脑上做。要切换到工作吗？'));
    const hostId = core.currentExecutionComputer?.() || core.state.hostId, computers = core.workComputers(), online = computers.some(r => r.hostId === hostId && r.online);
    card.append(node('p', 'muted', online ? `在 ${computerName(hostId)} 上做，原来的消息都会保留。` : computers.length ? '需要一台在线的电脑' : '在电脑上安装 WeftMate，用同一账号登录，就能在电脑上做事。'));
    const choices = node('div', 'work-choice-list'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '选择项目或文件夹');
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
    card.append(choices);
    const actions = node('div', 'work-switch-actions'), status = node('p', 'form-error'); status.setAttribute('role', 'status'); status.hidden = true;
    const later = node('button', 'button secondary', '先不用'); later.type = 'button'; later.disabled = locked;
    later.onclick = () => core.submitApproval(context, row, 'rejected');
    const start = node('button', 'button primary', '切换到工作'); start.type = 'button'; start.disabled = locked || !online || !selected;
    start.onclick = async () => { start.disabled = later.disabled = true;
      try { await core.switchConversationWork(context, row, selected); } catch (cause) { status.textContent = core.failureMessage(cause); status.hidden = false; start.disabled = later.disabled = false; } };
    actions.append(later, start);
    if (!online && core.offlineWorkReady?.()) { start.hidden=true;const queue=node('button','button primary','交给电脑，上线后做');queue.type='button';
      queue.onclick=()=>core.openOfflineWorkMode(core.conversationTasks.entries.get(row.taskId)?.task?.sourceText || ui.readMessageDraft());actions.append(queue); }
    if (!computers.length) {const add=node('button','button secondary','添加电脑');add.type='button';add.onclick=()=>ui.openSettings('devices');actions.prepend(add);}
    card.append(status, actions); target.replaceChildren(card); return card;
  }
  function mountWorkMode() {
    modes = node('div', 'rail-mode-switch'); modes.setAttribute('role', 'tablist'); modes.setAttribute('aria-label', '对话模式');
    for (const [mode, name, icon] of [['chat','对话','chat'], ['work','工作','folder']]) {
      const b = node('button', '', name); b.type = 'button'; b.dataset.mode = mode; b.setAttribute('role','tab'); b.setAttribute('aria-label',name);
      b.setAttribute('aria-controls','session-list'); b.prepend(WeftIcons.create(icon,18)); b.onclick = () => core.chooseSidebarMode(mode); modes.append(b);
    }
    modes.onkeydown = event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - [...modes.children].indexOf(document.activeElement);
      modes.children[index]?.focus(); modes.children[index]?.click(); };
    ui.byId('session-rail').prepend(modes);
    draftModes = modes.cloneNode(true); draftModes.className = 'rail-mode-switch conversation-mode-switch';
    draftModes.setAttribute('aria-label', '新对话模式');
    for (const b of draftModes.children) {
      b.dataset.draftMode = b.dataset.mode; delete b.dataset.mode;
      b.setAttribute('aria-label', `新对话：${b.dataset.draftMode === 'work' ? '工作' : '对话'}`);
      b.setAttribute('aria-controls', 'conversation-pane');
      b.onclick = () => { core.cancelNextSuggestions?.();
        void Promise.resolve(b.dataset.draftMode === 'work' ? core.startNewWork() : core.startNewConversation())
          .catch(cause => ui.toast(core.failureMessage(cause))); };
    }
    draftModes.onkeydown = event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - [...draftModes.children].indexOf(document.activeElement);
      draftModes.children[index]?.focus(); draftModes.children[index]?.click(); };
    ui.byId('assistant-title').before(draftModes);
    toolbar = node('div', 'work-mode-toolbar'); toolbar.setAttribute('aria-label', '工作电脑与文件夹'); toolbar.hidden = true;
    computer = button('电脑', 'desktop', trigger => WeftPopover.openMenu(trigger, core.workComputers().map(row => ({ name: row.displayName || row.name, icon: 'desktop',
      checked: row.hostId === core.state.workDraftHostId, description: row.online ? '在线' : '不在线', disabled: !row.online,
      action: () => core.chooseWorkComputer(row.hostId) })), { label: '选择电脑' }));
    folder = button('选择项目或文件夹', 'folder', chooseFolder); error = node('p', 'work-mode-hint'); error.setAttribute('role', 'status');
    toolbar.append(computer, folder, error); ui.byId('message-form').after(toolbar);
    subtitle = node('p', 'conversation-mode-subtitle'); subtitle.setAttribute('role', 'status'); ui.byId('assistant-title').after(subtitle);
    const update = ui.updateAvailability; ui.updateAvailability = (...args) => { const result = update(...args); paintWorkMode(); return result; };
    const paint = ui.paintSelectedSession; ui.paintSelectedSession = (...args) => { const result = paint(...args); paintWorkMode(); return result; };
    paintWorkMode();
  }
  return { mountWorkMode, paintWorkMode, renderWorkSwitch };
};
