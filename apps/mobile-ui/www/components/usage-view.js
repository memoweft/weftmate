/* Usage presentation shared by desktop and the generated mobile usage-view asset. */
globalThis.WeftUsageView = function (core, target, { sessionId = '', current = () => target.isConnected } = {}) {
    const node = (tag, text, className = '') => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
    const status = node('p', '正在读取用量…', 'muted'); status.setAttribute('role', 'status');
    target.replaceChildren(status);
    let month = '';
    async function render() {
        status.textContent = '正在读取用量…';
        try {
            const value = await core.loadUsage({ sessionId, month });
            if (!value || !current()) return;
            const { summary, settings } = value;
            let timeZoneLabel = summary.timeZone;
            try {
                const name = new Intl.DateTimeFormat('zh-CN', { timeZone: summary.timeZone, timeZoneName: 'longGeneric' })
                    .formatToParts(new Date(`${summary.month}-15T12:00:00Z`)).find(part => part.type === 'timeZoneName')?.value;
                if (name && name !== summary.timeZone) timeZoneLabel = `${name}（${summary.timeZone}）`;
            } catch { /* Fall back to the API's IANA name when localization is unavailable. */ }
            // day is already a calendar date in summary.timeZone, not a UTC timestamp.
            const dateLabel = day => `${day.day}（${timeZoneLabel}）`;
            target.replaceChildren();
            const head = node('div', '', 'usage-toolbar');
            head.append(node('h2', sessionId ? '本对话用量' : '用量与费用'));
            const picker = node('input', ''); picker.type = 'month'; picker.value = summary.month; picker.setAttribute('aria-label', '统计月份');
            picker.addEventListener('change', () => { month = picker.value; void render(); });
            const refresh = node('button', '刷新用量', 'button secondary'); refresh.type = 'button'; refresh.addEventListener('click', () => { void render(); });
            head.append(picker, refresh); target.append(head);
            target.append(node('p', `${month ? '所选月份' : '本月合计'} ${core.usageMoney(summary.total.cost)} · ${summary.total.requests} 次请求`, 'usage-total'));
            target.append(node('p', `输入 ${summary.total.inputTokens.toLocaleString()}（含缓存 ${summary.total.cachedInputTokens.toLocaleString()}） · 输出 ${summary.total.outputTokens.toLocaleString()}`, 'usage-tokens'));
            target.append(node('p', `按 ${timeZoneLabel} 统计，金额按请求时单价计算，供参考，以服务商账单为准。`, 'muted'));
            if (summary.total.unknownRequests || summary.total.unpricedRequests) target.append(node('p', `${summary.total.unknownRequests} 次用量未知；${summary.total.unpricedRequests} 次费用未知，未计入金额。`, 'muted'));
            const notice = node('p', value.notice || (summary.budget.effectiveLimit === null ? '未设置月度上限。' : `本月有效上限 ${core.usageMoney(summary.budget.effectiveLimit)}。`), 'usage-notice');
            notice.setAttribute('role', summary.budget.state === 'blocked' ? 'alert' : 'status'); target.append(notice);
            target.append(node('h3', '每日费用'));
            const chart = node('div', '', 'usage-chart'); chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `${summary.month} 每日费用柱状图（${timeZoneLabel}）`);
            const max = Math.max(...summary.days.map(day => day.cost), 0.000000001);
            for (const day of summary.days) {
                const column = node('div', '', 'usage-column'); column.title = `${dateLabel(day)} ${core.usageMoney(day.cost)} · ${day.requests} 次 · 未知 ${day.unknownRequests}`;
                const meter = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); meter.setAttribute('viewBox', '0 0 10 100'); meter.setAttribute('preserveAspectRatio', 'none'); meter.setAttribute('aria-hidden', 'true');
                const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); const height = 100 * day.cost / max;
                for (const [key, value] of Object.entries({ x: 1, y: 100 - height, width: 8, height })) bar.setAttribute(key, String(value));
                meter.append(bar);
                column.append(meter, node('small', String(Number(day.day.slice(-2))))); chart.append(column);
            }
            target.append(chart);
            const details = node('details', '', 'usage-daily'); details.append(node('summary', '每日明细'));
            const daily = node('ul', ''); for (const day of summary.days.filter(row => row.requests)) daily.append(node('li', `${dateLabel(day)} · ${core.usageMoney(day.cost)} · ${day.requests} 次请求 · 未知 ${day.unknownRequests}`));
            if (!daily.children.length) daily.append(node('li', '这个月还没有模型请求。')); details.append(daily); target.append(details);
            for (const [title, rows] of [['按对话排行', value.sessions], ['按模型排行', value.models]]) {
                target.append(node('h3', title)); const list = node('ol', '', 'usage-ranking');
                for (const row of rows) {
                    const item = node('li', ''); item.append(node('span', `${row.name}${row.local ? ' · 本地' : ''}`),
                        node('span', `${core.usageMoney(row.cost)} · ${row.requests} 次`, 'usage-amount'));
                    item.append(node('small', `输入 ${row.inputTokens}（缓存 ${row.cachedInputTokens}） · 输出 ${row.outputTokens}${row.unknownRequests ? ` · ${row.unknownRequests} 次未知` : ''}`)); list.append(item);
                }
                if (!rows.length) list.append(node('li', '这个月还没有模型请求。')); target.append(list);
            }
            if (settings.canManage) {
                target.append(node('h3', '月度上限'));
                const limits = node('form', '', 'usage-form');
                const field = (label, initial, step = 'any') => {
                    const wrapper = node('label', label); const input = node('input', ''); input.type = 'number'; input.min = '0'; input.step = step; input.value = initial ?? ''; wrapper.append(input); return { wrapper, input };
                };
                const permanent = field('月度上限（元）', settings.monthlyLimit), temporary = field('仅本月临时上限（元）', summary.budget.temporaryLimit);
                limits.append(permanent.wrapper, temporary.wrapper, node('p', '留空表示不限；0 暂停云端请求。本地模型不受限。临时上限于下月自动失效。', 'muted'));
                const save = node('button', '保存月度上限', 'button primary'); save.type = 'submit'; limits.append(save);
                limits.addEventListener('submit', async event => {
                    event.preventDefault(); save.disabled = true;
                    try { await core.saveUsageSettings({ monthlyLimit: permanent.input.value === '' ? null : Number(permanent.input.value), temporaryLimit: temporary.input.value === '' ? null : Number(temporary.input.value) }); month = ''; await render(); }
                    catch (error) { showError(error); } finally { save.disabled = false; }
                }); target.append(limits);
                const pricing = node('details', '', 'usage-pricing'); pricing.append(node('summary', '模型单价（元 / 百万 token）'));
                pricing.append(node('p', 'MiMo Flash 预置官方价格。其他云模型请填写单价；未设置时费用为未知。修改只影响后续请求。', 'muted'));
                for (const model of settings.models) {
                    const form = node('form', '', 'usage-form'); form.append(node('h4', `${model.name}${model.local ? ' · 本地' : ''}`));
                    const cache = field('缓存输入', model.price?.cachedInput), input = field('未缓存输入', model.price?.input), output = field('输出', model.price?.output);
                    form.append(cache.wrapper, input.wrapper, output.wrapper);
                    const savePrice = node('button', '保存单价', 'button secondary'); savePrice.type = 'submit'; form.append(savePrice);
                    form.addEventListener('submit', async event => {
                        event.preventDefault(); savePrice.disabled = true;
                        try {
                            if ([cache, input, output].some(row => row.input.value === '')) throw new Error('请填写三个单价。');
                            await core.saveUsageSettings({ profileId: model.id, price: { cachedInput: Number(cache.input.value), input: Number(input.input.value), output: Number(output.input.value) } }); await render();
                        } catch (error) { showError(error); } finally { savePrice.disabled = false; }
                    }); pricing.append(form);
                } target.append(pricing);
            }
        } catch (error) { if (current()) { target.replaceChildren(status); showError(error); const retry = node('button', '重试读取用量', 'button secondary'); retry.addEventListener('click', () => { void render(); }); target.append(retry); } }
    }
    function showError(error) { status.textContent = error instanceof Error ? error.message : core.failureMessage(error); status.setAttribute('role', 'alert'); if (!status.isConnected) target.append(status); }
    void render();
};
if (globalThis.WeftUiComponents) globalThis.WeftUiComponents.factories.usage = (core, ui) => {
    let activeScope = null;
    let conversationButton;
    function renderConversationUsage() {
        if (conversationButton) conversationButton.hidden = core.state.newConversation || !core.state.selectedSessionId || core.state.activeChatSource === 'phone';
    }
    function showSettingsUsage({ sessionId = '' } = {}) {
        const target = document.querySelector('[data-category="usage"].settings-category');
        const token = core.accountToken(); activeScope = {};
        const scope = activeScope;
        WeftUsageView(core, target, { sessionId, current: () => scope === activeScope && core.accountCurrent(token) && !target.hidden });
    }
    function mountUsage() {
        const conversation = ui.element('button', 'button quiet small usage-title-button', '本对话用量'); conversation.type = 'button';
        conversationButton = conversation; renderConversationUsage();
        conversation.addEventListener('click', () => {
            if (!core.state.selectedSessionId || core.state.activeChatSource === 'phone') return ui.toast('请先选择一段电脑对话。');
            ui.openSettings('usage', { sessionId: core.state.selectedSessionId });
        });
        globalThis.WeftUiLayout.mountUsage(conversation);
    }
    return { mountUsage, showSettingsUsage, renderConversationUsage };
};
