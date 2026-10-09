/* Pure timeline projection: events and step updates never depend on a renderer. */
(() => {
    function toolArguments(value) {
        try {
            const parsed = typeof value === 'string' ? JSON.parse(value) : value;
            const args = parsed?.arguments ?? parsed?.parameters ?? (parsed && ('output' in parsed || 'approval' in parsed) ? {} : parsed);
            const result = typeof args === 'string' ? JSON.parse(args) : args;
            return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
        } catch { return {}; }
    }
    function toolSummary(tool, value) {
        const args = toolArguments(value), name = String(tool || '工具操作');
        const short = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
        const paths = [...new Set([args.paths, args.files, args.file_path, args.filePath, args.path, args.target]
            .flat().filter(value => typeof value === 'string' && value))];
        const files = paths.slice(0, 3).map(value => value.split(/[\\/]/).at(-1)).join('、');
        const suffix = paths.length ? ` ${paths.length} 个文件：${files}${paths.length > 3 ? '…' : ''}` : '';
        if (/^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(name) || args.command || args.cmd)
            return `运行命令：${short(args.command || args.cmd || args.script || name)}${args.cwd || args.workdir || args.workingDirectory ? `（在 ${short(args.cwd || args.workdir || args.workingDirectory)}）` : ''}`;
        if (/(delete|remove|unlink)/i.test(name)) return `删除${suffix || '文件'}`;
        if (/(write|save|create_file)/i.test(name)) return `写入${suffix || '文件'}`;
        if (/(edit|patch|replace|modify)/i.test(name)) return `修改${suffix || '文件'}`;
        if (/^(read|read_file)$/.test(name)) return `读取${suffix || '文件'}`;
        if (/(grep|search|glob)/i.test(name)) return `搜索 ${short(args.query || args.pattern || args.glob || args.path || name)}`;
        if (/(web|browser|fetch|navigate)/i.test(name) || args.url) {
            const url = args.url || args.urls?.[0];
            let site = short(url || args.query || args.action || name);
            try { site = new URL(url).hostname; } catch { /* Keep a readable query or address. */ }
            return `访问网页 ${site}`;
        }
        if (/(subagent|spawn_agent|delegate|task)/i.test(name))
            return `交给子任务：${short(args.description || args.prompt || args.task || args.message || name)}`;
        const preview = Object.entries(args).slice(0, 3).map(([key, val]) => `${key}=${short(typeof val === 'object' ? JSON.stringify(val) : val)}`).join('，');
        return `${name}${preview ? `：${preview}` : ''}`;
    }
    function sourcePresentation(tool, text) {
        const args = toolArguments(text);
        return { summary: toolSummary(tool, args), raw: typeof text === 'string' ? text : JSON.stringify(text, null, 2),
            hasArguments: Object.keys(args).length > 0 };
    }

    function progressText(steps, terminal = false) {
        const failed = steps.find(step => step.state === 'failed');
        if (failed) return { text: `第 ${failed.ordinal || steps.indexOf(failed) + 1} 步失败`, failed: true, running: false };
        if (steps.some(step => step.state === 'cancelled')) return { text: '已停止', running: false };
        const current = !terminal && steps.filter(step => step.state === 'running' || step.state === 'pending').at(-1);
        if (current) {
            const summary = current.summary || toolSummary(current.toolName, current.arguments);
            return { text: current.approvalStatus === 'pending' ? `等待批准：${summary}` : `正在${summary.replace(/^运行命令：/, '运行命令 ')}…`, running: current.approvalStatus !== 'pending' };
        }
        const counts = new Map();
        for (const step of steps) {
            const name = step.toolName || '', summary = step.summary || '';
            const kind = /^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(name) || /^运行命令/.test(summary) ? 'command'
                : /^(read|read_file)$/.test(name) || /^读取.*文件/.test(summary) ? 'read'
                : /grep|search|glob/.test(name) || /^搜索|^查找/.test(summary) ? 'search'
                : /write|edit|patch/.test(name) || /^写入|^修改/.test(summary) ? 'write' : 'other';
            const args = toolArguments(step.arguments), paths = [...new Set([args.paths, args.files, args.file_path, args.path].flat().filter(value => typeof value === 'string'))];
            const amount = kind === 'read' || kind === 'write' ? paths.length || Number(/(\d+) 个文件/.exec(summary)?.[1]) || 1 : 1;
            counts.set(kind, (counts.get(kind) || 0) + amount);
        }
        const labels = { command: n => `已运行 ${n} 个命令`, read: n => `读取了 ${n} 个文件`, search: n => `搜索了 ${n} 次`, write: n => `修改了 ${n} 个文件`, other: n => `执行了 ${n} 个工具步骤` };
        return { text: [...counts].map(([kind, count]) => labels[kind](count)).join('、'), running: false };
    }
    function approvalProgress(row) {
        return ({ 'allowed-once': '已批准', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' })[row?.outcome || row?.decisionOutcome] || (row?.status === 'pending' ? '等待批准' : '');
    }
    function executionDetailText(text) {
        try {
            const data = JSON.parse(text), args = toolArguments(data);
            const collect = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(collect)
                : value?.type === 'text' ? [value.text || ''] : value?.content ? collect(value.content) : [];
            const output = collect(data.output).filter(Boolean).join('\n');
            return Object.keys(args).length || output ? `${Object.keys(args).length ? `参数\n${JSON.stringify(args, null, 2)}` : ''}${output ? `\n\n输出\n${output}` : ''}`.trim() : text;
        } catch { return text; }
    }
    function projectTimeline(events, approvals = []) {
        const ordered = [...events].sort((a, b) => a.seq - b.seq), groups = [], steps = new Map();
        let group = null;
        const ordinals = new Map();
        for (const raw of ordered) {
            const event = raw.type === 'artifact.created' && raw.data?.completedStep ? { ...raw, type: 'step.completed', data: raw.data.completedStep } : raw;
            if (event.type.startsWith('step.')) {
                const data = event.data || {}, key = `${data.taskId}/${data.stepId}`;
                let step = steps.get(key);
                if (!step) {
                    if (!group || group.taskId !== data.taskId) {
                        group = { seq: event.seq, taskId: data.taskId, steps: [] };
                        groups.push(group);
                    }
                    const ordinal = (ordinals.get(data.taskId) || 0) + 1;
                    ordinals.set(data.taskId, ordinal);
                    step = { ...data, ordinal, at: event.at, endAt: event.type === 'step.completed' ? event.at : null };
                    group.steps.push(step);
                    steps.set(key, step);
                }
                else {
                    Object.assign(step, data);
                    if (event.type === 'step.completed')
                        step.endAt = event.at;
                }
                if (raw.type === 'artifact.created')
                    group = null;
            }
            else if (!['turn.started', 'turn.ended', 'task.started', 'task.ended', 'approval.requested', 'approval.resolved'].includes(event.type))
                group = null;
        }
        for (const step of steps.values()) {
            const request = ordered.find(event => event.type === 'approval.requested' && event.data?.callId &&
                (!event.data.taskId || event.data.taskId === step.taskId) && (event.data.callId === step.stepId || event.data.callId === step.callId));
            const row = approvals.find(row => row.callId && (row.callId === step.stepId || row.callId === step.callId) && (!row.turn || step.taskId === `turn-${row.turn}` || row.taskId === step.taskId));
            const resolved = request && ordered.find(event => event.type === 'approval.resolved' && event.data?.approvalId === request.data.approvalId);
            const record = row || resolved?.data || request && { status: 'pending' };
            step.approvalText = approvalProgress(record);
            step.approvalStatus = row?.status || (resolved ? 'resolved' : request ? 'pending' : undefined);
        }
        const cards = ordered.flatMap(event => event.type === 'artifact.created' && event.data?.artifacts?.length
            ? event.data.artifacts.map(artifact => ({ ...event, data: { ...event.data, ...artifact } })) : [event]);
        return { ordered, groups, cards };
    }
    function sessionGroup(session, now = new Date()) {
        const stamp = session.updatedAt || session.lastMessageAt || session.createdAt;
        if (!stamp || !Number.isFinite(Date.parse(stamp)))
            return '会话';
        const date = new Date(stamp), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const days = Math.round((today - day) / 86400000);
        return days <= 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? '7 天内' : '更早';
    }
    function sortSessions(sessions) {
        return [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (Date.parse(b.updatedAt || b.lastMessageAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.lastMessageAt || a.createdAt) || 0));
    }
    function resourceReferences(text) {
        let args;
        try {
            args = JSON.parse(text).arguments;
            if (typeof args === 'string')
                args = JSON.parse(args);
        }
        catch {
            return [];
        }
        if (!args)
            return [];
        const strings = value => (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value);
        const references = [];
        for (const [kind, values] of [['file', [...strings(args.file_path), ...strings(args.filePath), ...strings(args.path), ...strings(args.paths)]], ['webpage', [...strings(args.url), ...strings(args.urls)]]]) {
            for (const value of new Set(values))
                references.push({ kind, value, key: `${kind}:${value}` });
        }
        return references;
    }
    Object.assign(globalThis.WeftUiCore, { projectTimeline, progressText, approvalProgress, executionDetailText, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, sourcePresentation });
    globalThis.WeftUiCore.factories.timeline = () => ({ projectTimeline, progressText, approvalProgress, executionDetailText, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, sourcePresentation });
})();
