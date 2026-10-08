/* Reminder presentation shared by the desktop category and generated mobile view. */
globalThis.WeftSchedulesView = (core, target, { openConversation, autoLoad = true, current = () => target.isConnected } = {}) => {
    const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const status = element('p', 'muted'); status.setAttribute('role', 'status');
    const refresh = element('button', 'button secondary', '刷新提醒'); refresh.type = 'button';
    const list = element('ul', 'settings-schedules-list'); list.setAttribute('aria-label', '提醒与定时任务列表');
    target.replaceChildren(status, refresh, list);
    let generation = 0;
    async function render() {
        core.syncMobileIdentity?.();
        const version = ++generation, token = core.accountToken(); status.textContent = '正在读取…'; list.replaceChildren();
        try {
            const value = await core.loadSchedules();
            if (!value || version !== generation || !core.accountIdentityCurrent(token) || !current()) return;
            list.replaceChildren(); status.textContent = value.items.length ? `${value.items.length} 项提醒与定时任务` : '还没有提醒。可以在对话里说“明天早上 9 点提醒我交报告”。';
            for (const row of value.items) {
                const item = element('li', 'system-service settings-schedule-row'); item.setAttribute('aria-label', row.text);
                const details = element('div', 'system-service-detail');
                details.append(element('strong', '', row.text), element('small', 'muted', core.scheduleDescription(row)));
                const conversation = element('button', 'button quiet small', '打开所属对话'); conversation.type = 'button';
                conversation.addEventListener('click', () => { void openConversation(row.sessionId); }); details.append(conversation); item.append(details);
                const actions = row.state === 'completed' ? [['run', '立即运行'], ['delete', '删除']]
                    : [[row.state === 'paused' ? 'resume' : 'pause', row.state === 'paused' ? '恢复' : '暂停'], ['run', '立即运行'], ['delete', '删除']];
                for (const [action, label] of actions) {
                    const button = element('button', 'button secondary small', label); button.type = 'button';
                    button.addEventListener('click', async () => {
                        button.disabled = true;
                        try { await core.manageSchedule(row, action); if (core.accountIdentityCurrent(token) && current()) await render(); }
                        catch { if (core.accountIdentityCurrent(token) && current()) status.textContent = `${label}未确认，请刷新查看实际状态。`; }
                        finally { button.disabled = false; }
                    }); item.append(button);
                }
                list.append(item);
            }
        } catch { if (core.accountIdentityCurrent(token) && current()) status.textContent = '读取失败，请刷新重试。'; }
    }
    refresh.addEventListener('click', () => { void render(); }); if (autoLoad) void render(); return render;
};
if (globalThis.WeftUiComponents) globalThis.WeftUiComponents.factories.schedules = (core, ui) => {
    let renderSchedules;
    return {
        mountSchedules() {
            const target = ui.element('section', 'settings-schedules'); target.id = 'settings-schedules';
            globalThis.WeftUiLayout.mountSchedules(target);
            renderSchedules = globalThis.WeftSchedulesView(core, target, { autoLoad: false, current: () => !ui.byId('account-view').hidden && !target.closest('.settings-category').hidden,
                openConversation: async sessionId => { await core.enterAssistant(); await core.selectSession(sessionId); } });
        },
        showSettingsSchedules() { void renderSchedules(); },
    };
};
