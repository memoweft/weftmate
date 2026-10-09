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

    function projectTimeline(events) {
        const ordered = [...events].sort((a, b) => a.seq - b.seq), groups = [], steps = new Map();
        let group = null;
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
                    step = { ...data, at: event.at, endAt: event.type === 'step.completed' ? event.at : null };
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
            else if (!['turn.started', 'turn.ended', 'task.started', 'task.ended'].includes(event.type))
                group = null;
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
    Object.assign(globalThis.WeftUiCore, { projectTimeline, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, sourcePresentation });
    globalThis.WeftUiCore.factories.timeline = () => ({ projectTimeline, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, sourcePresentation });
})();
