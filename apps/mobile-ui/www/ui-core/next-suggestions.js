/* Ephemeral account/session suggestions. They never enter the timeline or a draft until accepted. */
(() => {
    const priorities = ['approval', 'question', 'connection', 'subtasks', 'suggestions'];
    function composerAbovePriority(value = {}) {
        if (value.noModel) return priorities.find(key => key !== 'suggestions' && value[key]) || 'none';
        return priorities.find(key => value[key]) || 'none';
    }
    globalThis.WeftUiCore.composerAbovePriority = composerAbovePriority;
    globalThis.WeftUiCore.factories.nextSuggestions = (core, effects, environment) => {
        const runtime = { scope: null, boundary: null, attempted: null, dismissed: null, suggestions: [], completion: '', draft: '', pending: null, timer: null, composing: false, completionCancelled: false };
        const schedule = environment.setTimeout || globalThis.setTimeout, clear = environment.clearTimeout || globalThis.clearTimeout;
        // An optional timeout must not mark the whole conversation offline or show a connection banner.
        const optionalApi = (path, options) => core.requestJson ? core.requestJson(`${core.accessBase}${path}`, options) : core.accessApi(path, options);
        const enabled = () => core.state.personalization?.nextSuggestionsEnabled !== false;
        const context = () => {
            const sessionId = core.state.activeChatSource === 'phone' ? core.phoneBinding?.()?.sessionId : core.state.selectedSessionId;
            return { sessionId, ownerId: core.state.ownerId, identity: core.state.identityGeneration };
        };
        const scopeOf = value => `${value.ownerId}/${value.identity}/${value.sessionId}`;
        const paint = () => { effects.paintNextSuggestions?.(nextSuggestionsView()); core._nextSuggestionsPaint?.(); };
        function cancelNextSuggestions({ clearReplies = true, cancelCompletion = false } = {}) {
            if (runtime.timer != null) { clear(runtime.timer); runtime.timer = null; }
            const task = runtime.pending; runtime.pending = null;
            if (task) {
                task.controller.abort();
                // Keep the captured account and session. A late cancellation must not cancel a newer request.
                if (task.context.ownerId === core.state.ownerId && task.context.identity === core.state.identityGeneration)
                    void optionalApi(`/sessions/${encodeURIComponent(task.context.sessionId)}/suggestions?requestId=${encodeURIComponent(task.requestId)}`,
                        { method: 'DELETE', protectedWrite: true }).catch(() => {});
            }
            if (clearReplies) runtime.suggestions = [];
            runtime.completion = '';
            if (cancelCompletion) runtime.completionCancelled = true;
            paint();
        }
        function nextSuggestionsView() {
            return { suggestions: [...runtime.suggestions], completion: runtime.completion, draft: runtime.draft,
                enabled: enabled(), requestId: runtime.pending?.requestId || null };
        }
        function viable() {
            const ctx = context();
            return enabled() && !!ctx.ownerId && !!ctx.sessionId && core.state.online !== false &&
                core.state.personalCapabilities?.nextSuggestions === 1 && !runtime.composing &&
                !core.conversationRunning?.(ctx.sessionId) && !core.state.submitting && !core.state.sessionSelecting;
        }
        async function requestNextSuggestions(kind, draft = runtime.draft) {
            if (!viable() || kind === 'replies' && (draft.trim() || runtime.dismissed === runtime.boundary)) return;
            cancelNextSuggestions();
            const ctx = context(), requestId = environment.crypto.randomUUID(), controller = new AbortController();
            const task = { context: ctx, requestId, controller, kind, draft, scope: scopeOf(ctx), boundary: runtime.boundary };
            runtime.pending = task;
            try {
                const result = await optionalApi(`/sessions/${encodeURIComponent(ctx.sessionId)}/suggestions`,
                    { method: 'POST', protectedWrite: true, signal: controller.signal, timeoutMs: 7000, body: { kind, ...(kind === 'completion' ? { draft } : {}), requestId } });
                if (runtime.pending !== task || controller.signal.aborted || scopeOf(context()) !== task.scope || !viable() || runtime.draft !== draft || result.requestId !== requestId) return;
                if (kind === 'replies' && runtime.dismissed !== task.boundary)
                    runtime.suggestions = (result.suggestions || []).filter(text => typeof text === 'string' && text.trim()).slice(0, 3);
                if (kind === 'completion' && !runtime.completionCancelled)
                    runtime.completion = typeof result.completion === 'string' ? result.completion.replace(/[\r\n].*$/s, '').slice(0, 80) : '';
            } catch { /* Optional generation fails silently. No queue or retry. */ }
            finally { if (runtime.pending === task) { runtime.pending = null; paint(); } }
        }
        function syncNextSuggestions() {
            const ctx = context(), scope = scopeOf(ctx), draft = effects.readMessageDraft?.() || '';
            const events = core.timelineEventsForContext?.() || [...core.state.historyEvents.values()];
            const boundary = events.filter(event => ['turn.started', 'turn.ended'].includes(event.type)).sort((a, b) => a.seq - b.seq).at(-1);
            const key = boundary ? `${boundary.seq}/${boundary.at || ''}/${boundary.type}` : null;
            if (scope !== runtime.scope) {
                cancelNextSuggestions(); runtime.scope = scope; runtime.boundary = key; runtime.attempted = key;
                runtime.dismissed = null; runtime.draft = draft; runtime.completionCancelled = false;
            }
            if (!viable()) { cancelNextSuggestions(); runtime.boundary = key; runtime.attempted = key; return; }
            if (draft !== runtime.draft) nextSuggestionsInput(draft);
            if (key !== runtime.boundary) {
                cancelNextSuggestions(); runtime.boundary = key; runtime.dismissed = null;
                if (boundary?.type === 'turn.ended' && boundary.data?.reason === 'completed' && !draft.trim() && runtime.attempted !== key) {
                    runtime.attempted = key; void requestNextSuggestions('replies');
                }
            }
            paint();
        }
        function nextSuggestionsInput(draft = effects.readMessageDraft?.() || '') {
            cancelNextSuggestions(); runtime.draft = draft;
            if (!draft.trim()) runtime.completionCancelled = false;
            if (!runtime.completionCancelled && draft.trim() && viable()) runtime.timer = schedule(() => {
                runtime.timer = null; void requestNextSuggestions('completion', draft);
            }, 350);
        }
        function dismissNextSuggestions() {
            runtime.dismissed = runtime.boundary; cancelNextSuggestions({ cancelCompletion: !!runtime.draft.trim() });
        }
        function setSuggestionsComposing(value) { runtime.composing = value; cancelNextSuggestions(); if (!value) nextSuggestionsInput(); }
        return { nextSuggestionsView, syncNextSuggestions, nextSuggestionsInput, cancelNextSuggestions, dismissNextSuggestions,
            requestNextSuggestions, setSuggestionsComposing };
    };
})();
