/* Desktop reminder management; shared actions remain in ui-core. */
globalThis.WeftUiComponents.factories.schedules = (core, ui) => ({
    mountSchedules() {
        const section = ui.element('details', 'card group');
        section.append(ui.element('summary', '', '提醒与定时任务'));
        const body = ui.element('div', 'usage-body');
        const status = ui.element('p', 'muted'); status.setAttribute('role', 'status');
        const refresh = ui.element('button', 'button secondary', '刷新提醒'); refresh.type = 'button';
        const list = ui.element('ul', 'system-services'); list.setAttribute('aria-label', '提醒与定时任务列表');
        body.append(status, refresh, list); section.append(body);
        let generation = 0;
        async function render() {
            const version = ++generation, token = core.accountToken();
            status.textContent = '正在读取…';
            try {
                const value = await core.loadSchedules();
                if (!value || version !== generation || !core.accountCurrent(token)) return;
                list.replaceChildren(); status.textContent = value.items.length ? `${value.items.length} 项提醒与定时任务` : '还没有提醒。可以在对话里说“明天早上 9 点提醒我交报告”。';
                for (const row of value.items) {
                    const item = ui.element('li', 'system-service'); item.setAttribute('aria-label', row.text);
                    const details = ui.element('div', 'system-service-detail');
                    details.append(ui.element('strong', '', row.text), ui.element('small', 'muted', core.scheduleDescription(row)));
                    const conversation = ui.element('button', 'button quiet small', '打开所属对话'); conversation.type = 'button';
                    conversation.addEventListener('click', () => { void core.selectSession(row.sessionId); }); details.append(conversation);
                    item.append(details);
                    const actions = row.state === 'completed' ? [['run', '立即运行'], ['delete', '删除']]
                        : [[row.state === 'paused' ? 'resume' : 'pause', row.state === 'paused' ? '恢复' : '暂停'], ['run', '立即运行'], ['delete', '删除']];
                    for (const [action, label] of actions) {
                        const button = ui.element('button', 'button secondary small', label); button.type = 'button';
                        button.addEventListener('click', async () => {
                            button.disabled = true;
                            try { await core.manageSchedule(row, action); if (core.accountCurrent(token)) await render(); }
                            catch { if (core.accountCurrent(token)) status.textContent = `${label}未确认，请刷新查看实际状态。`; }
                            finally { button.disabled = false; }
                        }); item.append(button);
                    }
                    list.append(item);
                }
            } catch { if (core.accountCurrent(token)) status.textContent = '读取失败，请刷新重试。'; }
        }
        refresh.addEventListener('click', () => { void render(); });
        section.addEventListener('toggle', () => { if (section.open) void render(); else generation++; });
        globalThis.WeftUiLayout.mountSchedules(section);
    },
});
