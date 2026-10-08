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
        const context = core.approvalContext(), list = ui.byId('transcript');
        if (!core.approvalContextCurrent(context))
            return;
        const scroll = ui.byId('chat-scroll'), top = scroll.scrollTop;
        const reading = [...list.children].find((node) => node.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top);
        const readingTop = reading?.getBoundingClientRect().top;
        const visible = new Set();
        for (const entry of core.conversationApprovals.entries.values()) {
            const row = entry.row;
            if (row.sessionId !== context.sessionId || !core.approvalSource(row))
                continue;
            const timelineAnchor = [...list.children].find(node => node.dataset?.timelineApproval === row.approvalId);
            const anchor = timelineAnchor || [...list.children].find((node) => node.dataset?.receiptId === row.sourceReceiptId);
            if (!anchor)
                continue;
            visible.add(row.approvalId);
            const marker = core.approvalMarker(context, row), operation = core.conversationApprovals.operations.get(row.approvalId);
            const sourceNotice = core.conversationTasks.entries.get(row.taskId)?.notice || '';
            const signature = JSON.stringify([row, entry.notice, sourceNotice, entry.authoritative, marker, operation?.requestId]);
            const scope = JSON.stringify(context);
            let card = [...list.children].find((node) => node.dataset?.conversationApproval === row.approvalId);
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
                !document.querySelector('dialog[open]') ? active.dataset?.conversationApprovalAction : null;
            if (!card) {
                card = ui.element('li', 'conversation-task conversation-approval');
                card.dataset.conversationApproval = row.approvalId;
                let next = anchor.nextSibling;
                while (next?.dataset?.conversationTask || next?.dataset?.conversationApproval && next.dataset.sourceReceiptId === row.sourceReceiptId)
                    next = next.nextSibling;
                list.insertBefore(card, next);
            }
            if (timelineAnchor) {
                card.dataset.seq = timelineAnchor.dataset.seq;
                list.insertBefore(card, timelineAnchor);
            }
            const firstPaint = !card.dataset.signature;
            const resolution = card.dataset.motionStatus && card.dataset.motionStatus !== row.status && row.status !== 'pending' && core.conversationApprovals.entries.size <= 20 ? globalThis.WeftMotion?.snapshot(card) : null;
            card.dataset.motionStatus = row.status;
            card.dataset.sourceReceiptId = row.sourceReceiptId;
            card.dataset.signature = signature;
            card.dataset.scope = scope;
            card.replaceChildren();
            const heading = ui.element('strong', 'conversation-task-title', `${core.executionName(row)} · ${row.status === 'pending' ? '需要你批准' : '审批回执'}`);
            heading.prepend(window.WeftIcons.create('approval', 16));
            card.append(heading);
            card.classList.toggle('is-resolved', row.status !== 'pending');
            const presentation = core.approvalPresentation(row);
            const reason = ui.element('p', 'conversation-approval-reason', presentation.summary);
            const explanation = ui.element('p', 'conversation-approval-reason');
            const details = ui.element('details', 'conversation-task-more');
            const raw = ui.element('pre', 'timeline-raw');
            details.append(ui.element('summary', '', '详情'), raw);
            const paint = value => { raw.textContent = typeof value.raw === 'string' ? value.raw : JSON.stringify(value.raw, null, 2); reason.textContent = value.summary; explanation.textContent = value.reason; explanation.hidden = !value.reason || row.status !== 'pending'; };
            paint(presentation);
            details.hidden = row.status !== 'pending';

            void core.readApprovalPresentation(row).then(value => {
                if (card.isConnected && card.dataset.signature === signature && core.approvalContextCurrent(context)) paint(value);
            });
            reason.hidden = row.status !== 'pending';
            card.append(reason, explanation, details);
            const notice = entry.notice || (sourceNotice ? '原任务暂时无法核对，请重新核对答复。' : '');
            const status = ui.element('p', 'conversation-approval-status', row.status === 'pending' && operation ? '正在提交本次决定…'
                : notice || (row.status === 'pending' && marker ? '上次答复结果尚未确认。已核对仍在等待，可用原答复重试。' : core.approvalStatusText(row)));
            status.setAttribute('role', 'status');
            status.tabIndex = -1;
            status.dataset.conversationApprovalAction = 'status';
            card.append(status);
            const actions = ui.element('div', 'conversation-task-actions');
            if (row.status === 'pending')
                for (const action of ['allowed-once', ...(row.riskCategories?.length ? ['allowed-always'] : []), 'rejected']) {
                    const outcome = action === 'allowed-always' ? 'allowed-once' : action;
                    const button = ui.element('button', `button ${action === 'allowed-once' ? 'primary' : 'secondary'} small`, action === 'allowed-once' ? '允许一次' : action === 'allowed-always' ? '总是允许此类' : '拒绝');
                    button.prepend(window.WeftIcons.create(action === 'rejected' ? 'deny' : 'allow', 16));
                    button.type = 'button';
                    button.dataset.conversationApprovalAction = action;
                    button.disabled = !!operation || !entry.authoritative || !!notice || !!marker && (marker.outcome !== outcome ||
                        (marker.scope ?? 'once') !== (action === 'allowed-always' ? 'conversation-category' : 'once'));
                    button.addEventListener('click', () => {
                        if (core.approvalContextCurrent(context))
                            void core.submitApproval(context, row, outcome, action === 'allowed-always' ? 'conversation-category' : 'once');
                    });
                    actions.append(button);
                }
            if (notice || marker || row.status === 'answered') {
                const check = ui.element('button', 'button secondary small', '重新核对答复');
                check.type = 'button';
                check.dataset.conversationApprovalAction = 'check';
                check.disabled = !!operation;
                check.addEventListener('click', () => {
                    if (core.approvalContextCurrent(context)) {
                        if (sourceNotice)
                            void core.refreshConversationTasks();
                        else
                            void core.refreshConversationApprovals(context, true);
                    }
                });
                actions.append(check);
            }
            const detail = ui.element('button', 'button secondary small', '查看来源与成果');
            detail.type = 'button';
            detail.dataset.conversationApprovalAction = 'detail';
            detail.addEventListener('click', () => ui.inlineTaskInfo(row.taskId, detail));
            actions.hidden = ['resolved', 'unavailable'].includes(row.status);
            card.classList.toggle('is-resolved', ['resolved', 'unavailable'].includes(row.status));
            actions.append(detail);
            card.append(actions);
            if (firstPaint && core.conversationApprovals.entries.size <= 20) globalThis.WeftMotion?.reveal(card, 'base');
            globalThis.WeftMotion?.dismiss(resolution, true);
            if (focusAction && !document.querySelector('dialog[open]') &&
                (document.activeElement === active || document.activeElement === document.body)) {
                const replacement = card.querySelector(`[data-conversation-approval-action="${focusAction}"]`);
                (replacement && !replacement.disabled ? replacement : status).focus({ preventScroll: true });
            }
        }
        for (const card of [...list.children])
            if (card.dataset?.conversationApproval && !visible.has(card.dataset.conversationApproval))
                card.remove();
        if (reading?.isConnected && Number.isFinite(readingTop) && Number.isFinite(scroll.scrollTop))
            scroll.scrollTop += reading.getBoundingClientRect().top - readingTop;
        else if (Number.isFinite(top))
            scroll.scrollTop = top;
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
