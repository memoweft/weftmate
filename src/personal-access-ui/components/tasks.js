/* Desktop tasks component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.tasks = (core, ui) => {
    function renderTaskQueue() {
        const list = ui.byId('task-queue');
        if (!list) return;
        const context = core.conversationTaskContext(), rows = core.taskQueue().filter(row => row.queued);
        const visible = rows.filter(row => row.state === 'queued' || row.state === 'running');
        const active = document.activeElement;
        const taskId = active?.closest('[data-queued-task]')?.dataset.queuedTask, action = active?.dataset.queueAction;
        const previous = new Map([...list.children].map(card => [card.dataset.queuedTask, card]));
        const departing = Math.max(previous.size, visible.length) <= 20 ? [...previous].filter(([id]) => !visible.some(row => row.taskId === id)).map(([, card]) => globalThis.WeftMotion?.snapshot(card)) : [];
        list.hidden = visible.length === 0;
        list.replaceChildren();
        for (const row of visible) {
            const card = ui.element('article', 'queued-task'); card.dataset.queuedTask = row.taskId;
            card.setAttribute('aria-label', `排队任务 ${row.text}`);
            card.append(ui.element('strong', '', row.state === 'queued' ? '排队中' : '运行中'), ui.element('p', 'queued-task-text', row.text));
            if (row.notice) { const notice = ui.element('p', 'queued-task-notice', row.notice); notice.setAttribute('role', 'status'); card.append(notice); }
            if (row.state === 'queued') {
                const actions = ui.element('div', 'conversation-task-actions');
                for (const [action, label] of [['edit', '编辑后重新排'], ['cancel', '取消']]) {
                    const button = ui.element('button', 'button quiet small', label); button.type = 'button';
                    button.dataset.queueAction = action; button.disabled = row.busy;
                    button.addEventListener('click', async () => {
                        if (!core.conversationTaskCurrent(context)) return;
                        if (action === 'cancel') return core.cancelQueuedTask(row.taskId);
                        if (ui.readMessageDraft().trim()) { ui.toast('请先发送或清空当前草稿，再编辑排队任务。'); return; }
                        const text = await core.editQueuedTask(row.taskId);
                        if (text === null || !core.conversationTaskCurrent(context)) return;
                        ui.byId('message-text').value = text;
                        core.setMessageMode('queue');
                        ui.byId('message-text').focus();
                    });
                    actions.append(button);
                }
                card.append(actions);
            }
            list.append(card);
            if (!previous.has(row.taskId) && visible.length <= 20) globalThis.WeftMotion?.reveal(card, 'fast');
        }
        for (const copy of departing) globalThis.WeftMotion?.dismiss(copy);
        if (taskId && action && document.activeElement === document.body) {
            const replacement = [...list.querySelectorAll('button')].find(button => button.dataset.queueAction === action && button.closest('[data-queued-task]').dataset.queuedTask === taskId);
            if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
        }
        // Receipt lookup may complete after the message first appears.
        for (const node of ui.byId('transcript').children) {
            if (!node.dataset?.receiptId) continue;
            const label = core.messageTaskLabel({ data: { receiptId: node.dataset.receiptId } });
            if (label && !node.querySelector('.message-task-label')) node.append(ui.element('small', 'message-task-label', label));
        }
    }
    function renderDesktopActionReview() {
        const list = ui.byId('transcript');
        for (const node of [...list.children])
            if (node.dataset?.commandReview)
                node.remove();
        const command = core.desktopBlocker();
        if (!command || core.state.activeChatSource !== 'desktop')
            return;
        const row = ui.element('li', 'conversation-task');
        row.dataset.commandReview = command.commandId;
        row.append(ui.element('p', '', core.commandStatus(command)));
        if (command.kind === 'desktop.open_app' && ['accepted_by_host', 'uncertain'].includes(command.state)) {
            const acknowledge = ui.element('button', 'button quiet small', '已在电脑核对，允许再次发起');
            acknowledge.type = 'button';
            acknowledge.addEventListener('click', () => core.acknowledgeDesktop(command));
            row.append(acknowledge);
        }
        list.append(row);
    }
    function renderConversationTasks() {
        ui.renderTaskQueue();
        ui.renderDesktopActionReview();
        const context = core.conversationTaskContext(), list = ui.byId('transcript');
        if (!context.sessionId || core.conversationTasks.ownerId !== context.ownerId || core.conversationTasks.identity !== context.identity)
            return;
        const queue = new Map(core.taskQueue().map(row => [row.taskId, row]));
        for (const entry of core.conversationTasks.entries.values()) {
            if (entry.sessionId !== context.sessionId || entry.conversationId && entry.conversationId !== context.conversationId)
                continue;
            if (['queued', 'cancelled'].includes(queue.get(entry.taskId)?.state)) {
                [...list.children].find(row => row.dataset?.conversationTask === entry.taskId)?.remove();
                continue;
            }
            const payload = entry.payload, steps = payload ? core.relatedExecutionSteps(payload) : [];
            const artifacts = (Array.isArray(payload?.artifacts) ? payload.artifacts : []).filter((row) => row?.taskId === entry.taskId && row.sessionId === context.sessionId && core.sessionIdPattern.test(row.artifactId || ''));
            const control = payload?.control;
            const outputLimited = payload?.replyEvidence?.status === 'failed' && payload.replyEvidence.endReasonKind === 'max-tokens';
            const turn = payload?.source?.dshTurn ?? payload?.replyEvidence?.turn;
            const hasTimeline = Number.isSafeInteger(turn) && core.timelineEventsForContext(context).some(e => e.type.startsWith('step.') && e.data?.taskId === `turn-${turn}`);
            const visible = entry.notice || !hasTimeline && steps.length || artifacts.length || payload?.sources?.length || control?.canStop || control && control.state !== 'active' || outputLimited;
            let card = [...list.children].find((row) => row.dataset?.conversationTask === entry.taskId);
            if (!visible) {
                card?.remove();
                continue;
            }
            const receiptId = payload?.source?.receiptId || entry.receiptId;
            const anchor = [...list.children].find((row) => row.dataset?.receiptId === receiptId);
            if (!anchor && !entry.notice)
                continue;
            if (card && anchor && anchor.nextSibling !== card)
                list.insertBefore(card, anchor.nextSibling);
            const signature = JSON.stringify([payload, entry.notice]);
            const scope = JSON.stringify([context.ownerId, context.identity, context.source, context.sessionId,
                context.conversationId, entry.taskId]);
            if (card?.dataset.signature === signature && card.dataset.scope === scope)
                continue;
            const active = document.activeElement;
            const focusAction = card?.dataset.scope === scope && core.conversationTaskCurrent(context) &&
                card.contains(active) && !document.querySelector('dialog[open]')
                ? active.dataset?.conversationTaskAction : null;
            if (!card) {
                card = ui.element('li', 'conversation-task');
                card.dataset.conversationTask = entry.taskId;
                if (anchor)
                    list.insertBefore(card, anchor.nextSibling);
                else
                    list.append(card);

            }
            const expanded = card.querySelector?.('details')?.open === true;
            card.dataset.signature = signature;
            card.dataset.scope = scope;
            card.classList.toggle('has-timeline', hasTimeline && !entry.notice && !outputLimited && control?.state === 'active');
            card.replaceChildren();
            card.append(ui.element('strong', 'conversation-task-title', entry.notice ? '工具进展 · 待更新'
                : outputLimited && !steps.length && !artifacts.length ? '回复状态' : '工具进展'));
            if (entry.notice)
                card.append(ui.element('p', 'conversation-task-notice', entry.notice));
            if (steps.length && !hasTimeline) {
                const latest = steps.slice(-3), records = ui.element('ul', 'conversation-task-steps');
                for (const step of latest)
                    records.append(ui.element('li', '', `${entry.notice ? '上次记录：' : ''}${core.executionName(step)} · ${core.executionProgress(step)}`));
                card.append(records);
                if (steps.length > 3) {
                    const details = ui.element('details', 'conversation-task-more');
                    details.open = expanded;
                    const summary = ui.element('summary', '', `查看全部 ${steps.length} 条执行记录`);
                    summary.dataset.conversationTaskAction = 'more';
                    details.append(summary);
                    for (const step of steps)
                        details.append(ui.element('p', '', `${core.executionName(step)} · ${core.executionProgress(step)}`));
                    card.append(details);
                }
            }
            if (!entry.notice && control && control.state !== 'active')
                card.append(ui.element('p', 'conversation-task-state', core.taskControlStatus(control)));
            if (!entry.notice && payload?.replyEvidence)
                card.append(ui.element('p', 'conversation-task-reply', core.taskReplyText(payload.replyEvidence)));
            const verified = artifacts.filter((row) => row.state === 'observed' && row.verification?.status === 'observed' &&
                row.verification?.method === 'sha256_readback');
            for (const artifact of artifacts)
                ui.appendTimelineArtifact(card, artifact, context);
            if (artifacts.length)
                card.append(ui.element('p', 'conversation-task-result', verified.length
                    ? `${verified.length} 个成果文件已读回核验` : '成果文件仍待核验'));
            const actions = ui.element('div', 'conversation-task-actions');
            const detail = ui.element('button', 'button secondary small', verified.length ? '查看来源与成果' : '查看来源与成果');
            detail.type = 'button';
            detail.dataset.conversationTaskAction = 'detail';
            detail.addEventListener('click', () => ui.inlineTaskInfo(entry.taskId, detail));
            actions.append(detail);
            if (entry.notice) {
                const retry = ui.element('button', 'button secondary small', '重新核对进展');
                retry.type = 'button';
                retry.dataset.conversationTaskAction = 'retry';
                retry.addEventListener('click', () => {
                    if (core.conversationTaskCurrent(context))
                        void core.refreshConversationTasks();
                });
                actions.append(retry);
            }
            card.append(actions);
            if (['detail', 'retry', 'more'].includes(focusAction) && core.conversationTaskCurrent(context) &&
                card.dataset.scope === scope && !document.querySelector('dialog[open]') &&
                (document.activeElement === active || document.activeElement === document.body)) {
                const replacement = card.querySelector(`[data-conversation-task-action="${focusAction}"]`);
                if (replacement?.isConnected && !replacement.disabled && !replacement.hidden)
                    replacement.focus({ preventScroll: true });
            }
        }
        for (const card of [...list.children])
            if (card.dataset?.conversationTask && !core.conversationTasks.entries.has(card.dataset.conversationTask)) card.remove();
        ui.renderConversationApprovals();
        ui.renderConversationQuestions();
    }
    return { renderTaskQueue, renderDesktopActionReview, renderConversationTasks };
};
