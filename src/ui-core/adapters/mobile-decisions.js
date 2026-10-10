/* Android presentation compatibility over the shared tasks, approvals and questions. */
globalThis.WeftUiCore.factories.mobileDecisions = (core, effects, environment) => {
    const mobile = environment.mobileState;
    if (!mobile)
        return {};
    const storage = environment.storage;
    const shared = {
        context: core.conversationTaskContext, current: core.conversationTaskCurrent, approvalCurrent: core.approvalContextCurrent,
        approvals: core.refreshConversationApprovals, questions: core.refreshConversationQuestions,
        tasks: core.refreshConversationTasks, draft: core.questionDraft,
    };
    const readResults = { approvals: new Map(), questions: new Map() };
    const restoredDrafts = new WeakSet();
    let tasksRead = null;
    let backgroundTaskReads = 0;
    const sync = () => core.syncMobileIdentity?.();
    const deviceId = () => mobile.deviceId || mobile.profile?.device?.id || '';
    function conversationTaskContext() { sync(); return shared.context(); }
    function conversationTaskCurrent(context) {
        sync();
        return mobile.loggedIn && !mobile.transitionPending && shared.current(context);
    }
    function context() {
        const value = conversationTaskContext();
        return { ...value, owner: value.ownerId, epoch: value.identity, generation: mobile.generation,
            source: mobile.chatSource, page: mobile.page, deviceId: deviceId() };
    }
    function coreContext(value) {
        return { ...value, ownerId: value.ownerId ?? value.owner, identity: value.identity ?? value.epoch,
            history: value.history ?? value.generation, source: value.source === 'host' ? 'desktop' : value.source };
    }
    function current(value, checkDevice = false) {
        return conversationTaskCurrent(coreContext(value)) &&
            (value.page === undefined || value.page === mobile.page) &&
            (value.generation === undefined || value.generation === mobile.generation) && (!checkDevice || value.deviceId === deviceId());
    }
    function approvalContextCurrent(value) {
        sync();
        if (value.page !== 'home') return shared.approvalCurrent(value);
        return mobile.loggedIn && !mobile.transitionPending && mobile.page === 'home' &&
            value.ownerId === core.state.ownerId && value.identity === core.state.identityGeneration &&
            value.history === core.state.historyGeneration && value.generation === mobile.generation && value.deviceId === deviceId();
    }
    function modeCurrent(value) {
        sync();
        return mobile.loggedIn && !mobile.transitionPending && value.owner === mobile.owner &&
            value.epoch === mobile.authEpoch && value.generation === mobile.generation && value.page === mobile.page &&
            (value.defaults || value.source === mobile.chatSource && value.sessionId === conversationTaskContext().sessionId && value.conversationId === conversationTaskContext().conversationId && value.deviceId === deviceId());
    }
    const family = question => question ? core.conversationQuestions : core.conversationApprovals;
    const resultMap = question => question ? readResults.questions : readResults.approvals;
    // An authoritative empty phone read removes its old card. The shared cache
    // still retains the record for receipt recovery and monotonic terminal merge.
    const visibleEntry = (entry, question) => entry.notice !== (question
        ? '这批问题暂时无法核对，已填写内容保留。请重新核对。' : '这条审批暂时无法核对，请重新核对原对话。');
    function scopeCurrent(value, question = false) {
        return family(question).scope === JSON.stringify([value.ownerId ?? value.owner, value.identity ?? value.epoch, value.deviceId]);
    }
    const legacyApprovalIdentity = row => JSON.stringify([row.approvalId, row.sessionId, row.taskId, row.sourceCommandId,
        row.sourceReceiptId, row.turn, row.callId, row.rootCallId, row.toolName, row.createdAt]);
    const legacyQuestionIdentity = row => JSON.stringify([row.questionRpcId, row.sessionId, row.taskId, row.sourceCommandId,
        row.sourceReceiptId, row.turn, row.questions, row.createdAt]);
    const legacyKey = (value, row, question = false, kind = 'request') => question
        ? `weftmate-question-${kind}:${value.ownerId ?? value.owner}:${value.deviceId}:${row.sessionId}:${row.questionRpcId}`
        : `weftmate-approval:${value.ownerId ?? value.owner}:${value.deviceId}:${row.sessionId}:${row.approvalId}`;
    function readSaved(key) { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } }
    function removeSaved(key) { try { storage.removeItem(key); } catch { /* Optional browser persistence. */ } }
    function importMarker(value, row, question = false) {
        const ctx = coreContext(value);
        const existing = question ? core.questionMarker(ctx, row) : core.approvalMarker(ctx, row);
        if (existing || row.status !== 'pending')
            return existing;
        const saved = readSaved(legacyKey(ctx, row, question));
        if (!saved || saved.identity !== (question ? legacyQuestionIdentity(row) : legacyApprovalIdentity(row)) ||
            !core.approvalRequestPattern.test(saved.requestId || ''))
            return null;
        const marker = question
            ? core.validQuestionAnswer(saved.answer, row.questions) && { ...core.questionIdentity(row), requestId: saved.requestId, answer: saved.answer }
            : ['allowed-once', 'rejected'].includes(saved.outcome) &&
                (saved.scope === undefined || saved.outcome === 'allowed-once' && ['once', 'conversation-category'].includes(saved.scope)) &&
                { ...core.approvalIdentity(row), requestId: saved.requestId, outcome: saved.outcome,
                    ...(saved.outcome === 'allowed-once' ? { scope: saved.scope || 'once' } : {}) };
        if (!marker)
            return null;
        try {
            if (question) core.saveQuestionMarker(ctx, marker);
            else core.saveApprovalMarker(ctx, marker);
            removeSaved(legacyKey(ctx, row, question));
            return marker;
        }
        catch { return null; }
    }
    function attempt(value, row, question = false) {
        if (row.status !== 'pending') {
            removeSaved(legacyKey(value, row, question));
            return null;
        }
        const data = family(question), id = question ? row.questionRpcId : row.approvalId;
        const operation = data.operations.get(id), marker = operation || importMarker(value, row, question);
        if (!marker || !(question ? core.sameQuestion(marker, row) : core.sameApproval(marker, row)))
            return null;
        const entry = data.entries.get(id);
        return { ...marker, identity: question ? legacyQuestionIdentity(row) : legacyApprovalIdentity(row),
            busy: !!operation, unknown: true, checked: !!entry?.authoritative && !entry.notice,
            ...(question || marker.outcome !== 'allowed-once' ? {} : { scope: marker.scope || 'once' }) };
    }
    function rows(value, question = false) {
        if (!scopeCurrent(value, question))
            return [];
        return [...family(question).entries.values()].filter(entry => entry.row.sessionId === value.sessionId && visibleEntry(entry, question)).map(entry => entry.row);
    }
    function sessions(question = false) {
        const data = family(question), result = new Map();
        if (!data.scope)
            return result;
        const ids = new Set([...data.entries.values()].map(entry => entry.row.sessionId));
        const selected = conversationTaskContext().sessionId;
        if (selected) ids.add(selected);
        for (const sessionId of ids) {
            const entries = [...data.entries.values()].filter(entry => entry.row.sessionId === sessionId && visibleEntry(entry, question));
            const error = resultMap(question).get(sessionId) === false || entries.some(entry => !entry.authoritative || entry.notice)
                ? '状态暂时无法核对' : '';
            result.set(sessionId, { rows: new Map(entries.map(entry => [question ? entry.row.questionRpcId : entry.row.approvalId, entry.row])),
                loaded: resultMap(question).has(sessionId), error });
        }
        return result;
    }
    function store(question = false) {
        const data = family(question), scope = () => { try { return JSON.parse(data.scope || 'null'); } catch { return null; } };
        return {
            get owner() { return scope()?.[0] ?? null; }, get epoch() { return scope()?.[1] ?? -1; },
            get deviceId() { return scope()?.[2] ?? null; }, get sessions() { return sessions(question); },
            get attempts() {
                const result = new Map(), value = context();
                for (const entry of data.entries.values()) {
                    const row = entry.row, pending = attempt(value, row, question);
                    if (pending) result.set(`${row.sessionId}/${question ? row.questionRpcId : row.approvalId}`, pending);
                }
                return result;
            },
            get inFlight() { return data.reads; }, detail: null, pollTimer: null,
        };
    }
    const tasks = {
        get owner() { return core.conversationTasks.ownerId; }, set owner(value) { core.conversationTasks.ownerId = value; },
        get epoch() { return core.conversationTasks.identity; }, set epoch(value) { core.conversationTasks.identity = value; },
        get entries() {
            for (const entry of core.conversationTasks.entries.values()) {
                const descriptor = Object.getOwnPropertyDescriptor(entry, 'task');
                if (!descriptor?.get) {
                    if (entry.task) entry.payload = entry.task;
                    Object.defineProperty(entry, 'task', { enumerable: false, configurable: true,
                        get() { return this.payload; }, set(value) { this.payload = value; } });
                }
            }
            return core.conversationTasks.entries;
        },
        get inFlight() { return core.conversationTasks.inFlight; }, set inFlight(value) { core.conversationTasks.inFlight = value; },
    };
    function reset(question = false) {
        (question ? core.resetConversationQuestions : core.resetConversationApprovals)();
        resultMap(question).clear();
    }
    async function refreshShared(value, force, question) {
        sync();
        const result = await (question ? shared.questions : shared.approvals)(value, force);
        if (core.approvalContextCurrent(value)) {
            resultMap(question).set(value.sessionId, result);
            for (const row of rows({ ...value, deviceId: value.deviceId }, question))
                importMarker(value, row, question);
            (question ? effects.renderConversationQuestions : effects.renderConversationApprovals)?.();
        }
        return result;
    }
    async function readDecisionSources(value, question) {
        const pending = rows(value, question).filter(row => ['pending', 'answered'].includes(row.status));
        for (const taskId of new Set(pending.map(row => row.taskId))) {
            const known = tasks.entries.get(taskId);
            if (known?.payload && !known.notice) continue;
            const payload = await core.accessApi(`/tasks/${encodeURIComponent(taskId)}`);
            if (!current(value, true)) return;
            const previous = core.conversationTasks.entries.get(taskId);
            const entry = { taskId, sessionId: value.sessionId, conversationId: payload?.conversationId,
                receiptId: payload?.source?.receiptId, payload, notice: '' };
            core.conversationTasks.entries.set(taskId, entry);
            if (payload?.taskId !== taskId || payload.sessionId !== value.sessionId ||
                payload.conversationId && payload.conversationId !== value.conversationId ||
                !pending.some(row => row.taskId === taskId && core.approvalSource(row))) {
                if (previous) core.conversationTasks.entries.set(taskId, previous);
                else core.conversationTasks.entries.delete(taskId);
                throw { code: question ? 'QUESTION_RECEIPT_INVALID' : 'APPROVAL_RECEIPT_INVALID' };
            }
            core.conversationTasks.ownerId = value.ownerId ?? value.owner;
            core.conversationTasks.identity = value.identity ?? value.epoch;
        }
    }
    async function refresh(value, force = false, question = false) {
        if (!current(value, true)) return false;
        const result = await refreshShared(coreContext(value), force, question);
        if (result && current(value, true)) {
            try { await readDecisionSources(value, question); }
            catch {
                if (current(value, true)) resultMap(question).set(value.sessionId, false);
                (question ? effects.renderConversationQuestions : effects.renderConversationApprovals)?.();
                return false;
            }
            (question ? effects.renderConversationQuestions : effects.renderConversationApprovals)?.();
        }
        return result;
    }
    async function refreshTasks() {
        const value = context();
        if (!current(value) || !core.sessionIdPattern.test(value.sessionId || '')) return;
        const key = JSON.stringify(value);
        if (tasksRead?.key === key) return tasksRead.promise;
        const run = async () => {
            // Decisions have dedicated native readers and remain reachable when
            // the general activity index cannot be read.
            const decisionReads = Promise.all([refresh(value), refresh(value, false, true)]);
            try {
                const payload = await core.accessApi('/commands?limit=50');
                if (!current(value)) return;
                if (!Array.isArray(payload.commands)) throw { code: 'REQUEST_FAILED' };
                core.state.tasks = payload.commands;
                // The native phone UI has always refreshed decisions beside the task read.
                // Keep that scheduling while sharing the same readers and task projection.
                backgroundTaskReads++;
                try { await shared.tasks(); } finally { backgroundTaskReads--; }
            }
            catch {
                if (!current(value)) return;
                for (const entry of core.conversationTasks.entries.values())
                    if (entry.sessionId === value.sessionId)
                        entry.notice = '电脑暂不可达，执行进展待更新。重连后可重新核对。';
                effects.renderConversationTasks?.();
                void decisionReads.then(async () => {
                    if (!current(value)) return;
                    try { await Promise.all([readDecisionSources(value, false), readDecisionSources(value, true)]); }
                    catch { /* Each dedicated reader retains its existing receipt state. */ }
                    if (current(value)) effects.renderConversationTasks?.();
                });
            }
        };
        const promise = run(); tasksRead = { key, promise };
        try { await promise; } finally { if (tasksRead?.promise === promise) tasksRead = null; }
    }
    async function refreshHomeApprovals() {
        const value = context();
        if (mobile.page !== 'home' || !mobile.loggedIn || mobile.transitionPending) return;
        await Promise.all((mobile.sharedSessions || []).map(session => core.refreshConversationApprovals(
            coreContext({ ...value, sessionId: session.sessionId }), true)));
    }
    function questionDraft(value, row) {
        const ctx = coreContext(value);
        importMarker(ctx, row, true);
        const draft = shared.draft(ctx, row);
        if (!restoredDrafts.has(draft)) {
            restoredDrafts.add(draft);
            const saved = readSaved(legacyKey(ctx, row, true, 'draft'));
            if (!core.questionMarker(ctx, row) && saved?.identity === legacyQuestionIdentity(row) && Array.isArray(saved.answers)) {
                const answer = canonicalAnswer({ answers: saved.answers.map(item => ({ ...item,
                    ...(item.custom === '' ? { custom: undefined } : {}) })) }, row.questions);
                if (answer) draft.answers = answer.answers.map(item => ({ ...item, custom: item.custom || '' }));
            }
        }
        return draft;
    }
    function saveDraft(value, row) {
        const draft = questionDraft(value, row);
        try { storage.setItem(legacyKey(value, row, true, 'draft'), JSON.stringify({ identity: legacyQuestionIdentity(row), answers: draft.answers })); }
        catch { /* Keep the active draft in shared state. */ }
    }
    function canonicalAnswer(answer, questions) {
        if (!core.validQuestionAnswer(answer, questions)) return null;
        return { answers: answer.answers.map(item => ({ id: item.id, selected: [...item.selected],
            ...(item.custom !== undefined ? { custom: item.custom } : {}) })) };
    }
    async function submitApproval(value, row, outcome, scope) {
        if (!current(value, true) || !['allowed-once', 'rejected'].includes(outcome)) return;
        if (outcome === 'allowed-once' && !['once', 'conversation-category'].includes(scope) || outcome === 'rejected' && scope !== undefined) return;
        if (scope === 'conversation-category' && !row.riskCategories?.some(value => ['delete', 'overwrite', 'system', 'install', 'external', 'spend', 'execute'].includes(value))) return;
        importMarker(value, row);
        await core.submitApproval(coreContext(value), row, outcome, scope || 'once');
    }
    async function submitQuestion(value, row, answer) {
        if (!current(value, true)) return;
        const canonical = canonicalAnswer(answer, row.questions);
        if (!canonical) return;
        const ctx = coreContext(value), marker = importMarker(ctx, row, true);
        if (!marker) questionDraft(ctx, row).answers = canonical.answers.map(item => ({ ...item, custom: item.custom || '' }));
        await core.submitQuestion(ctx, row);
    }
    async function mode(value, selected) {
        if (!modeCurrent(value)) return null;
        const result = value.defaults
            ? selected === undefined ? await core.readDefaultApprovalMode() : await core.saveDefaultApprovalMode(selected)
            : await core.accessApi(`/sessions/${encodeURIComponent(value.sessionId)}/approval-mode`, selected === undefined ? undefined :
                { method: 'PATCH', protectedWrite: true, body: { mode: selected } });
        if (!core.approvalModes.some(item => item[0] === result?.mode) || selected !== undefined && result.mode !== selected)
            throw { code: 'APPROVAL_RECEIPT_INVALID' };
        return result;
    }
    const mobileDecisions = {
        tasks, approvals: store(), questions: store(true), context, current, deviceId, modeCurrent, scopeCurrent, rows,
        approvalAttempt: (value, row) => attempt(value, row), questionAttempt: (value, row) => attempt(value, row, true),
        questionDraft, canonicalAnswer, reset, refresh, refreshTasks, refreshHomeApprovals, submitApproval, submitQuestion,
        related: (task, row) => task?.taskId === row.taskId && !!core.approvalSource(row),
        chooseOption(value, row, index, label, checked) {
            const answer = core.chooseQuestionOption(coreContext(value), row, index, label, checked);
            if (answer) saveDraft(value, row);
            return answer;
        },
        setCustom(value, row, index, text) {
            const ctx = coreContext(value);
            let answer = core.setQuestionCustom(ctx, row, index, text);
            if (answer && text.length && row.questions[index].multiSelect !== true && answer.selected.length) {
                core.chooseQuestionOption(ctx, row, index, answer.selected[0], false);
                answer = core.setQuestionCustom(ctx, row, index, text);
            }
            if (answer) saveDraft(value, row);
            return answer;
        },
        readMode: value => mode(value), saveMode: (value, selected) => mode(value, selected),
    };
    function refreshFromSharedTask(value, force, question) {
        if (backgroundTaskReads && value.page === undefined) return Promise.resolve(true);
        return refreshShared(value, force, question);
    }
    return { mobileDecisions, conversationTaskContext, conversationTaskCurrent, approvalContextCurrent, questionDraft,
        refreshConversationApprovals: (value = core.approvalContext(), force = false) => refreshFromSharedTask(value, force, false),
        refreshConversationQuestions: (value = core.approvalContext(), force = false) => refreshFromSharedTask(value, force, true) };
};
