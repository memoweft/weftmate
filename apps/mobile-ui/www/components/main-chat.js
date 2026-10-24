/* Logical main timeline: measured rows, stable anchors, two-screen overscan. */
globalThis.WeftUiComponents.factories.mainChat = (core, ui) => {
    const original = Object.fromEntries(['renderSessions', 'paintSelectedSession', 'renderOlderControl', 'renderOptimisticMessages', 'renderConversationTasks', 'renderTurnStatus', 'beginOlderHistory', 'restoreOlderHistoryPosition', 'scrollToLatest', 'renderTimeline'].map(key => [key, ui[key]]));
    const heights = new Map(), expanded = new Map(), mounted = new Map();
    let rows = [], offsets = [], frame = null, anchor = null, observer, sidebar, sidebarHeading, tools, searchPanel, origin, top, bottom, generation = 0, fixedNavigation;
    const box = () => ui.byId('chat-scroll'), list = () => ui.byId('transcript');
    const listStart = () => list().getBoundingClientRect().top - box().getBoundingClientRect().top + box().scrollTop;
    const fixedTitle = () => document.body.classList.contains('health-open') ? '健康' : document.body.classList.contains('help-open') ? document.querySelector('.help-surface')?.dataset.title || '帮助与小技巧' : document.body.classList.contains('library-open') ? '成果库' : document.body.classList.contains('goals-open') ? '目标' : document.body.classList.contains('activity-open') ? '动态' : 'WeftMate';
    const main = () => (core.inLogicalTimeline?.() ?? core.inMainChat?.()) === true;
    const detailKey = detail => detail.dataset.step || (detail.dataset.stepGroup ? `steps:${detail.dataset.stepGroup}` : detail.classList.contains('model-thinking') ? 'thinking' : 'group');
    const detailState = detail => ({ key: detailKey(detail), open: detail.open, active: detail.dataset.active });
    const timelineChat = () => core.currentTimelineChat?.() || core.state.mainChat;
    const button = (text, name, action, className = 'button quiet small') => {
        const node = ui.element('button', className, text); node.type = 'button'; node.setAttribute('aria-label', name || text);
        node.addEventListener('click', () => Promise.resolve(action()).catch(error => ui.toast(core.failureMessage(error)))); return node;
    };
    const iconButton = (icon, name, action) => { const node = button('', name, action, 'chat-icon-button'); node.title = name; node.append(WeftIcons.create(icon, 16)); return node; };
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
        expanded.set(row.dataset.eventId, [...row.querySelectorAll('details')].map(detailState));
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
            row.classList.toggle('is-last-assistant', !core.state.chatWindow.hasNewer && spec.event?.type === 'assistant.message' && spec.key === rows.findLast(item => item.event?.type === 'assistant.message')?.key);
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
        const focus = row.contains(document.activeElement), focusName = document.activeElement?.getAttribute('aria-label'), saved = [...row.querySelectorAll('details')].map(detailState);
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
            if (row.dataset.streamSeq === String(spec.event.data?.streamSeq) && row.dataset.streamSearch===core.state.chatWindow.search.query && Number.isSafeInteger(spec.event.data?.streamSeq) && row.querySelector('.message-text,.markdown,.model-thinking')) {
                row.classList.add('message','assistant');
                row.setAttribute('aria-label',`助手消息：${Array.from(spec.event.data.text).slice(0,80).join('')}`);
                row.dataset.seq = String(spec.event.sourceRef?.seq ?? spec.event.seq);
                if (spec.event.data.text && !row.querySelector('.message-text,.markdown')) row.append(WeftContent.create('', 'message-text markdown-body'));
                const body = row.querySelector('.message-text,.markdown');
                if (spec.event.data.truncated && !spec.event.data.fullTextReadFailed && core.completeMessageEvent) {
                    globalThis.WeftReplyMotion?.indicator(body,false);
                    const identity=core.state.identityGeneration,owner=core.state.ownerId;
                    void core.completeMessageEvent(spec.event.sourceRef?.sessionId || core.state.selectedSessionId,spec.event).then(full=>{
                        if(body.isConnected && identity===core.state.identityGeneration && owner===core.state.ownerId)WeftContent.update(body,full.data.text,{streaming:false});
                    }).catch(()=>{
                        if(body.isConnected && identity===core.state.identityGeneration && owner===core.state.ownerId)
                            WeftContent.messageCompletionNotice(row, core, spec.event, spec.event.sourceRef?.sessionId || core.state.selectedSessionId, true);
                    });
                } else if (body && !spec.event.data.truncated) WeftContent.update(body, spec.event.data.text, { streaming: spec.event.data.streaming === true });
                WeftContent.messageCompletionNotice(row, core, spec.event, spec.event.sourceRef?.sessionId || core.state.selectedSessionId);
                (globalThis.WeftTimeline?.thinking || globalThis.WeftModelThinking)?.(core,row,spec.event);
                if (!spec.event.data.live) { (ui.bindMainMessage || ui.messageActions?.bind)?.(row,spec.event); ui.appendReplyMemory?.(row,spec.event); }
                if(core.state.chatWindow.search.query.trim())highlight(row);
                return;
            }
            row.tabIndex=0;row.setAttribute('role','group');row.setAttribute('aria-label',`${spec.event.type==='user.message'?'我的消息':'助手消息'}：${Array.from(spec.event.data?.text||'附件').slice(0,80).join('')}`);
            const temporary = ui.element('ol'); ui.paintHistoryMessages([spec.event], temporary); const message = temporary.firstElementChild;
            row.replaceChildren(); if (message) { row.className += ' ' + message.className; row.append(...message.childNodes); }
            WeftContent.messageCompletionNotice(row, core, spec.event, spec.event.sourceRef?.sessionId || core.state.selectedSessionId);
            if (Number.isSafeInteger(spec.event.data?.streamSeq)) row.dataset.streamSeq = String(spec.event.data.streamSeq);
            row.dataset.streamSearch=core.state.chatWindow.search.query;
            row.dataset.memorySession=spec.event.sourceRef?.sessionId||'';
            if (!spec.event.data?.live) ui.bindMainMessage?.(row, spec.event);
            const complete = Number.isSafeInteger(spec.event.data?.streamSeq) ? spec.event.data.streaming !== true : !timelineChat().running || spec.event.sourceRef?.sessionId !== timelineChat().activeSessionId || spec.event.type === 'user.message' || spec.event.eventId !== rows.filter(item => item.kind === 'message').at(-1)?.key;
            globalThis.WeftReplyMotion?.indicator(row.querySelector('.message-text,.markdown'),!complete && spec.event.type==='assistant.message');
            if(complete)globalThis.WeftReplyMotion?.reveal(row.querySelector('.message-actions'),'arrival');
            highlight(row);
        } else if (spec.kind === 'result') {
            const result = spec.event.data, summary = globalThis.WeftUiCore.sideResultText(result);
            row.classList.add('side-result'); row.replaceChildren();
            if (result.deleted) row.append(ui.element('span', 'muted', '对话已删除'));
            else {
                const open = button(summary, `打开对话结果：${summary}`, async () => {
                const chat = (await core.readChat(result.sourceChatId || spec.event.sourceRef.sourceChatId)).chat; await core.selectSession(chat.activeSessionId);
                }, 'side-result-link');
                const arrow = WeftIcons.create('chevron',16); arrow.classList.add('side-result-arrow'); open.append(arrow); row.append(open);
            }
            highlight(row);
        } else if (spec.kind === 'waiting') {
            row.classList.add('inline-waiting'); row.setAttribute('role','status'); const text=row.querySelector('.inline-progress-text')||ui.element('span','inline-progress-text is-running');if(!text.parentNode)row.replaceChildren(text);if(globalThis.WeftReplyMotion)WeftReplyMotion.status(text,spec.text,core.state.online);else text.textContent=spec.text;
        } else if (spec.kind === 'optimistic') {
            row.classList.add('message', 'user'); row.replaceChildren(ui.element('span', 'message-text', spec.event.text || (spec.event.files || []).join('、') || '附件'), ui.element('small', 'message-task-label', spec.event.status === 'undelivered' ? '未送达' : ['failed','confirming'].includes(spec.event.status) ? '发送结果待核对，草稿已保留' : spec.event.status === 'accepted' ? '已发送' : '发送中'));
            if(!row.dataset.motionSent){row.dataset.motionSent='true';requestAnimationFrame(()=>globalThis.WeftReplyMotion?.reveal(row,'send'));}
            if (['failed','confirming','undelivered'].includes(spec.event.status)) {
                const retry = button(spec.event.status === 'undelivered' ? '重试发送' : '检查状态', '检查状态', () => core.retryMainRequest(spec.event.requestId));
                retry.disabled = !!spec.event.retrying || !core.state.online;row.append(retry);
            }
        } else {
            const nested = row.querySelector('ol') || ui.element('ol', 'chat-progress'); if (!nested.parentNode) row.replaceChildren(nested);
            globalThis.WeftTimeline.render(spec.events, nested, { quietFailure:spec.finalTaskBlock===false, stopViews:Object.fromEntries([...core.conversationTasks.entries.values()].filter(entry=>entry.payload?.control?.state==='stopped'||entry.payload?.control?.stopStatus==='stopped').map(entry=>[`${entry.sessionId}:turn-${entry.payload?.source?.dshTurn??entry.payload?.replyEvidence?.turn}`,{terminal:true,text:'已停止'}])), executions:[...core.conversationTasks.entries.values()].flatMap(entry=>entry.payload?core.relatedExecutionSteps(entry.payload).map(row=>({...row,sessionId:entry.sessionId})):[]), approvals: [...core.conversationApprovals.entries.values()].map(entry=>entry.row),
                thinkingDisplay:core.state.personalization?.thinkingDisplay,
                readDetail: seq => { const event = spec.events.find(event => event.sourceRef?.seq === seq || event.data?.detailRef?.seq === seq); return event ? core.readTimelineDetail(event.sourceRef.sessionId, seq) : Promise.reject({ code: 'SOURCE_UNAVAILABLE' }); },
                questions: [...core.conversationQuestions.entries.values()].map(entry => {const event=spec.events.find(event=>event.sourceRef?.seq===entry.row.observedSeq);return {...entry.row,observedSeq:event?.seq??entry.row.observedSeq};}),
                readArtifact:id=>core.accessApi(`/library/${encodeURIComponent(id)}`),
                openAllArtifacts:()=>ui.openLibrary(),
                downloadArtifact:ui.downloadTimelineArtifact,
                onError:()=>ui.toast('文件操作未完成，请重试。'),
                openArtifact: artifact => ui.openTimelinePreview(core.conversationTaskContext(), core.artifactPreviewPath(artifact.artifactId), artifact.fileName || '成果文件'),
                appendArtifactActions: (target, artifact) => ui.appendResourceArtifactActions(target, artifact) });
        }
        for (const state of expanded.get(spec.key) || []) {
            const detail = [...row.querySelectorAll('details')].find(detail => detailKey(detail) === state.key);
            if (detail && (!detail.classList.contains('model-thinking') || state.active === detail.dataset.active)) detail.open = state.open;
        }
        if (focus && !row.contains(document.activeElement)) ([...row.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === focusName) || row).focus({ preventScroll: true });
    }
    function paintLiveChatMessages() {
        if(!main()||core.state.chatWindow.search.query.trim())return false;
        if(globalThis.WeftTimeline?.prepare && core.mainChatDays().some(day=>day.events.some(event=>event.data?.live && event.data?.modelThinking)))return false;
        const live=core.mainChatDays().flatMap(group=>group.events).filter(event=>event.data?.live);
        const keys=new Set(live.map(event=>event.presentationKey||event.eventId));
        if(rows.some(spec=>spec.event?.data?.live&&!keys.has(spec.key)))return false;
        for(const event of live){
            const key=event.presentationKey||event.eventId,spec=rows.find(spec=>spec.key===key);
            if(!spec)return false;
            spec.event=event;const row=mounted.get(key);
            if(row){
                if (event.data.text && !row.querySelector('.message-text,.markdown')) return false;
                const body = row.querySelector('.message-text,.markdown');
                if (body) WeftContent.update(body,event.data.text,{streaming:event.data.streaming===true});
                (globalThis.WeftTimeline?.thinking || globalThis.WeftModelThinking)?.(core,row,event);
                row.dataset.chatSignature=JSON.stringify([event,spec.collapsed,core.state.chatWindow.search.query,null]);
            }
        }
        ui.conversationScroll?.follow(true);
        return true;
    }
    function renderMainChat() {
        if (!tools) return;
        tools.hidden = !main(); searchPanel.hidden = !main() || !searchPanel.open;
        ui.byId('assistant-title').closest(ui.mobile ? '.topbar' : '.assistant-topbar').classList.toggle('is-main-chat',main());
        sidebar.hidden = core.supportsWorkModes?.() || !core.state.mainChat;
        sidebar.querySelector('.session-status,.mobile-session-status')?.remove();
        if (core.state.mainChat) { sidebar.dataset.statusKey = 'main'; ui.appendSessionStatus(sidebar, core.state.sessionStatusSummary?.main ?? core.state.mainChat); }
        if (ui.mobile) {
            const tab = ui.byId('mobile-tab-chat');
            if (tab) { tab.setAttribute('aria-label','聊天');tab.removeAttribute('aria-description');tab.querySelector('.chat-attention-dot')?.remove(); const attention = core.state.sessionStatusSummary?.all?.attention;
                if (attention) { tab.setAttribute('aria-description',attention === 'approval' ? '等你批准' : '等你回答'); const dot = ui.element('span','chat-attention-dot'); dot.setAttribute('role','img'); dot.setAttribute('aria-label',attention === 'approval' ? '等你批准' : '等你回答'); tab.append(dot); }
            }
        }
        sidebar.classList.toggle('is-current', core.inMainChat?.()); sidebar.setAttribute('aria-current', core.inMainChat?.() ? 'page' : 'false');
        if (!main()) return;
        tools.querySelectorAll('button')[0].disabled = !core.supportsChat('chatSearch');
        tools.querySelectorAll('button')[1].disabled = !core.supportsChat('chatTimeline');
        list().classList.add('is-main-chat');
        ui.byId('assistant-title').textContent = core.state.workTimeline ? timelineChat().title || '工作' : fixedTitle(); ui.byId('chat-intro').querySelector('h1').textContent = '今天想做什么？'; origin.hidden = true;
        const saved = ui.conversationScroll?.pinned ? null : rememberAnchor();
        rows = [];
        for (const group of core.mainChatDays()) {
            const visible = group.events.filter(event => /^(user.message|assistant.message|side.result)$/.test(event.type) && !(globalThis.WeftTimeline?.prepare && event.data?.modelThinking && !event.data.text && !event.data.images?.length));
            rows.push({ kind: 'day', key: `day:${group.date}`, date: group.date, label: group.label, collapsed: group.collapsed, count: core.state.chatWindow.dayCounts.get(group.date) ?? visible.length, estimate: 52 });
            if (group.collapsed) continue;
            const mappedEvents = group.events.map((event, seq) => ({ ...event, seq, progressSeq:seq, data: { ...event.data,
                ...(event.data?.taskId?.startsWith('turn-') ? {taskId:`${event.sourceRef.sessionId}:${event.data.taskId}`} : {}),
                ...(event.data?.completedStep ? {completedStep:{...event.data.completedStep,taskId:event.data.completedStep.taskId?.startsWith('turn-')?`${event.sourceRef.sessionId}:${event.data.completedStep.taskId}`:event.data.completedStep.taskId}}:{}) } })), mapped = globalThis.WeftTimeline?.prepare ? WeftTimeline.prepare(mappedEvents,core.state.personalization?.thinkingDisplay) : mappedEvents, projected = WeftUiCore.projectTimeline(mapped);
            const specs = visible.map(event => ({ kind: event.type === 'side.result' ? 'result' : 'message', key: event.presentationKey || event.eventId, event, seq: mapped.find(item => item.eventId === event.eventId && item.type === event.type).seq, estimate: 100 }));
            for (const block of projected.groups) {
                const end = projected.groups.find(next => next.seq > block.seq)?.seq ?? Infinity;
                const events = mapped.filter(event => event.seq >= block.seq && event.seq < end && !['user.message', 'assistant.message', 'side.result'].includes(event.type)).flatMap(event=>event.type==='artifact.created' ? event.data?.completedStep ? [{...event,type:'step.completed',data:event.data.completedStep}] : [] : [event]);
                events.push(...mapped.filter(event=>['task.ended','turn.ended'].includes(event.type)&&WeftUiCore.turnOutcome([event],block.taskId).terminal&&!events.includes(event)));
                specs.push({ kind: 'progress', key: `progress:${mapped.find(event=>event.seq===block.seq)?.presentationKey || mapped.find(event=>event.seq===block.seq)?.eventId || block.seq}`, seq: WeftUiCore.progressPosition(mapped, block, true), events, finalTaskBlock:projected.groups.filter(group=>group.taskId===block.taskId).at(-1)===block, estimate: 48 });
            }
            for (const event of projected.cards.filter(event => /^(artifact.|question.)/.test(event.type))) specs.push({ kind: 'progress', key: `output:${event.eventId || event.seq}`, seq: event.seq, events: [{...event,data:{...event.data,completedStep:undefined}},...mapped.filter(end=>['task.ended','turn.ended'].includes(end.type)&&WeftUiCore.turnOutcome([end],event.data.taskId).terminal)], estimate: 70 });
            rows.push(...specs.sort((a, b) => a.seq - b.seq));
        }
        const activeEvents = core.mainChatDays().flatMap(group=>group.events).filter(event => event.sourceRef?.sessionId === timelineChat().activeSessionId).sort((a,b)=>a.orderKey.localeCompare(b.orderKey));
        const lastVisible = activeEvents.filter(event => /^(user.message|assistant.message|step.)/.test(event.type)).at(-1);
        if (timelineChat().running && !activeEvents.some(event=>event.data?.thinkingActive && core.state.personalization?.thinkingDisplay !== 'hidden') && (!lastVisible || lastVisible.type === 'user.message' || lastVisible.type === 'step.completed')) rows.push({kind:'waiting',key:'main-waiting',text:core.processingStageLabel(timelineChat().processing),estimate:40});
        for (const event of core.optimisticMessages()) rows.push({ kind: 'optimistic', key: event.requestId, event, estimate: 90 });
        if (!top?.isConnected) { top = ui.element('li', 'chat-spacer'); bottom = ui.element('li', 'chat-spacer'); top.setAttribute('aria-hidden', 'true'); bottom.setAttribute('aria-hidden', 'true'); list().replaceChildren(top, bottom); list().setAttribute('aria-live','off'); mounted.clear(); }
        measureOffsets(); restoreAnchor(saved); renderVisible();
        ui.byId('chat-intro').hidden = rows.length > 0;
        if (core.state.chatWindow.hasNewer) {ui.byId('jump-latest').hidden=false;ui.byId('jump-latest').textContent='回到最近内容';}
        const search = core.state.chatWindow.search;
        const status = searchPanel.querySelector('[role=status]');
        status.textContent = search.query ? `${search.hits.length ? `${search.index + 1} / ${search.hits.length}` : '0 / 0'}` : '';
        status.title = core.state.chatWindow.indexState === 'building' ? '仍在整理历史' : core.state.chatWindow.indexState === 'failed' ? '历史整理失败，请重新打开对话' : search.hits.length ? '搜索结果' : '没有匹配记录';
        searchPanel.querySelector('[data-search-more]').hidden = !search.hasMore;
        if (!search.query) ui.historyNotice(core.state.chatWindow.indexState === 'building' ? '仍在整理历史，最近内容可以正常阅读。' : core.state.chatWindow.indexState === 'failed' ? '历史整理失败，请重新打开对话。' : '');
    }
    function focusMainEvent(id) {
        measureOffsets(); const index = rows.findIndex(row => row.key === id || row.event?.eventId === id); if (index < 0) return;
        ui.conversationScroll?.hold(); box().scrollTop = listStart() + offsets[index]; renderVisible();
        const row = mounted.get(rows[index].key);row?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});row?.focus({ preventScroll: true });
    }
    function resetMainChatView() { generation++; rows = []; offsets = []; heights.clear(); expanded.clear(); mounted.clear(); top = bottom = null; observer?.disconnect(); list().classList.remove('is-main-chat'); list().setAttribute('aria-live','polite'); if (searchPanel) { searchPanel.querySelector('input').value = ''; searchPanel.querySelector('[role=status]').textContent = ''; } }
    function renderChatOrigin(chat) {
        origin.replaceChildren(); origin.hidden = !chat?.contextTransfer?.sourceDeleted && !chat?.contextTransfer?.sourceRefs?.length && !chat?.originRefs?.length; if (origin.hidden) return;
        const transfer = chat.contextTransfer, ref = chat.originRefs?.[0] || transfer?.sourceRefs?.[0];
        if (transfer?.sourceDeleted) origin.append(ui.element('span', 'muted', '原消息已删除'));
        else if (ref) {const mainSource=ref.chatId===core.state.mainChat?.chatId;origin.append(button(mainSource?'来自原对话 · 查看原消息':'来自原对话 · 查看原消息',mainSource?'查看原对话消息':'查看原对话消息',async()=>{if(mainSource)return core.selectMainChat(ref.eventId);const source=(await core.readChat(ref.chatId)).chat;return core.selectSession(source.activeSessionId);}));}
        if (transfer?.state === 'references_only') origin.append(ui.element('span', 'muted', '相关上下文尚未带入'));
    }
    function mountMainChat() {
        document.addEventListener('weft:personalization', () => {
            if (!globalThis.WeftTimeline?.prepare) return;
            if (main()) { expanded.clear(); renderMainChat(); } else ui.renderTimeline();
            const mode = core.state.personalization?.thinkingDisplay || 'collapsed';
            for (const detail of list().querySelectorAll('.model-thinking')) detail.open = mode === 'expanded' && detail.dataset.active === 'true';
        });
        sidebar = button('小纬', '小纬主对话', () => core.selectMainChat(), 'rail-main-chat');
        const avatar = ui.element('span', 'wm-brand chat-avatar'); avatar.setAttribute('aria-hidden', 'true'); sidebar.prepend(avatar); sidebar.hidden = true;
        if (ui.mobile) ui.byId('drawer').querySelector('.drawer-new-group').before(sidebar);
        else ui.byId('session-rail').querySelector('.rail-top').before(sidebar);
        sidebarHeading = ui.element('div', 'rail-side-heading', '对话'); sidebar.before(sidebarHeading);
        // TB-4 owns the future fixed pages; retain the explicit extension point hidden.
        const future = ui.element('nav'); fixedNavigation = future; future.hidden = true; future.setAttribute('aria-label', '动态、健康、目标与成果库');
        if (ui.mobile) { future.id = 'mobile-bottom-tabs'; future.setAttribute('aria-label','聊天、动态、目标、成果库'); ui.byId('chat-page').append(future); }
        else sidebar.after(future);
        tools = ui.element('div', 'main-chat-tools'); tools.hidden = true;
        tools.append(iconButton('search', '搜索对话', () => { searchPanel.open = !searchPanel.open; searchPanel.hidden = !searchPanel.open; if (searchPanel.open) searchPanel.querySelector('input').focus(); }),
            iconButton('clock', '跳到日期', () => { const date = tools.querySelector('input'); date.hidden = !date.hidden; if (!date.hidden) { date.value=''; date.focus();  } }));
        const date = ui.element('input'); date.type = 'text'; date.placeholder='YYYY-MM-DD'; date.inputMode='numeric'; date.pattern='[0-9]{4}-[0-9]{2}-[0-9]{2}'; date.hidden = true; date.setAttribute('aria-label', '跳到日期');
        const jumpDate=()=>{if(!date.value)return;if(!date.checkValidity()){date.setAttribute('aria-invalid','true');ui.toast('请按年-月-日填写日期，例如 2026-10-10。');return;}date.removeAttribute('aria-invalid');date.hidden=true;void core.jumpChatDate(date.value).catch(() => ui.toast('日期暂时无法定位，请重试。')).finally(()=>tools.querySelectorAll('button')[1].focus());};
        date.addEventListener('change',jumpDate);date.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpDate();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();date.hidden=true;tools.querySelectorAll('button')[1].focus();}});tools.append(date);
        if (ui.mobile) ui.byId('chat-page').prepend(tools);
        else ui.byId('assistant-title').parentElement.after(tools);
        searchPanel = ui.element('form', 'main-chat-search'); searchPanel.hidden = true; searchPanel.setAttribute('aria-label', '对话内搜索');
        const input = ui.element('input'); input.type = 'search'; input.setAttribute('aria-label', '对话搜索关键词'); input.placeholder = '搜索这段对话';
        searchPanel.addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); void core.searchMainChat(input.value).catch(() => ui.toast('搜索暂时无法读取，请重试。')); });
        const submit = ui.element('button', 'sr-only', '查找'); submit.type = 'submit'; submit.tabIndex = -1;
        let searchTimer; input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchPanel.requestSubmit(), 250); });
        const status = ui.element('span', 'muted'); status.setAttribute('role', 'status');
        const more = button('更多', '更多搜索结果', () => core.searchMainChat(input.value, true), 'chat-more-button'); more.dataset.searchMore = ''; more.hidden = true;
        searchPanel.append(input, submit, iconButton('chevron', '上一条搜索结果', () => core.moveSearchHit(-1)), iconButton('chevron', '下一条搜索结果', () => core.moveSearchHit(1)), status, more,
            iconButton('deny', '关闭对话搜索', async () => { clearTimeout(searchTimer); searchPanel.open = false; searchPanel.hidden = true; await core.searchMainChat(''); tools.querySelector('button').focus(); }));
        origin = ui.element('div', 'chat-origin'); origin.hidden = true; box().before(searchPanel, origin);
        if (ui.mobile) { const side = button('开对话', '开对话', () => core.openSideChat({ entry: 'composer' })); side.id = 'open-side-chat'; side.prepend(WeftIcons.create('compose', 20)); side.setAttribute('role','menuitem'); side.addEventListener('click',ui.closeAttachmentMenu); ui.byId('attachment-popover').append(side); }
        observer = new ResizeObserver(entries => {
            if (!main()) return; const saved = ui.conversationScroll?.pinned ? null : rememberAnchor(); let changed = false;
            for (const entry of entries) { const height = entry.target.getBoundingClientRect().height; if (height && Math.abs((heights.get(entry.target.dataset.eventId) || 0) - height) > 1) { heights.set(entry.target.dataset.eventId, height); changed = true; } }
            if (changed) { measureOffsets(); restoreAnchor(saved); schedule(); }
        });
        const schedule = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; renderVisible(); }); };
        box().addEventListener('scroll', () => {
            schedule();
            if (main() && !core.state.chatWindow.hasNewer && box().scrollHeight - box().scrollTop - box().clientHeight <= 48) void core.markLatestChatRead?.();
            if (!main() || !rows.length || core.state.olderLoading || ui.mobile && !ui.userScrolling?.()) return;
            const scroll = box().scrollTop - listStart(), total = measureOffsets();
            if (scroll < 80 && core.state.chatWindow.hasOlder && !ui.conversationScroll?.pinned) void core.loadOlderHistory();
            else if (total - scroll - box().clientHeight < 80 && core.state.chatWindow.hasNewer) void core.loadOlderLogicalHistory('newer');
        }, { passive: true }); new ResizeObserver(schedule).observe(box());
        ui.byId('jump-latest').addEventListener('click', () => { if (main() && core.state.chatWindow.hasNewer) void core.selectMainChat(); else if (main()) void core.markLatestChatRead?.(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && searchPanel.open) { searchPanel.open = false; searchPanel.hidden = true; void core.searchMainChat(''); } });
    }
    return { mountMainChat, renderMainChat, paintLiveChatMessages, focusMainEvent, resetMainChatView, renderChatOrigin, fixedPageNavigation: () => fixedNavigation,
        mainChatAnchor: () => {const saved=rememberAnchor();const index=rows.findIndex(row=>row.key===saved?.key);const row=rows.slice(Math.max(0,index)).find(row=>row.event?.eventId||row.events?.length);return row?.event?.eventId||row?.events?.[0]?.eventId||null;},
        restoreMainChatDraft: text => { ui.byId('message-text').value = text; ui.updateAvailability(); },
        renderSessions: () => { original.renderSessions(); if (sidebar) { sidebar.hidden = core.supportsWorkModes?.() || !core.state.mainChat; sidebarHeading.hidden = sidebar.hidden; } renderMainChat(); },
        paintSelectedSession: id => { original.paintSelectedSession(id); if (main()) ui.byId('assistant-title').textContent = core.supportsWorkModes?.() ? timelineChat().displayTitle || timelineChat().title || '小纬' : fixedTitle(); else ui.byId('chat-intro').querySelector('h1').textContent = '今天想做什么？'; },
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
