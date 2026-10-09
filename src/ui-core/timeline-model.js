/* Pure timeline projection: events and step updates never depend on a renderer. */
(() => {
    const toolLabels = { __proto__: null,
        open_settings:'系统设置', open_app:'打开应用', list_launchable_apps:'应用列表',
        read:'读取文件', read_file:'读取文件', pwsh:'运行命令', powershell:'运行命令', shell:'运行命令', bash:'运行命令', exec_command:'运行命令', run_command:'运行命令',
        search:'搜索内容', grep:'搜索内容', glob:'查找文件', write:'写入文件', write_file:'写入文件', edit:'修改文件', apply_patch:'修改文件',
        ask_user_question:'请求补充信息', load_tools:'准备可用工具', web_fetch:'读取网页', web_search:'搜索网页',
        create_goal:'建立任务目标', get_goal:'查看任务目标', update_goal:'更新任务目标', todo:'整理执行计划', todo_write:'整理执行计划',
        run_code:'运行脚本', weftmod:'操作电脑应用', weftmod_script:'运行脚本', job_output:'读取后台输出', job_list:'查看后台任务', job_kill:'停止后台任务',
        spawn_agent:'启动子任务', subagent:'处理子任务', enter_plan_mode:'开始制定计划', exit_plan_mode:'提交执行计划',
        memory:'查询记忆', recall:'查询记忆', remember:'记录记忆', delete:'删除文件', remove:'删除文件',
    };
    const fieldLabels = { __proto__: null, arguments:'参数', parameters:'参数', command:'命令', cmd:'命令', script:'脚本', cwd:'执行目录', workdir:'执行目录', workingDirectory:'执行目录',
        path:'路径', paths:'路径', files:'文件', file_path:'文件路径', filePath:'文件路径', target:'目标', query:'查询内容', pattern:'匹配内容', glob:'文件范围',
        url:'网页地址', urls:'网页地址', output:'输出', content:'内容', text:'正文', type:'类型', tool:'操作', toolName:'操作', name:'名称',
        description:'说明', message:'消息', prompt:'任务说明', task:'任务', action:'操作', questions:'问题', question:'问题', header:'标题', detail:'说明',
        options:'选项', label:'名称', multiSelect:'可多选', id:'编号', selected:'已选', custom:'补充回答', answers:'回答', approval:'审批',
        status:'状态', state:'状态', reason:'原因', riskCategories:'风险类别', rootCallId:'关联操作', callId:'操作编号', approvalId:'审批编号',
        fileName:'文件名', size:'大小', contentType:'文件类型', artifactId:'成果编号', timeout:'等待时间', timeout_ms:'等待时间（毫秒）',
        exitCode:'退出状态', exit_code:'退出状态', success:'成功', error:'错误', errorCode:'错误类别', code:'类别' };
    function toolLabel(name) {
        name = String(name || '');
        return toolLabels[name] || toolActivity(name)?.summary || (/search|grep|glob/.test(name) ? '搜索内容' : /read/.test(name) ? '读取文件' : /write|save/.test(name) ? '写入文件' : /edit|patch/.test(name) ? '修改文件' : /web|browser|fetch/.test(name) ? '访问网页' : '扩展服务');
    }
    function interfaceText(value) {
        if (value == null) return '';
        const text = String(value);
        if (Object.hasOwn(toolLabels, text)) return toolLabel(text);
        if (['undefined', 'null'].includes(text)) return '未提供';
        // Translate metadata descriptions, preserving filenames and literal commands.
        return text.replace(/(?:执行工具|调用工具)(?:[:：]\s*|\s+)([A-Za-z][A-Za-z0-9_.:-]*)/g, (_, name) => toolLabel(name))
            .replace(/Weave\s*组件(?![.\w])/gi, '界面扩展');
    }
    function readableParameters(value) {
        if (Array.isArray(value)) return value.map(readableParameters);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, item], index) => [fieldLabels[key] || (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) ? `附加信息 ${index + 1}` : key),
            ['tool','toolName'].includes(key) ? toolLabel(item) : readableParameters(item)]));
    }
    function dateText(value, { year = false, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
        const date = new Date(value);
        if (value == null || !Number.isFinite(date.getTime())) return '未记录';
        const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone, year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(date).map(part => [part.type, part.value]));
        return `${year ? `${parts.year} 年 ` : ''}${parts.month} 月 ${parts.day} 日 ${parts.hour}:${parts.minute}`;
    }
    function monthText(value) { const match = /^(\d{4})-(\d{2})$/.exec(value || ''); return match ? `${match[1]} 年 ${Number(match[2])} 月` : '未记录'; }
    function dayText(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ''); return match ? `${Number(match[2])} 月 ${Number(match[3])} 日` : '未记录'; }
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
        const activity = toolActivity(name);
        if (activity) return activity.summary;
        if (/^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(name) || args.command || args.cmd)
            return `运行命令${args.command || args.cmd || args.script ? `：${short(args.command || args.cmd || args.script)}` : ''}${args.cwd || args.workdir || args.workingDirectory ? `（在 ${short(args.cwd || args.workdir || args.workingDirectory)}）` : ''}`;
        if (/(delete|remove|unlink)/i.test(name)) return `删除${suffix || '文件'}`;
        if (/(write|save|create_file)/i.test(name)) return `写入${suffix || '文件'}`;
        if (/(edit|patch|replace|modify)/i.test(name)) return `修改${suffix || '文件'}`;
        if (/^(read|read_file)$/.test(name)) return `读取${suffix || '文件'}`;
        if (/(grep|search|glob)/i.test(name)) return `搜索${args.query || args.pattern || args.glob || args.path ? ` ${short(args.query || args.pattern || args.glob || args.path)}` : '文件或内容'}`;
        if (/(web|browser|fetch|navigate)/i.test(name) || args.url) {
            const url = args.url || args.urls?.[0];
            let site = short(url || args.query || args.action);
            try { site = new URL(url).hostname; } catch { /* Keep a readable query or address. */ }
            return `访问网页${site ? ` ${site}` : ''}`;
        }
        if (/(subagent|spawn_agent|delegate|task)/i.test(name))
            return `交给子任务${args.description || args.prompt || args.task || args.message ? `：${short(args.description || args.prompt || args.task || args.message)}` : ''}`;
        return '调用扩展服务';
    }
    function toolActivity(name) {
        if (name === 'load_tools') return { summary: '准备可用工具', internal: true };
        if (/^(get_goal|create_goal|update_goal)$/.test(name)) return { summary: {get_goal:'查看任务目标',create_goal:'建立任务目标',update_goal:'更新任务目标'}[name], kind: {get_goal:'goalRead',create_goal:'goalCreate',update_goal:'goal'}[name] };
        if (/^(todo|todo_write|enter_plan_mode|exit_plan_mode)$/.test(name)) return { summary: '整理执行计划', kind: 'plan' };
        if (/^schedule_/.test(name)) return { summary: /list/.test(name) ? '查看定时安排' : /delete/.test(name) ? '删除定时安排' : '更新定时安排', kind: 'schedule' };
        if (/^job_/.test(name)) return { summary: /kill/.test(name) ? '结束后台命令' : '查看后台命令', kind: 'job' };
        if (name === 'run_code') return { summary: '运行脚本', kind: 'code' };
        if (/weftmod|desktop|computer/.test(name)) return { summary: '操作电脑应用', kind: 'computer' };
        if (/memory|remember|recall/.test(name)) return { summary: '查询或更新记忆', kind: 'memory' };
        if (name === 'ask_user_question') return { summary: '请求补充信息', kind: 'question' };
        return null;
    }
    function sourcePresentation(tool, text) {
        const args = toolArguments(text);
        return { summary: toolSummary(tool, args), raw: executionDetailText(typeof text === 'string' ? text : JSON.stringify(text, null, 2)),
            hasArguments: Object.keys(args).length > 0 };
    }

    function executionState(step) {
        if (step.state === 'failed' || step.jobState === 'failed') return 'failed';
        if (step.state === 'cancelled' || step.jobState === 'killed') return 'cancelled';
        return ['running', 'stopping'].includes(step.jobState) ? 'running' : step.state;
    }
    function progressText(steps, terminal = false) {
        const failed = steps.find(step => executionState(step) === 'failed');
        if (failed) return { text: `第 ${failed.ordinal || steps.indexOf(failed) + 1} 步失败`, failed: true, running: false };
        if (steps.some(step => executionState(step) === 'cancelled')) return { text: '已停止', running: false };
        const current = !terminal && steps.filter(step => ['running', 'pending'].includes(executionState(step))).at(-1);
        if (current) {
            const summary = toolActivity(current.toolName)?.summary || current.summary || toolSummary(current.toolName, current.arguments);
            return { text: current.approvalStatus === 'pending' ? `等待批准：${summary}` : current.jobState === 'stopping' ? `正在停止：${summary}…` : `正在${summary.replace(/^运行命令：/, '运行命令 ')}…`, running: current.approvalStatus !== 'pending' };
        }
        const counts = new Map();
        for (const step of steps) {
            const name = step.toolName || '', summary = step.summary || '';
            const activity = toolActivity(name);
            if (activity?.internal) continue;
            const kind = activity?.kind || (/^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(name) || /^运行命令/.test(summary) ? 'command'
                : /^(read|read_file)$/.test(name) || /^读取.*文件/.test(summary) ? 'read'
                : /grep|search|glob/.test(name) || /^搜索|^查找/.test(summary) ? 'search'
                : /delete|remove|unlink/.test(name) ? 'delete'
                : /write|save|create_file|edit|patch|replace|modify/.test(name) || /^写入|^修改/.test(summary) ? 'write'
                : /web|browser|fetch|navigate/.test(name) ? 'web'
                : /subagent|spawn_agent|delegate|task/.test(name) ? 'subagent' : 'extension');
            const args = toolArguments(step.arguments), paths = [...new Set([args.paths, args.files, args.file_path, args.filePath, args.path, args.target].flat().filter(value => typeof value === 'string'))];
            const amount = ['read','write','delete'].includes(kind) ? paths.length || Number(/(\d+) 个文件/.exec(summary)?.[1]) || 1 : 1;
            counts.set(kind, (counts.get(kind) || 0) + amount);
        }
        const labels = { command: n => `已运行 ${n} 个命令`, read: n => `读取了 ${n} 个文件`, search: n => `搜索了 ${n} 次`, write: n => `修改了 ${n} 个文件`, delete: n => `删除了 ${n} 个文件`, web: n => `访问了 ${n} 次网页`, subagent: n => `处理了 ${n} 个子任务`, goal: n => `更新了 ${n} 次任务目标`, goalRead: n => `查看了 ${n} 次任务目标`, goalCreate: n => `建立了 ${n} 个任务目标`, plan: n => `整理了 ${n} 次执行计划`, schedule: n => `处理了 ${n} 次定时安排`, job: n => `查看或管理了 ${n} 次后台命令`, code: n => `运行了 ${n} 次脚本`, computer: n => `操作了 ${n} 次电脑应用`, memory: n => `查询或更新了 ${n} 次记忆`, question: n => `请求了 ${n} 次补充信息`, extension: n => `调用了 ${n} 次扩展服务` };
        return { text: [...counts].map(([kind, count]) => labels[kind](count)).join('、') || (steps.length ? '工具已就绪' : ''), running: false };
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
            return Object.keys(args).length || output ? `${Object.keys(args).length ? `参数\n${JSON.stringify(readableParameters(args), null, 2)}` : ''}${output ? `\n\n输出\n${output}` : ''}`.trim() : data && typeof data === 'object' && ['arguments','parameters','output'].some(key => key in data) ? '暂无参数与输出' : text;
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
                if (toolActivity(step.toolName) || /^执行工具(?:\s|$)/.test(step.summary || '')) step.summary = toolSummary(step.toolName, step.arguments);
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
    Object.assign(globalThis.WeftUiCore, { projectTimeline, executionState, progressText, approvalProgress, executionDetailText, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, toolLabel, interfaceText, readableParameters, dateText, monthText, dayText, sourcePresentation });
    globalThis.WeftUiCore.factories.timeline = () => ({ projectTimeline, executionState, progressText, approvalProgress, executionDetailText, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, toolLabel, interfaceText, readableParameters, dateText, monthText, dayText, sourcePresentation });
})();
