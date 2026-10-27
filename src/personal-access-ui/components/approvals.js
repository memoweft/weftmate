/* Desktop approvals component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.approvals = (core, ui) => {
    function setApprovalModeBusy(busy) {
        ui.byId('approval-mode-trigger').disabled = busy;
    }
    function focusApprovalMode() {
        ui.byId('approval-mode-trigger').focus();
    }
    function closeApprovalMenu() {
        if (!ui.byId('approval-mode-menu'))
            return;
        ui.byId('approval-mode-menu').hidden = true;
        ui.byId('approval-mode-trigger').setAttribute('aria-expanded', 'false');
    }
    function renderApprovalMode() {
        const menu = ui.byId('approval-mode-menu'), trigger = ui.byId('approval-mode-trigger');
        if (!menu || !trigger)
            return;
        const currentMode=core.state.newConversation?core.state.newConversationApprovalMode:core.currentApprovalMode;
        ui.byId('approval-mode-label').textContent = core.approvalModes.find(row => row[0] === currentMode)?.[1].replace('（推荐）', '') ?? '审批模式';
        trigger.title = core.approvalModes.find(row => row[0] === currentMode)?.[2] ?? '选择新对话的审批模式';
        trigger.classList.toggle('is-warning', currentMode === 'allow-all');
        const shield = trigger.querySelector('.approval-shield');
        if (shield) shield.toggleAttribute('hidden', currentMode !== 'allow-all' && !globalThis.matchMedia?.('(max-width:640px)').matches);
        menu.replaceChildren();
        core.approvalModes.forEach(([mode, label, description], index) => {
            const button = ui.element('button', 'approval-mode-option');
            button.type = 'button';
            button.dataset.mode = mode;
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', String(mode === currentMode));
            const copy = ui.element('span', 'approval-mode-copy');
            copy.append(ui.element('strong', '', label), ui.element('span', 'muted', description));
            const check = ui.element('span', 'approval-mode-check');
            if (mode === currentMode)
                check.append(window.WeftIcons.create('allow', 16));
            button.append(check, copy, ui.element('kbd', '', String(index + 1)));
            button.addEventListener('click', () => { void core.saveApprovalMode(mode); });
            menu.append(button);
        });
    }
    function acceptApprovalRisk(mode) {
        return mode !== 'allow-all' || globalThis.WeftDialogs.allowAll();
    }
    function renderPhoneApprovals(context, bar) {
        globalThis.WeftPhoneUnify.placeDecision(ui, bar);
        const rows = core.approvalContextCurrent(context) ? [...core.conversationApprovals.entries.values()]
            .filter(entry => entry.row.sessionId === context.sessionId && core.approvalSource(entry.row))
            .sort((a,b) => a.row.createdAt.localeCompare(b.row.createdAt)) : [];
        const scope = JSON.stringify(context);
        if (bar.dataset.phoneScope !== scope) { bar.replaceChildren(); bar.dataset.phoneScope = scope; }
        bar.hidden = rows.length === 0;
        const ids = new Set(rows.map(entry => entry.row.approvalId));
        for (const card of [...bar.children]) if (!ids.has(card.dataset.conversationApproval)) card.remove();
        for (const entry of rows) {
            const row = entry.row, marker = core.approvalMarker(context,row), review = core.approvalReview?.(row);
            const operation = core.conversationApprovals.operations.get(row.approvalId);
            const notice = entry.notice || (core.conversationTasks.entries.get(row.taskId)?.notice ? '原任务暂时无法核对，请重新核对答复。' : '');
            const signature = JSON.stringify([row,entry.authoritative,notice,marker,!!operation,review]);
            let card = [...bar.children].find(node => node.dataset.conversationApproval === row.approvalId);
            if (!card) { card = ui.element('section','phone-approval-card'); card.dataset.conversationApproval = row.approvalId; bar.append(card); }
            if (card.dataset.signature === signature) continue;
            if (operation && card.children.length) {
                for (const button of card.querySelectorAll('button')) button.disabled = true;
                const status = card.querySelector('.approval-status'); if (status) { status.hidden = false; status.textContent = '正在提交本次决定…'; }
                continue;
            }
            const expanded = card.querySelector('details')?.open === true;
            const hadFocus = card.contains(document.activeElement), focusedAction = document.activeElement?.dataset?.conversationApprovalAction;
            const previousChoice = card.phoneChoice;
            card.dataset.signature = signature; card.dataset.phonePending = String(row.status === 'pending');
            card.replaceChildren();
            if (row.status !== 'pending') {
                card.className = 'phone-approval-receipt';
                card.append(WeftIcons.create('approval',16),ui.element('span','',core.approvalStatusText(row)));
                if (hadFocus) ui.byId('message-text').focus({preventScroll:true});
                continue;
            }
            card.className = 'phone-approval-card';
            if (row.intent === 'work-switch' && ui.renderWorkSwitch) {
                ui.renderWorkSwitch(context, row, card, !!operation || !!notice || !entry.authoritative);
                continue;
            }
            const title = ui.element('h3','phone-decision-title'), text = ui.element('strong');
            title.append(WeftIcons.create('approval',20),text);
            const reason = ui.element('p','approval-explanation'), details = ui.element('details','approval-detail'); details.open = expanded;
            const summary = ui.element('summary',''); summary.append(ui.element('span','','查看详情'),WeftIcons.create('chevron',16));
            const raw = ui.element('pre','timeline-raw'); details.append(summary,raw);
            const paint = value => { text.textContent = `${core.hasMultipleComputers?.()?core.computerName(core.currentExecutionComputer())+' · ':''}要${value.summary}`; reason.textContent = value.reason; reason.hidden = !value.reason; raw.textContent = typeof value.raw === 'string' ? value.raw : JSON.stringify(value.raw,null,2); };
            paint(core.approvalPresentation(row)); card.append(title,reason,details);
            void core.readApprovalPresentation(row).then(value => { if (card.dataset.signature === signature && core.approvalContextCurrent(context)) paint(value); });
            if (review) { const note = ui.element('p','approval-review',review.text); note.setAttribute('role',review.warning ? 'alert':'note'); card.append(note); }
            const status = ui.element('p','approval-status',operation ? '正在提交本次决定…' : notice || (marker ? '上次答复尚未确认，请核对或重试原答复。' : ''));
            status.setAttribute('role','status'); status.hidden = !status.textContent; card.append(status);
            const fresh = () => { const current = core.approvalContext(); return JSON.stringify(current) === scope && core.approvalContextCurrent(current) ? current : null; };
            const disabled = (outcome, category = 'once') => !!operation || !entry.authoritative || !!notice || !!marker && (marker.outcome !== outcome || (marker.scope ?? 'once') !== category);
            const submit = (outcome, category = 'once') => { const current = fresh(); if (current) void core.submitApproval(current,row,outcome,category); };
            const actions = ui.element('div','approval-bar-actions');
            if (row.canAlwaysAllow) {
                const choices = ui.element('div','phone-approval-choices'); choices.setAttribute('role','radiogroup'); choices.setAttribute('aria-label','选择怎么处理这次操作');
                const values = [['allowed-once','仅这一次','allowed-once','once'],['allowed-always','以后这类都允许','allowed-once','global-category'],['rejected','拒绝','rejected','once']];
                card.phoneChoice = marker ? marker.outcome === 'rejected' ? 'rejected' : marker.scope === 'global-category' ? 'allowed-always' : 'allowed-once' : previousChoice || 'allowed-once';
                const confirm = ui.element('button','button primary small','确认'); confirm.type = 'button';
                confirm.dataset.conversationApprovalAction = 'confirm';
                const controls = [];
                const paintChoice = () => { for (const option of controls) option.setAttribute('aria-checked',String(option.dataset.conversationApprovalAction === card.phoneChoice)); const chosen = values.find(value=>value[0]===card.phoneChoice); confirm.disabled = !chosen || disabled(chosen[2],chosen[3]); };
                for (const [key,label,outcome,category] of values) {
                    const option = ui.element('button','phone-approval-option'); option.type = 'button'; option.setAttribute('role','radio'); option.dataset.conversationApprovalAction = key; option.disabled = disabled(outcome,category);
                    const radio = ui.element('span','phone-radio'); radio.setAttribute('aria-hidden','true'); option.append(radio,ui.element('span','',label));
                    option.addEventListener('click',()=>{ if (fresh()) { card.phoneChoice = key; paintChoice(); } }); choices.append(option); controls.push(option);
                }
                choices.addEventListener('keydown',event=>{ if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return; event.preventDefault(); const enabled = controls.filter(control=>!control.disabled),at = enabled.indexOf(document.activeElement),next = enabled[event.key==='Home'?0:event.key==='End'?enabled.length-1:(at+(event.key==='ArrowUp'?-1:1)+enabled.length)%enabled.length]; next?.focus(); next?.click(); });
                confirm.addEventListener('click',()=>{ const chosen = values.find(value=>value[0]===card.phoneChoice); if (chosen && !disabled(chosen[2],chosen[3])) submit(chosen[2],chosen[3]); });
                paintChoice(); card.append(choices); actions.append(confirm);
            } else {
                for (const [outcome,label] of [['rejected','拒绝'],['allowed-once','批准']]) {
                    const button = ui.element('button',`button ${outcome==='allowed-once'?'primary':'secondary'} small`,label); button.type = 'button'; button.dataset.conversationApprovalAction = outcome;
                    button.disabled = disabled(outcome); button.addEventListener('click',()=>submit(outcome)); actions.append(button);
                }
            }
            if (notice || marker) {
                const check = ui.element('button','button secondary small','重新核对答复'); check.type = 'button'; check.disabled = !!operation; check.dataset.conversationApprovalAction = 'check';
                check.addEventListener('click',()=>{ if (fresh()) { void core.refreshConversationTasks(); void core.refreshConversationApprovals(context,true); } }); card.append(check);
            }
            card.append(actions);
            if (hadFocus) { const replacement = [...card.querySelectorAll('[data-conversation-approval-action]')].find(node=>node.dataset.conversationApprovalAction===focusedAction); if (replacement && !replacement.disabled) replacement.focus({preventScroll:true}); }
            if (review?.warning && card.dataset.reviewFocusId !== row.approvalId) { card.querySelector('[data-conversation-approval-action="rejected"]')?.focus({preventScroll:true}); card.dataset.reviewFocusId = row.approvalId; }
        }
        ui.renderModelHint?.();
        ui.syncPhoneDecisions?.();
    }
    function renderConversationApprovals() {
        const context = core.approvalContext(), bar = globalThis.WeftTimeline?.decisionSurface('approval-bar') || ui.byId('approval-bar');
        if (!bar) return;
        globalThis.WeftTimeline?.placeDecisions();
        if (globalThis.WeftQuestionBar?.retainInteraction(bar, renderConversationApprovals)) return;
        if (globalThis.WeftPhoneUnify?.isPhone()) { renderPhoneApprovals(context,bar); ui.renderTimeline();for(const node of ui.byId('transcript').querySelectorAll('[data-timeline-approval]'))if(core.conversationApprovals.entries.has(node.dataset.timelineApproval))node.hidden=true;return; }
        const rows = core.approvalContextCurrent(context) ? [...core.conversationApprovals.entries.values()]
            .filter(entry => entry.row.sessionId === context.sessionId && core.approvalSource(entry.row) && entry.row.status === 'pending')
            .sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt)) : [];
        const hadFocus = bar.contains(document.activeElement), action = document.activeElement?.dataset?.conversationApprovalAction;
        bar.hidden = rows.length === 0;
        ui.renderModelHint?.();
        if (!rows.length) {
            bar.replaceChildren(); delete bar.dataset.signature; delete bar.dataset.workSignature;
            if (hadFocus) ui.byId('message-text').focus({ preventScroll: true });
            ui.renderTimeline(); return;
        }
        const entry = rows[0], row = entry.row, marker = core.approvalMarker(context, row);
        bar.classList.toggle('work-switch-host', row.intent === 'work-switch');
        if (row.intent === 'work-switch' && ui.renderWorkSwitch) {
            delete bar.dataset.signature;
            if (bar.dataset.workSignature !== JSON.stringify([context, row, core.state.projects, core.state.computers, entry.notice, core.conversationApprovals.operations.has(row.approvalId)])) {
                bar.dataset.workSignature = JSON.stringify([context, row, core.state.projects, core.state.computers, entry.notice, core.conversationApprovals.operations.has(row.approvalId)]);
                ui.renderWorkSwitch(context, row, bar, !!entry.notice || !entry.authoritative || core.conversationApprovals.operations.has(row.approvalId));
            }
            return;
        }
        delete bar.dataset.workSignature;
        const review = core.approvalReview?.(row);
        bar.classList.toggle('is-review-warning', !!review?.warning);
        const operation = core.conversationApprovals.operations.get(row.approvalId);
        const notice = entry.notice || (core.conversationTasks.entries.get(row.taskId)?.notice ? '原任务暂时无法核对，请重新核对答复。' : '');
        const identity = Object.fromEntries(['ownerId','identity','deviceId','source','sessionId','conversationId'].map(key => [key, context[key]]));
        const signature = (globalThis.WeftQuestionBar?.signatureOf || JSON.stringify)([identity, row, notice, entry.authoritative, marker, operation, rows.length]);
        if (bar.dataset.signature === signature) return;
        if (operation && bar.dataset.approvalId === row.approvalId) {
            for (const button of bar.querySelectorAll('button')) button.disabled = true;
            const status = bar.querySelector('.approval-status'); if (status) { status.textContent = '正在提交本次决定…'; status.hidden = false; }
            return;
        }
        const actionContext = () => { const fresh = core.approvalContext(); return ['ownerId','identity','deviceId','source','sessionId','conversationId'].every(key => fresh[key] === context[key]) && core.approvalContextCurrent(fresh) ? fresh : null; };
        const sameApproval = bar.dataset.approvalId === row.approvalId;
        const expanded = bar.querySelector('details')?.open === true && bar.dataset.approvalId === row.approvalId;
        bar.dataset.signature = signature; bar.dataset.approvalId = row.approvalId;
        bar.replaceChildren();
        const card = ui.element('div', 'approval-bar-content'); card.dataset.conversationApproval = row.approvalId;
        const presentation = core.approvalPresentation(row), details = ui.element('details', 'approval-detail'); details.open = expanded;
        details.dataset.motion='unfold';
        const summary = ui.element('summary', '', `要${presentation.summary}`), raw = ui.element('pre', 'timeline-raw');
        summary.dataset.conversationApprovalAction = 'parameters';
        const reason = ui.element('p', 'approval-explanation');
        const paint = value => { summary.textContent = `${core.hasMultipleComputers?.()?core.computerName(core.currentExecutionComputer())+' · ':''}要${value.summary}`; raw.textContent = typeof value.raw === 'string' ? value.raw : JSON.stringify(value.raw, null, 2); reason.textContent = value.reason; reason.hidden = !value.reason; };
        paint(presentation); details.append(summary, reason, raw); card.append(details);
        void core.readApprovalPresentation(row).then(value => { if (bar.dataset.signature === signature && core.approvalContextCurrent(context)) paint(value); });
        if (rows.length > 1) card.append(ui.element('small', 'approval-remaining', `还有 ${rows.length - 1} 个待批准`));
        const status = ui.element('p', 'approval-status', operation ? '正在提交本次决定…' : notice || (marker ? '上次答复尚未确认，请核对或重试原答复。' : ''));
        status.setAttribute('role', 'status'); status.hidden = !status.textContent; card.append(status);
        const actions = ui.element('div', 'approval-bar-actions');
        for (const [outcome, label] of [['allowed-once', '批准'], ['rejected', '拒绝']]) {
            const button = ui.element('button', `button ${outcome === 'allowed-once' ? 'primary' : 'secondary'} small`, label); button.type = 'button';
            button.dataset.conversationApprovalAction = outcome;
            button.disabled = !!operation || !entry.authoritative || !!notice || !!marker && (marker.outcome !== outcome || (marker.scope ?? 'once') !== 'once');
            button.addEventListener('click', () => { const fresh = actionContext(); if (fresh) void core.submitApproval(fresh, row, outcome); }); actions.append(button);
        }
        if (row.canAlwaysAllow) {
            const always = ui.element('button', 'button secondary small', '以后这类都允许'); always.type = 'button';
            always.dataset.conversationApprovalAction = 'allowed-always';always.title = '保存为通用设置，项目单独设置的规则仍优先。';
            always.disabled = !!operation || !entry.authoritative || !!notice || !!marker && (marker.outcome !== 'allowed-once' || marker.scope !== 'global-category');
            always.addEventListener('click', () => { const fresh = actionContext(); if (fresh) void core.submitApproval(fresh, row, 'allowed-once', 'global-category'); }); actions.append(always);
        }
        if (notice || marker) {
            const check = ui.element('button', 'button quiet small', '重新核对答复'); check.type = 'button'; check.disabled = !!operation;
            check.dataset.conversationApprovalAction = 'check';
            check.addEventListener('click', () => { if (core.approvalContextCurrent(context)) { void core.refreshConversationTasks(); void core.refreshConversationApprovals(context, true); } }); card.append(check);
        }
        card.append(actions); bar.append(card);
        if (review) { const note = ui.element('p', 'approval-review', review.text); note.setAttribute('role', review.warning ? 'alert' : 'note'); card.append(note); }
        ui.renderTimeline();
        if (hadFocus) { const replacement = [...bar.querySelectorAll('[data-conversation-approval-action]')].find(node => node.dataset.conversationApprovalAction === action); if (sameApproval && replacement && !replacement.disabled) replacement.focus({ preventScroll: true }); else ui.byId('message-text').focus({ preventScroll: true }); }
        if (review?.warning && bar.dataset.reviewFocusId !== row.approvalId) queueMicrotask(() => {
            const reject = bar.querySelector('[data-conversation-approval-action="rejected"]');
            if (core.approvalContextCurrent(context) && !bar.hidden && bar.dataset.approvalId === row.approvalId && reject && !reject.disabled) {
                reject.focus({ preventScroll: true }); bar.dataset.reviewFocusId = row.approvalId;
            }
        });
    }
    function defaultApprovalBusy(busy) {
        ui.byId('default-approval-mode').disabled = busy;
    }
    function paintDefaultApproval(settings) {
        const select = ui.byId('default-approval-mode');
        select.replaceChildren(...core.approvalModes.map(([mode, label]) => new Option(label, mode)));
        select.value = settings.mode;
        select.disabled = false;
    }
    function defaultApprovalNotice(message) {
        ui.byId('approval-settings-notice').textContent = message;
    }
    function mountApprovals() {
        ui.byId('approval-mode-trigger')?.addEventListener('click', () => {
            const menu = ui.byId('approval-mode-menu'), opening = menu.hidden;
            ui.renderApprovalMode();
            menu.hidden = !opening;
            if (opening) globalThis.WeftPopover?.position(menu, ui.byId('approval-mode-trigger'));
            ui.byId('approval-mode-trigger').setAttribute('aria-expanded', String(opening));
            if (opening)
                menu.querySelector('[aria-checked="true"]')?.focus();
        });
        document.addEventListener('click', event => {
            if (!ui.byId('approval-picker')?.contains(event.target))
                ui.closeApprovalMenu();
        });
        document.addEventListener('keydown', event => {
            const menu = ui.byId('approval-mode-menu');
            if (!menu || menu.hidden)
                return;
            WeftShortcuts.dispatch(event,Object.fromEntries(core.approvalModes.map(([mode])=>[`approval-${mode}`,()=>void core.saveApprovalMode(mode)])));
            if (event.key === 'Escape') {
                event.preventDefault();
                ui.closeApprovalMenu();
                ui.byId('approval-mode-trigger').focus();
            }
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const buttons = [...menu.querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus();
            }
        });
        ui.byId('default-approval-mode')?.addEventListener('change', async (event) => {
            const token = core.accountToken();
            const mode = event.target.value;
            if (!await ui.acceptApprovalRisk(mode)) {
                void core.refreshApprovalSettings();
                return;
            }
            if (!core.accountCurrent(token)) return;
            event.target.disabled = true;
            try {
                await core.saveDefaultApprovalMode(mode);
                if (!core.accountCurrent(token))
                    return;
                ui.byId('approval-settings-notice').textContent = '已保存，下次新建对话时生效。';
            }
            catch {
                if (core.accountCurrent(token))
                    ui.byId('approval-settings-notice').textContent = '默认模式未保存，请重试。';
            }
            finally {
                if (core.accountCurrent(token))
                    void core.refreshApprovalSettings();
            }
        });
    }
    return { setApprovalModeBusy, focusApprovalMode, closeApprovalMenu, renderApprovalMode, acceptApprovalRisk, renderConversationApprovals, defaultApprovalBusy, paintDefaultApproval, defaultApprovalNotice, mountApprovals };
};
