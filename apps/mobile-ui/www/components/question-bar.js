/* Shared question presentation; writes and identity checks stay in ui-core. */
(() => {
    const cursors = new Map();
    const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
    function paint(bar, config) {
        const { row, draft, locked, notice, remaining = 0, choose, custom, submit, check, current, focusComposer } = config;
        const editLocked = locked || config.retry;
        const key = `${bar.dataset.scope}:${row.questionRpcId}`;
        const index = Math.min(cursors.get(key) || 0, row.questions.length - 1), question = row.questions[index];
        const signature = JSON.stringify([key, row, index, locked, notice, remaining]);
        if (bar.dataset.signature === signature) return;
        const active = document.activeElement, focus = bar.contains(active) ? active.dataset.questionControl : null;
        const selection = focus === 'custom' ? [active.selectionStart, active.selectionEnd] : null;
        const expanded = bar.dataset.questionId === row.questionRpcId && bar.dataset.questionIndex === String(index) && bar.querySelector('details')?.open;
        bar.dataset.signature = signature; bar.dataset.questionId = row.questionRpcId; bar.dataset.questionIndex = String(index); bar.replaceChildren();
        const body = node('div', '', 'question-bar-content');
        body.append(node('strong', question.question || question.header || '请补充信息', 'question-bar-title'));
        const count = remaining + row.questions.length - index - 1;
        if (count) body.append(node('small', `还有 ${count} 个问题`, 'approval-remaining'));
        const details = node('details', '', 'question-bar-detail'); details.open = !!expanded;
        details.hidden = !question.detail && !(question.options || []).some(option => option.description);
        details.append(node('summary', question.intent?.kind === 'plan-review' ? '查看执行计划' : '查看完整说明'), node('p', question.detail || question.question));
        for (const option of question.options || []) if (option.description) details.append(node('p', `${option.label}：${option.description}`));
        body.append(details);
        const choices = node('div', '', 'question-bar-options');
        choices.setAttribute('role', question.multiSelect ? 'group' : 'radiogroup'); choices.setAttribute('aria-label', question.question || question.header || '补充信息');
        const controls = [];
        const update = answer => { if (!answer) return; input.value = answer.custom || ''; for (const button of controls) { const selected = answer.selected.includes(button.dataset.value); button.setAttribute(question.multiSelect ? 'aria-pressed' : 'aria-checked', String(selected)); button.choiceCheck.hidden = !selected; } };
        for (const [at, option] of (question.options || []).entries()) {
            const button = node('button', option.label || '空白选项', 'button secondary question-choice'); button.type = 'button';
            button.dataset.value = option.label; button.dataset.questionControl = `option-${at}`;
            if (!question.multiSelect) button.setAttribute('role', 'radio');
            button.setAttribute(question.multiSelect ? 'aria-pressed' : 'aria-checked', String(draft.answers[index].selected.includes(option.label))); button.disabled = editLocked;
            const check = globalThis.WeftIcons?.create('check', 16) || node('span', '', 'icon icon-check'); check.setAttribute('aria-hidden', 'true'); check.hidden = !draft.answers[index].selected.includes(option.label); button.choiceCheck = check; button.append(check);
            button.addEventListener('click', () => { if (current()) update(choose(index, option.label, question.multiSelect ? button.getAttribute('aria-pressed') !== 'true' : true)); });
            controls.push(button); choices.append(button);
        }
        body.append(choices);
        const label = node('label', question.options?.length ? '其他…' : '你的回答', 'question-bar-custom');
        const input = node('input'); input.className = 'question-custom'; input.type = 'text'; input.value = draft.answers[index].custom || ''; input.disabled = editLocked;
        input.setAttribute('aria-label', question.options?.length ? '其他回答' : '你的回答'); input.dataset.questionControl = 'custom';
        input.addEventListener('input', () => { if (current()) update(custom(index, input.value)); }); label.append(input); body.append(label);
        const status = node('p', notice || '', 'question-status'); status.setAttribute('role', 'status'); status.hidden = !notice; body.append(status);
        const actions = node('div', '', 'question-actions');
        if (index > 0) { const back = node('button', '上一题', 'button secondary'); back.type = 'button'; back.disabled = locked; back.addEventListener('click', () => { cursors.set(key, index - 1); delete bar.dataset.signature; paint(bar, config); }); actions.append(back); }
        const next = node('button', index < row.questions.length - 1 ? '下一题' : config.retry ? '重试原回答' : '提交回答', 'button primary'); next.type = 'button'; next.disabled = locked; next.dataset.questionControl = 'submit';
        next.addEventListener('click', () => {
            if (!current() || locked) return;
            if (index < row.questions.length - 1) { cursors.set(key, index + 1); delete bar.dataset.signature; paint(bar, config); bar.querySelector('[data-question-control]')?.focus({ preventScroll: true }); }
            else submit();
        }); actions.append(next);
        if (check) { const retry = node('button', '重新核对回答', 'button secondary'); retry.type = 'button'; retry.dataset.questionControl = 'check'; retry.addEventListener('click', check); actions.append(retry); }
        body.append(actions); bar.append(body);
        choices.onkeydown = event => {
            if (!question.multiSelect && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
                event.preventDefault(); const at = controls.indexOf(document.activeElement);
                const button = controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (at + (/Right|Down/.test(event.key) ? 1 : -1) + controls.length) % controls.length];
                button?.focus(); button?.click();
            }
        };
        // Prevent implicit Enter submission through the surrounding message form.
        bar.onkeydown = event => { if (event.key === 'Enter' && event.target !== next && event.target?.tagName?.toUpperCase() !== 'SUMMARY' && event.target?.tagName?.toUpperCase() !== 'BUTTON') event.preventDefault(); };
        if (focus) { const replacement = [...bar.querySelectorAll('[data-question-control]')].find(el => el.dataset.questionControl === focus); if (replacement && !replacement.disabled) { replacement.focus({ preventScroll: true }); if (selection) replacement.setSelectionRange?.(...selection); } else focusComposer(); }
    }
    function record(row) {
        if (row.outcome === 'cancelled') return '提问已取消';
        if (row.answer) return `已回答：${row.answer.answers.map(answer => [...answer.selected.map(label => label || '空白选项'), answer.custom].filter(Boolean).join('、') || '未作选择').join('；')}`;
        return row.outcome === 'cancelled' ? '提问已取消' : '提问已结束';
    }
    function ensure(approval) {
        let bar = document.getElementById('question-bar');
        if (!bar) { bar = node('div', '', 'approval-bar question-bar'); bar.id = 'question-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '待回答问题'); bar.hidden = true; approval.after(bar); }
        return bar;
    }
    function waiting(approval, count) {
        let note = approval.querySelector('.question-waiting');
        if (!count || approval.hidden) { note?.remove(); return; }
        if (!note) { note = node('small', '', 'question-waiting approval-remaining'); approval.append(note); }
        note.textContent = `另有 ${count} 个问题，处理审批后回答`;
    }
    globalThis.WeftQuestionBar = { paint, record, ensure, waiting };
})();
