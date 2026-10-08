/* Desktop sessions component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.sessions = (core, ui) => {
    function paintSelectedSession(sessionId) {
        ui.byId('chat-intro').hidden = false;
        ui.byId('desktop-action').hidden = true;
        const selected = core.state.sessions.find((item) => item.sessionId === sessionId);
        ui.byId('assistant-title').textContent = selected?.title || '新对话';
    }
    function renderSessions() {
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
        for (const session of window.WeftDesktop?.sortSessions(core.state.sessions) || core.state.sessions) {
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
