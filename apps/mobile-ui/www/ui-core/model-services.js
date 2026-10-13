/* Account scoped service actions. Keys are submitted directly and never cached here. */
globalThis.WeftUiCore.factories.modelServices = (core, effects, environment) => {
    let reading, writing = false, retryIdentity, retryAt = 0;
    const scope = () => `${core.state.ownerId}/${core.state.identityGeneration}`;
    const recentKey = () => `weftmate:model-recent:${core.state.ownerId}`;
    function modelServicesView() {
        let recent = []; try { recent = JSON.parse(environment.storage.getItem(recentKey()) || '[]'); } catch {}
        const services = core.state.modelServices || [];
        const selected = services.flatMap(s => s.models.map(m => ({serviceId:s.serviceId,modelId:m.modelId,profileId:m.profileId,profileIds:m.profileIds}))).find(row => row.profileId === core.state.modelProfileId || row.profileIds?.includes(core.state.modelProfileId));
        const image = row => (row.contentType || row.mimeType || '').startsWith('image/');
        const needsImage = core.currentAttachmentDrafts?.().some(image) || core.timelineEventsForContext?.().some(event => event.data?.images?.length>0 || (event.attachments || event.data?.attachments || []).some(image));
        return { services, selected, recent: Array.isArray(recent) ? recent : [], loading: !!reading, requiresVision: needsImage === true,
            modelName: services.find(s => s.serviceId === selected?.serviceId)?.models.find(m => m.modelId === selected?.modelId)?.name || core.state.models.find(m => m.id === core.state.modelProfileId)?.name };
    }
    async function refreshModelServices(refresh = false) {
        const identity = scope(); if (reading?.identity === identity) return reading.promise;
        if (!refresh && retryIdentity === identity && Date.now() < retryAt) return;
        const work = (async () => {
            if (refresh && core.state.modelServices) await Promise.all(core.state.modelServices.map(service => core.accessApi(`/model-services/${encodeURIComponent(service.serviceId)}/refresh`, {method:'POST',protectedWrite:true,body:{}}).catch(() => {})));
            const payload = await core.accessApi('/model-services');
            if (identity !== scope()) return;
            core.state.modelServices = Array.isArray(payload.services) ? payload.services : [];
            core.state.modelServicesCanManage = payload.canManage === true;
            retryAt = 0;
            effects.renderAccountModels?.(); effects.updateModelPicker?.();
            return payload;
        })(); reading = {identity,promise:work};
        try { return await work; }
        catch (error) {
            if (identity === scope()) {
                retryIdentity = identity;
                retryAt = Date.now() + (globalThis.WeftUiCore.polling?.configuration || 30000);
            }
            throw error;
        } finally { if (reading?.promise === work) reading = null; }
    }
    async function selectServiceModel({serviceId,modelId}) {
        if (writing) return false; writing = true; const identity = scope();
        try {
            let sessionId=core.state.selectedSessionId;
            // The composer can appear before its logical conversation projection
            // finishes loading. Resolve the selected chat before persisting its
            // next-message choice, so the next poll cannot restore the old model.
            if(!sessionId&&!core.state.newConversation){
                const chat=core.state.selectedChatId&&core.readChat?await core.readChat(core.state.selectedChatId):core.readMainChat?await core.readMainChat():null;
                if(identity!==scope())return false;
                sessionId=chat?.chat?.activeSessionId||chat?.chat?.sessionId;
            }
            const result = await core.accessApi(`/model-services/${encodeURIComponent(serviceId)}/select`, {method:'POST',protectedWrite:true,
                body:{modelId,requestId:environment.crypto.randomUUID(),...(sessionId ? {sessionId} : {})}, timeoutMs:60000});
            if (identity !== scope()) return false;
            if (!result.profileId) throw {code:'MODEL_UNAVAILABLE'};
            retryAt = 0;
            if (result.models) core.state.models = result.models.filter(m => m.configured);
            await core.refreshModels(); if (identity !== scope()) return false;
            core.state.modelProfileId = result.profileId; core.state.modelSettings = {...core.state.modelSettings,defaultModelProfileId:result.profileId};
            if (result.service) core.state.modelServices = core.state.modelServices.map(s => s.serviceId === serviceId ? result.service : s);
            try { let recent = JSON.parse(environment.storage.getItem(recentKey()) || '[]'); const key = `${serviceId}/${modelId}`; environment.storage.setItem(recentKey(), JSON.stringify([key,...recent.filter(k => k !== key)].slice(0,20))); } catch {}
            effects.paintModels?.(); effects.updateAvailability?.(); return true;
        } finally { writing = false; }
    }
    async function writeModelService(serviceId, body, method = serviceId ? 'PATCH' : 'POST') {
        const identity = scope();
        const result = await core.accessApi('/model-services' + (serviceId ? '/' + encodeURIComponent(serviceId) : ''), {method,protectedWrite:true,body:{requestId:environment.crypto.randomUUID(),...body},timeoutMs:60000});
        if (identity === scope()) { retryAt = 0; await core.refreshModels(); }
        return result;
    }
    const checkModelService = ({baseUrl,apiKey,interfaceType,serviceId}) => core.accessApi('/model-services/check', {method:'POST',protectedWrite:true,body:{baseUrl,interfaceType,...(apiKey?{apiKey}:{}),...(serviceId?{serviceId}:{})},timeoutMs:20000});
    return { modelServicesView, refreshModelServices, selectServiceModel, writeModelService, checkModelService };
};
