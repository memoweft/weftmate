/* Desktop sessions component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.sessions = (core, ui) => {
    const collapsedGroups = new Set();
    let activeMenu, activeSubmenu;
    function closeMenu() { activeSubmenu?.remove(); activeSubmenu=null; if (activeMenu) { activeMenu.remove(); activeMenu = null; } }
    function editName(title, initial, save) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', title);
        const form = ui.element('form', 'dialog-body'); form.append(ui.element('h2', '', title));
        const input = ui.element('input'); input.value = initial; input.required = true; input.maxLength = 256; input.setAttribute('aria-label', title);
        const error = ui.element('p', 'form-error'); error.setAttribute('role','alert');
        const submit = ui.element('button','button primary','保存'); submit.type = 'submit';
        const cancel = ui.element('button','button secondary','取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        form.append(input,error,submit,cancel); dialog.append(form);
        form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; try { await save(input.value); dialog.close(); } catch(cause) { error.textContent = core.failureMessage(cause); } finally { submit.disabled = false; } };
        dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal(); input.focus(); input.select();
    }
    function manageGroups(){
        const dialog=ui.element('dialog','dialog confirm-dialog');dialog.setAttribute('aria-label','管理分组');const body=ui.element('div','dialog-body');body.append(ui.element('h2','','管理分组'));
        const notice=ui.element('p','form-error');notice.setAttribute('role','alert');
        for(const group of core.state.sessionGroups||[]){const row=ui.element('div','archived-session-row');row.append(ui.element('span','',group.name));
            const rename=ui.element('button','button secondary','重命名');rename.setAttribute('aria-label',`重命名分组 ${group.name}`);rename.onclick=()=>{dialog.close();editName('重命名分组',group.name,name=>core.sessionGroupAction('PATCH',group.id,name));};
            const remove=ui.element('button','button danger','删除');remove.setAttribute('aria-label',`删除分组 ${group.name}`);remove.onclick=async()=>{remove.disabled=true;try{await core.sessionGroupAction('DELETE',group.id);await core.refreshSessions();row.remove();}catch(error){notice.textContent=core.failureMessage(error);remove.disabled=false;}};row.append(rename,remove);body.append(row);
        }
        const close=ui.element('button','button secondary','关闭');close.onclick=()=>dialog.close();body.append(notice,close);dialog.append(body);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
    }
    function renameInline(session) {
        const row = [...ui.byId('session-list').querySelectorAll('.session-row')].find(item => item.dataset.sessionId === session.sessionId);
        if (!row) return;
        const button = row.firstElementChild, input = ui.element('input','session-rename'); input.value = session.title || '新对话'; input.maxLength = 256; input.setAttribute('aria-label','重命名对话');
        button.hidden = true; row.prepend(input); input.focus(); input.select();
        const cancel = () => { input.remove(); button.hidden = false; button.focus(); };
        input.onkeydown = async event => { if(event.key === 'Escape'){event.preventDefault();cancel();}
            if(event.key === 'Enter'){event.preventDefault();input.disabled = true;try{await core.updateSession(session.sessionId,{title:input.value});if(core.state.selectedSessionId===session.sessionId)paintSelectedSession(session.sessionId);}catch(error){input.disabled=false;input.setCustomValidity(core.failureMessage(error));input.reportValidity();input.focus();}} };
        input.oninput = () => input.setCustomValidity('');
    }
    function sessionMenu(session, trigger, groupsOnly = false) {
        if(groupsOnly){activeSubmenu?.remove();}else closeMenu();
        const menu = ui.element('div', 'session-menu'); if(groupsOnly)activeSubmenu=menu;else activeMenu = menu; menu.setAttribute('role','menu'); menu.setAttribute('aria-label',groupsOnly?'移至分组':'对话操作');
        const notice = ui.element('p','form-error'); notice.setAttribute('role','alert');
        const action = (label, run, options = {}) => {
            if(options.separator){const line=ui.element('div','session-menu-separator');line.setAttribute('role','separator');menu.append(line);}
            const button = ui.element('button', options.danger?'session-menu-item danger':'session-menu-item'); button.type='button';button.setAttribute('role','menuitem');
            button.append(ui.element('span','',label));
            if(options.key)button.append(ui.element('span','session-menu-key',options.key));
            if(options.submenu){button.setAttribute('aria-haspopup','menu');button.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();button.click();}});const icon=globalThis.WeftIcons.create('chevron',16);icon.classList.add('session-submenu-icon');button.append(icon);}
            button.onclick=async()=>{button.disabled=true;try{await run();}catch(error){notice.textContent=core.sessionLifecycleMessage(error);menu.append(notice);}finally{button.disabled=false;}};
            menu.append(button); return button;
        };
        if(groupsOnly){
            for(const group of core.state.sessionGroups || []) action(group.name,async()=>{await core.updateSession(session.sessionId,{groupId:group.id});closeMenu();});
            action('新建分组…',()=>{closeMenu();editName('新建分组','',async name=>{const result=await core.sessionGroupAction('POST',null,name);if(result)await core.updateSession(session.sessionId,{groupId:result.group.id});});},{separator:true});
            action('移出分组',async()=>{await core.updateSession(session.sessionId,{groupId:null});closeMenu();});
            action('管理分组',()=>{closeMenu();manageGroups();});
        }else{
            const runs={pin:async()=>{await core.updateSession(session.sessionId,{pinned:!session.pinned});closeMenu();},unread:async()=>{await core.updateSession(session.sessionId,{unread:!session.unread});closeMenu();},
                rename:()=>{closeMenu();renameInline(session);},fork:async()=>{const child=await core.forkSession(session.sessionId);closeMenu();if(!child)return;await core.refreshSessions();await core.selectSession(child.sessionId);},
                group:()=>sessionMenu(session,menu.querySelector('[aria-haspopup=menu]'),true),archive:async()=>{await core.archiveSession(session.sessionId,!session.archived);closeMenu();},delete:()=>{closeMenu();confirmDelete(session);}};
            const buttons = new Map();
            for(const item of globalThis.WeftUiCore.sessionMenuItems(session))buttons.set(item.id,action(item.label,runs[item.id],item));
            menu.onkeydown = event => {
                if(event.ctrlKey || event.altKey || event.metaKey)return;
                const id=globalThis.WeftUiCore.sessionMenuKey(event.key);if(id){event.preventDefault();buttons.get(id)?.click();}
            };
        }
        menu.addEventListener('keydown', event=>{
            const buttons=[...menu.querySelectorAll('[role=menuitem]')];let index=buttons.indexOf(document.activeElement);
            if(event.key==='Escape'||groupsOnly&&event.key==='ArrowLeft'){event.preventDefault();if(groupsOnly){activeSubmenu?.remove();activeSubmenu=null;}else closeMenu();trigger.focus?.();}
            else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();}
        });
        document.body.append(menu);
        const anchor=groupsOnly?{getBoundingClientRect:()=>{const rect=trigger.getBoundingClientRect();return {left:rect.right+8,right:rect.right+8,top:rect.top-8,bottom:rect.top-8};}}:trigger;
        globalThis.WeftPopover.position(menu,anchor,{side:'bottom'});menu.querySelector('button')?.focus();
    }
    document.addEventListener('pointerdown',event=>{if(activeMenu&&!activeMenu.contains(event.target)&&!activeSubmenu?.contains(event.target))closeMenu();});
    function confirmDelete(session) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', '删除对话');
        const body = ui.element('div', 'dialog-body'); body.append(ui.element('h2', '', '删除对话？'),
            ui.element('p', '', '这会永久删除对话、工作目录与经验，无法恢复。运行中的对话会先停止。'));
        const label = ui.element('label'); const forget = ui.element('input'); forget.type = 'checkbox';
        label.append(forget, document.createTextNode('同时忘掉从这段对话形成的记忆')); body.append(label);
        const snippetsLabel = ui.element('label'), snippets = ui.element('input'); snippets.type = 'checkbox';
        snippetsLabel.append(snippets, document.createTextNode('同时删除对话里含这句话的原话')); snippetsLabel.hidden = true;
        const summary = ui.element('p'); summary.setAttribute('role', 'status'); body.append(summary, snippetsLabel);
        let preview = null, previewGeneration = 0;
        const error = ui.element('p', 'form-error'); error.setAttribute('role', 'alert'); body.append(error);
        const footer = ui.element('div', 'dialog-footer');
        const cancel = ui.element('button', 'button secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
        const remove = ui.element('button', 'button danger', '永久删除'); remove.type = 'button';
        forget.addEventListener('change', async () => {
            const generation = ++previewGeneration; preview = null; snippets.checked = false;
            snippetsLabel.hidden = !forget.checked; summary.textContent = ''; error.textContent = '';
            remove.disabled = forget.checked;
            if (!forget.checked) return;
            summary.textContent = '正在读取遗忘范围…';
            try {
                const result = await core.previewSessionForget(session.sessionId);
                if (generation !== previewGeneration || !dialog.open) return;
                preview = result; summary.textContent = `将一起忘掉 ${result.itemCount} 项记忆，清除 ${result.evidenceCount} 条来源。勾选删除原话也会清除其他对话里的对应片段。`;
                remove.disabled = false;
            } catch (cause) {
                if (generation !== previewGeneration || !dialog.open) return;
                summary.textContent = ''; error.textContent = '无法读取遗忘范围，请取消勾选或重新打开确认框。';
            }
        });
        remove.addEventListener('click', async () => {
            remove.disabled = true; error.textContent = '';
            if (forget.checked && !preview) return;
            try { await core.deleteSession(session.sessionId, forget.checked, { deleteConversationSnippets: snippets.checked, worldRevision: preview?.worldRevision }); dialog.close(); }
            catch (cause) { error.textContent = core.sessionLifecycleMessage(cause); }
            finally { remove.disabled = forget.checked && !preview; }
        });
        footer.append(cancel, remove); dialog.append(body, footer); dialog.addEventListener('close', () => dialog.remove());
        document.body.append(dialog); dialog.showModal(); cancel.focus();
    }
    function paintSelectedSession(sessionId) {
        ui.byId('chat-intro').hidden = false;
        ui.byId('desktop-action').hidden = true;
        const selected = core.state.sessions.find((item) => item.sessionId === sessionId);
        ui.byId('assistant-title').textContent = selected?.title || '新对话';
        globalThis.WeftMotion?.changed(ui.byId('chat-scroll'), sessionId, 'base');
    }
    function renderSessions() {
        archivedRedraw?.();
        const list = ui.byId('session-list');
        list.replaceChildren();
        const phone = core.phoneConversations();
        const linkedSessionIds = new Set(phone.map((record) => core.phoneBinding(record.id)?.sessionId).filter(Boolean));
        if (!core.state.sessions.length && !phone.length) {
            ui.byId('sessions-status').textContent = '还没有会话。';
            return;
        }
        ui.byId('sessions-status').textContent = '';
        const query = (ui.byId('session-search').value || '').normalize('NFKC').trim().toLocaleLowerCase();
        let currentGroup = null, matches = 0;
        const sessions = core.sessionList();
        for (const session of globalThis.WeftUiCore.sortSessions(sessions).sort(globalThis.WeftUiCore.compareSessionGroups)) {
            if (!core.sessionIdPattern.test(session.sessionId) || linkedSessionIds.has(session.sessionId))
                continue;
            const title = typeof session.title === 'string' && session.title ? session.title : '新对话';
            if (query && !title.normalize('NFKC').toLocaleLowerCase().includes(query))
                continue;
            const group = session.pinned ? '置顶' : (core.state.sessionGroups || []).find(item => item.id === session.groupId)?.name || '未分组';
            const groupId = session.pinned ? 'pinned' : session.groupId || 'ungrouped';
            if (groupId !== currentGroup) {
                const heading = ui.element('li','session-group');const toggle=ui.element('button','session-group-toggle',group);toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsedGroups.has(groupId)));
                toggle.onclick=()=>{collapsedGroups.has(groupId)?collapsedGroups.delete(groupId):collapsedGroups.add(groupId);renderSessions();};heading.append(toggle);
                if(!['pinned','ungrouped'].includes(groupId)) {
                    const manage=ui.element('button','session-group-manage');manage.type='button';manage.setAttribute('aria-label',`管理分组 ${group}`);manage.append(globalThis.WeftIcons.create('more',16));
                    manage.onclick=()=>{editName('重命名分组',group,name=>core.sessionGroupAction('PATCH',groupId,name));};
                    const remove=ui.element('button','session-group-manage');remove.type='button';remove.setAttribute('aria-label',`删除分组 ${group}`);remove.append(globalThis.WeftIcons.create('trash',16));remove.onclick=()=>{void core.sessionGroupAction('DELETE',groupId).then(()=>core.refreshSessions()).catch(error=>{ui.byId('sessions-status').textContent=core.failureMessage(error);});};heading.append(manage,remove);
                }
                list.append(heading);currentGroup=groupId;
            }
            if(collapsedGroups.has(groupId) && !query) continue;
            matches++;
            const row = ui.element('li');
            const button = ui.element('button', core.state.activeChatSource === 'desktop' &&
                session.sessionId === core.state.selectedSessionId ? 'is-current' : '');
            button.type = 'button';
            const label = ui.element('span', 'session-title');
            label.append(ui.element('span', 'session-title-text', title));
            button.append(label);
            if (session.running) {
                const dot = ui.element('span', 'session-running-dot');
                dot.setAttribute('aria-label', '正在运行');
                button.children[0].append(dot);
            }
            if ([...core.conversationApprovals.entries.values()].some(entry => entry.row.sessionId === session.sessionId && entry.row.status === 'pending')) {
                const dot = ui.element('span', 'session-pending-dot');
                dot.setAttribute('aria-label', '等待审批');
                label.append(dot);
            }
            button.addEventListener('click', () => { void core.selectSession(session.sessionId); });
            row.append(button);
            row.className = 'session-row' + (session.unread ? ' is-unread' : ''); row.dataset.sessionId = session.sessionId;
            const more = ui.element('button', 'session-more'); more.append(globalThis.WeftIcons.create('more',16)); more.type = 'button'; more.setAttribute('aria-haspopup','menu'); more.setAttribute('aria-label', `更多操作 ${title}`);
            more.addEventListener('click', () => sessionMenu(session, more)); row.append(more);
            button.addEventListener('contextmenu', event => { event.preventDefault(); sessionMenu(session, more); });
            if (session.archived) button.setAttribute('aria-label', `${title}，已归档`);
            list.append(row);
        }
        for (const record of phone) {
            if (query && !core.phoneDisplayTitle(record).normalize('NFKC').toLocaleLowerCase().includes(query))
                continue;
            matches++;
            const row = ui.element('li');
            const button = ui.element('button', core.state.activeChatSource === 'phone' &&
                record.id === core.state.selectedPhoneConversationId ? 'is-current' : '');
            button.type = 'button';
            button.append(ui.element('span', 'session-title', core.phoneDisplayTitle(record)));
            button.addEventListener('click', () => { core.selectPhoneConversation(record.id); });
            row.append(button);
            list.append(row);
        }
        ui.byId('sessions-status').textContent = matches ? '' : '没有找到会话。';
        if (matches <= 20) globalThis.WeftMotion?.changed(list, JSON.stringify([query, sessions.map(row => row.sessionId)]), 'fast');
        else globalThis.WeftMotion?.cancel(list);
    }
    function mountSessions() {
        ui.byId('load-older').addEventListener('click', () => { void core.loadOlderHistory(); });
    }
    function showSettingsArchived(target) {
        const search=ui.element('input','settings-search');search.type='search';search.setAttribute('aria-label','搜索已归档对话');search.placeholder='搜索已归档对话';
        const list=ui.element('div','archived-session-list'),notice=ui.element('p','muted');notice.setAttribute('role','status');target.replaceChildren(search,list,notice);
        const draw=()=>{list.replaceChildren();for(const session of core.sessionList(true).filter(item=>(item.title||'').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))){
            const row=ui.element('div','archived-session-row');row.append(ui.element('span','',session.title||'新对话'));
            const restore=ui.element('button','button secondary','恢复');restore.type='button';restore.onclick=async()=>{restore.disabled=true;try{await core.archiveSession(session.sessionId,false);draw();}catch(error){notice.textContent=core.failureMessage(error);restore.disabled=false;}};
            const remove=ui.element('button','button danger','删除');remove.type='button';remove.onclick=()=>confirmDelete(session);row.append(restore,remove);list.append(row);}
            notice.textContent=list.children.length?'':'没有已归档对话。';};search.oninput=draw;
        void core.refreshSessions().then(draw).catch(error=>{notice.textContent=core.failureMessage(error);});
        archivedRedraw=draw;
    }
    let archivedRedraw;
    return { paintSelectedSession, renderSessions, mountSessions, showSettingsArchived };
};
