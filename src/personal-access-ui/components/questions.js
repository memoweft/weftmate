/* Desktop questions component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.questions = (core, ui) => {
    function renderConversationQuestions() {
        const context = core.approvalContext(), list = ui.byId('transcript');
        if (!core.approvalContextCurrent(context))
            return;
        const scroll = ui.byId('chat-scroll'), top = scroll.scrollTop;
        const reading = [...list.children].find((node) => node.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top);
        const readingTop = reading?.getBoundingClientRect().top, visible = new Set();
        for (const entry of core.conversationQuestions.entries.values()) {
            const row = entry.row;
            if (row.sessionId !== context.sessionId || !core.approvalSource(row))
                continue;
            const questionEvent = [...(core.state.activeChatSource === 'phone' ? core.state.phoneHostEvents.get(context.conversationId) || [] : core.state.historyEvents.values())]
                .filter(e => e.type === 'question.asked' && e.data?.turn === row.turn && Number.isSafeInteger(row.observedSeq) && e.seq <= row.observedSeq).sort((a, b) => b.seq - a.seq)[0];
            const timelineAnchor = questionEvent && [...list.children].find(node => node.dataset?.timelineQuestion === questionEvent.data.callId);
            const anchor = timelineAnchor || [...list.children].find((node) => node.dataset?.receiptId === row.sourceReceiptId);
            if (!anchor)
                continue;
            visible.add(row.questionRpcId);
            const marker = core.questionMarker(context, row), operation = core.conversationQuestions.operations.get(row.questionRpcId);
            const sourceNotice = core.conversationTasks.entries.get(row.taskId)?.notice || '';
            const notice = entry.notice || (sourceNotice ? '原任务暂时无法核对，已填写内容保留。请重新核对。' : '') ||
                (marker && !core.sameQuestion(marker, row) ? '问题内容已变化，无法重发原回答。请重新核对原对话。' : '');
            const signature = JSON.stringify([row, notice, entry.authoritative, entry.validation, marker, operation?.requestId]);
            const scope = JSON.stringify(context);
            let card = [...list.children].find((node) => node.dataset?.conversationQuestion === row.questionRpcId);
            if (timelineAnchor) {
                timelineAnchor.hidden = true;
                if (card) {
                    card.dataset.seq = timelineAnchor.dataset.seq;
                    list.insertBefore(card, timelineAnchor);
                }
            }
            if (card?.dataset.signature === signature && card.dataset.scope === scope)
                continue;
            const active = document.activeElement, focusAction = card?.dataset.scope === scope && card.contains(active) &&
                !document.querySelector('dialog[open]') ? active.dataset?.conversationQuestionAction : null;
            const selection = focusAction?.startsWith('custom-') ? [active.selectionStart, active.selectionEnd] : null;
            if (!card) {
                card = ui.element('li', 'conversation-task conversation-question');
                card.dataset.conversationQuestion = row.questionRpcId;
                let next = anchor.nextSibling;
                while (next?.dataset?.conversationTask || (next?.dataset?.conversationApproval || next?.dataset?.conversationQuestion) &&
                    next.dataset.sourceReceiptId === row.sourceReceiptId)
                    next = next.nextSibling;
                list.insertBefore(card, next);
            }
            if (timelineAnchor) {
                card.dataset.seq = timelineAnchor.dataset.seq;
                list.insertBefore(card, timelineAnchor);
            }
            card.dataset.sourceReceiptId = row.sourceReceiptId;
            card.dataset.signature = signature;
            card.dataset.scope = scope;
            const planReview = row.questions.some(question => question.intent?.kind === 'plan-review');
            card.classList.toggle('conversation-plan', planReview);
            card.replaceChildren();
            card.append(ui.element('strong', 'conversation-task-title', row.status === 'pending' ? planReview ? '确认执行计划' : '需要补充信息' : planReview ? '计划确认回执' : '信息回答回执'));
            const status = ui.element('p', 'conversation-question-status', row.status === 'pending' && operation ? '正在提交本次回答…'
                : notice || entry.validation || (row.status === 'pending' && marker ? '上次回答结果尚未确认。已核对仍在等待，可重试原回答。' : planReview && row.status === 'pending' ? '确认计划后开始执行；危险操作仍会询问。' : core.questionStatusText(row)));
            status.setAttribute('role', 'status');
            status.tabIndex = -1;
            status.dataset.conversationQuestionAction = 'status';
            card.append(status);
            const draft = core.questionDraft(context, row), answer = row.status === 'pending' ? draft : row.answer;
            const locked = row.status !== 'pending' || !!operation || !!marker || !entry.authoritative || !!notice;
            const form = ui.element('form', 'conversation-question-form');
            row.questions.forEach((question, index) => {
                const isPlan = question.intent?.kind === 'plan-review';
                const item = ui.element('fieldset', 'question-item'), controls = [], customLabel = ui.element('label', 'question-custom');
                item.append(ui.element('legend', '', isPlan ? '执行计划' : question.header || question.question || '补充信息'));
                if (!isPlan && question.header && question.question)
                    item.append(ui.element('p', 'question-text', question.question));
                if (question.detail)
                    item.append(isPlan && window.WeftDesktop?.markdown ? window.WeftDesktop.markdown(question.detail, 'question-detail markdown-body') : ui.element('p', 'question-detail', question.detail));
                for (const [optionIndex, option] of (question.options || []).entries()) {
                    const label = ui.element('label', 'question-option'), input = ui.element('input');
                    input.type = question.multiSelect === true ? 'checkbox' : 'radio';
                    input.name = `question-${row.questionRpcId}-${index}`;
                    input.checked = !!answer?.answers[index]?.selected?.includes(option.label);
                    input.disabled = locked;
                    input.dataset.conversationQuestionAction = `option-${index}-${optionIndex}`;
                    const text = ui.element('span', 'question-option-text', isPlan ? option.label === question.intent.approve ? '确认并执行' : '继续修改计划' : option.label || '空白选项');
                    if (!isPlan && option.description)
                        text.append(ui.element('small', '', option.description));
                    input.addEventListener('change', () => {
                        if (!core.approvalContextCurrent(context) || locked || core.conversationQuestions.operations.has(row.questionRpcId) || core.questionMarker(context, row))
                            return;
                        const answer = core.chooseQuestionOption(context, row, index, option.label, input.checked);
                        if (!answer)
                            return;
                        if (question.multiSelect !== true)
                            custom.value = answer.custom;
                        for (const control of controls)
                            control.input.checked = answer.selected.includes(control.label);
                    });
                    controls.push({ input, label: option.label });
                    label.append(input, text);
                    item.append(label);
                }
                customLabel.append(ui.element('span', '', question.options?.length ? question.multiSelect === true ? '补充说明（可选）' : '填写其他回答' : '你的回答'));
                const custom = ui.element('textarea');
                custom.rows = 3;
                custom.value = answer?.answers[index]?.custom || '';
                custom.disabled = locked;
                custom.dataset.conversationQuestionAction = `custom-${index}`;
                custom.addEventListener('input', () => {
                    if (!core.approvalContextCurrent(context) || locked || core.conversationQuestions.operations.has(row.questionRpcId) || core.questionMarker(context, row))
                        return;
                    const answer = core.setQuestionCustom(context, row, index, custom.value);
                    if (answer)
                        for (const control of controls)
                            control.input.checked = answer.selected.includes(control.label);
                });
                customLabel.append(custom);
                item.append(customLabel);
                form.append(item);
            });
            const actions = ui.element('div', 'conversation-task-actions');
            if (row.status === 'pending') {
                const submit = ui.element('button', 'button small', marker ? '重试原回答' : '提交回答');
                submit.type = 'submit';
                submit.dataset.conversationQuestionAction = 'submit';
                submit.disabled = !!operation || !entry.authoritative || !!notice;
                actions.append(submit);
            }
            if (notice || marker || row.status === 'answered') {
                const check = ui.element('button', 'button secondary small', '重新核对回答');
                check.type = 'button';
                check.disabled = !!operation;
                check.dataset.conversationQuestionAction = 'check';
                check.addEventListener('click', () => {
                    if (core.approvalContextCurrent(context)) {
                        if (sourceNotice)
                            void core.refreshConversationTasks();
                        else
                            void core.refreshConversationQuestions(context, true);
                    }
                });
                actions.append(check);
            }
            const detail = ui.element('button', 'button secondary small', '查看来源与成果');
            detail.type = 'button';
            detail.dataset.conversationQuestionAction = 'detail';
            detail.addEventListener('click', () => ui.inlineTaskInfo(row.taskId, detail));
            actions.append(detail);
            form.append(actions);
            form.hidden = ['resolved', 'unavailable'].includes(row.status);
            card.classList.toggle('is-resolved', form.hidden);
            card.append(form);
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                if (core.approvalContextCurrent(context))
                    void core.submitQuestion(context, row);
            });
            if (focusAction && !document.querySelector('dialog[open]') && (document.activeElement === active || document.activeElement === document.body)) {
                const replacement = card.querySelector(`[data-conversation-question-action="${focusAction}"]`);
                const target = replacement && !replacement.disabled ? replacement : status;
                target.focus({ preventScroll: true });
                if (target === replacement && selection && Number.isInteger(selection[0]))
                    replacement.setSelectionRange?.(...selection);
            }
        }
        for (const card of [...list.children])
            if (card.dataset?.conversationQuestion && !visible.has(card.dataset.conversationQuestion))
                card.remove();
        if (reading?.isConnected && Number.isFinite(readingTop) && Number.isFinite(scroll.scrollTop))
            scroll.scrollTop += reading.getBoundingClientRect().top - readingTop;
        else if (Number.isFinite(top))
            scroll.scrollTop = top;
    }
    return { renderConversationQuestions };
};
