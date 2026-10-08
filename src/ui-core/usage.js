/* Shared usage reads, identity safety, settings validation and presentation data. */
globalThis.WeftUiCore.factories.usage = (core, effects) => {
    let generation = 0, lastBudgetRead = 0, warned = '';
    const current = token => { const now = core.accountToken(); return ['generation', 'ownerId', 'deviceId', 'csrf'].every(key => now[key] === token[key]); };
    const money = value => `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
    const budgetText = budget => budget.state === 'blocked'
        ? '本月用量已达到上限，云端模型请求已暂停。请提高本月上限或切换本地模型。'
        : budget.state === 'warning' ? '本月用量已达到上限的 80%，请留意剩余额度。' : '';
    async function loadUsage({ month = '', sessionId = '' } = {}) {
        core.syncMobileIdentity?.();
        const token = core.accountToken(), request = ++generation;
        const query = new URLSearchParams();
        if (month) query.set('month', month);
        if (sessionId) query.set('sessionId', sessionId);
        const [summary, settings, sessions] = await Promise.all([
            core.accessApi(`/usage${query.size ? `?${query}` : ''}`), core.accessApi('/settings/usage'), core.accessApi('/sessions')]);
        if (!current(token) || request !== generation) return null;
        const names = new Map((sessions.sessions || []).map(row => [row.sessionId, row.title || '未命名对话']));
        const models = new Map(settings.models.map(row => [row.id, row]));
        return { summary, settings, notice: budgetText(summary.budget),
            sessions: summary.sessions.map(row => ({ ...row, name: row.sessionId === null ? '后台 / 手机独立请求' : names.get(row.sessionId) || '已移除的对话' })),
            models: summary.models.map(row => ({ ...row, name: models.get(row.profileId)?.name || '已移除的模型', local: models.get(row.profileId)?.local === true })) };
    }
    async function saveUsageSettings(input) {
        core.syncMobileIdentity?.();
        for (const key of ['monthlyLimit', 'temporaryLimit']) if (input[key] !== undefined && input[key] !== null && (!Number.isFinite(input[key]) || input[key] < 0)) throw new Error('请输入大于或等于 0 的金额；留空表示不限。');
        return core.accessApi('/settings/usage', { method: 'PATCH', protectedWrite: true, body: input });
    }
    async function refreshUsageBudget() {
        if (Date.now() - lastBudgetRead < 5000) return;
        lastBudgetRead = Date.now();
        const token = core.accountToken();
        try {
            const summary = await core.accessApi('/usage');
            if (!current(token)) return;
            const key = `${token.ownerId}:${summary.month}:${summary.budget.state}`;
            if (['warning', 'blocked'].includes(summary.budget.state) && key !== warned) effects.toast?.(budgetText(summary.budget));
            warned = key;
        } catch { /* Existing host connectivity UI owns read failures. */ }
    }
    return { loadUsage, saveUsageSettings, usageMoney: money, usageBudgetText: budgetText, refreshUsageBudget };
};
