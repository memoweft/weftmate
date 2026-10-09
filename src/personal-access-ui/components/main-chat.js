/* Logical main timeline: measured rows, stable anchors, two-screen overscan. */
globalThis.WeftUiComponents.factories.mainChat = (core, ui) => {
    const original = Object.fromEntries(['renderSessions', 'paintSelectedSession', 'renderOlderControl', 'renderOptimisticMessages', 'renderConversationTasks', 'renderTurnStatus', 'beginOlderHistory', 'restoreOlderHistoryPosition', 'scrollToLatest', 'renderTimeline'].map(key => [key, ui[key]]));
    const heights = new Map(), expanded = new Map(), mounted = new Map();
    let rows = [], offsets = [], frame = null, anchor = null, observer, sidebar, tools, searchPanel, origin, top, bottom, generation = 0;
    const box = () => ui.byId('chat-scroll'), list = () => ui.byId('transcript');
    const listStart = () => list().getBoundingClientRect().top - box().getBoundingClientRect().top + box().scrollTop;
    const main = () => core.inMainChat?.() === true;
    const button = (text, name, action, className = 'button quiet small') => {
        const node = ui.element('button', className, text); node.type = 'button'; node.setAttribute('aria-label', name || text);
        node.addEventListener('click', () => Promise.resolve(action()).catch(error => ui.toast(core.failureMessage(error)))); return node;
    };
    function rememberAnchor() {
        const viewport = box().getBoundingClientRect();
        const visible = [...mounted.values()].filter(row => row.getBoundingClientRect().bottom > viewport.top && row.getBoundingClientRect().top < viewport.bottom)
            .sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)[0];
        if (visible) return {key:visible.dataset.eventId,offset:viewport.top-visible.getBoundingClientRect().top};
        const top = box().scrollTop - listStart();
        const index = Math.max(0, offsets.findIndex((offset, i) => offset + (heights.get(rows[i]?.key) || rows[i]?.estimate || 90) > top));
        return rows[index] ? { key: rows[index].key, offset: top - offsets[index] } : null;
    }
    function restoreAnchor(saved) {
        if (!saved) return;
        const index = rows.findIndex(row => row.key === saved.key);
        if (index >= 0) box().scrollTop = listStart() + offsets[index] + saved.offset;
    }
    function measureOffsets() { let total = 0; offsets = rows.map(row => { const offset = total; total += heights.get(row.key) || row.estimate; return offset; }); return total; }
    function rememberRow(row) {
        expanded.set(row.dataset.eventId, [...row.querySelectorAll('details')].map(detail => ({ key: detail.dataset.step || 'group', open: detail.open })));
        observer?.unobserve(row); mounted.delete(row.dataset.eventId); row.remove();
    }
    function renderVisible() {
        if (!main() || !top) return;
        const total = measureOffsets(), scroll = box().scrollTop - listStart(), viewport = box().clientHeight;
        const from = Math.max(0, scroll - viewport), to = scroll + viewport * 2;
        let first = offsets.findIndex((offset, i) => offset + (heights.get(rows[i].key) || rows[i].estimate) >= from);
        if (first < 0) first = Math.max(0, rows.length - 1);
        let end = first; while (end < rows.length && offsets[end] < to) end++;
        const visible = rows.slice(first, end), keys = new Set(visible.map(row => row.key));
        // A keyboard-focused row stays mounted until focus moves.
        const focused = document.activeElement?.closest?.('[data-event-id]'); if (focused && list().contains(focused) && rows.some(row => row.key === focused.dataset.eventId)) keys.add(focused.dataset.eventId);
        for (const [key, node] of mounted) if (!keys.has(key)) rememberRow(node);
        top.style.height = `${offsets[first] || 0}px`; bottom.style.height = `${Math.max(0, total - (offsets[end] ?? total))}px`;
        for (const spec of visible) {
            let row = mounted.get(spec.key);
            if (!row) { row = buildRow(spec); row.dataset.eventId = spec.key; row.tabIndex = -1; mounted.set(spec.key, row); observer?.observe(row); }
            const pendingState = spec.kind==='progress' ? [[...core.conversationQuestions.entries.values()].map(entry=>[entry.row.questionRpcId,entry.row.status,entry.row.answer]),[...core.conversationApprovals.entries.values()].map(entry=>[entry.row.approvalId,entry.row.status,entry.row.outcome])] : null;
            const signature = JSON.stringify([spec.events || spec.event || spec.date || spec.text, spec.collapsed, core.state.chatWindow.search.query,pendingState]);
            if (row.dataset.chatSignature !== signature) { updateRow(row, spec); row.dataset.chatSignature = signature; }
        }
        // Move only rows out of order; never detach the focused control on a stream update.
        let previous = top;
        for (const spec of visible) { const row = mounted.get(spec.key); if (previous.nextSibling !== row) previous.after(row); previous = row; }
        if (previous.nextSibling !== bottom) previous.after(bottom);
    }
    function buildRow() { return ui.element('li', 'main-chat-row'); }
    function highlight(row) {
        const query = core.state.chatWindow.search.query.trim(); if (!query) return;
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const text of nodes) {
            if (text.parentElement.closest('button:not(.side-result-link), mark, script, style')) continue;
            let start = 0, at, lower = text.data.toLocaleLowerCase(), target = query.toLocaleLowerCase(), fragment = document.createDocumentFragment();
            while ((at = lower.indexOf(target, start)) >= 0) { fragment.append(document.createTextNode(text.data.slice(start, at)), ui.element('mark', '', text.data.slice(at, at + query.length))); start = at + query.length; }
            if (start) { fragment.append(document.createTextNode(text.data.slice(start))); text.replaceWith(fragment); }
        }
    }
    function updateRow(row, spec) {
        const focus = row.contains(document.activeElement), focusName = document.activeElement?.getAttribute('aria-label'), saved = [...row.querySelectorAll('details')].map(detail => ({ key: detail.dataset.step || 'group', open: detail.open }));
        if (saved.length) expanded.set(spec.key, saved);
        row.className = 'main-chat-row';
        if (spec.kind === 'day') {
            row.classList.add('chat-day'); row.replaceChildren();
            const action = button(`${spec.label}${spec.collapsed ? ` · ${spec.count} 条` : ''}`, `${spec.label}${spec.collapsed ? ` · ${spec.count} 条，展开` : '，收起'}`, () => {
                const state = core.state.chatWindow;
                if (spec.collapsed) { state.expanded.add(spec.date); state.collapsed.delete(spec.date); }
                else { state.expanded.delete(spec.date); state.collapsed.add(spec.date); }
                renderMainChat();
            }, 'chat-day-toggle'); action.setAttribute('aria-expanded', String(!spec.collapsed)); row.append(action);
        } else if (spec.kind === 'message') {
            if (ui.mobile) { row.setAttribute('role','group');row.setAttribute('aria-label',`${spec.event.type==='user.message'?'我的消息':'助手消息'}：${Array.from(spec.event.data?.text||'附件').slice(0,80).join('')}`); }
            const temporary = ui.element('ol'); ui.paintHistoryMessages([spec.event], temporary); const message = temporary.firstElementChild;
            row.replaceChildren(); if (message) { row.className += ' ' + message.className; row.append(...message.childNodes); }
            const complete = !core.state.mainChat.running || spec.event.sourceRef?.sessionId !== core.state.mainChat.activeSessionId || spec.event.type === 'user.message' || spec.event.eventId !== rows.filter(item => item.kind === 'message').at(-1)?.key;
            if (complete && core.supportsChat('sideChats')) {
                const menu = ui.element('details', 'chat-message-menu'), summary = ui.element('summary'); summary.setAttribute('aria-label', '消息菜单'); summary.append(WeftIcons.create('more', 16));
                menu.append(summary, button('从这里开旁聊', '从这里开旁聊', () => showSidePanel(spec.event))); row.append(menu);
            }
            highlight(row);
        } else if (spec.kind === 'result') {
            const result = spec.event.data, state = { completed: '成功', failed: '失败', stopped: '停止' }[result.state] || '待核对';
            row.classList.add('side-result'); row.replaceChildren();
            if (result.deleted) row.append(ui.element('span', 'muted', '旁聊已删除'));
            else {
                const open = button(`${state} · ${Array.from(result.summary || '').slice(0, 160).join('')}`, `打开旁聊结果：${state} · ${result.summary || ''}`, async () => {
                const chat = (await core.readChat(result.sourceChatId || spec.event.sourceRef.sourceChatId)).chat; await core.selectSession(chat.activeSessionId);
                }, 'side-result-link');
                const arrow = WeftIcons.create('chevron',16); arrow.classList.add('side-result-arrow'); open.append(arrow); row.append(open);
            }
            highlight(row);
        } else if (spec.kind === 'waiting') {
            row.classList.add('inline-waiting'); row.setAttribute('role','status'); row.replaceChildren(ui.element('span','inline-progress-text is-running',spec.text));
        } else if (spec.kind === 'optimistic') {
            row.classList.add('message', 'user'); row.replaceChildren(ui.element('span', 'message-text', spec.event.text), ui.element('small', 'message-task-label', spec.event.status === 'failed' ? '发送未确认，草稿已保留' : spec.event.status === 'accepted' ? '已发送' : '排队中'));
            if (spec.event.status === 'failed') row.append(button('核对原请求', '核对原请求', () => core.retryMainRequest(spec.event.requestId)));
        } else {
            const nested = row.querySelector('ol') || ui.element('ol', 'chat-progress'); if (!nested.parentNode) row.replaceChildren(nested);
            globalThis.WeftTimeline.render(spec.events, nested, { approvals: [...core.conversationApprovals.entries.values()].map(entry=>entry.row),
                readDetail: seq => { const event = spec.events.find(event => event.sourceRef?.seq === seq || event.data?.detailRef?.seq === seq); return event ? core.readTimelineDetail(event.sourceRef.sessionId, seq) : Promise.reject({ code: 'SOURCE_UNAVAILABLE' }); },
                questions: [...core.conversationQuestions.entries.values()].map(entry => {const event=spec.events.find(event=>event.sourceRef?.seq===entry.row.observedSeq);return {...entry.row,observedSeq:event?.seq??entry.row.observedSeq};}),
                openArtifact: artifact => ui.openTimelinePreview(core.conversationTaskContext(), core.artifactPreviewPath(artifact.artifactId), artifact.fileName || '成果文件'),
                appendArtifactActions: (target, artifact) => ui.appendResourceArtifactActions(target, artifact) });
        }
        for (const state of expanded.get(spec.key) || []) { const detail = [...row.querySelectorAll('details')].find(detail => (detail.dataset.step || 'group') === state.key); if (detail) detail.open = state.open; }
        if (focus && !row.contains(document.activeElement)) ([...row.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === focusName) || row).focus({ preventScroll: true });
    }
    function renderMainChat() {
        if (!tools) return;
        tools.hidden = !main(); searchPanel.hidden = !main() || !searchPanel.open;
        ui.byId('assistant-title').closest(ui.mobile ? '.topbar' : '.assistant-topbar').classList.toggle('is-main-chat',main());
        sidebar.hidden = !core.state.mainChat;
        sidebar.classList.toggle('is-current', main()); sidebar.setAttribute('aria-current', main() ? 'page' : 'false');
        if (!main()) return;
        tools.querySelectorAll('button')[0].disabled = !core.supportsChat('chatSearch');
        tools.querySelectorAll('button')[1].disabled = !core.supportsChat('chatTimeline');
        list().classList.add('is-main-chat');
        ui.byId('assistant-title').textContent = 'WeftMate'; ui.byId('chat-intro').querySelector('h1').textContent = '今天想聊些什么？'; origin.hidden = true;
        const saved = ui.conversationScroll?.pinned ? null : rememberAnchor();
        rows = [];
        for (const group of core.mainChatDays()) {
            const visible = group.events.filter(event => /^(user.message|assistant.message|side.result)$/.test(event.type));
            rows.push({ kind: 'day', key: `day:${group.date}`, date: group.date, label: group.label, collapsed: group.collapsed, count: core.state.chatWindow.dayCounts.get(group.date) ?? visible.length, estimate: 52 });
            if (group.collapsed) continue;
            const mapped = group.events.map((event, seq) => ({ ...event, seq, data: { ...event.data,
                ...(event.data?.taskId?.startsWith('turn-') ? {taskId:`${event.sourceRef.sessionId}:${event.data.taskId}`} : {}) } })), projected = WeftUiCore.projectTimeline(mapped);
            const specs = visible.map(event => ({ kind: event.type === 'side.result' ? 'result' : 'message', key: event.eventId, event, seq: mapped.find(item => item.eventId === event.eventId).seq, estimate: 100 }));
            for (const block of projected.groups) {
                const end = projected.groups.find(next => next.seq > block.seq)?.seq ?? Infinity;
                const events = mapped.filter(event => event.seq >= block.seq && event.seq < end && !['user.message', 'assistant.message', 'side.result'].includes(event.type));
                specs.push({ kind: 'progress', key: `progress:${mapped[block.seq]?.eventId || block.seq}`, seq: block.seq, events, estimate: 48 });
            }
            for (const event of projected.cards.filter(event => /^(artifact.|question.)/.test(event.type))) specs.push({ kind: 'progress', key: event.eventId, seq: event.seq, events: [event], estimate: 70 });
            rows.push(...specs.sort((a, b) => a.seq - b.seq));
        }
        const activeEvents = [...core.state.chatWindow.events.values()].filter(event => event.sourceRef?.sessionId === core.state.mainChat.activeSessionId).sort((a,b)=>a.orderKey.localeCompare(b.orderKey));
        const lastVisible = activeEvents.filter(event => /^(user.message|assistant.message|step.)/.test(event.type)).at(-1);
        if (core.state.mainChat.running && (!lastVisible || lastVisible.type === 'user.message' || lastVisible.type === 'step.completed')) rows.push({kind:'waiting',key:'main-waiting',text:core.processingStageLabel(core.state.mainChat.processing),estimate:40});
        for (const event of core.optimisticMessages()) rows.push({ kind: 'optimistic', key: event.requestId, event, estimate: 90 });
        if (!top?.isConnected) { top = ui.element('li', 'chat-spacer'); bottom = ui.element('li', 'chat-spacer'); top.setAttribute('aria-hidden', 'true'); bottom.setAttribute('aria-hidden', 'true'); list().replaceChildren(top, bottom); list().setAttribute('aria-live','off'); mounted.clear(); }
        measureOffsets(); restoreAnchor(saved); renderVisible();
        ui.byId('chat-intro').hidden = rows.length > 0;
        if (core.state.chatWindow.hasNewer) {ui.byId('jump-latest').hidden=false;ui.byId('jump-latest').textContent='回到最近内容';}
        const search = core.state.chatWindow.search;
        const status = searchPanel.querySelector('[role=status]');
        status.textContent = search.query ? `${search.hits.length ? `${search.index + 1} / ${search.hits.length}` : core.state.chatWindow.indexState === 'building' ? '仍在整理历史' : core.state.chatWindow.indexState === 'failed' ? '历史整理失败，请重新打开主对话' : '没有匹配记录'}${search.hasMore ? ' · 还有更多结果' : ''}` : '';
        searchPanel.querySelector('[data-search-more]').hidden = !search.hasMore;
        if (!search.query) ui.historyNotice(core.state.chatWindow.indexState === 'building' ? '仍在整理历史，最近内容可以正常阅读。' : core.state.chatWindow.indexState === 'failed' ? '历史整理失败，请重新打开主对话。' : '');
    }
    function focusMainEvent(id) {
        measureOffsets(); const index = rows.findIndex(row => row.key === id); if (index < 0) return;
        ui.conversationScroll?.hold(); box().scrollTop = listStart() + offsets[index]; renderVisible();
        const row = mounted.get(id);row?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});row?.focus({ preventScroll: true });
    }
    function resetMainChatView() { generation++; rows = []; offsets = []; heights.clear(); expanded.clear(); mounted.clear(); top = bottom = null; observer?.disconnect(); list().classList.remove('is-main-chat'); list().setAttribute('aria-live','polite'); if (searchPanel) { searchPanel.querySelector('input').value = ''; searchPanel.querySelector('[role=status]').textContent = ''; } }
    function renderChatOrigin(chat) {
        origin.replaceChildren(); origin.hidden = !chat?.contextTransfer && !chat?.originRefs?.length; if (origin.hidden) return;
        const transfer = chat.contextTransfer, ref = chat.originRefs?.[0] || transfer?.sourceRefs?.[0];
        if (transfer?.sourceDeleted) origin.append(ui.element('span', 'muted', '原消息已删除'));
        else if (ref) origin.append(button('来自主对话 · 查看原消息', '回到主对话原消息', () => core.selectMainChat(ref.eventId)));
        if (transfer?.state === 'references_only') origin.append(ui.element('span', 'muted', '相关上下文尚未带入'));
    }
    function showSidePanel(event) {
        const dialog = ui.element('dialog', 'dialog side-chat-dialog'); dialog.setAttribute('aria-label', '开旁聊');
        const title = ui.element('input'); title.setAttribute('aria-label', '旁聊名称'); title.value = Array.from(event.data.text || '新旁聊').slice(0, 30).join('');
        const first = ui.element('textarea'); first.setAttribute('aria-label', '旁聊第一句话'); first.value = ui.readMessageDraft();
        dialog.append(ui.element('h2', '', '从这里开旁聊'), title, ui.element('p', 'side-source', Array.from(event.data.text || '').slice(0, 160).join('')), ui.element('p', 'muted', '相关上下文尚未带入'), first,
            button('取消', '取消', () => { dialog.close(); dialog.remove(); }), button('开旁聊', '确认开旁聊', async () => {
                const draft = first.value; await core.openSideChat({ entry: 'message', title: title.value, originChatId: core.state.mainChat.chatId, originEventId: event.eventId });
                ui.restoreMainChatDraft(draft); dialog.close(); dialog.remove(); ui.byId('message-text').focus();
            }, 'button primary'));
        document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal(); title.focus();
    }
    function mountMainChat() {
        sidebar = button('WeftMate', 'WeftMate 主对话', () => core.selectMainChat(), 'rail-main-chat');
        const avatar = ui.element('span', 'wm-brand chat-avatar'); avatar.setAttribute('aria-hidden', 'true'); sidebar.prepend(avatar); sidebar.hidden = true;
        if (ui.mobile) ui.byId('session-list').before(sidebar);
        else ui.byId('session-rail').querySelector('.rail-top').before(sidebar);
        const heading = ui.element('div', 'rail-side-heading', '旁聊'); ui.byId('session-list').before(heading);
        // TB-4 owns the future fixed pages; retain the explicit extension point hidden.
        const future = ui.element('nav'); future.hidden = true; future.setAttribute('aria-label', '动态、目标与成果库');
        if (ui.mobile) { future.id = 'mobile-bottom-tabs'; future.setAttribute('aria-label','聊天、动态、目标、成果库'); ui.byId('chat-page').append(future); }
        else sidebar.after(future);
        tools = ui.element('div', 'main-chat-tools'); tools.hidden = true;
        tools.append(button('搜索', '搜索主对话', () => { searchPanel.open = !searchPanel.open; searchPanel.hidden = !searchPanel.open; if (searchPanel.open) searchPanel.querySelector('input').focus(); }),
            button('日期', '跳到日期', () => { const date = tools.querySelector('input'); date.hidden = !date.hidden; if (!date.hidden) { date.value=''; date.focus(); date.showPicker?.(); } }));
        const date = ui.element('input'); date.type = 'date'; date.hidden = true; date.setAttribute('aria-label', '跳到日期'); date.addEventListener('change', () => {date.hidden=true;void core.jumpChatDate(date.value).catch(() => ui.toast('日期暂时无法定位，请重试。')).finally(()=>tools.querySelectorAll('button')[1].focus());}); tools.append(date);
        if (ui.mobile) ui.byId('chat-page').prepend(tools);
        else ui.byId('assistant-title').parentElement.after(tools);
        searchPanel = ui.element('form', 'main-chat-search'); searchPanel.hidden = true; searchPanel.setAttribute('aria-label', '主对话内搜索');
        const input = ui.element('input'); input.type = 'search'; input.setAttribute('aria-label', '主对话搜索关键词'); input.placeholder = '搜索这段主对话';
        searchPanel.addEventListener('submit', event => { event.preventDefault(); void core.searchMainChat(input.value).catch(() => ui.toast('搜索暂时无法读取，请重试。')); });
        const submit = ui.element('button', 'button quiet small', '查找'); submit.type = 'submit';
        const status = ui.element('span', 'muted'); status.setAttribute('role', 'status');
        const more = button('更多结果', '更多搜索结果', () => core.searchMainChat(input.value, true)); more.dataset.searchMore = ''; more.hidden = true;
        searchPanel.append(input, submit, button('上一条', '上一条搜索结果', () => core.moveSearchHit(-1)), button('下一条', '下一条搜索结果', () => core.moveSearchHit(1)), status, more,
            button('关闭', '关闭主对话搜索', async () => { searchPanel.open = false; searchPanel.hidden = true; await core.searchMainChat(''); tools.querySelector('button').focus(); }));
        origin = ui.element('div', 'chat-origin'); origin.hidden = true; box().before(searchPanel, origin);
        const side = button('开旁聊', '开旁聊', () => core.openSideChat({ entry: 'composer' })); side.id = 'open-side-chat';
        if (ui.mobile) { side.setAttribute('role','menuitem'); side.addEventListener('click',ui.closeAttachmentMenu); ui.byId('attachment-popover').append(side); }
        else ui.byId('message-form').append(side);
        observer = new ResizeObserver(entries => {
            if (!main()) return; const saved = ui.conversationScroll?.pinned ? null : rememberAnchor(); let changed = false;
            for (const entry of entries) { const height = entry.target.getBoundingClientRect().height; if (height && Math.abs((heights.get(entry.target.dataset.eventId) || 0) - height) > 1) { heights.set(entry.target.dataset.eventId, height); changed = true; } }
            if (changed) { measureOffsets(); restoreAnchor(saved); schedule(); }
        });
        const schedule = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; renderVisible(); }); };
        box().addEventListener('scroll', () => {
            schedule();
            if (!main() || !rows.length || core.state.olderLoading || ui.mobile && !ui.userScrolling?.()) return;
            const scroll = box().scrollTop - listStart(), total = measureOffsets();
            if (scroll < 80 && core.state.chatWindow.hasOlder && !ui.conversationScroll?.pinned) void core.loadOlderHistory();
            else if (total - scroll - box().clientHeight < 80 && core.state.chatWindow.hasNewer) void core.loadOlderLogicalHistory('newer');
        }, { passive: true }); new ResizeObserver(schedule).observe(box());
        ui.byId('jump-latest').addEventListener('click', () => { if (main() && core.state.chatWindow.hasNewer) void core.selectMainChat(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && searchPanel.open) { searchPanel.open = false; searchPanel.hidden = true; void core.searchMainChat(''); } });
    }
    return { mountMainChat, renderMainChat, focusMainEvent, resetMainChatView, renderChatOrigin,
        mainChatAnchor: () => {const saved=rememberAnchor();const index=rows.findIndex(row=>row.key===saved?.key);const row=rows.slice(Math.max(0,index)).find(row=>row.event?.eventId||row.events?.length);return row?.event?.eventId||row?.events?.[0]?.eventId||null;},
        restoreMainChatDraft: text => { ui.byId('message-text').value = text; ui.updateAvailability(); },
        renderSessions: () => { original.renderSessions(); if (sidebar) { sidebar.hidden = !core.state.mainChat; const label = ui.byId('new-session'); label.childNodes.forEach(node => { if (node.nodeType === Node.TEXT_NODE) node.textContent = core.state.mainChat ? '新旁聊' : '新对话'; }); } renderMainChat(); },
        paintSelectedSession: id => { original.paintSelectedSession(id); if (main()) ui.byId('assistant-title').textContent = 'WeftMate'; else ui.byId('chat-intro').querySelector('h1').textContent = '今天想做什么？'; },
        renderOlderControl: () => { if (!main()) return original.renderOlderControl(); const button = ui.byId('load-older'); button.hidden = !core.state.chatWindow.hasOlder; button.disabled = core.state.olderLoading; },
        renderOptimisticMessages: () => main() ? renderMainChat() : original.renderOptimisticMessages(),
        renderConversationTasks: () => { if (!main()) return original.renderConversationTasks(); ui.renderTaskQueue?.(); ui.renderConversationApprovals(); ui.renderConversationQuestions(); },
        renderTurnStatus: () => { if (!main()) return original.renderTurnStatus(); },
        renderTimeline: (...args) => main() ? renderMainChat() : original.renderTimeline(...args),
        beginOlderHistory: () => { if (!main()) return original.beginOlderHistory(); ui.conversationScroll?.hold(); anchor = rememberAnchor(); },
        restoreOlderHistoryPosition: () => { if (!main()) return original.restoreOlderHistoryPosition(); measureOffsets(); restoreAnchor(anchor); renderVisible(); },
        scrollToLatest: () => { if (!main()) return original.scrollToLatest(); measureOffsets(); box().scrollTop = box().scrollHeight; renderVisible(); ui.conversationScroll?.latest(); }
    };
};
