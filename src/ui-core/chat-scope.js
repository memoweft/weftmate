/* A second conversation uses the same actions with its own state and effects. */
globalThis.WeftUiCore.factories.chatScope = (parent, _effects, environment) => {
    function createChatScope(effects, tabId, computerId = parent.currentExecutionComputer?.() || parent.state.hostId) {
        const identity = parent.state.identityGeneration, owner = parent.state.ownerId;
        const lifetime = new AbortController();
        const prefix = `weftmate-chat-scope:${owner}:${tabId}:`;
        const storage = {
            getItem: key => environment.storage.getItem(prefix + key),
            setItem: (key, value) => environment.storage.setItem(prefix + key, value),
            removeItem: key => environment.storage.removeItem(prefix + key),
        };
        const current = () => !lifetime.signal.aborted && parent.state.identityGeneration === identity && parent.state.ownerId === owner;
        const core = globalThis.WeftUiCore.create({ ...environment, effects, storage, chatScope:true,
            fetch: async (url, options = {}) => {
                if (!current()) return Promise.reject({ code: 'ABORTED' });
                const response = await environment.fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal });
                if (!current()) throw { code: 'ABORTED' };
                return response;
            },
        });
        // Account and host projections are inputs. Conversation state, pending
        // commands, drafts, attachments, cursors and process identities stay owned.
        const initial = ['account', 'device', 'ownerId', 'hostId', 'hostName', 'capabilities', 'personalCapabilities',
            'models', 'allModels', 'modelProfileId', 'modelSettings', 'modelServices', 'personalization', 'personalizationOwner', 'cloudAuth', 'computers', 'projects'];
        for (const key of initial) if (parent.state[key] !== undefined)
            core.state[key] = JSON.parse(JSON.stringify(parent.state[key]));
        core.state.hostId = computerId;
        core.state.currentView = 'assistant';
        core.state.identityGeneration = identity;
        core.state.sessions = parent.state.sessions.map(row => ({ ...row }));
        core.state.chats = (parent.state.chats || []).map(row => ({ ...row }));
        core.sessionExpired = () => { if (current()) parent.sessionExpired(); };
        const localAccess = core.accessApi;
        core.accessApi = async (path, options = {}) => {
            if (!current()) throw { code:'ABORTED' };
            const result = parent.canUseComputerChannel?.() ? await parent.computerApi(computerId, path, options) : await localAccess(path, options);
            if (!current()) throw { code:'ABORTED' };
            return result;
        };
        function sync() {
            if (!current()) return false;
            core.state.csrfToken = parent.state.csrfToken;
            core.state.online = parent.state.online;
            return true;
        }
        sync();
        let timer, overview, started = false;
        async function refresh() {
            if (!sync()) return;
            try {
                await Promise.all([core.refreshLiveConversation(), core.refreshConversationFacts()]);
            } catch { /* Existing history/receipt effects expose retryable failures. */ }
            if (current() && started) timer = setTimeout(refresh, core.state.turnStatus === 'running' ? 250 : 1500);
        }
        return { core, sync,
            start() { if (!started) { started = true; void refresh(); overview = setInterval(() => { if (sync() && core.state.selectedSessionId) void core.refreshSessions().catch(() => {}); }, 4500); } },
            dispose() {
                started = false; clearTimeout(timer); clearInterval(overview); lifetime.abort();
                core.historyWaitAbort?.abort(); core.cancelSessionSelection?.(); core.cancelAttachmentUpload(); core.stopAssistantRefresh();
                core.state.identityGeneration++; core.state.csrfToken = null;
                core.state.historyGeneration++; core.state.historyEvents.clear();
                core.state.chatWindow.events.clear(); core.resetMessageBodies(); core.resetMessageProcesses();
                core.state.attachmentDrafts.clear(); core.state.attachmentAttempts.clear(); core.state.attachmentGroups.clear();
            },
        };
    }
    return { createChatScope };
};
