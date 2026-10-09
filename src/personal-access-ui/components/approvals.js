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
        ui.byId('approval-mode-label').textContent = core.approvalModes.find(row => row[0] === core.currentApprovalMode)?.[1].replace('（推荐）', '') ?? '自动';
        trigger.title = core.approvalModes.find(row => row[0] === core.currentApprovalMode)?.[2] ?? '';
        menu.replaceChildren();
        core.approvalModes.forEach(([mode, label, description], index) => {
            const button = ui.element('button', 'approval-mode-option');
            button.type = 'button';
            button.dataset.mode = mode;
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', String(mode === core.currentApprovalMode));
            const copy = ui.element('span', 'approval-mode-copy');
            copy.append(ui.element('strong', '', label), ui.element('span', 'muted', description));
            const check = ui.element('span', 'approval-mode-check');
            if (mode === core.currentApprovalMode)
                check.append(window.WeftIcons.create('allow', 16));
            button.append(check, copy, ui.element('kbd', '', String(index + 1)));
            button.addEventListener('click', () => { void core.saveApprovalMode(mode); });
            menu.append(button);
        });
    }
    function acceptApprovalRisk(mode) {
        return mode !== 'allow-all' || window.confirm('全部允许会直接执行删除或覆盖文件、修改系统、安装软件、对外发送或发布和付款等操作，可能无法撤销。确定启用？');
    }
    function renderConversationApprovals() {
        const context = core.approvalContext(), bar = ui.byId('approval-bar');
        if (!bar) return;
        const rows = core.approvalContextCurrent(context) ? [...core.conversationApprovals.entries.values()]
            .filter(entry => entry.row.sessionId === context.sessionId && core.approvalSource(entry.row) && entry.row.status === 'pending')
            .sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt)) : [];
        const hadFocus = bar.contains(document.activeElement), action = document.activeElement?.dataset?.conversationApprovalAction;
        bar.hidden = rows.length === 0;
        ui.byId('timeline-status').hidden = !bar.hidden;
        ui.byId('model-hint').hidden = !bar.hidden || core.state.sessions.some(session => session.sessionId === context.sessionId && session.running) || !ui.byId('model-hint').textContent;
        if (!rows.length) {
            bar.replaceChildren(); delete bar.dataset.signature;
            if (hadFocus) ui.byId('message-text').focus({ preventScroll: true });
            ui.renderTimeline(); return;
        }
        const entry = rows[0], row = entry.row, marker = core.approvalMarker(context, row);
        const operation = core.conversationApprovals.operations.get(row.approvalId);
        const notice = entry.notice || (core.conversationTasks.entries.get(row.taskId)?.notice ? '原任务暂时无法核对，请重新核对答复。' : '');
        const signature = JSON.stringify([context, row, notice, entry.authoritative, marker, operation, rows.length]);
        if (bar.dataset.signature === signature) return;
        const sameApproval = bar.dataset.approvalId === row.approvalId;
        const expanded = bar.querySelector('details')?.open === true && bar.dataset.approvalId === row.approvalId;
        bar.dataset.signature = signature; bar.dataset.approvalId = row.approvalId;
        bar.replaceChildren();
        const card = ui.element('div', 'approval-bar-content'); card.dataset.conversationApproval = row.approvalId;
        const presentation = core.approvalPresentation(row), details = ui.element('details', 'approval-detail'); details.open = expanded;
        const summary = ui.element('summary', '', `要${presentation.summary}`), raw = ui.element('pre', 'timeline-raw');
        summary.dataset.conversationApprovalAction = 'parameters';
        const reason = ui.element('p', 'approval-explanation');
        const paint = value => { summary.textContent = `要${value.summary}`; raw.textContent = typeof value.raw === 'string' ? value.raw : JSON.stringify(value.raw, null, 2); reason.textContent = value.reason; reason.hidden = !value.reason; };
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
            button.addEventListener('click', () => { if (core.approvalContextCurrent(context)) void core.submitApproval(context, row, outcome); }); actions.append(button);
        }
        if (row.riskCategories?.length) {
            const always = ui.element('button', 'button quiet small', '总是允许此类'); always.type = 'button';
            always.dataset.conversationApprovalAction = 'allowed-always';
            always.disabled = !!operation || !entry.authoritative || !!notice || !!marker && (marker.outcome !== 'allowed-once' || marker.scope !== 'conversation-category');
            always.addEventListener('click', () => { if (core.approvalContextCurrent(context)) void core.submitApproval(context, row, 'allowed-once', 'conversation-category'); }); details.append(always);
        }
        if (notice || marker) {
            const check = ui.element('button', 'button quiet small', '重新核对答复'); check.type = 'button'; check.disabled = !!operation;
            check.dataset.conversationApprovalAction = 'check';
            check.addEventListener('click', () => { if (core.approvalContextCurrent(context)) { void core.refreshConversationTasks(); void core.refreshConversationApprovals(context, true); } }); card.append(check);
        }
        card.append(actions); bar.append(card);
        if (hadFocus) { const replacement = [...card.querySelectorAll('[data-conversation-approval-action]')].find(node => node.dataset.conversationApprovalAction === action); if (sameApproval && replacement && !replacement.disabled) replacement.focus({ preventScroll: true }); else ui.byId('message-text').focus({ preventScroll: true }); }
        ui.renderTimeline();
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
            if (/^[1-5]$/.test(event.key)) {
                event.preventDefault();
                void core.saveApprovalMode(core.approvalModes[Number(event.key) - 1][0]);
            }
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
            if (!ui.acceptApprovalRisk(mode)) {
                void core.refreshApprovalSettings();
                return;
            }
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
