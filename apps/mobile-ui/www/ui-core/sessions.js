/* Shared sessions state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.sessions = (core, effects, environment) => {
    async function refreshSessions() {
        const payload = await core.accessApi('/sessions');
        core.state.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
        if (!core.state.selectedSessionId && core.state.sessions.length && core.state.ownerId) {
            let saved = null;
            try {
                saved = environment.storage.getItem(core.sessionKey());
            }
            catch { /* no preference storage */ }
            const chosen = core.state.sessions.find((item) => item.sessionId === saved) ?? core.state.sessions[0];
            if (chosen?.sessionId)
                await core.selectSession(chosen.sessionId);
        }
        else
            effects.renderSessions();
        if (core.state.turnStatus === 'running')
            effects.renderTurnStatus();
        effects.updateAvailability();
    }
    return { refreshSessions };
};
