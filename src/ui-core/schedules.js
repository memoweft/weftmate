/* Shared reminder actions and descriptions. Presentation owns placement. */
globalThis.WeftUiCore.factories.schedules = (core,_effects,environment) => {
 const pending = new Map();
 return ({
    async loadSchedules() {
        const token = core.accountToken();
        const value = await core.accessApi('/schedules');
        return core.accountIdentityCurrent(token) ? value : null;
    },
    async manageSchedule(row, action) {
        const base = `/schedules/${encodeURIComponent(row.sessionId)}/${encodeURIComponent(row.id)}`;
        const key = `${core.state.identityGeneration}:${row.sessionId}:${row.id}:${action}`;
        if (!pending.has(key)) pending.set(key, environment.crypto.randomUUID());
        const result = await core.accessApi(action === 'delete' ? base : `${base}/${action}`, {
            method: action === 'delete' ? 'DELETE' : 'POST', protectedWrite: true,
            ...(action === 'delete' ? {} : { body: {requestId:pending.get(key)} }) });
        pending.delete(key); return result;
    },
    scheduleDescription(row) {
        const rules = { daily: '每天', monthly: `每月 ${row.repeat?.day} 日`, weekly: `每周${['日', '一', '二', '三', '四', '五', '六'][row.repeat?.weekday]}` };
        const repeat = row.repeat?.kind === 'interval' ? `每 ${row.repeat.seconds / 60} 分钟` : row.repeat ? `${rules[row.repeat.kind]} ${row.repeat.time.slice(0, 5)}` : '一次性';
        const next = row.state === 'paused' ? '已暂停' : row.nextRunAt
            ? `下次 ${new Date(row.nextRunAt).toLocaleString('zh-CN', {timeZone: row.timeZone})}` : '已完成';
        const conversation = (core.goalsPage?.sessions?.find(session => session.sessionId === row.sessionId)) ?? core.state.sessions.find(session => session.sessionId === row.sessionId);
        return `${next} · ${repeat} · ${row.temporary||conversation?.temporary||conversation?.hasTemporaryContent?'临时对话':conversation?.title || conversation?.name || '新对话'} · ${row.timeZone}`;
    },
}); };
