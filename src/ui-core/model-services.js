/* Account scoped service actions. Keys are submitted directly and never cached here. */
globalThis.WeftUiCore.factories.modelServices = (core, effects, environment) => {
    let reading, capabilitiesReading, writing = false, retryIdentity, retryAt = 0;
    const scope = () => `${core.state.ownerId}/${core.state.identityGeneration}`;
    const recentKey = () => `weftmate:model-recent:${core.state.ownerId}`;
    async function requireModelServices() {
        const identity = core.state.identityGeneration;
        // First-run onboarding precedes the assistant's normal status read.
        // An absent declaration is unknown until /status has actually loaded.
        if (core.state.personalCapabilities == null) {
            if (capabilitiesReading?.identity !== identity) {
                const promise = core.refreshStatus();
                capabilitiesReading = {identity, promise};
            }
            const work = capabilitiesReading;
            try { await work.promise; }
            catch (error) {
                if (['UNAUTHORIZED', 'FORBIDDEN'].includes(error?.code)) throw error;
                throw {code:'MODEL_SERVICE_STATUS_UNAVAILABLE'};
            } finally { if (capabilitiesReading === work) capabilitiesReading = null; }
        }
        if (identity !== core.state.identityGeneration) throw {code:'ABORTED'};
        if (core.state.personalCapabilities?.modelServices !== 1) throw {code:'COMPUTER_UPDATE_REQUIRED'};
        return identity;
    }
    function modelServiceFailureMessage(error) {
        switch (error?.code) {
            case 'MODEL_SERVICE_STATUS_UNAVAILABLE': return '暂时无法读取这台电脑的模型服务能力，请稍后重试。';
            case 'ACCOUNT_MODEL_SECRET_REQUIRED': return '请填写这个模型服务的密钥后重试。';
            case 'INVALID_REQUEST': return '填写的模型服务信息不正确，请检查服务地址、密钥和模型名称后重试。';
            case 'MODEL_UNAVAILABLE': return '这个模型暂时不可用，请重新查询并选择一个可用模型。';
            case 'NETWORK': case 'TIMEOUT': return '暂时无法连接这台电脑，请稍后重试。';
            case 'COMPUTER_UPDATE_REQUIRED': case 'UNAUTHORIZED': case 'FORBIDDEN': case 'COMPUTER_OFFLINE':
                return core.failureMessage(error, 'network');
            default: return '模型服务操作未完成，请稍后重试。';
        }
    }
    function preferredServiceModel(service) {
        const models = (service?.models || []).filter(model => model.enabled !== false);
        const defaultProfileId = core.state.modelSettings?.defaultModelProfileId;
        return models.find(model => model.modelId === service?.selectedModelId)
            || (defaultProfileId && models.find(model => model.profileId === defaultProfileId || model.profileIds?.includes(defaultProfileId)))
            || models[0];
    }
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
        if (core.state.personalCapabilities?.modelServices !== 1) { delete core.state.modelServices; core.state.modelServicesCanManage = false; return null; }
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
        const generation = await requireModelServices();
        if (generation !== core.state.identityGeneration) throw {code:'ABORTED'};
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
                body:{modelId,requestId:environment.crypto.randomUUID(),...(sessionId ? {sessionId} : {}),...(environment.chatScope ? {preference:'conversation'} : {})}, timeoutMs:60000});
            if (identity !== scope()) return false;
            if (!result.profileId) throw {code:'MODEL_UNAVAILABLE'};
            retryAt = 0;
            if (result.models) core.state.models = result.models.filter(m => m.configured);
            await core.refreshModels(); if (identity !== scope()) return false;
            core.state.modelProfileId = result.profileId;
            if (!environment.chatScope) core.state.modelSettings = {...core.state.modelSettings,defaultModelProfileId:result.profileId};
            if (result.service) core.state.modelServices = core.state.modelServices.map(s => s.serviceId === serviceId ? result.service : s);
            try { let recent = JSON.parse(environment.storage.getItem(recentKey()) || '[]'); const key = `${serviceId}/${modelId}`; environment.storage.setItem(recentKey(), JSON.stringify([key,...recent.filter(k => k !== key)].slice(0,20))); } catch {}
            effects.paintModels?.(); effects.updateAvailability?.(); return true;
        } finally { writing = false; }
    }
    async function writeModelService(serviceId, body, method = serviceId ? 'PATCH' : 'POST') {
        const generation = await requireModelServices();
        if (generation !== core.state.identityGeneration) throw {code:'ABORTED'};
        const identity = scope();
        const result = await core.accessApi('/model-services' + (serviceId ? '/' + encodeURIComponent(serviceId) : ''), {method,protectedWrite:true,body:{requestId:environment.crypto.randomUUID(),...body},timeoutMs:60000});
        if (identity === scope()) { retryAt = 0; await core.refreshModels(); }
        return result;
    }
    async function checkModelService({baseUrl,apiKey,interfaceType,serviceId}) {
        const generation = await requireModelServices();
        if (generation !== core.state.identityGeneration) throw {code:'ABORTED'};
        return core.accessApi('/model-services/check', {method:'POST',protectedWrite:true,body:{baseUrl,interfaceType,...(apiKey?{apiKey}:{}),...(serviceId?{serviceId}:{})},timeoutMs:20000});
    }
    return { modelServicesView, refreshModelServices, selectServiceModel, writeModelService, checkModelService, modelServiceFailureMessage, preferredServiceModel };
};
