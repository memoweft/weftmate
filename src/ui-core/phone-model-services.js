/* Phone-owned service state. Credentials live only in memory in an ordinary browser. */
(() => {
  async function create({ catalog, fetchImpl = globalThis.fetch, now = Date.now, crypto = globalThis.crypto, changed = () => {} } = {}) {
    catalog ||= await import('./model-service-catalog.mjs');
    let services = [], selected = null;
    const pending = new Map();
    const publicService = service => ({ serviceId: service.serviceId, name: service.name, baseUrl: service.baseUrl,
      endpoint: service.baseUrl, interfaceType: service.interfaceType, models: structuredClone(service.models),
      catalog: { ...service.catalog }, selectedModelId: selected?.serviceId === service.serviceId ? selected.modelId : null });
    const view = () => ({ services: services.map(publicService), selected: selected && { ...selected }, loading: pending.size > 0 });
    const find = serviceId => {
      const service = services.find(row => row.serviceId === serviceId);
      if (!service) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
      return service;
    };
    const currentModel = () => {
      if (!selected) return null;
      const service = services.find(row => row.serviceId === selected.serviceId);
      const model = service?.models.find(row => row.modelId === selected.modelId);
      return model && { serviceId: service.serviceId, baseUrl: service.baseUrl, endpoint: service.baseUrl,
        modelId: model.modelId, displayName: model.name, interfaceType: service.interfaceType,
        apiKey: service.apiKey, capabilities: model.capabilities, deepThinking: model.deepThinking };
    };
    const selectedView = () => {
      const model = currentModel();
      if (!model) return null;
      const { apiKey, ...publicModel } = model;
      return { source: 'phone', ...publicModel };
    };
    function select(serviceId, modelId) {
      const service = find(serviceId), model = service.models.find(row => row.modelId === modelId);
      if (!model) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
      model.enabled = true; model.lastUsedAt = now(); selected = { serviceId, modelId }; changed(view());
      return selectedView();
    }
    async function refresh(serviceId, { force = false } = {}) {
      const targets = serviceId ? [find(serviceId)] : services;
      await Promise.all(targets.map(service => {
        const route = { baseUrl: service.baseUrl, apiKey: service.apiKey, interfaceType: service.interfaceType };
        const previous = pending.get(service.serviceId);
        if (previous && previous.baseUrl === route.baseUrl && previous.apiKey === route.apiKey && previous.interfaceType === route.interfaceType) return previous.promise;
        const checkedAt = Date.parse(service.catalog.checkedAt);
        if (!force && Number.isFinite(checkedAt) && now() - checkedAt < catalog.SERVICE_CATALOG_TTL_MS) return;
        const request = (async () => {
          const result = await catalog.queryServiceCatalog({ ...route, fetchImpl });
          if (!services.includes(service) || service.baseUrl !== route.baseUrl || service.apiKey !== route.apiKey || service.interfaceType !== route.interfaceType) return;
          service.catalog = { status: result.status, checkedAt: result.checkedAt, message: result.message };
          if (result.status === 'available') {
            const preferences = new Map(service.models.map(model => [model.modelId, model.deepThinking?.enabled]));
            service.models = catalog.mergeServiceModels(service.models, result.models).map(model => model.deepThinking && preferences.has(model.modelId)
              ? { ...model, deepThinking: { ...model.deepThinking, enabled: preferences.get(model.modelId) === true } } : model);
          }
          if (!selected) {
            const modelId = catalog.recommendServiceModel(service.models);
            if (modelId) selected = { serviceId: service.serviceId, modelId };
          }
        })().finally(() => { if (pending.get(service.serviceId)?.promise === request) pending.delete(service.serviceId); changed(view()); });
        pending.set(service.serviceId, { ...route, promise: request }); changed(view()); return request;
      }));
      return { ...view(), model: selectedView() };
    }
    async function configure(params) {
      const baseUrl = catalog.canonicalServiceBaseUrl(params.endpoint ?? params.baseUrl ?? '');
      if (!baseUrl) throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' });
      const url = new URL(baseUrl);
      if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('INVALID_REQUEST');
      const previous = params.serviceId ? find(params.serviceId) : null;
      const apiKey = params.apiKey || previous?.apiKey || '';
      if (!apiKey) throw Object.assign(new Error('MODEL_NOT_CONFIGURED'), { code: 'MODEL_NOT_CONFIGURED' });
      const interfaceType = params.interfaceType || previous?.interfaceType || 'openai-compatible';
      if (!['openai-compatible', 'anthropic'].includes(interfaceType)) throw Error('INVALID_REQUEST');
      if (params.modelId && !/^[A-Za-z0-9._:/-]{1,128}$/.test(params.modelId)) throw Error('INVALID_REQUEST');
      let service = previous || services.find(row => row.baseUrl === baseUrl && row.apiKey === apiKey && row.interfaceType === interfaceType);
      if (!service) { service = { serviceId: crypto.randomUUID(), models: [], catalog: { status: 'not_checked' } }; services.push(service); }
      if (service.baseUrl !== baseUrl || service.apiKey !== apiKey) service.catalog = { status: 'not_checked' };
      Object.assign(service, { baseUrl, apiKey, interfaceType, name: (params.name || service.name || '模型服务').trim().slice(0, 100) });
      // A known preset or old hand-entered model remains available when a service has no directory.
      if (params.modelId) {
        if (!/^[A-Za-z0-9._:/-]{1,128}$/.test(params.modelId)) throw Error('INVALID_REQUEST');
        service.models = catalog.mergeServiceModels(service.models, [{ modelId: params.modelId,
          name: catalog.modelDisplayName(params.modelId, params.displayName), enabled: true, manual: true }]);
      }
      await refresh(service.serviceId, { force: true });
      if (service.models.length && (!previous || !selected)) select(service.serviceId, catalog.recommendServiceModel(service.models,
        selected?.serviceId === service.serviceId ? selected.modelId : undefined));
      return { ...view(), service: publicService(service), model: selectedView() };
    }
    function update(params) {
      const service = find(params.serviceId);
      if (Array.isArray(params.enabledModelIds)) {
        const enabled = new Set(params.enabledModelIds);
        service.models = service.models.map(model => ({ ...model, enabled: enabled.has(model.modelId) }));
      }
      if (params.modelId) {
        if (!/^[A-Za-z0-9._:/-]{1,128}$/.test(params.modelId)) throw Error('INVALID_REQUEST');
        if (!service.models.some(model => model.modelId === params.modelId)) service.models.push({ modelId: params.modelId,
          name: catalog.modelDisplayName(params.modelId, params.displayName), enabled: true, manual: true });
        if (!selected) select(service.serviceId, params.modelId);
      }
      if (selected?.serviceId === service.serviceId && !service.models.some(model => model.modelId === selected.modelId && model.enabled !== false)) {
        const modelId = catalog.recommendServiceModel(service.models);
        if (modelId) select(service.serviceId, modelId); else selected = null;
      }
      changed(view()); return { ...view(), model: selectedView() };
    }
    function remove(serviceId) {
      services = services.filter(service => service.serviceId !== serviceId);
      if (selected?.serviceId === serviceId) selected = null;
      changed(view()); return { ...view(), model: selectedView() };
    }
    const clear = () => { for (const service of services) service.apiKey = ''; services = []; selected = null; changed(view()); };
    function setDeepThinking(enabled) {
      if (!selected) return;
      const model = find(selected.serviceId).models.find(row => row.modelId === selected.modelId);
      if (model?.deepThinking?.supported !== true) return;
      model.deepThinking = { ...model.deepThinking, enabled: enabled === true }; changed(view());
    }
    return { view, configure, refresh, select, update, remove, clear, currentModel, selectedView, setDeepThinking };
  }
  globalThis.WeftPhoneModelServices = { create };
})();
