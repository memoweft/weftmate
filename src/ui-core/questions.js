/* Shared questions state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.questions = (core, effects, environment) => {
    function resetConversationQuestions() {
        core.conversationQuestions.scope = null;
        core.conversationQuestions.entries.clear();
        core.conversationQuestions.reads.clear();
        core.conversationQuestions.operations.clear();
        core.conversationQuestions.drafts.clear();
        core.conversationQuestions.readGeneration++;
    }
    function questionIdentity(row) { return { ...Object.fromEntries(core.questionIdentityFields.map((field) => [field, row[field]])), questions: row.questions }; }
    function sameQuestion(left, right) {
        return core.questionIdentityFields.every((field) => left?.[field] === right?.[field]) && JSON.stringify(left?.questions) === JSON.stringify(right?.questions);
    }
    function validQuestionItems(questions) {
        return Array.isArray(questions) && questions.length > 0 && questions.every((question) => question &&
            typeof question.id === 'string' && typeof question.question === 'string' &&
            ['header', 'detail'].every((field) => question[field] === undefined || typeof question[field] === 'string') &&
            (question.multiSelect === undefined || typeof question.multiSelect === 'boolean') &&
            (question.options === undefined || Array.isArray(question.options) && question.options.every((option) => option &&
                typeof option.label === 'string' && (option.description === undefined || typeof option.description === 'string'))) &&
            (question.intent === undefined || question.intent?.kind === 'plan-review' && typeof question.intent.approve === 'string' &&
                typeof question.detail === 'string' && question.options?.some((option) => option.label === question.intent.approve)));
    }
    function validQuestionAnswer(answer, questions) {
        return !!answer && Object.keys(answer).length === 1 && Array.isArray(answer.answers) && answer.answers.length === questions.length &&
            answer.answers.every((item, index) => item && Object.keys(item).every((key) => ['id', 'selected', 'custom'].includes(key)) &&
                item.id === questions[index].id && Array.isArray(item.selected) && item.selected.every((label) => typeof label === 'string' &&
                (questions[index].options || []).some((option) => option.label === label)) && new Set(item.selected).size === item.selected.length &&
                (item.custom === undefined || typeof item.custom === 'string' && !!item.custom.trim()) &&
                (questions[index].multiSelect === true || item.selected.length <= 1 && (item.custom === undefined || item.selected.length === 0)));
    }
    function validQuestion(row, sessionId) {
        const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
        if (!row || !core.questionIdentityFields.every((field) => field === 'turn' || typeof row[field] === 'string') ||
            !core.approvalIdPattern.test(row.questionRpcId) || row.sessionId !== sessionId || !core.sessionIdPattern.test(row.taskId) ||
            !core.sessionIdPattern.test(row.sourceCommandId) || !core.receiptIdPattern.test(row.sourceReceiptId) ||
            !Number.isSafeInteger(row.turn) || row.turn < 1 || !time(row.createdAt) || !core.validQuestionItems(row.questions) ||
            !['pending', 'answered', 'resolved', 'unavailable'].includes(row.status))
            return false;
        const hasAnswer = [row.answer, row.answerRequestId, row.answeredAt].some((value) => value !== undefined);
        if (hasAnswer && (!core.approvalRequestPattern.test(row.answerRequestId || '') || !time(row.answeredAt) ||
            !core.validQuestionAnswer(row.answer, row.questions)))
            return false;
        if (row.answerAcceptedAt !== undefined && (!hasAnswer || !time(row.answerAcceptedAt)))
            return false;
        if (row.status === 'pending')
            return !hasAnswer && row.answerAcceptedAt === undefined && row.outcome === undefined && row.resolvedAt === undefined;
        if (row.status === 'answered')
            return hasAnswer && row.outcome === undefined && row.resolvedAt === undefined;
        if (row.status === 'unavailable')
            return typeof row.reasonCode === 'string' && time(row.unavailableAt);
        return ['answered', 'cancelled'].includes(row.outcome) && time(row.resolvedAt);
    }
    function questionMarkerKey(context) { return `weftmate:question-answers:v1:${context.ownerId}:${context.deviceId}`; }
    function questionMarkers(context) {
        try {
            const rows = JSON.parse(environment.storage.getItem(core.questionMarkerKey(context)) || '[]');
            return Array.isArray(rows) ? rows.filter((row) => row && core.approvalIdPattern.test(row.questionRpcId || '') &&
                core.approvalRequestPattern.test(row.requestId || '') && core.validQuestionItems(row.questions) && core.validQuestionAnswer(row.answer, row.questions)) : [];
        }
        catch {
            return [];
        }
    }
    function questionMarker(context, row) { return core.questionMarkers(context).find((marker) => marker.questionRpcId === row.questionRpcId); }
    function saveQuestionMarker(context, marker) {
        environment.storage.setItem(core.questionMarkerKey(context), JSON.stringify([...core.questionMarkers(context)
                .filter((row) => row.questionRpcId !== marker.questionRpcId), marker]));
    }
    function clearQuestionMarker(context, id) {
        try {
            environment.storage.setItem(core.questionMarkerKey(context), JSON.stringify(core.questionMarkers(context).filter((row) => row.questionRpcId !== id)));
        }
        catch { /* GET remains authoritative. */ }
    }
    function questionDraft(context, row) {
        const key = JSON.stringify([context.ownerId, context.deviceId, row.questionRpcId]);
        let draft = core.conversationQuestions.drafts.get(key);
        if (!draft || !core.sameQuestion(draft, row)) {
            const marker = core.questionMarker(context, row), answer = marker && core.sameQuestion(marker, row) ? marker.answer : row.answer;
            draft = { ...core.questionIdentity(row), answers: row.questions.map((question, index) => ({ id: question.id,
                    selected: [...(answer?.answers[index]?.selected || [])], custom: answer?.answers[index]?.custom || '' })) };
            core.conversationQuestions.drafts.set(key, draft);
        }
        return draft;
    }
    function mergeQuestion(entry, row) {
        if (entry && !core.sameQuestion(entry.row, row))
            return { ...entry, authoritative: false, notice: '问题来源已变化，请重新核对原对话。' };
        const rank = { pending: 0, answered: 1, resolved: 2, unavailable: 2 };
        let next = entry && rank[entry.row.status] > rank[row.status] ? entry.row : row;
        if (entry?.row.answerAcceptedAt && !next.answerAcceptedAt && next.answerRequestId === entry.row.answerRequestId &&
            JSON.stringify(next.answer) === JSON.stringify(entry.row.answer))
            next = { ...next, answerAcceptedAt: entry.row.answerAcceptedAt };
        return { ...entry, row: next, authoritative: true, notice: '', validation: '' };
    }
    async function refreshConversationQuestions(context = core.approvalContext(), force = false) {
        if (!core.approvalContextCurrent(context) || !core.sessionIdPattern.test(context.sessionId || ''))
            return false;
        const scope = JSON.stringify([context.ownerId, context.identity, context.deviceId]);
        if (core.conversationQuestions.scope !== scope) {
            core.resetConversationQuestions();
            core.conversationQuestions.scope = scope;
        }
        const key = JSON.stringify(context), prior = core.conversationQuestions.reads.get(key);
        if (!force && prior)
            return prior.promise;
        const generation = ++core.conversationQuestions.readGeneration;
        const run = async () => {
            const rows = new Map(), cursors = new Set();
            let before = null;
            try {
                do {
                    const page = await core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/questions?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`);
                    if (!core.approvalContextCurrent(context) || core.conversationQuestions.reads.get(key)?.generation !== generation)
                        return false;
                    if (!Array.isArray(page?.questions) || typeof page.hasMore !== 'boolean' ||
                        page.hasMore && (!core.approvalIdPattern.test(page.nextBefore || '') || cursors.has(page.nextBefore) || !page.questions.length) ||
                        !page.hasMore && page.nextBefore !== null)
                        throw { code: 'REQUEST_FAILED' };
                    for (const row of page.questions)
                        if (core.validQuestion(row, context.sessionId)) {
                            if (rows.has(row.questionRpcId))
                                throw { code: 'REQUEST_FAILED' };
                            rows.set(row.questionRpcId, row);
                        }
                    before = page.hasMore ? page.nextBefore : null;
                    if (before)
                        cursors.add(before);
                } while (before);
                for (const [id, entry] of core.conversationQuestions.entries)
                    if (entry.row.sessionId === context.sessionId && !rows.has(id)) {
                        entry.authoritative = false;
                        entry.notice = '这批问题暂时无法核对，已填写内容保留。请重新核对。';
                    }
                for (const [id, row] of rows) {
                    const entry = core.mergeQuestion(core.conversationQuestions.entries.get(id), row);
                    core.conversationQuestions.entries.set(id, entry);
                    if (entry.authoritative && row.status !== 'pending')
                        core.clearQuestionMarker(context, id);
                }
                effects.renderConversationQuestions();
                return true;
            }
            catch (error) {
                if (!core.approvalContextCurrent(context) || core.conversationQuestions.reads.get(key)?.generation !== generation)
                    return false;
                for (const entry of core.conversationQuestions.entries.values())
                    if (entry.row.sessionId === context.sessionId) {
                        entry.authoritative = false;
                        entry.notice = '信息问题暂时无法核对，已填写内容保留。连接恢复后请重新核对。';
                    }
                effects.renderConversationQuestions();
                return false;
            }
        };
        const promise = run();
        core.conversationQuestions.reads.set(key, { generation, promise });
        try {
            return await promise;
        }
        finally {
            if (core.conversationQuestions.reads.get(key)?.promise === promise)
                core.conversationQuestions.reads.delete(key);
        }
    }
    function questionStatusText(row) {
        const label = row.questions?.[0]?.header || row.questions?.[0]?.question || '补充信息';
        if (row.status === 'unavailable')
            return `已失效 · ${label}`;
        if (row.status === 'resolved' && row.outcome === 'cancelled')
            return `已取消 · ${label}`;
        if (row.answerAcceptedAt)
            return `已回答 · ${label}`;
        if (row.status === 'pending')
            return '请补充这次任务需要的信息。';
        if (row.status === 'answered')
            return `已提交回答 · ${label}`;
        return `已结束 · ${label}`;
    }
    async function submitQuestion(context, original) {
        const id = original.questionRpcId;
        if (!core.approvalContextCurrent(context) || core.conversationQuestions.operations.has(id))
            return;
        let entry = core.conversationQuestions.entries.get(id);
        if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !core.sameQuestion(entry.row, original) || !core.approvalSource(entry.row, true))
            return;
        const marker = core.questionMarker(context, original), draft = core.questionDraft(context, original);
        if (marker && !core.sameQuestion(marker, original))
            return;
        const answer = marker?.answer || { answers: draft.answers.map((item) => ({ id: item.id, selected: [...item.selected], ...(item.custom.trim() ? { custom: item.custom } : {}) })) };
        if (!core.validQuestionAnswer(answer, original.questions)) {
            entry.validation = '请核对每题的选择与填写内容，再提交回答。';
            effects.renderConversationQuestions();
            return;
        }
        const operation = marker || { ...core.questionIdentity(original), requestId: environment.crypto.randomUUID(), answer };
        try {
            core.saveQuestionMarker(context, operation);
        }
        catch {
            entry.notice = '无法保留本次回答，请稍后重试。';
            effects.renderConversationQuestions();
            return;
        }
        core.conversationQuestions.operations.set(id, operation);
        effects.renderConversationQuestions();
        try {
            if (marker) {
                if (!await core.refreshConversationQuestions(context, true) || !core.approvalContextCurrent(context))
                    return;
                entry = core.conversationQuestions.entries.get(id);
                if (!entry?.authoritative || entry.notice || entry.row.status !== 'pending' || !core.sameQuestion(entry.row, original) || !core.approvalSource(entry.row, true))
                    return;
            }
            const receipt = await core.accessApi(`/sessions/${encodeURIComponent(original.sessionId)}/questions/${encodeURIComponent(id)}`, { method: 'POST', protectedWrite: true, body: { requestId: operation.requestId, answer: operation.answer } });
            if (!core.approvalContextCurrent(context) || core.conversationQuestions.operations.get(id) !== operation)
                return;
            if (receipt?.requestId !== operation.requestId || !core.validQuestion(receipt.question, original.sessionId) || !core.sameQuestion(receipt.question, original) ||
                receipt.question.status !== 'answered' || receipt.question.answerRequestId !== operation.requestId ||
                JSON.stringify(receipt.question.answer) !== JSON.stringify(operation.answer))
                throw { code: 'REQUEST_FAILED' };
            core.conversationQuestions.entries.set(id, core.mergeQuestion(core.conversationQuestions.entries.get(id), receipt.question));
            if (core.approvalContextCurrent(context)) void core.refreshSessions?.();
            effects.renderConversationQuestions();
            await core.refreshConversationQuestions(context, true);
        }
        catch (error) {
            if (!core.approvalContextCurrent(context) || core.conversationQuestions.operations.get(id) !== operation)
                return;
            entry = core.conversationQuestions.entries.get(id);
            if (entry) {
                entry.authoritative = false;
                entry.notice = '回答结果尚未确认，正在读取实际问题状态。';
            }
            effects.renderConversationQuestions();
            await core.refreshConversationQuestions(context, true);
        }
        finally {
            if (core.conversationQuestions.operations.get(id) === operation)
                core.conversationQuestions.operations.delete(id);
            if (core.approvalContextCurrent(context))
                effects.renderConversationQuestions();
        }
    }
    function chooseQuestionOption(context, row, index, label, checked) {
        if (!core.approvalContextCurrent(context) || core.conversationQuestions.operations.has(row.questionRpcId) || core.questionMarker(context, row))
            return null;
        const draft = core.questionDraft(context, row), question = row.questions[index];
        const selected = new Set(draft.answers[index].selected);
        if (question.multiSelect === true) {
            if (checked)
                selected.add(label);
            else
                selected.delete(label);
        }
        else {
            selected.clear();
            if (checked)
                selected.add(label);
            draft.answers[index].custom = '';
        }
        draft.answers[index].selected = (question.options || []).map(option => option.label).filter((label, i, labels) => selected.has(label) && labels.indexOf(label) === i);
        return draft.answers[index];
    }
    function setQuestionCustom(context, row, index, text) {
        if (!core.approvalContextCurrent(context) || core.conversationQuestions.operations.has(row.questionRpcId) || core.questionMarker(context, row))
            return null;
        const draft = core.questionDraft(context, row);
        draft.answers[index].custom = text;
        if (row.questions[index].multiSelect !== true && text.trim())
            draft.answers[index].selected = [];
        return draft.answers[index];
    }
    return { resetConversationQuestions, questionIdentity, sameQuestion, validQuestionItems, validQuestionAnswer, validQuestion, questionMarkerKey, questionMarkers, questionMarker, saveQuestionMarker, clearQuestionMarker, questionDraft, mergeQuestion, refreshConversationQuestions, questionStatusText, submitQuestion, chooseQuestionOption, setQuestionCustom };
};
