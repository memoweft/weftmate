/* Shared tasks state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.tasks = (core, effects, environment) => {
    function taskQueue(events = core.timelineEventsForContext(), commands = core.state.tasks) {
        const sessionId = core.conversationTaskContext().sessionId;
        const rows = new Map();
        const roots = commands.filter(row => row.kind === 'session.message' && !row.rootTaskId && row.sessionId === sessionId);
        const root = data => roots.find(row => row.commandId === data.taskId || data.receiptId && row.receiptId === data.receiptId);
        for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
            if (!['task.queued', 'task.started', 'task.ended'].includes(event.type)) continue;
            for (const data of event.data?.tasks || [event.data || {}]) {
                const command = root(data), taskId = command?.commandId || data.taskId;
                if (!taskId) continue;
                const previous = rows.get(taskId) || {};
                rows.set(taskId, { ...previous, taskId, receiptId: data.receiptId || command?.receiptId || previous.receiptId,
                    text: data.text || previous.text || command?.text || command?.taskLabel || '排队任务',
                    seq: previous.seq ?? event.seq, queued: previous.queued || event.type === 'task.queued',
                    state: event.type === 'task.queued' ? 'queued' : event.type === 'task.started' ? 'running' :
                        ['canceled', 'cancelled'].includes(data.reason) ? 'cancelled' : 'ended', reason: data.reason });
            }
        }
        return [...rows.values()].sort((a, b) => a.seq - b.seq).map(row => {
            const scope = JSON.stringify([core.state.ownerId, core.state.identityGeneration, sessionId]);
            const operation = core.queueOperationScope === scope ? core.queueOperations?.get(row.taskId) : null;
            return { ...row, ...(operation?.cancelled && row.state === 'queued' ? { state: 'cancelled' } : {}),
                busy: operation?.busy === true, notice: operation?.notice || '' };
        });
    }
    async function cancelQueuedTask(taskId) {
        const context = core.conversationTaskContext(), row = core.taskQueue().find(row => row.taskId === taskId);
        if (!core.conversationTaskCurrent(context) || !row || row.state !== 'queued') return false;
        const key = JSON.stringify([context.ownerId, context.identity, context.sessionId]);
        if (core.queueOperationScope !== key) { core.queueOperationScope = key; core.queueOperations = new Map(); }
        const operation = core.queueOperations.get(taskId) || { requestId: environment.crypto.randomUUID() };
        if (operation.busy) return false;
        operation.busy = true; operation.notice = '';
        core.queueOperations.set(taskId, operation);
        effects.renderConversationTasks();
        try {
            await core.accessApi(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
                method: 'POST', protectedWrite: true, body: { requestId: operation.requestId } });
            if (!core.conversationTaskCurrent(context)) return false;
            operation.cancelled = true;
            return true;
        } catch (error) {
            if (core.conversationTaskCurrent(context)) {
                operation.notice = error.status === 409 ? '已经开始，可以用停止' : error.code === 'NETWORK'
                    ? '取消结果待确认，可重试核对原请求。' : '取消未完成，请重试。';
                effects.toast(operation.notice);
            }
            return false;
        } finally {
            operation.busy = false;
            if (core.conversationTaskCurrent(context)) effects.renderConversationTasks();
        }
    }
    async function editQueuedTask(taskId) {
        const row = core.taskQueue().find(row => row.taskId === taskId);
        return row && await core.cancelQueuedTask(taskId) ? row.text : null;
    }
    function messageTaskLabel(event) {
        const command = core.state.tasks.find(row => row.sessionId === core.conversationTaskContext().sessionId &&
            row.receiptId && row.receiptId === event.data?.receiptId);
        return event.data?.taskAction === 'supplement' || command?.taskAction === 'supplement'
            ? '已补充到当前任务' : '';
    }
    function commandTitle(command) {
        if (command.kind === 'desktop.write_artifact')
            return command.fileName || '电脑生成的文件';
        if (command.kind === 'desktop.open_app')
            return '在电脑打开记事本';
        if (command.kind === 'session.create')
            return '新建对话';
        if (command.kind === 'session.message')
            return !command.rootTaskId && typeof command.taskLabel === 'string' && command.taskLabel
                ? command.taskLabel : '发送消息';
        if (command.kind === 'session.cancel')
            return '请求停止回复';
        return '请求';
    }
    function commandStatus(command) {
        if (command.kind === 'desktop.write_artifact') {
            return command.state === 'observed' && command.verification?.status === 'observed' &&
                command.verification?.method === 'sha256_readback' ? '文件已由电脑写入并读回核验。'
                : command.state === 'rejected' ? '文件未生成。' : '文件尚未完成读回核验。';
        }
        switch (command.state) {
            case 'pending': return '请求已记录，等待派发。';
            case 'dispatching': return '正在交给电脑执行。';
            case 'accepted_by_dsh':
                if (command.kind === 'session.create')
                    return '新对话已创建。';
                if (command.kind === 'session.message')
                    return '消息已送达，回复见原会话。';
                if (command.kind === 'session.cancel')
                    return '停止请求已受理，实际状态见会话。';
                return '请求已受理。';
            case 'accepted_by_host': return '电脑已接收启动请求，窗口尚未核验。';
            case 'observed':
                if (command.kind === 'desktop.open_app') {
                    if (command.verification?.status === 'observed' && command.verification?.method === 'visible_window') {
                        return command.verification.outcome === 'already_open'
                            ? '记事本已在电脑上打开，窗口已核验。' : '记事本窗口已打开并核验。';
                    }
                    return '动作状态已更新，窗口仍待核对。';
                }
                return '已从原会话观察到结果。';
            case 'uncertain': return '结果待确认。请先查看原会话或电脑，不会自动重复执行。';
            case 'rejected':
                if (command.errorCode === 'SESSION_READ_ONLY')
                    return '旧会话只供阅读；请新建受限远端会话后继续。';
                if (command.errorCode === 'MODEL_UNAVAILABLE')
                    return '电脑没有可用模型，请先在电脑设置中配置。';
                if (command.errorCode === 'RUNTIME_UNAVAILABLE')
                    return '电脑运行时不可用，请稍后再试。';
                if (command.errorCode === 'CAPABILITY_UNAVAILABLE')
                    return '这项电脑能力目前不可用。';
                return '请求未执行，请核对电脑状态。';
            default: return '正在核对请求状态。';
        }
    }
    function taskReplyText(evidence) {
        switch (evidence?.status) {
            case 'waiting': return '回复：电脑会话正在等待模型输出。';
            case 'streaming': return `回复：模型正在生成${evidence.lastChunkAt ? `，最近输出于 ${core.formatDate(evidence.lastChunkAt)}` : ''}；尚未见到结束记录。`;
            case 'completed': return evidence.assistantMessages > 0
                ? '回复：电脑会话已正常结束。' : '回复：回合已结束，但没有已核对的最终文字回复。';
            case 'aborted': return '回复：回合已中断；已核验的文件仍可查看。';
            case 'blocked': return '回复：模型请求被阻断，尚无正常结束记录。';
            case 'failed': return evidence.endReasonKind === 'max-tokens'
                ? '回复：因输出限制结束，尚未确认完整交付。' : '回复：模型回合未完成；请查看原会话的错误。';
            default: return '回复：是否结束尚无法核对；请勿把已核验文件当作回复完成。';
        }
    }
    function conversationTaskContext() {
        const conversationId = core.state.activeChatSource === 'phone' ? core.state.selectedPhoneConversationId : null;
        const sessionId = conversationId ? core.phoneBinding(conversationId)?.sessionId : core.state.selectedSessionId;
        return { sessionId, conversationId, source: core.state.activeChatSource,
            ownerId: core.state.ownerId, identity: core.state.identityGeneration, history: core.state.historyGeneration };
    }
    function conversationTaskCurrent(context) {
        const current = core.conversationTaskContext();
        return core.state.currentView === 'assistant' && !!core.state.csrfToken && context.ownerId === current.ownerId &&
            context.identity === current.identity && context.sessionId === current.sessionId &&
            context.conversationId === current.conversationId && context.source === current.source && context.history === current.history;
    }
    function relatedExecutionSteps(payload) {
        const commands = [payload.source, ...(Array.isArray(payload.supplements) ? payload.supplements : []),
            ...(Array.isArray(payload.resumes) ? payload.resumes : [])].filter((row) => row?.kind === 'session.message' &&
            row.sessionId === payload.sessionId && (row.commandId === payload.taskId && !row.rootTaskId || row.rootTaskId === payload.taskId));
        return (Array.isArray(payload.executionSteps) ? payload.executionSteps : []).filter((row) => row &&
            typeof row.executionId === 'string' && row.executionId.length > 0 && row.executionId.length <= 256 &&
            typeof row.toolName === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(row.toolName) &&
            ['running', 'completed', 'failed', 'cancelled', 'uncertain'].includes(row.state) &&
            commands.some((command) => command.commandId === row.sourceCommandId &&
                core.receiptIdPattern.test(command.receiptId || '') && command.receiptId === row.sourceReceiptId));
    }
    function executionProgress(row) {
        const jobs = { running: '后台运行中', stopping: '后台正在停止', completed: '后台已结束', killed: '后台已停止',
            failed: '后台未完成', uncertain: '后台状态待确认', unconfirmed: '后台状态待确认' };
        return Object.hasOwn(jobs, row.jobState) ? jobs[row.jobState] : row.jobId ? '后台状态待确认'
            : { running: '正在执行', completed: '执行结束', failed: '未完成', cancelled: '已停止', uncertain: '待确认' }[row.state];
    }
    function executionName(row) {
        return { pwsh: '运行命令', read: '读取文件', write: '写入文件', edit: '修改文件', glob: '查找文件', grep: '搜索内容',
            weftmod: '设备操作', weftmod_script: '运行脚本', job_output: '读取后台输出', job_list: '查看后台任务', job_kill: '停止后台任务' }[row.toolName] || core.toolSummary(row.toolName, row.arguments);
    }
    async function refreshConversationTasks() {
        const context = core.conversationTaskContext();
        if (!core.conversationTaskCurrent(context) || !core.sessionIdPattern.test(context.sessionId || ''))
            return;
        if (core.state.sessions.find(row => row.sessionId === context.sessionId)?.taskAvailable === false) {
            for (const [id, entry] of core.conversationTasks.entries)
                if (entry.sessionId === context.sessionId) core.conversationTasks.entries.delete(id);
            effects.renderConversationTasks();
            return;
        }
        if (core.conversationTasks.ownerId !== context.ownerId || core.conversationTasks.identity !== context.identity) {
            core.conversationTasks.entries.clear();
            core.conversationTasks.ownerId = context.ownerId;
            core.conversationTasks.identity = context.identity;
        }
        const key = JSON.stringify(context);
        if (core.conversationTasks.inFlight?.key === key)
            return core.conversationTasks.inFlight.promise;
        const roots = core.state.tasks.filter((row) => row?.kind === 'session.message' && !row.rootTaskId &&
            row.sessionId === context.sessionId && core.sessionIdPattern.test(row.commandId || '') &&
            (!row.conversationId || row.conversationId === context.conversationId)).slice(0, 8);
        const run = async () => {
            await core.refreshConversationApprovals({ ...context, deviceId: core.state.device?.id });
            await core.refreshConversationQuestions({ ...context, deviceId: core.state.device?.id });
            if (!core.conversationTaskCurrent(context))
                return;
            const receipts = new Set(core.timelineEventsForContext(context).filter(event => event.type === 'user.message').map(event => event.data?.receiptId).filter(Boolean));
            for (const entry of core.conversationApprovals.entries.values())
                if (entry.row.sessionId === context.sessionId &&
                    (receipts.has(entry.row.sourceReceiptId) || core.timelineEventsForContext(context).some(e => entry.row.approvalId && e.data?.approvalId === entry.row.approvalId || entry.row.callId && e.data?.callId === entry.row.callId || e.type === 'question.asked' && e.data?.turn === entry.row.turn)) && !roots.some((row) => row.commandId === entry.row.taskId)) {
                    roots.push({ commandId: entry.row.taskId, sessionId: context.sessionId,
                        ...(context.conversationId ? { conversationId: context.conversationId } : {}) });
                }
            for (const entry of core.conversationQuestions.entries.values())
                if (entry.row.sessionId === context.sessionId &&
                    (receipts.has(entry.row.sourceReceiptId) || core.timelineEventsForContext(context).some(e => entry.row.approvalId && e.data?.approvalId === entry.row.approvalId || entry.row.callId && e.data?.callId === entry.row.callId || e.type === 'question.asked' && e.data?.turn === entry.row.turn)) && !roots.some((row) => row.commandId === entry.row.taskId)) {
                    roots.push({ commandId: entry.row.taskId, sessionId: context.sessionId,
                        ...(context.conversationId ? { conversationId: context.conversationId } : {}) });
                }
            let next = 0;
            const worker = async () => {
                while (core.conversationTaskCurrent(context) && next < roots.length) {
                    const command = roots[next++], taskId = command.commandId;
                    const previous = core.conversationTasks.entries.get(taskId);
                    const entry = { ...previous, taskId, sessionId: context.sessionId, conversationId: command.conversationId,
                        receiptId: command.receiptId, notice: '' };
                    try {
                        const payload = await core.accessApi(`/tasks/${encodeURIComponent(taskId)}`);
                        if (!core.conversationTaskCurrent(context))
                            return;
                        if (payload?.taskId !== taskId || payload.sessionId !== context.sessionId ||
                            payload.source?.commandId !== taskId || payload.source.kind !== 'session.message' || payload.source.rootTaskId ||
                            payload.source.sessionId !== context.sessionId || !Array.isArray(payload.artifacts) ||
                            command.receiptId && payload.source.receiptId !== command.receiptId ||
                            payload.conversationId && payload.conversationId !== context.conversationId)
                            throw { code: 'REQUEST_FAILED' };
                        entry.payload = payload;
                    }
                    catch (error) {
                        if (!core.conversationTaskCurrent(context) || error.code === 'UNAUTHORIZED')
                            return;
                        entry.notice = error.code === 'NETWORK' ? '连接中断，执行进展待更新。重连后可重新核对。'
                            : '执行进展暂时无法读取，已有记录待更新。请重新核对。';
                    }
                    core.conversationTasks.entries.set(taskId, entry);
                    effects.renderConversationTasks();
                    effects.renderTurnStatus?.();
                    effects.renderTimeline?.();
                }
            };
            await Promise.all([worker(), worker()]);
        };
        const promise = run();
        core.conversationTasks.inFlight = { key, promise };
        try {
            await promise;
        }
        finally {
            if (core.conversationTasks.inFlight?.promise === promise)
                core.conversationTasks.inFlight = null;
        }
    }
    function taskControlStatus(control) {
        if (control?.state === 'stop_requested' && typeof control.stopStatus === 'string') {
            if (control.stopStatus === 'stopped')
                return '电脑已核对这件事的实际停止。已执行的步骤与成果会保留。';
            if (control.stopStatus === 'completed')
                return '这件事的回合已不在运行；未确认是停止请求使它结束。核对已执行的步骤与成果后，可写明下一步。';
            if (control.stopStatus === 'cancel_requested')
                return '电脑已对准这件事发起取消，正在等待实际结束记录。';
            if (control.legacyStopIntent && !control.canResume)
                return '旧停止记录缺少完整目标快照，结果仍待核对。请查看原会话与成果，稍后重新核对。';
            if (control.stopStatus === 'requested')
                return '停止请求已记录，正在核对电脑回合；目前还不能确认已停止。';
            return '停止结果仍不明确。请核对原会话与成果，稍后重新核对；不要重复执行。';
        }
        switch (control?.state) {
            case 'active': return '任务可继续处理；文件是否完成仍以读回核验为准。';
            case 'stop_requested': return control.reasonCode === 'TURN_ENDED_AFTER_STOP_REQUEST' && control.canResume === true
                ? '上一回合已结束，但尚不能确认是停止请求使它结束。请写明下一步，再恢复这件事。'
                : '停止意图已记录，仍在等待执行端状态核对；请勿把它当作已经停止。';
            case 'stopped': return control.stoppedAt ? `执行端停止已核对：${core.formatDate(control.stoppedAt)}` : '执行端停止已核对。';
            case 'uncertain': return '任务结果尚不明确。请先核对电脑会话和成果，再决定是否恢复。';
            default: return '任务控制状态待核对。';
        }
    }
    function taskStopView(turn) {
        const context = core.conversationTaskContext();
        if (!core.conversationTaskCurrent(context) || !Number.isSafeInteger(turn) ||
            core.conversationTasks.ownerId !== context.ownerId || core.conversationTasks.identity !== context.identity) return null;
        const events = core.timelineEventsForContext(context).sort((a, b) => a.seq - b.seq);
        const start = events.findIndex(event => event.type === 'turn.started' && event.data?.turn === turn);
        const end = start < 0 ? -1 : events.findIndex((event, index) => index > start && event.type === 'turn.started');
        const receipts = new Set(start < 0 ? [] : events.slice(start, end < 0 ? undefined : end)
            .filter(event => event.type === 'user.message').map(event => event.data?.receiptId).filter(Boolean));
        for (const entry of core.conversationTasks.entries.values()) {
            const task = entry.payload, control = task?.control;
            if (entry.sessionId !== context.sessionId || control?.state !== 'stop_requested') continue;
            const commands = [task.source, ...(task.supplements || []), ...(task.resumes || [])];
            if (!commands.some(command => command?.receiptId && (command.dshTurn === turn || receipts.has(command.receiptId)))) continue;
            const terminal = control.canResume === true && ['stopped', 'completed'].includes(control.stopStatus);
            return { text: terminal ? control.stopStatus === 'stopped' ? '已停止' : '已结束' : '正在停止…', terminal };
        }
        return null;
    }
    function taskControlError(error) {
        if (error.code === 'TASK_NOT_READY' || error.status === 409)
            return '任务状态已变化或结果仍待核对，请重新核对后再操作。';
        if (error.code === 'NETWORK')
            return '连接中断，操作结果待核对；请重新打开任务查看记录。';
        if (error.status === 403 || error.status === 404)
            return '当前账户或设备无法操作这件事。';
        return '操作尚未确认，请重新核对任务记录。';
    }
    return { taskQueue, cancelQueuedTask, editQueuedTask, messageTaskLabel, commandTitle, commandStatus, taskReplyText, conversationTaskContext, conversationTaskCurrent, relatedExecutionSteps, executionProgress, executionName, refreshConversationTasks, taskControlStatus, taskControlError, taskStopView };
};
