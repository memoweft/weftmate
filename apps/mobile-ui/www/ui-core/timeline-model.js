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
    function toolName(name) { return String(name || '').replace(/^mcp__[^]+?__/, ''); }
    function toolLabel(name) {
        name = toolName(name);
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
    function sideResultText(result) {
        let label = {completed:'已完成',failed:'执行失败',stopped:'已停止'}[result.state] || '待核对';
        let text = String(result.summary || '').replace(/`+/g, '');
        const prefixes = /^(?:(?:成功|已完成|完成|已停止|停止|执行失败|失败|已拒绝|拒绝)\s*[：:·，,。]?\s*)+/.exec(text)?.[0] || '';
        if (result.state === 'completed' && /已停止|停止/.test(prefixes)) label = '已停止';
        if (result.state === 'completed' && /已拒绝|拒绝/.test(prefixes)) label = '已拒绝';
        text = text.replace(/(?<![./\\])\b[A-Za-z][\w]*\b(?![./\\])/g, name => Object.hasOwn(toolLabels,name) ? toolLabel(name) : name);
        // Older stored cards contain stacked status prefixes. The native state
        // owns the single displayed status, while the rest remains the summary.
        text = text.replace(/^(?:(?:成功|已完成|完成|已停止|停止|执行失败|失败|已拒绝|拒绝)\s*[：:·，,。]?\s*)+/, '').trim();
        return text ? `${label} · ${Array.from(text).slice(0,160).join('')}` : label;
    }
    globalThis.WeftUiCore.sideResultText = sideResultText;
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
    function toolSummary(tool, value, language = 'zh') {
        const args = toolArguments(value), name = toolName(tool || '工具操作');
        if (language === 'en') {
            const activity = toolActivity(name, language);
            if (activity) return activity.summary;
            const label = /^(shell|bash|pwsh|powershell|exec_command|run_command)$/.test(name) || args.command || args.cmd ? 'Run command'
                : /delete|remove|unlink/i.test(name) ? 'Delete file' : /write|save|create_file/i.test(name) ? 'Write file'
                : /edit|patch|replace|modify/i.test(name) ? 'Edit file' : /^(read|read_file)$/.test(name) ? 'Read file'
                : /grep|search|glob/i.test(name) ? 'Search files' : /web|browser|fetch|navigate/i.test(name) ? 'Visit webpage'
                : /subagent|spawn_agent|delegate|task/i.test(name) ? 'Run subtask' : 'Use extension';
            const object = args.command || args.cmd || args.file_path || args.filePath || args.path || args.query || args.url;
            return label + (typeof object === 'string' && object ? `: ${object.replace(/\s+/g, ' ').trim().slice(0, 180)}` : '');
        }
        const short = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
        const paths = [...new Set([args.paths, args.files, args.file_path, args.filePath, args.path, args.target]
            .flat().filter(value => typeof value === 'string' && value))];
        const files = paths.slice(0, 3).map(value => value.split(/[\\/]/).at(-1)).join('、');
        const suffix = paths.length ? ` ${paths.length} 个文件：${files}${paths.length > 3 ? '…' : ''}` : '';
        const activity = toolActivity(name);
        if (activity) {
            const object = short(args.title || args.subject || args.calendarName || args.calendar || args.folder || args.uid || '');
            return `${activity.summary}${args.to?.length ? `，收件人：${[].concat(args.to).map(short).join('、')}` : ''}${object ? `：${object}` : ''}`;
        }
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
        return '使用扩展工具';
    }
    function approvalSummary(tool, value) {
        const args = toolArguments(value), name = toolName(tool);
        const short = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (/^(shell|bash|pwsh|powershell|exec_command|run_command|command)$/.test(name) || args.command || args.cmd) {
            const command = String(args.command || args.cmd || args.script || '');
            const description = short(args.description) || (/^\s*(?:Get-ChildItem|ls|dir)(?:\s|$)/i.test(command) ? '列出这个文件夹里的文件' : '');
            return `运行一条命令${description && !/[{}\[\]\n]|weftmate:|\b(?:pwsh|powershell|Get-ChildItem)\b/i.test(description) ? `：${description}` : ''}`;
        }
        if (/^(list_directory|read_directory|list_dir|ls)$/.test(name)) {
            const folder = short(args.path || args.directory || args.file_path).split(/[\\/]/).filter(Boolean).at(-1);
            return `读取文件夹${folder ? `：${folder}` : ''}`;
        }
        const summary = toolSummary(tool, args);
        return summary;
    }
    function approvalCopy(row, detail) {
        const reason = String(row.reason || '');
        const offset = reason.indexOf('\n{');
        const rawArgs = offset >= 0 ? reason.slice(offset + 1) : reason;
        const args = toolArguments(detail || row.arguments || row.parameters || rawArgs);
        const humanReason = reason.replace(/^\[weftmate:[a-z,\-]+\]\s*/, '').trim();
        const service = /操作：((?:邮箱|日历) · [^\n]+)/.exec(humanReason)?.[1];
        const raw = [row.toolName, reason, detail || row.arguments || row.parameters]
            .filter(value => value != null && value !== '').map(value => typeof value === 'string' ? value : JSON.stringify(value,null,2)).join('\n');
        const explanation = humanReason.split('\n')[0].replace(/操作：.*$/, '').trim();
        const command = /^(shell|bash|pwsh|powershell|exec_command|run_command|command)$/.test(toolName(row.toolName)) || /^运行命令[:：]/.test(humanReason);
        const plain = !command && !Object.keys(args).length && !/\b(?:pwsh|powershell|shell|bash)\b|mcp__|weftmate:|[{}]|操作：|执行工具|调用工具/i.test(humanReason);
        return {summary: service && /· (?:收件人|日历)：/.test(service) ? service
            : plain && humanReason && !row.toolName?.startsWith('mcp__') ? humanReason : approvalSummary(command ? 'command' : row.toolName,args), reason: !service && !row.toolName?.startsWith('mcp__') && offset >= 0 && explanation && !/mcp__|weftmate:|\b(?:pwsh|powershell|shell|bash)\b|[{}]/i.test(explanation) ? explanation : '',raw};
    }
    function rejectedStep(step) { return step.approvalOutcome === 'rejected' || step.approvalText === '已拒绝'; }
    function chineseToolActivity(name) {
        name = toolName(name);
        if (name === 'health_query') return { summary: '查询健康数据', kind: 'health' };
        if (/^calendar_(query|list|list_events|search|events|read|free)$/.test(name)) return { summary: '查询日历', kind: 'calendar' };
        if (/^calendar_(create|update|delete)$/.test(name)) return { summary: {calendar_create:'新建日程',calendar_update:'修改日程',calendar_delete:'删除日程'}[name], kind: name };
        if (/^(mail_query|mail_list|mail_search|mail_read|email_query|email_list|email_search|email_read)$/.test(name)) return { summary: '读取邮件', kind: 'mail' };
        if (/^mail_(send|reply|forward|mark|move|delete)$/.test(name)) return { summary: {mail_send:'发送邮件',mail_reply:'回复邮件',mail_forward:'转发邮件',mail_mark:'标记邮件',mail_move:'移动邮件',mail_delete:'删除邮件'}[name], kind: name };
        if (name === 'read_local_time') return {summary:'查看当前时间',kind:'clock'};
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
    function toolActivity(name, language = 'zh') {
        const activity = chineseToolActivity(name);
        if (!activity || language !== 'en') return activity;
        const labels = { health:'Query health data', calendar:'Query calendar', mail:'Read mail', clock:'Check current time',
            calendar_create:'Create calendar event', calendar_update:'Update calendar event', calendar_delete:'Delete calendar event',
            mail_send:'Send mail', mail_reply:'Reply to mail', mail_forward:'Forward mail', mail_mark:'Mark mail', mail_move:'Move mail', mail_delete:'Delete mail',
            goalRead:'View task goal', goalCreate:'Create task goal', goal:'Update task goal', plan:'Organize execution plan',
            code:'Run script', computer:'Operate computer app', memory:'Query or update memory', question:'Request information' };
        const summary = activity.internal ? 'Prepare tools' : activity.kind === 'schedule'
            ? /list/.test(name) ? 'List schedules' : /delete/.test(name) ? 'Delete schedule' : 'Update schedule'
            : activity.kind === 'job' ? /kill/.test(name) ? 'Stop background command' : 'Check background command' : labels[activity.kind];
        return { ...activity, summary };
    }
    function textLanguage(text) {
        const prose = String(text || '').replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g, '');
        const han = (prose.match(/\p{Script=Han}/gu) || []).length;
        const words = (prose.match(/[A-Za-z]{2,}/g) || []).length;
        return han ? words > han ? 'en' : 'zh' : words >= 1 ? 'en' : null;
    }
    globalThis.WeftUiCore.textLanguage = textLanguage;
    function progressLanguage(events, block) {
        const session = block.steps[0]?.sessionId;
        const belongs = event => !session || (event.sessionId || event.sourceRef?.sessionId) === session;
        const start = events.filter(event => belongs(event) && event.type === 'turn.started' && event.seq <= block.seq).at(-1);
        const next = events.find(event => belongs(event) && event.type === 'turn.started' && event.seq > block.seq);
        const messages = events.filter(event => belongs(event) && event.seq >= (start?.seq ?? -Infinity) && event.seq < (next?.seq ?? Infinity));
        const reply = messages.filter(event => ['assistant.message','assistant.delta'].includes(event.type) && event.data?.text && !messages.some(next=>next.seq>event.seq && next.type.startsWith('step.'))).at(-1);
        const user = messages.filter(event => event.type === 'user.message' && event.seq <= block.seq).at(-1);
        return textLanguage(reply?.data.text) || textLanguage(user?.data.text) || 'zh';
    }
    function progressWaitingText(value, language) {
        if (language !== 'en') return value;
        let text = String(value || '');
        const labels = {'等待模型回复…':'Waiting for the model…','正在读取记忆…':'Reading memory…','模型响应慢，正在重试…':'The model is slow; retrying…','正在思考…':'Thinking…','正在回复…':'Replying…','等待接续':'Waiting to resume','正在停止…':'Stopping…'};
        for (const [source, target] of Object.entries(labels)) text = text.replace(source, target);
        text = text.replace(/^正在加载模型(.*?)…/, 'Loading model$1…').replace(/模型排队中，前面还有 (\d+) 个请求/, 'Queued; $1 requests ahead').replace(/(\d+) 秒$/, '$1 s');
        return text;
    }
    globalThis.WeftUiCore.progressWaitingText = progressWaitingText;
    function sourcePresentation(tool, text) {
        const args = toolArguments(text);
        return { summary: toolSummary(tool, args), raw: executionDetailText(typeof text === 'string' ? text : JSON.stringify(text, null, 2)),
            hasArguments: Object.keys(args).length > 0 };
    }

    // Presentation only: native task, step and job records remain untouched.
    function executionState(step) {
        const reason = step.stopReason || step.endReasonKind || step.reason?.kind || step.reason || '';
        if (['cancelled','canceled','aborted','stopped','killed','terminated','replaced'].includes(step.state) ||
            ['killed','cancelled','stopped'].includes(step.jobState) ||
            /^(aborted|cancelled|canceled|interrupted|terminated|stopped|replaced|superseded)$/.test(reason) ||
            step.interrupted === true || step.signal === 'SIGINT' || step.signal === 'SIGTERM' || [130,143].includes(step.exitCode)) return 'cancelled';
        if (step.state === 'failed' || step.jobState === 'failed') return 'failed';
        return ['running', 'stopping'].includes(step.jobState) ? 'running' : step.state;
    }
    function executionPresentation(step, records = []) {
        const record = records.find(row=>row.callId === (step.callId || step.stepId) &&
            (!step.sessionId || row.sessionId === step.sessionId) && (!step.turn || row.turn === step.turn));
        return record ? { ...step, ...(record.state === 'cancelled' ? {state:'cancelled'} : {}),
            jobState:record.jobState ?? step.jobState, stopReason:record.stopReason ?? step.stopReason,
            signal:record.signal ?? step.signal, exitCode:record.exitCode ?? step.exitCode } : step;
    }
    function interruptionFromDetail(text, step) {
        if (step && executionState(step) !== 'failed') return false;
        try {
            const data = JSON.parse(text);
            const interrupted = value => {
                if (typeof value === 'string') {
                    try { const parsed=JSON.parse(value); if(parsed!==value && interrupted(parsed)) return true; } catch { /* Native text output. */ }
                    return /(?:signal|信号)\s*[:=]?\s*SIG(?:INT|TERM)\b|(?:command|process|job|execution|operation|用户|使用者|命令|进程).{0,60}(?:interrupt(?:ed)?\b|cancel(?:led|ed)\b|terminated\b|killed\b|中断|终止|已停止)/i.test(value);
                }
                if (Array.isArray(value)) return value.some(interrupted);
                if (!value || typeof value !== 'object') return false;
                if (['SIGINT','SIGTERM'].includes(value.signal) || [130,143].includes(value.exitCode ?? value.exit_code) || ['killed','cancelled','canceled','interrupted','terminated'].includes(value.status)) return true;
                return [value.text,value.content,value.output,value.result,value.value,value.error,value.message,value.stderr].some(interrupted);
            };
            return interrupted(data.output ?? data.result);
        } catch { return false; }
    }
    function turnOutcome(events, taskId, stopView) {
        const matches = event => event.data?.taskId === taskId ||
            event.type === 'turn.ended' && (taskId === `turn-${event.data?.turn}` || taskId?.endsWith(`:turn-${event.data?.turn}`)) &&
            (!(event.sessionId || event.sourceRef?.sessionId) || !taskId.includes(':') || taskId.startsWith(`${event.sessionId || event.sourceRef?.sessionId}:`));
        const end = events.filter(event => ['task.ended','turn.ended'].includes(event.type) && matches(event)).at(-1);
        if (stopView?.terminal && stopView.text === '已停止' && end?.data?.reason !== 'completed') return {terminal:true,reason:'aborted'};
        if (stopView?.terminal && !end) return {terminal:true,reason:stopView.text==='已结束'?'completed':'aborted'};
        return end ? { terminal: true, reason: end.data?.reason, endReasonKind: end.data?.endReasonKind } : { terminal: false };
    }
    function classifyProgress(steps, outcome = {}) {
        if (typeof outcome === 'boolean') outcome = { terminal: outcome };
        const reason = outcome.reason?.kind || outcome.reason || outcome.status;
        const stopped = ['aborted','cancelled','canceled','stopped','killed'].includes(reason);
        const completed = reason === 'completed';
        const failed = ['error','failed','blocked'].includes(reason);
        return { terminal: outcome.terminal === true || stopped || completed || failed,
            state: failed ? 'failed' : stopped ? 'stopped' : completed ? 'completed' : outcome.terminal ? 'ended' : 'running',
            retries: steps.filter(step => executionState(step) === 'failed' && !rejectedStep(step)).length };
    }
    function stepPresentation(step, outcome) {
        const progress = classifyProgress([step], outcome), state = executionState(step), rejected = rejectedStep(step);
        const english = (outcome?.language || step.language) === 'en';
        if (english) step = { ...step, language:'en', summary: toolSummary(step.toolName, step.arguments, 'en'),
            approvalText: ({'已批准':'Approved','已拒绝':'Declined','已取消':'Cancelled','已失效':'Expired','等待批准':'Awaiting approval'})[step.approvalText] || step.approvalText };
        if (rejected) return { ...step, state:'rejected', summary:english ? `You declined ${toolSummary(step.toolName,step.arguments,'en')}`:`${toolLabel(step.toolName)}被你拒绝了`,statusText:'',approvalText:'' };
        if (state === 'cancelled' || progress.state === 'stopped' && ['running','pending','failed'].includes(state))
            return { ...step, state: 'cancelled', statusText: english ? 'Interrupted' : '已中断' };
        if (state === 'failed') return { ...step, state: progress.state === 'failed' ? 'failed' : 'issue',
            statusText: english ? progress.state === 'completed' ? 'Continued another way' : progress.terminal ? 'Encountered an issue' : 'Encountered an issue; continuing'
                : progress.state === 'completed' ? '已换办法继续' : progress.terminal ? '遇到问题' : '遇到问题，正在继续' };
        return { ...step, statusText: state === 'running' && !progress.terminal ? english ? 'Running' : '运行中' : '' };
    }
    function progressText(steps, outcome = false) {
        const language = outcome?.language || steps[0]?.language || 'zh', english = language === 'en';
        const progress = classifyProgress(steps, outcome);
        const rejected = steps.filter(rejectedStep);
        if (rejected.length) {
            const remaining = steps.filter(step => !rejectedStep(step));
            const other = progressText(remaining, outcome);
            const refusal = rejected.map(step => english ? `You declined ${toolSummary(step.toolName,step.arguments,language)}` : `${toolLabel(step.toolName)}被你拒绝了`).join(english ? '; ' : '；');
            return {...other,text:[refusal,['已完成','工具已就绪','Completed','Tools ready'].includes(other.text) ? '' : other.text].filter(Boolean).join(' · ')};
        }
        const failed = steps.find(step => executionState(step) === 'failed');
        if (progress.state === 'failed') {
            const problem = failed?.summary || '这次回复';
            const limit = outcome.endReasonKind === 'max-tokens';
            if (english) return { text: limit ? 'Reply incomplete: the response length limit was reached. You can ask me to continue.'
                : `Could not finish: ${failed ? toolSummary(failed.toolName,failed.arguments,language) : 'this reply'} encountered an issue. You can ask me to retry.`, failed:true, running:false };
            return { text: limit ? '回复未完成：内容超出了本次可回复的长度，可以让我接着做。'
                : `未能完成：${problem}遇到问题，可以让我重试或补充说明。`, failed: true, running: false };
        }
        if (progress.state === 'stopped') return { text: english ? 'Interrupted' : '已中断', running: false };
        if (failed && !progress.terminal) return { text: english ? `Step ${failed.ordinal || steps.indexOf(failed) + 1} encountered an issue; continuing` : `第 ${failed.ordinal || steps.indexOf(failed) + 1} 步遇到问题，正在继续`, running: true };
        if (!progress.terminal && steps.some(step => executionState(step) === 'cancelled') &&
            !steps.some(step => ['running','pending'].includes(executionState(step)))) return { text: english ? 'Interrupted' : '已中断', running: false };
        const current = (!progress.terminal || steps.some(step=>['running','stopping'].includes(step.jobState))) && steps.filter(step => ['running', 'pending'].includes(executionState(step))).at(-1);
        if (current) {
            const summary = toolActivity(current.toolName, language)?.summary || (english ? toolSummary(current.toolName,current.arguments,language) : current.summary) || toolSummary(current.toolName, current.arguments);
            if (english) return { text: `${current.approvalStatus === 'pending' ? 'Awaiting approval: ' : current.jobState === 'stopping' ? 'Stopping: ' : ''}${summary}…`, running:current.approvalStatus !== 'pending' };
            return { text: current.approvalStatus === 'pending' ? `等待批准：${summary}` : current.jobState === 'stopping' ? `正在停止：${summary}…` : `正在${summary.replace(/^运行命令：/, '运行命令 ')}…`, running: current.approvalStatus !== 'pending' };
        }
        const counts = new Map();
        for (const step of steps) {
            if (progress.terminal && ['failed','cancelled'].includes(executionState(step))) continue;
            const name = toolName(step.toolName), summary = step.summary || '';
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
        const labels = { health: n => n === 1 ? '查了健康数据' : `查了 ${n} 次健康数据`, calendar: n => n === 1 ? '查了日历' : `查了 ${n} 次日历`, mail: n => n === 1 ? '读了邮件' : `读了 ${n} 次邮件`, clock: n => `查看了 ${n} 次当前时间`, calendar_create: n => `新建了 ${n} 次日程`, calendar_update: n => `修改了 ${n} 次日程`, calendar_delete: n => `删除了 ${n} 次日程`, mail_send: n => `发送了 ${n} 次邮件`, mail_reply: n => `回复了 ${n} 次邮件`, mail_forward: n => `转发了 ${n} 次邮件`, mail_mark: n => `标记了 ${n} 次邮件`, mail_move: n => `移动了 ${n} 次邮件`, mail_delete: n => `删除了 ${n} 次邮件`, command: n => `已运行 ${n} 个命令`, read: n => `读取了 ${n} 个文件`, search: n => `搜索了 ${n} 次`, write: n => `修改了 ${n} 个文件`, delete: n => `删除了 ${n} 个文件`, web: n => `访问了 ${n} 次网页`, subagent: n => `处理了 ${n} 个子任务`, goal: n => `更新了 ${n} 次任务目标`, goalRead: n => `查看了 ${n} 次任务目标`, goalCreate: n => `建立了 ${n} 个任务目标`, plan: n => `整理了 ${n} 次执行计划`, schedule: n => `处理了 ${n} 次定时安排`, job: n => `查看或管理了 ${n} 次后台命令`, code: n => `运行了 ${n} 次脚本`, computer: n => `操作了 ${n} 次电脑应用`, memory: n => `查询或更新了 ${n} 次记忆`, question: n => `请求了 ${n} 次补充信息`, extension: n => n === 1 ? '用了一个扩展工具' : `用了 ${n} 次扩展工具` };
        const englishLabels = { health:['Queried','health record'], calendar:['Queried','calendar'], mail:['Read','mail item'], clock:['Checked','time'],
            calendar_create:['Created','calendar event'], calendar_update:['Updated','calendar event'], calendar_delete:['Deleted','calendar event'],
            mail_send:['Sent','email'],mail_reply:['Replied to','email'],mail_forward:['Forwarded','email'],mail_mark:['Marked','email'],mail_move:['Moved','email'],mail_delete:['Deleted','email'],
            command:['Ran','command'],read:['Read','file'],search:['Performed','search'],write:['Updated','file'],delete:['Deleted','file'],web:['Visited','webpage'],subagent:['Handled','subtask'],
            goal:['Updated','task goal'],goalRead:['Viewed','task goal'],goalCreate:['Created','task goal'],plan:['Organized','execution plan'],schedule:['Handled','scheduling action'],job:['Checked','background command'],code:['Ran','script'],computer:['Performed','computer action'],memory:['Queried or updated','memory item'],question:['Requested','clarification'],extension:['Used','extension'] };
        const text = [...counts].map(([kind, count]) => english ? `${englishLabels[kind][0]} ${count} ${englishLabels[kind][1]}${count === 1 ? '' : kind === 'search' ? 'es' : 's'}` : labels[kind](count)).join(english ? ', ' : '、')
            || (progress.state === 'completed' ? english ? 'Completed' : '已完成' : steps.length ? english ? 'Tools ready' : '工具已就绪' : '');
        return { text: text + (progress.state === 'completed' && progress.retries ? english ? ` · ${progress.retries} retried step(s)` : ` · 中途有 ${progress.retries} 步重试` : ''), running: false };
    }
    function approvalProgress(row) {
        return ({ 'allowed-once': '已批准', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' })[row?.outcome || row?.decisionOutcome] || (row?.status === 'pending' ? '等待批准' : '');
    }
    function groupConsecutiveSteps(steps) {
        const groups = [];
        for (const step of steps) {
            const name = toolName(step.toolName), kind = /^(read|read_file)$/.test(name) ? 'read' : name;
            let group = groups.at(-1);
            if (!group || group.kind !== kind) { group = { kind, steps: [] }; groups.push(group); }
            group.steps.push(step);
        }
        for (const group of groups) {
            const first = group.steps[0], count = group.steps.length, english = first.language === 'en';
            const same = group.steps.every(step => step.summary === first.summary);
            const paths = new Set(group.steps.flatMap(step => {
                const args = toolArguments(step.arguments);
                return [args.paths,args.files,args.file_path,args.filePath,args.path].flat().filter(value => typeof value === 'string' && value);
            }));
            group.summary = count === 1 ? first.summary : same ? `${first.summary} · ${count} ${english ? 'times' : '次'}`
                : group.kind === 'read' && paths.size ? english ? `Read ${paths.size} files · ${count} times` : `读取了 ${paths.size} 个文件 · ${count} 次`
                : `${toolActivity(first.toolName, first.language)?.summary || (english ? toolSummary(first.toolName, {}, 'en') : toolLabel(first.toolName))} · ${count} ${english ? 'times' : '次'}`;
        }
        return groups;
    }
    globalThis.WeftUiCore.groupConsecutiveSteps = groupConsecutiveSteps;
    function progressPosition(events, block, chronological = false) {
        if (chronological) return Number.isFinite(block.replySeq) ? Math.min(block.seq,block.replySeq-0.01) : block.seq;
        if (!turnOutcome(events, block.taskId).terminal) return block.seq;
        const session = block.steps[0]?.sessionId;
        const end = events.filter(event => ['turn.ended','task.ended'].includes(event.type) && turnOutcome([event],block.taskId).terminal).at(-1);
        const next = events.find(event => event.seq > block.seq && event.type === 'turn.started' &&
            (!session || (event.sessionId || event.sourceRef?.sessionId) === session));
        const reply = events.filter(event => event.type === 'assistant.message' && event.data?.streaming !== true && event.seq > block.seq &&
            (!session || (event.sessionId || event.sourceRef?.sessionId) === session) &&
            (!next || event.seq < next.seq) && (!end || event.seq <= end.seq) &&
            (!event.data?.taskId || event.data.taskId === block.taskId)).at(-1);
        return reply ? reply.seq + 0.01 : block.seq;
    }
    // Native uses the web projection and wording through its embedded UI engine.
    // Kotlin never maintains a second tool-name mapping.
    function nativeTimelineRows(events, approvals = [], questions = []) {
        const normalized = events.map((event, index) => ({...event, seq:index, sourceSeq:event.seq,
            data:{...event.data, ...(event.data?.completedStep ? {completedStep:{...event.data.completedStep}} : {}), ...(event.type.startsWith('tool.') ? {
                stepId:event.data?.stepId || event.data?.callId || `tool-${index}`,
                taskId:event.data?.taskId || `turn-${event.data?.turn || 0}`,
                state:event.data?.state || (event.type.endsWith('started')?'running':event.type.endsWith('failed')?'failed':'completed')
            }: {})}, type:event.type.replace(/^tool\./,'step.')}));
        for (const event of normalized) {
            const session = event.sessionId || event.sourceRef?.sessionId || '';
            for (const data of [event.data,event.data?.completedStep].filter(Boolean))
                if (session && data.taskId?.startsWith('turn-')) data.taskId = `${session}:${data.taskId}`;
        }
        const projected = projectTimeline(normalized, approvals), tasks = new Map();
        for (const group of projected.groups) {
            const key = group.taskId || `progress-${group.seq}`;
            if (!tasks.has(key)) tasks.set(key,{...group,steps:[]});
            tasks.get(key).steps.push(...group.steps);
        }
        const rows = normalized.filter(event => ['user.message','assistant.message','assistant.delta','artifact.created','approval.requested','question.requested'].includes(event.type))
            .map(event => ({...event, data:{...event.data,completedStep:undefined}, presentationSeq:event.seq}));
        for (const block of tasks.values()) {
            const outcome = turnOutcome(normalized,block.taskId), view = progressText(block.steps,outcome);
            const steps = block.steps.map(step => ({...stepPresentation(step,outcome),summary:toolSummary(step.toolName,step.arguments,step.language),
                attention:!rejectedStep(step) && executionState(step)==='failed' || step.approvalStatus==='pending'}));
            rows.push({eventId:`progress:${block.taskId || block.seq}`,type:'native.progress',at:normalized[block.seq]?.at,
                sourceRef:normalized[block.seq]?.sourceRef,presentationSeq:progressPosition(normalized,block),
                data:{taskId:block.taskId,summary:view.text || '回复已结束',running:view.running,failed:!!view.failed,steps}});
        }
        for (const [decisions,family,id] of [[approvals,'approval','approvalId'],[questions,'question','questionRpcId']])
            for (const decision of decisions) if (!rows.some(row=>row.data?.[id]===decision[id]))
                rows.push({eventId:`${family}:${decision[id]}`,type:`${family}.requested`,at:decision.createdAt,data:decision,presentationSeq:normalized.length});
        for (const row of rows.filter(row => row.type === 'approval.requested')) {
            const decision = approvals.find(value => value.approvalId === row.data?.approvalId) || row.data;
            const step = normalized.filter(event=>event.type.startsWith('step.')).map(event=>event.data)
                .find(step=>step?.detailRef && (step.callId === decision.callId || step.stepId === decision.callId));
            if (decision.toolName) row.data = {...row.data,copy:approvalCopy(decision,step?.arguments)};
        }
        return rows.sort((a,b)=>a.presentationSeq-b.presentationSeq);
    }
    Object.assign(globalThis.WeftUiCore, {progressPosition,nativeTimelineRows});
    function executionDetailText(text, language = 'zh') {
        try {
            const data = JSON.parse(text), args = toolArguments(data);
            const collect = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(collect)
                : value?.type === 'text' ? [value.text || ''] : value?.content ? collect(value.content) : [];
            const output = collect(data.output).filter(Boolean).join('\n');
            const english = language === 'en';
            return Object.keys(args).length || output ? `${Object.keys(args).length ? `${english ? 'Parameters' : '参数'}\n${JSON.stringify(english ? args : readableParameters(args), null, 2)}` : ''}${output ? `\n\n${english ? 'Output' : '输出'}\n${output}` : ''}`.trim() : data && typeof data === 'object' && ['arguments','parameters','output'].some(key => key in data) ? english ? 'No parameters or output' : '暂无参数与输出' : text;
        } catch { return text; }
    }
    function projectTimeline(events, approvals = [], mergeTurns = false) {
        const ordered = [...events].filter(event => !(event.type === 'task.queued' && event.data?.inherited)).sort((a, b) => a.seq - b.seq), groups = [], steps = new Map();
        let group = null;
        const ordinals = new Map();
        for (const raw of ordered) {
            const event = raw.type === 'artifact.created' && raw.data?.completedStep ? { ...raw, type: 'step.completed', data: raw.data.completedStep } : raw;
            if (event.type.startsWith('step.')) {
                const data = event.data || {}, key = `${data.taskId}/${data.stepId}`;
                let step = steps.get(key);
                if (!step) {
                    if (mergeTurns) group = groups.find(item=>item.taskId===data.taskId) || null;
                    if (!group || group.taskId !== data.taskId) {
                        group = { seq: event.seq, taskId: data.taskId, steps: [] };
                        groups.push(group);
                    }
                    const ordinal = (ordinals.get(data.taskId) || 0) + 1;
                    ordinals.set(data.taskId, ordinal);
                    step = { ...data, sessionId:event.sessionId || event.sourceRef?.sessionId, ordinal, at: event.at, endAt: event.type === 'step.completed' ? event.at : null };
                    group.steps.push(step);
                    steps.set(key, step);
                }
                else {
                    Object.assign(step, data);
                    if (event.type === 'step.completed')
                        step.endAt = event.at;
                }
                if (toolActivity(step.toolName) || /^执行工具(?:\s|$)/.test(step.summary || '') || step.summary === '调用扩展服务') step.summary = toolSummary(step.toolName, step.arguments);
            }
            else if (!['turn.started', 'turn.ended', 'task.started', 'task.ended', 'approval.requested', 'approval.resolved'].includes(event.type))
                group = null;
        }
        for (const step of steps.values()) {
            const request = ordered.find(event => event.type === 'approval.requested' && event.data?.callId &&
                (!event.data.taskId || event.data.taskId === step.taskId) && (event.data.callId === step.stepId || event.data.callId === step.callId));
            const row = approvals.find(row => row.callId && (row.callId === step.stepId || row.callId === step.callId) &&
                (!row.sessionId || !step.sessionId || row.sessionId === step.sessionId) &&
                (!row.turn || step.taskId === `turn-${row.turn}` || step.taskId === `${row.sessionId}:turn-${row.turn}` || row.taskId === step.taskId));
            const resolved = request && ordered.find(event => event.type === 'approval.resolved' && event.data?.approvalId === request.data.approvalId);
            const record = row || resolved?.data || request && { status: 'pending' };
            step.approvalText = approvalProgress(record);
            step.approvalOutcome = record?.outcome || record?.decisionOutcome;
            if (record?.reason) step.approvalSummary = approvalCopy({...record,toolName:step.toolName}).summary;
            step.approvalStatus = row?.status || (resolved ? 'resolved' : request ? 'pending' : undefined);
        }
        const cards = [], outputs = new Map();
        let turnKey = 'history';
        for (const event of ordered) {
            if (event.type === 'turn.started') turnKey = `${event.sessionId || event.sourceRef?.sessionId || ''}:turn-${event.data?.turn ?? event.seq}`;
            if (event.type === 'task.queued') {
                const data = event.data || {}, queued = data.tasks || [data];
                const pending = queued.filter(task => !ordered.some(next => {
                    const session = event.sessionId || event.sourceRef?.sessionId, nextSession = next.sessionId || next.sourceRef?.sessionId;
                    if (next.seq <= event.seq || nextSession && session && nextSession !== session) return false;
                    const id = task.receiptId || task.taskId;
                    if (!id) return false;
                    return ['user.message','task.started','task.ended','step.started','step.completed'].includes(next.type) &&
                        (next.data?.receiptId === id || next.data?.taskId === id);
                }));
                if (pending.length) cards.push({...event, data:{...pending[0], ...(pending.length > 1 ? {tasks:pending} : {})}});
                continue;
            }
            if (event.type !== 'artifact.created') { cards.push(event); continue; }
            const data = event.data || {};
            if (/^(read|read_file|move|rename|delete|remove)$/.test(data.completedStep?.toolName || '')) continue;
            const key = data.completedStep?.taskId || data.taskId || turnKey;
            let bundle = outputs.get(key);
            if (!bundle) { bundle = { ...event, data: { ...data, taskId:key, artifactId: `summary:${key}`, artifacts: [] } }; outputs.set(key,bundle); cards.push(bundle); }
            bundle.data.artifacts.push(...(data.artifacts || [data.artifact || data]));
            bundle.seq = event.seq;
        }
        for (const block of groups) {
            if(mergeTurns) {
                const session=block.steps[0]?.sessionId;
                const belongs=event=>!session || (event.sessionId || event.sourceRef?.sessionId)===session;
                const start=ordered.findLast(event=>belongs(event) && event.type==='turn.started' && event.seq<=block.seq);
                const next=ordered.find(event=>belongs(event) && event.type==='turn.started' && event.seq>block.seq);
                block.replySeq=ordered.find(event=>belongs(event) && event.type==='assistant.message' && event.seq>(start?.seq ?? -Infinity) && (!next || event.seq<next.seq))?.seq;
            }
            const language = progressLanguage(ordered, block);
            block.language = language;
            for (const step of block.steps) {
                step.language = language;
                if(step.toolName==='__thinking') step.summary=language==='en'?'Thinking':'思考过程';
                else if(step.toolName==='__progress') step.summary=language==='en'?'Progress update':'进展说明';
                else if(language==='en' || textLanguage(step.summary)==='en') step.summary=toolSummary(step.toolName,step.arguments,language);
            }
        }
        return { ordered, groups, cards };
    }
    function finalArtifacts(artifacts) {
        const latest = new Map();
        for (const file of artifacts || []) {
            if (!file?.artifactId || ['read','move','rename','delete'].includes(file.operation || file.action) ||
                ['source','intermediate'].includes(file.role) || ['superseded','deleted','replaced'].includes(file.state) || file.supersededBy || file.exists === false && file.finalDelivery === false) continue;
            const location = file.filePath || file.relativePath || file.path;
            const key = location || file.artifactId;
            latest.set(key,file);
        }
        return [...latest.values()];
    }
    function artifactFamilies(artifacts) {
        const groups = new Map();
        for (const file of finalArtifacts(artifacts)) {
            const name = file.fileName || file.name || '成果文件', location = file.filePath || file.relativePath || file.path || '';
            const folder = location.replace(/\\/g,'/').replace(/[^/]*$/,'');
            const stem = name.replace(/\.[^.]+$/, '').replace(/[-_ ]v\d+$/i,'');
            const key = `${folder}/${stem}`;
            if (!groups.has(key)) groups.set(key,[]);
            groups.get(key).push(file);
        }
        return [...groups.values()];
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
    Object.assign(globalThis.WeftUiCore, { projectTimeline, progressLanguage, executionState, executionPresentation, interruptionFromDetail, turnOutcome, classifyProgress, stepPresentation, finalArtifacts, artifactFamilies, progressText, approvalProgress, executionDetailText, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, approvalSummary, approvalCopy, toolLabel, interfaceText, readableParameters, dateText, monthText, dayText, sourcePresentation });
    globalThis.WeftUiCore.factories.timeline = () => ({ projectTimeline, progressLanguage, executionState, executionPresentation, interruptionFromDetail, turnOutcome, classifyProgress, stepPresentation, finalArtifacts, artifactFamilies, progressText, approvalProgress, executionDetailText, sessionGroup, sortSessions, resourceReferences, toolArguments, toolSummary, approvalSummary, approvalCopy, toolLabel, interfaceText, readableParameters, dateText, monthText, dayText, sourcePresentation });
})();
