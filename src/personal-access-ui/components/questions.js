/* Desktop question bar, using authoritative shared question actions. */
globalThis.WeftUiComponents.factories.questions = (core, ui) => {
    function renderConversationQuestions() {
        const context = core.approvalContext(), list = ui.byId('transcript'), approval = ui.byId('approval-bar');
        if (!approval) return;
        const bar = WeftQuestionBar.ensure(approval);
        const rows = core.approvalContextCurrent(context) ? [...core.conversationQuestions.entries.values()]
            .filter(entry => entry.row.sessionId === context.sessionId && core.approvalSource(entry.row))
            .sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt)) : [];
        ui.renderTimeline();
        const pending = rows.filter(entry => entry.row.status === 'pending');
        WeftQuestionBar.waiting(approval, pending.reduce((n, entry) => n + entry.row.questions.length, 0));
        const wasFocused = bar.contains(document.activeElement);
        bar.hidden = !pending.length || !approval.hidden;
        if (bar.hidden && wasFocused) ui.byId('message-text').focus({ preventScroll: true });
        if (!pending.length) { bar.replaceChildren(); delete bar.dataset.signature; }
        for (const entry of rows) {
            const row = entry.row;
            const event = core.timelineEventsForContext(context).filter(event => event.type === 'question.asked' && event.data?.turn === row.turn && event.seq <= row.observedSeq).at(-1);
            const anchor = event && [...list.children].find(node => node.dataset?.timelineQuestion === event.data.callId);
            if (anchor) { anchor.hidden = row.status === 'pending'; if (!anchor.hidden) anchor.textContent = WeftQuestionBar.record(row); }
            const old = [...list.children].find(node => node.dataset?.conversationQuestion === row.questionRpcId);
            if (old) old.remove();
            if (!anchor && row.status !== 'pending') { const receipt = [...list.children].find(node => node.dataset?.receiptId === row.sourceReceiptId); if (receipt) { const record = ui.element('li', 'question-record', WeftQuestionBar.record(row)); record.dataset.conversationQuestion = row.questionRpcId; receipt.after(record); } }
        }
        if (!pending.length) return;
        const entry = pending[0], row = entry.row, marker = core.questionMarker(context, row), operation = core.conversationQuestions.operations.get(row.questionRpcId);
        const notice = entry.notice || entry.validation || (core.conversationTasks.entries.get(row.taskId)?.notice ? '原任务暂时无法核对，请重新核对。' : '') || (operation ? '正在提交回答…' : marker ? '上次回答尚未确认，请重新核对。' : '');
        bar.dataset.scope = JSON.stringify(context);
        WeftQuestionBar.paint(bar, { row, draft: core.questionDraft(context, row), remaining: pending.slice(1).reduce((n, entry) => n + entry.row.questions.length, 0),
            retry: !!marker, submitting: !!operation, locked: !!operation || !entry.authoritative || !!entry.notice || !!marker && !core.sameQuestion(marker, row), notice,
            current: () => core.approvalContextCurrent(context), focusComposer: () => ui.byId('message-text').focus({ preventScroll: true }),
            choose: (index, label, checked) => core.chooseQuestionOption(context, row, index, label, checked),
            custom: (index, text) => core.setQuestionCustom(context, row, index, text), submit: () => void core.submitQuestion(context, row),
            check: notice || marker ? () => { void core.refreshConversationTasks(); void core.refreshConversationQuestions(context, true); } : null });
    }
    return { renderConversationQuestions };
};
