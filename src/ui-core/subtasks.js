/* Real timeline steps and native settlement notices; no guessed agents. */
globalThis.WeftUiCore.composerSubtasks = (events, now = Date.now()) => {
    const ordered = [...events].sort((a,b) => a.seq-b.seq), tasks = new Map(), ids = new Map(), starts = new Map();
    const latestTurn = ordered.filter(event => event.type === 'turn.started').at(-1)?.seq ?? -1;
    for (const event of ordered) {
        const data = event.data || {}, key = `${data.taskId}/${data.stepId}`;
        if(event.type === 'step.started')starts.set(key,event);
        if (event.type.startsWith('step.') && data.subtask) {
            let row = tasks.get(key);
            if (!row) { row = {key,stepId:data.stepId,seq:event.seq,name:data.subtask.name || '子任务',
                startedAt:starts.get(key)?.at ?? event.at,state:'running'}; tasks.set(key,row); }
            if (data.subtask.id) { ids.set(data.subtask.id,row); row.background = true; }
            if (data.state === 'failed' || event.type === 'step.completed' && !row.background) {
                row.state = data.state === 'failed' ? 'failed' : 'completed'; row.endedAt = event.at;
            }
        }
        if (event.type === 'subtask.updated') {
            const row = ids.get(data.id);
            if (row && ['completed','failed'].includes(data.state) && row.state === 'running') {
                row.state = data.state; row.endedAt = event.at;
            }
        }
    }
    const rows = [...tasks.values()].filter(row => row.seq >= latestTurn || row.state === 'running');
    if (!rows.some(row => row.state === 'running')) return [];
    return rows.map(row => { const elapsed = Date.parse(row.endedAt) || now;
        const duration = Number.isFinite(Date.parse(row.startedAt)) ? Math.max(0, Math.floor((elapsed-Date.parse(row.startedAt))/1000)) : null;
        return {...row,status:{running:'进行中',completed:'完成',failed:'失败'}[row.state],
            duration:duration === null ? '耗时未记录' : duration < 60 ? `${duration} 秒` : `${Math.floor(duration/60)} 分 ${duration%60} 秒`}; });
};
