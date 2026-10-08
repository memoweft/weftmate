/* Desktop sessions component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.sessions = (core, ui) => {
    let archivedView = false;
    function sessionMenu(session) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog');
        dialog.setAttribute('aria-label', '对话操作');
        const body = ui.element('div', 'dialog-body');
        body.append(ui.element('h2', '', session.title || '新对话'));
        const archive = ui.element('button', 'button secondary', session.archived ? '恢复对话' : '归档对话');
        archive.type = 'button';
        const notice = ui.element('p', 'form-error'); notice.setAttribute('role', 'alert');
        archive.addEventListener('click', async () => {
            archive.disabled = true;
            try { await core.archiveSession(session.sessionId, !session.archived); dialog.close(); }
            catch (error) { notice.textContent = core.sessionLifecycleMessage(error); }
            finally { archive.disabled = false; }
        });
        const remove = ui.element('button', 'button danger', '删除对话'); remove.type = 'button';
        remove.addEventListener('click', () => { dialog.close(); confirmDelete(session); });
        const cancel = ui.element('button', 'button secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
        body.append(archive, remove, notice, cancel); dialog.append(body);
        dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
    }
    function confirmDelete(session) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', '删除对话');
        const body = ui.element('div', 'dialog-body'); body.append(ui.element('h2', '', '删除对话？'),
            ui.element('p', '', '这会永久删除对话、工作目录与经验，无法恢复。运行中的对话会先停止。'));
        const label = ui.element('label'); const forget = ui.element('input'); forget.type = 'checkbox';
        label.append(forget, document.createTextNode('同时忘掉从这段对话形成的记忆')); body.append(label);
        const error = ui.element('p', 'form-error'); error.setAttribute('role', 'alert'); body.append(error);
        const footer = ui.element('div', 'dialog-footer');
        const cancel = ui.element('button', 'button secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
        const remove = ui.element('button', 'button danger', '永久删除'); remove.type = 'button';
        remove.addEventListener('click', async () => {
            remove.disabled = true; error.textContent = '';
            try { await core.deleteSession(session.sessionId, forget.checked); dialog.close(); }
            catch (cause) { error.textContent = core.sessionLifecycleMessage(cause); }
            finally { remove.disabled = false; }
        });
        footer.append(cancel, remove); dialog.append(body, footer); dialog.addEventListener('close', () => dialog.remove());
        document.body.append(dialog); dialog.showModal(); cancel.focus();
    }
    function paintSelectedSession(sessionId) {
        ui.byId('chat-intro').hidden = false;
        ui.byId('desktop-action').hidden = true;
        const selected = core.state.sessions.find((item) => item.sessionId === sessionId);
        ui.byId('assistant-title').textContent = selected?.title || '新对话';
    }
    function renderSessions() {
        const list = ui.byId('session-list');
        list.replaceChildren();
        let toggle = document.getElementById('archived-sessions');
        if (!toggle) {
            toggle = ui.element('button', 'rail-link'); toggle.id = 'archived-sessions'; toggle.type = 'button';
            toggle.addEventListener('click', () => { archivedView = !archivedView; renderSessions(); });
            list.parentNode.insertBefore(toggle, list);
        }
        toggle.textContent = archivedView ? '返回最近对话' : '已归档'; toggle.setAttribute('aria-pressed', String(archivedView));
        const phone = archivedView ? [] : core.phoneConversations();
        const linkedSessionIds = new Set(phone.map((record) => core.phoneBinding(record.id)?.sessionId).filter(Boolean));
        if (!core.state.sessions.length && !phone.length) {
            ui.byId('sessions-status').textContent = '还没有会话。';
            return;
        }
        ui.byId('sessions-status').textContent = '';
        const query = (ui.byId('session-search').value || '').normalize('NFKC').trim().toLocaleLowerCase();
        let currentGroup = null, matches = 0;
        const sessions = core.sessionList(archivedView);
        for (const session of window.WeftDesktop?.sortSessions(sessions) || sessions) {
            if (!core.sessionIdPattern.test(session.sessionId) || linkedSessionIds.has(session.sessionId))
                continue;
            const title = typeof session.title === 'string' && session.title ? session.title : '新对话';
            if (query && !title.normalize('NFKC').toLocaleLowerCase().includes(query))
                continue;
            const group = window.WeftDesktop?.sessionGroup(session) || '会话';
            if (window.WeftDesktop && group !== currentGroup) {
                list.append(ui.element('li', 'session-group', group));
                currentGroup = group;
            }
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
            row.className = 'session-row';
            const more = ui.element('button', 'session-more', '更多'); more.type = 'button'; more.setAttribute('aria-label', `更多操作 ${title}`);
            more.addEventListener('click', () => sessionMenu(session)); row.append(more);
            button.addEventListener('contextmenu', event => { event.preventDefault(); sessionMenu(session); });
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
    }
    function mountSessions() {
        ui.byId('load-older').addEventListener('click', () => { void core.loadOlderHistory(); });
    }
    return { paintSelectedSession, renderSessions, mountSessions };
};
