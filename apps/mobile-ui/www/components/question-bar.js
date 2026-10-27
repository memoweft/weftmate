/* Shared question presentation; writes and identity checks stay in ui-core. */
(() => {
    const cursors = new Map();
    const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
    // A recovery read must not detach the target between pointerdown and click.
    // Repaint after the browser has dispatched click (or cancelled the gesture).
    function retainInteraction(bar, repaint) {
        if (!bar.decisionInteraction) {
            const state = bar.decisionInteraction = { pressed: false, repaint: null };
            bar.addEventListener('pointerdown', event => { state.pressed = true; state.target = event.target; });
            const finish = () => { state.pressed = false; const pending = state.repaint; state.repaint = null; pending?.(); };
            bar.addEventListener('click', finish);
            document.addEventListener('pointerup', event => { if (state.pressed && event.target !== state.target) finish(); });
            bar.addEventListener('pointercancel', finish);
        }
        if (!bar.decisionInteraction.pressed) return false;
        bar.decisionInteraction.repaint = repaint; return true;
    }
    const signatureOf = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    function paint(bar, config) {
        bar.questionConfig = config;
        if (retainInteraction(bar, () => paint(bar, bar.questionConfig))) return;
        const { row, draft, locked, notice, remaining = 0, choose, custom, submit, check, current, focusComposer } = config;
        const editLocked = locked || config.retry;
        const key = `${bar.dataset.scope}:${row.questionRpcId}`;
        const index = Math.min(cursors.get(key) || 0, row.questions.length - 1), question = row.questions[index];
        const quickChoice = config.mobile && !question.multiSelect && question.options?.length === 2;
        const signature = signatureOf([key, row, index, locked, notice, remaining, config.mobile, config.retry]);
        if (bar.dataset.signature === signature) return;
        if (config.submitting && bar.dataset.questionId === row.questionRpcId) {
            for (const control of bar.querySelectorAll('button,input')) control.disabled = true;
            const status = bar.querySelector('.question-status'); if (status) { status.textContent = notice; status.hidden = !notice; }
            return;
        }
        const active = document.activeElement, focus = bar.contains(active) ? active.dataset.questionControl : null;
        const selection = focus === 'custom' ? [active.selectionStart, active.selectionEnd] : null;
        const expanded = bar.dataset.questionId === row.questionRpcId && bar.dataset.questionIndex === String(index) && bar.querySelector('details')?.open;
        const collapsed = bar.dataset.questionId === row.questionRpcId && bar.dataset.collapsed === 'true';
        bar.dataset.signature = signature; bar.dataset.questionId = row.questionRpcId; bar.dataset.questionIndex = String(index); bar.dataset.collapsed=String(collapsed); bar.replaceChildren();
        const body = node('div', '', 'question-bar-content');
        const header=node('div','','question-bar-header'), title=node('strong',question.question || question.header || '请补充信息','question-bar-title');
        const fold=node('button',collapsed?'展开问题':'收起问题','button quiet small');fold.type='button';fold.dataset.questionControl='fold';fold.setAttribute('aria-expanded',String(!collapsed));
        const content=node('div','','question-bar-fields');content.hidden=collapsed;
        fold.addEventListener('click',()=>{const closed=bar.dataset.collapsed!=='true';bar.dataset.collapsed=String(closed);content.hidden=closed;fold.textContent=closed?'展开问题':'收起问题';fold.setAttribute('aria-expanded',String(!closed));});
        header.append(title,fold);body.append(header);
        const count = remaining + row.questions.length - index - 1;
        if (count) body.append(node('small', `还有 ${count} 个问题`, 'approval-remaining'));
        const details = node('details', '', 'question-bar-detail'); details.open = !!expanded;
        details.dataset.motion='unfold';
        details.hidden = !question.detail;
        details.append(node('summary', question.intent?.kind === 'plan-review' ? '查看执行计划' : '查看完整说明'), node('p', question.detail || question.question));
        content.append(details);
        const choices = node('div', '', `question-bar-options${config.mobile ? quickChoice ? ' decision-quick-choices' : ' decision-options' : ''}`);
        choices.setAttribute('role', question.multiSelect || quickChoice ? 'group' : 'radiogroup'); choices.setAttribute('aria-label', question.question || question.header || '补充信息');
        const controls = [];
        const update = answer => { if (!answer) return; input.value = answer.custom || ''; for (const button of controls) { const selected = answer.selected.includes(button.dataset.value); button.setAttribute(question.multiSelect ? 'aria-pressed' : 'aria-checked', String(selected)); button.choiceCheck.toggleAttribute('hidden',!selected); } };
        for (const [at, option] of (question.options || []).entries()) {
            const button = node('button', '', 'button secondary question-choice'); button.type = 'button';button.setAttribute('aria-label',option.label || '空白选项');
            const number=node('span',String(at+1),'question-choice-number');number.setAttribute('aria-hidden','true');
            const copy=node('span','','question-choice-copy');copy.append(node('span',option.label || '空白选项','question-choice-label'));
            if(option.description)copy.append(node('small',option.description,'question-choice-description'));
            button.append(number,copy);
            button.dataset.value = option.label; button.dataset.questionControl = `option-${at}`;
            if (!question.multiSelect && !quickChoice) button.setAttribute('role', 'radio');
            button.setAttribute(question.multiSelect ? 'aria-pressed' : 'aria-checked', String(draft.answers[index].selected.includes(option.label))); button.disabled = editLocked;
            const check = globalThis.WeftIcons?.create('allow', 16) || node('span', '', 'icon icon-check'); check.setAttribute('aria-hidden', 'true'); check.toggleAttribute('hidden',!draft.answers[index].selected.includes(option.label)); button.choiceCheck = check; button.append(check);
            button.addEventListener('click', () => { if (bar.questionConfig.current()) { update(bar.questionConfig.choose(index, option.label, question.multiSelect ? button.getAttribute('aria-pressed') !== 'true' : true)); if (quickChoice && !bar.questionConfig.locked) next.click(); } });
            controls.push(button); choices.append(button);
        }
        content.append(choices);
        const label = node('label', question.options?.length ? '或自定义输入' : '你的回答', 'question-bar-custom');
        const input = node('input'); input.className = 'question-custom'; input.type = 'text'; input.value = draft.answers[index].custom || ''; input.disabled = editLocked;
        input.setAttribute('aria-label', question.options?.length ? '其他回答' : '你的回答'); input.dataset.questionControl = 'custom';
        input.addEventListener('input', () => { if (bar.questionConfig.current()) { update(bar.questionConfig.custom(index, input.value)); if (quickChoice) next.hidden = !input.value.trim(); } }); label.append(input); content.append(label);
        const status = node('p', notice || '', 'question-status'); status.setAttribute('role', 'status'); status.hidden = !notice; body.append(status);
        const actions = node('div', '', 'question-actions');
        if (index > 0) { const back = node('button', '上一题', 'button secondary'); back.type = 'button'; back.disabled = locked; back.addEventListener('click', () => { cursors.set(key, index - 1); delete bar.dataset.signature; paint(bar, config); }); actions.append(back); }
        const next = node('button', index < row.questions.length - 1 ? '下一题' : config.retry ? '重试原回答' : config.mobile && question.options?.length ? '确认' : '提交回答', 'button primary'); next.type = 'button'; next.disabled = locked; next.dataset.questionControl = 'submit';
        next.hidden = !!quickChoice && !draft.answers[index].custom.trim();
        next.addEventListener('click', () => {
            if (!bar.questionConfig.current() || bar.questionConfig.locked) return;
            if (index < row.questions.length - 1) { cursors.set(key, index + 1); delete bar.dataset.signature; paint(bar, config); bar.querySelector('[data-question-control]')?.focus({ preventScroll: true }); }
            else bar.questionConfig.submit();
        }); actions.append(next);
        const skip=node('button','跳过','button quiet');skip.type='button';skip.disabled=editLocked;skip.dataset.questionControl='skip';
        skip.addEventListener('click',()=>{
            const current=bar.questionConfig;
            if(!current.current() || current.locked || current.retry)return;
            for(const option of question.options || [])current.choose(index,option.label,false);
            update(current.custom(index,''));
            next.click();
        });actions.prepend(skip);
        if (check) { const retry = node('button', '重新核对回答', 'button secondary'); retry.type = 'button'; retry.dataset.questionControl = 'check'; retry.addEventListener('click', check); actions.append(retry); }
        content.append(actions);body.append(content); bar.append(body);
        choices.onkeydown = event => {
            if (!question.multiSelect && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
                event.preventDefault(); const at = controls.indexOf(document.activeElement);
                const button = controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (at + (/Right|Down/.test(event.key) ? 1 : -1) + controls.length) % controls.length];
                button?.focus(); if (quickChoice) update(bar.questionConfig.choose(index, button.dataset.value, true)); else button?.click();
            }
        };
        // Prevent implicit Enter submission through the surrounding message form.
        bar.onkeydown = event => {
            if(!event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && /^[1-9]$/.test(event.key) && !event.target.closest('input,textarea,[contenteditable=true]') && !content.hidden) {
                const choice=controls[Number(event.key)-1];if(choice && !choice.disabled){event.preventDefault();choice.focus();choice.click();}
            }
            if (event.key === 'Enter' && event.target !== next && event.target?.tagName?.toUpperCase() !== 'SUMMARY' && event.target?.tagName?.toUpperCase() !== 'BUTTON') event.preventDefault();
        };
        if (focus) { const replacement = [...bar.querySelectorAll('[data-question-control]')].find(el => el.dataset.questionControl === focus); if (replacement && !replacement.disabled) { replacement.focus({ preventScroll: true }); if (selection) replacement.setSelectionRange?.(...selection); } else focusComposer(); }
    }
    function record(row) {
        if (row.outcome === 'cancelled') return '提问已取消';
        if (row.answer) return row.questions.map((question,index)=>{
            const answer=row.answer.answers[index], text=[...answer.selected.map(label=>label || '空白选项'),answer.custom].filter(Boolean).join('、');
            return `${question.question || question.header}\n${row.answerAcceptedAt?'已回答':'已提交'}：${text || '已跳过'}`;
        }).join('\n\n');
        return row.outcome === 'cancelled' ? '提问已取消' : '提问已结束';
    }
    function ensure(approval) {
        let bar = globalThis.WeftTimeline?.decisionSurface('question-bar') || document.getElementById('question-bar');
        if (!bar) { bar = node('div', '', 'approval-bar question-bar'); bar.id = 'question-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '待回答问题'); bar.hidden = true; approval.after(bar); }
        globalThis.WeftTimeline?.decisionSurface('question-bar',bar);
        return bar;
    }
    function waiting(approval, count) {
        let note = approval.querySelector('.question-waiting');
        if (!count || approval.hidden) { note?.remove(); return; }
        if (!note) { note = node('small', '', 'question-waiting approval-remaining'); approval.append(note); }
        note.textContent = `另有 ${count} 个问题，处理审批后回答`;
    }
    globalThis.WeftQuestionBar = { paint, record, ensure, waiting, retainInteraction, signatureOf };
})();
