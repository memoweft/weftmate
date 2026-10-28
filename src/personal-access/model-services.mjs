import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { durableWrite } from './store.mjs';
import { canonicalAccountBaseUrl, digest, exactKeys, failure, plainObject } from './common.mjs';
import { MODEL_ID, privateProfileId } from '../personal-account-models/index.mjs';
import { modelRouteFingerprint } from '../model-route-fingerprint.mjs';
import { openAICompatibleEndpoint } from '../openai-compatible-client.ts';
import { SERVICE_CATALOG_TTL_MS, modelDisplayName, queryServiceCatalog, mergeServiceModels, recommendServiceModel } from '../model-service-catalog.mjs';

export const MODEL_SERVICE_ID = /^model-service-[0-9a-f-]{36}$/;
const PROFILE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CATALOG_STATES = ['unchecked', 'available', 'unsupported', 'authentication_failed', 'offline', 'failed', 'invalid'];

export function validModelService(record, serviceId) {
  return plainObject(record) && record.serviceId === serviceId && MODEL_SERVICE_ID.test(serviceId) &&
    typeof record.name === 'string' && !!record.name.trim() && record.name.length <= 120 &&
    canonicalAccountBaseUrl(record.baseUrl) === record.baseUrl && ['openai-compatible', 'anthropic'].includes(record.interfaceType) &&
    ['active', 'removed'].includes(record.status) && Number.isSafeInteger(record.revision) && record.revision >= 1 &&
    TIME.test(record.createdAt) && TIME.test(record.updatedAt) && Array.isArray(record.models) &&
    new Set(record.models.map(row => row.modelId)).size === record.models.length &&
    record.models.every(row => plainObject(row) && MODEL_ID.test(row.modelId) && typeof row.name === 'string' &&
      row.name.length <= 120 && typeof row.enabled === 'boolean' &&
      (row.profileId === undefined || PROFILE_ID.test(row.profileId)) &&
      (row.profileIds === undefined || Array.isArray(row.profileIds) && row.profileIds.every(id => PROFILE_ID.test(id))) &&
      (row.capabilities === undefined || plainObject(row.capabilities) &&
        (row.capabilities.vision === undefined || typeof row.capabilities.vision === 'boolean') &&
        (row.capabilities.contextWindow === undefined || Number.isSafeInteger(row.capabilities.contextWindow) && row.capabilities.contextWindow > 0)) &&
      (row.deepThinking === undefined || plainObject(row.deepThinking) && typeof row.deepThinking.supported === 'boolean')) &&
    (record.selectedModelId === null || record.models.some(row => row.modelId === record.selectedModelId)) &&
    plainObject(record.catalog) && CATALOG_STATES.includes(record.catalog.status) &&
    (record.catalog.checkedAt === null || TIME.test(record.catalog.checkedAt)) && typeof record.catalog.message === 'string' &&
    (record.credentialProfileId === undefined || PROFILE_ID.test(record.credentialProfileId)) &&
    (record.stageRef === undefined || /^pending-model-[a-f0-9]{48}$/.test(record.stageRef)) &&
    Object.keys(record).every(key => ['serviceId', 'name', 'baseUrl', 'interfaceType', 'status', 'revision', 'createdAt', 'updatedAt',
      'models', 'selectedModelId', 'catalog', 'credentialProfileId', 'stageRef'].includes(key));
}

export function publicModelService(record) {
  return { serviceId: record.serviceId, name: record.name, baseUrl: record.baseUrl, interfaceType: record.interfaceType,
    revision: record.revision, models: record.models.map(row => ({ ...row, ...(row.profileIds ? { profileIds: [...row.profileIds] } : {}) })),
    selectedModelId: record.selectedModelId, catalog: { ...record.catalog }, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

// Secrets participate only in in-memory equality; neither they nor key hashes enter the service metadata.
export function mergeLegacyModelServices(existing, profiles, selectedProfileId, now) {
  const services = structuredClone(existing ?? {});
  const groups = [];
  for (const source of profiles) {
    const baseUrl = canonicalAccountBaseUrl(source.baseUrl);
    if (!baseUrl || !MODEL_ID.test(source.modelId) || !source.profileId || !source.secret ||
      Object.values(services).some(row => row.status === 'removed' && row.models.some(model => model.profileId === source.profileId || model.profileIds?.includes(source.profileId)))) continue;
    let group = groups.find(row => row.baseUrl === baseUrl && row.secret === source.secret);
    if (!group) { group = { baseUrl, secret: source.secret, profiles: [] }; groups.push(group); }
    group.profiles.push(source);
  }
  for (const group of groups) {
    let service = Object.values(services).find(row => row.status === 'active' && row.baseUrl === group.baseUrl &&
      group.profiles.some(profile => row.credentialProfileId === profile.profileId ||
        row.models.some(model => model.profileId === profile.profileId || model.profileIds?.includes(profile.profileId))));
    if (!service) {
      const first = group.profiles[0], serviceId = `model-service-${randomUUID()}`;
      service = { serviceId, name: first.serviceName ?? first.name ?? '模型服务', baseUrl: group.baseUrl,
        interfaceType: first.interfaceType ?? 'openai-compatible', status: 'active', revision: 1, models: [], selectedModelId: null,
        credentialProfileId: first.profileId, catalog: { status: 'unchecked', checkedAt: null, message: '已保留原来的模型，正在查询这个服务的清单。' },
        createdAt: now, updatedAt: now };
      services[serviceId] = service;
    }
    for (const profile of group.profiles) {
      let model = service.models.find(row => row.modelId === profile.modelId);
      if (!model) { model = { modelId: profile.modelId, name: modelDisplayName(profile.modelId), enabled: true,
        profileId: profile.profileId, profileIds: [], ...(profile.deepThinking ? { deepThinking: profile.deepThinking } : {}) }; service.models.push(model); }
      model.profileId ??= profile.profileId;
      if (!model.profileIds?.includes(profile.profileId)) (model.profileIds ??= []).push(profile.profileId);
      if (profile.profileId === selectedProfileId) service.selectedModelId = profile.modelId;
    }
    service.selectedModelId ??= recommendServiceModel(service.models);
  }
  return services;
}

export function createModelServiceOperations(context) {
  const refreshes = new Map(), migrations = new Map();
  const now = () => new Date(context.timestamp()).toISOString();
  const requireService = (ownerId, serviceId) => {
    const record = context.accountState(ownerId).modelServices?.[serviceId];
    if (!record || record.status !== 'active') throw failure('NOT_FOUND', 404);
    return record;
  };
  async function backup() {
    const file = path.join(context.root, 'model-services-v1.before.json');
    try { await access(file); } catch (error) { if (error.code !== 'ENOENT') throw error; await durableWrite(file, context.rootState); }
  }
  async function migrate(ownerId) {
    if (!context.accountModelManager) return;
    if (migrations.has(ownerId)) return migrations.get(ownerId);
    const work = context.serial(async () => {
      const account = context.accountState(ownerId), profiles = [];
      for (const record of Object.values(account.accountModels ?? {})) if (record.status === 'active') {
        const row = record.revisions[String(record.runtimeRevision)];
        profiles.push({ profileId: row.profileId, modelId: row.modelId, baseUrl: row.baseUrl, name: record.name, interfaceType: row.interfaceType });
      }
      if (context.hostOwner(ownerId) && context.accountModelManager.listProfiles) {
        const legacy = await context.accountModelManager.listProfiles();
        for (const row of legacy) if (!row.id.startsWith('private-model-') && row.model &&
          !profiles.some(profile => profile.profileId === row.id)) profiles.push({ profileId: row.id, modelId: row.model, baseUrl: row.baseUrl, name: row.name, interfaceType: row.interfaceType });
      }
      for (const profile of profiles) profile.secret = await context.accountModelManager.readSecret({ ownerId, profileId: profile.profileId });
      const selectedProfileId = account.defaultModelProfileId ?? (context.hostOwner(ownerId) ? context.accountModelManager.selectedProfileId?.() : null);
      const merged = mergeLegacyModelServices(account.modelServices, profiles, selectedProfileId, now());
      if (JSON.stringify(merged) === JSON.stringify(account.modelServices ?? {})) return;
      await backup();
      await context.mutate(ownerId, next => {
        next.modelServices = merged; next.modelServiceMigration = 1;
        if (!next.defaultModelProfileId && profiles.some(profile => profile.profileId === selectedProfileId)) next.defaultModelProfileId = selectedProfileId;
      }, undefined, { recoverableMigration: true });
    }).catch(() => {}); // A failed migration leaves every legacy route/credential/reference usable.
    migrations.set(ownerId, work);
    try { await work; } finally { migrations.delete(ownerId); }
  }
  async function secretFor(ownerId, record) {
    if (record.stageRef && context.accountModelManager.readStagedSecret) return context.accountModelManager.readStagedSecret({ ownerId, stageRef: record.stageRef });
    for (const profileId of new Set([record.credentialProfileId, ...record.models.map(row => row.profileId)].filter(Boolean))) {
      const secret = await context.accountModelManager.readSecret({ ownerId, profileId });
      if (secret) return secret;
    }
    return null;
  }
  async function installModels(ownerId, record, models, stageRef = record.stageRef, allowedPendingSessionId = null, allowedPendingModelProfileId = null) {
    const missing = models.filter(row => row.enabled !== false && (!row.profileId || row.pendingInstallation === true));
    if (!missing.length) return models;
    await backup();
    const timestamp = now(), targets = missing.map(row => {
      const existing = row.pendingInstallation && context.accountModelForProfile(ownerId, row.profileId);
      const accountModelId = existing?.accountModelId ?? `account-model-${randomUUID()}`;
      return { row, accountModelId, target: { runtimeRevision: 1, profileId: existing ? row.profileId : privateProfileId(ownerId, accountModelId, 1),
        baseUrl: record.baseUrl, modelId: row.modelId, name: row.name, interfaceType: record.interfaceType,
        ...(row.deepThinking ? { deepThinking: { ...row.deepThinking } } : {}), routeFingerprint: modelRouteFingerprint(
          openAICompatibleEndpoint(record.baseUrl, 'chat/completions').href, row.modelId) } };
    });
    const result = await context.accountModelManager.apply({ ownerId, targets: targets.map(row => row.target), target: targets[0].target,
      stageRef, previousProfileId: record.credentialProfileId, ...(allowedPendingSessionId ? { allowedPendingSessionId } : {}),
      ...(allowedPendingModelProfileId ? { allowedPendingModelProfileId } : {}) });
    if (result?.applied === false) throw failure('ACCOUNT_MODEL_ROUTE_UNCONFIRMED', 503);
    await context.serial(() => context.mutate(ownerId, next => {
      next.accountModels ??= {};
      for (const { target, accountModelId } of targets) next.accountModels[accountModelId] = {
        accountModelId, ownerId, revision: 1, runtimeRevision: 1, name: target.name, status: 'active',
        revisions: { '1': { revision: 1, profileId: target.profileId, baseUrl: target.baseUrl, modelId: target.modelId,
          interfaceType: target.interfaceType, ...(target.deepThinking ? { deepThinking: target.deepThinking } : {}), routeFingerprint: target.routeFingerprint, createdAt: timestamp } }, createdAt: timestamp, updatedAt: timestamp };
    }));
    const installed = new Map(targets.map(({ row, target }) => [row.modelId, target.profileId]));
    return models.map(row => { if (!installed.has(row.modelId)) return row; const { pendingInstallation, ...ready } = row;
      return { ...ready, profileId: installed.get(row.modelId), profileIds: [...new Set([...(row.profileIds ?? []), installed.get(row.modelId)])] }; });
  }
  async function reserveModel(ownerId, service, row) {
    const accountModelId = `account-model-${randomUUID()}`, profileId = privateProfileId(ownerId, accountModelId, 1), timestamp = now();
    const selected = { ...row, profileId, profileIds: [profileId], pendingInstallation: true };
    await backup();
    await context.serial(() => context.mutate(ownerId, next => {
      next.accountModels ??= {};
      next.accountModels[accountModelId] = { accountModelId, ownerId, revision: 1, runtimeRevision: 1, name: row.name, status: 'active',
        revisions: { '1': { revision: 1, profileId, baseUrl: service.baseUrl, modelId: row.modelId, interfaceType: service.interfaceType,
          ...(row.deepThinking ? { deepThinking: { ...row.deepThinking } } : {}),
          routeFingerprint: modelRouteFingerprint(openAICompatibleEndpoint(service.baseUrl, 'chat/completions').href, row.modelId), createdAt: timestamp } }, createdAt: timestamp, updatedAt: timestamp };
      Object.assign(next.modelServices[service.serviceId].models.find(model => model.modelId === row.modelId), selected);
    }));
    return selected;
  }
  function initialModels(ownerId, record, models) {
    // The released Apple client accepts 500 flattened profiles. Keep its existing
    // compatibility budget separate from the complete, searchable service directory.
    const slots = Math.max(0, 500 - Object.keys(context.accountState(ownerId).accountModels ?? {}).length);
    const enabled = models.filter(row => row.enabled !== false && !row.profileId);
    enabled.sort((a, b) => Number(b.modelId === record.selectedModelId) - Number(a.modelId === record.selectedModelId));
    const chosen = new Set(enabled.slice(0, slots).map(row => row.modelId));
    return models.filter(row => row.profileId || chosen.has(row.modelId));
  }
  function refresh(ownerId, serviceId) {
    const key = `${ownerId}|${serviceId}`;
    if (refreshes.has(key)) return refreshes.get(key);
    const work = (async () => {
      const before = requireService(ownerId, serviceId), apiKey = await secretFor(ownerId, before);
      const queried = await queryServiceCatalog({ ...before, apiKey, ...(context.accountModelManager.fetchCatalog ? { fetchImpl: context.accountModelManager.fetchCatalog } : {}), signal: context.closingSignal });
      if (context.closing) return;
      let models = queried.status === 'available' ? mergeServiceModels(before.models, queried.models) : before.models;
      // Directory discovery is useful even when a running conversation prevents route installation.
      if (queried.status === 'available') try { models = mergeServiceModels(models, await installModels(ownerId, before, initialModels(ownerId, before, models))); } catch { /* Selection retries installation when the runtime becomes idle. */ }
      await context.serial(() => context.mutate(ownerId, next => {
        const current = next.modelServices?.[serviceId];
        if (!current || current.status !== 'active' || current.baseUrl !== before.baseUrl || current.revision !== before.revision) return;
        current.models = mergeServiceModels(current.models, models);
        current.selectedModelId = recommendServiceModel(current.models, current.selectedModelId);
        current.catalog = Object.fromEntries(Object.entries(queried).filter(([field]) => field !== 'models'));
        const profile = current.models.find(row => row.profileId)?.profileId;
        if (profile) { current.credentialProfileId = profile; delete current.stageRef; }
        current.updatedAt = now();
      }));
      return publicModelService(requireService(ownerId, serviceId));
    })().finally(() => refreshes.delete(key));
    refreshes.set(key, work);
    return work;
  }
  async function list(ownerId, { refreshStale = true } = {}) {
    await migrate(ownerId);
    const records = Object.values(context.accountState(ownerId).modelServices ?? {}).filter(row => row.status === 'active');
    if (refreshStale) for (const record of records) if (!record.catalog.checkedAt || context.timestamp() - Date.parse(record.catalog.checkedAt) >= SERVICE_CATALOG_TTL_MS)
      refresh(ownerId, record.serviceId).catch(() => {});
    return records.map(publicModelService);
  }
  function validateInput(body, update = false) {
    exactKeys(body, ['requestId', 'expectedRevision', 'name', 'baseUrl', 'apiKey', 'interfaceType', 'modelId', 'models', 'selectedModelId'], update ? ['requestId', 'expectedRevision'] : ['requestId', 'name', 'baseUrl', 'apiKey']);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(body.requestId ?? '') ||
        update && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) ||
        body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) ||
        body.baseUrl !== undefined && !canonicalAccountBaseUrl(body.baseUrl) ||
        body.apiKey !== undefined && (typeof body.apiKey !== 'string' || !body.apiKey || body.apiKey.length > 4096) ||
        body.interfaceType !== undefined && !['openai-compatible', 'anthropic'].includes(body.interfaceType) ||
        body.modelId !== undefined && !MODEL_ID.test(body.modelId) ||
        body.selectedModelId !== undefined && !MODEL_ID.test(body.selectedModelId) ||
        body.models !== undefined && (!Array.isArray(body.models) || body.models.some(row => !plainObject(row) || !MODEL_ID.test(row.modelId) || typeof row.enabled !== 'boolean' || Object.keys(row).some(key => !['modelId', 'enabled'].includes(key))))) throw failure('INVALID_REQUEST');
  }
  async function configure(ownerId, body, serviceId = null) {
    validateInput(body, !!serviceId);
    await migrate(ownerId);
    const fingerprint = digest(JSON.stringify({ serviceId, ...body }));
    const previous = context.accountState(ownerId).modelServiceOperations?.[body.requestId];
    if (previous) { if (previous.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409); return previous.response; }
    if (context.requestIdUsed(context.accountState(ownerId), body.requestId)) throw failure('REQUEST_CONFLICT', 409);
    let before = serviceId ? requireService(ownerId, serviceId) : null;
    if (!before) for (const existing of Object.values(context.accountState(ownerId).modelServices ?? {})) {
      if (existing.status === 'active' && existing.baseUrl === canonicalAccountBaseUrl(body.baseUrl) &&
        existing.interfaceType === (body.interfaceType ?? 'openai-compatible') && await secretFor(ownerId, existing) === body.apiKey) {
        before = existing; serviceId = existing.serviceId; break;
      }
    }
    if (before && body.expectedRevision !== undefined && before.revision !== body.expectedRevision) throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
    const baseUrl = body.baseUrl ? canonicalAccountBaseUrl(body.baseUrl) : before.baseUrl;
    if (before && baseUrl !== before.baseUrl && !body.apiKey) throw failure('ACCOUNT_MODEL_SECRET_REQUIRED');
    const apiKey = body.apiKey ?? await secretFor(ownerId, before);
    const interfaceType = body.interfaceType ?? before?.interfaceType ?? 'openai-compatible';
    const keyChanged = body.apiKey !== undefined && (!before || body.apiKey !== await secretFor(ownerId, before));
    const stageRef = keyChanged ? `pending-model-${digest(`${ownerId}|${body.requestId}|${fingerprint}`).slice(0, 48)}` : before?.stageRef;
    if (keyChanged) await context.accountModelManager.stageSecret({ ownerId, stageRef, apiKey });
    const queried = body.apiKey || body.baseUrl || !before
      ? await queryServiceCatalog({ baseUrl, apiKey, interfaceType, ...(context.accountModelManager.fetchCatalog ? { fetchImpl: context.accountModelManager.fetchCatalog } : {}), signal: context.closingSignal }) : null;
    const routeChange = before && (baseUrl !== before.baseUrl || keyChanged || interfaceType !== before.interfaceType);
    let models = routeChange ? before.models.map(({ profileId, ...row }) => row) : before?.models ?? [];
    if (queried?.status === 'available') models = mergeServiceModels(models, queried.models);
    if (body.modelId && !models.some(row => row.modelId === body.modelId)) models = [...models, { modelId: body.modelId, name: modelDisplayName(body.modelId), enabled: true, manual: true }];
    if (body.models) models = models.map(row => ({ ...row, enabled: body.models.find(item => item.modelId === row.modelId)?.enabled ?? row.enabled }));
    const timestamp = now();
    const record = { serviceId: serviceId ?? `model-service-${randomUUID()}`, name: body.name?.trim() ?? before.name, baseUrl, interfaceType,
      status: 'active', revision: (before?.revision ?? 0) + 1, models, selectedModelId: recommendServiceModel(models, body.selectedModelId ?? before?.selectedModelId),
      catalog: queried ? Object.fromEntries(Object.entries(queried).filter(([field]) => field !== 'models')) : before.catalog,
      createdAt: before?.createdAt ?? timestamp, updatedAt: timestamp,
      ...(stageRef ? { stageRef } : {}), ...(before?.credentialProfileId ? { credentialProfileId: before.credentialProfileId } : {}) };
    if (models.length) {
      record.models = mergeServiceModels(models, await installModels(ownerId, record, initialModels(ownerId, record, models), stageRef));
      record.credentialProfileId = record.models.find(row => row.profileId)?.profileId;
      if (!record.stageRef || record.models.some(row => !models.find(previous => previous.modelId === row.modelId)?.profileId)) delete record.stageRef;
    }
    const response = { service: publicModelService(record) };
    await backup();
    await context.serial(() => context.mutate(ownerId, next => {
      if (before && next.modelServices?.[serviceId]?.revision !== before.revision) throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
      next.modelServices ??= {}; next.modelServiceOperations ??= {};
      next.modelServices[record.serviceId] = record;
      next.modelServiceOperations[body.requestId] = { fingerprint, response };
      const selected = record.models.find(row => row.modelId === record.selectedModelId);
      if (!next.defaultModelProfileId && selected?.profileId) next.defaultModelProfileId = selected.profileId;
    }));
    return response;
  }
  async function select(ownerId, serviceId, body) {
    exactKeys(body, ['modelId', 'sessionId', 'requestId', 'preference'], ['modelId']);
    if (!MODEL_ID.test(body.modelId) || body.sessionId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(body.sessionId) ||
        body.requestId !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.requestId) ||
        body.preference !== undefined && body.preference !== 'conversation') throw failure('INVALID_REQUEST');
    let service = requireService(ownerId, serviceId), selected = service.models.find(row => row.modelId === body.modelId && row.enabled);
    if (!selected) throw failure('MODEL_UNAVAILABLE', 422);
    if (!selected.profileId) {
      try { const installed = await installModels(ownerId, service, [selected]); selected = installed[0]; }
      catch (error) { if (error?.code !== 'ACCOUNT_MODEL_BUSY') throw error; selected = await reserveModel(ownerId, service, selected); }
      await context.serial(() => context.mutate(ownerId, next => {
        const record = next.modelServices[serviceId], row = record.models.find(model => model.modelId === body.modelId); Object.assign(row, selected);
        if (!selected.pendingInstallation) { record.credentialProfileId = selected.profileId; delete record.stageRef; }
      }));
    }
    if (body.sessionId && !context.accountState(ownerId).sessions[body.sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
    await context.serial(() => context.mutate(ownerId, next => {
      const record = next.modelServices[serviceId], row = record.models.find(model => model.modelId === body.modelId);
      if (!row.enabled || record.status !== 'active') throw failure('MODEL_UNAVAILABLE', 422);
      row.lastUsedAt = now();
      if (body.preference !== 'conversation') { record.selectedModelId = row.modelId; next.defaultModelProfileId = row.profileId; }
      if (body.sessionId) next.sessions[body.sessionId].pendingModelProfileId = row.profileId;
    }));
    service = requireService(ownerId, serviceId);
    return { profileId: selected.profileId, service: publicModelService(service),
      models: context.visibleModels(ownerId, await context.backend.listModels({ ownerId })) };
  }
  async function ensureProfile(ownerId, profileId, { allowedPendingSessionId = null, allowedPendingModelProfileId = null } = {}) {
    const service = Object.values(context.accountState(ownerId).modelServices ?? {}).find(record => record.status === 'active' && record.models.some(row => row.profileId === profileId));
    const pendingModel = service?.models.find(row => row.profileId === profileId && row.pendingInstallation);
    if (pendingModel) {
      let installed;
      try { installed = await installModels(ownerId, service, [pendingModel], service.stageRef, allowedPendingSessionId, allowedPendingModelProfileId); }
      catch (error) { if (error?.code === 'ACCOUNT_MODEL_BUSY') return false; throw error; }
      await context.serial(() => context.mutate(ownerId, next => {
        const record = next.modelServices[service.serviceId]; Object.assign(record.models.find(row => row.profileId === profileId), installed[0]);
        delete record.models.find(row => row.profileId === profileId).pendingInstallation;
        record.credentialProfileId = profileId; delete record.stageRef;
      }));
    }
    return true;
  }
  async function applyPendingSelection(ownerId, sessionId) {
    const session = context.accountState(ownerId).sessions[sessionId], profileId = session?.pendingModelProfileId;
    if (!profileId || profileId === session.modelProfileId) return true;
    if (!context.backend.selectSessionModel) throw failure('CAPABILITY_UNAVAILABLE', 503);
    if ((await context.backend.describeSession(sessionId, ownerId))?.running === true) return false;
    if (!await ensureProfile(ownerId, profileId, { allowedPendingSessionId: sessionId })) return false;
    return context.serial(async () => {
      const latest = context.accountState(ownerId).sessions[sessionId];
      if (latest?.pendingModelProfileId !== profileId) return false;
      const result = await context.backend.selectSessionModel({ ownerId, sessionId, modelProfileId: profileId });
      if (result?.pending) return false;
      await context.mutate(ownerId, next => {
        const current = next.sessions[sessionId];
        current.modelSelection ??= { originalProfileId: current.modelProfileId };
        current.modelProfileId = profileId;
        if (current.pendingModelProfileId === profileId) delete current.pendingModelProfileId;
        const bound = current.conversationId && next.conversationBindings?.[current.conversationId];
        if (bound) { bound.originalModelProfileId ??= bound.modelProfileId; bound.modelProfileId = profileId; }
      });
      return true;
    });
  }
  async function remove(ownerId, serviceId, body) {
    exactKeys(body, ['requestId', 'expectedRevision'], ['requestId', 'expectedRevision']);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(body.requestId ?? '') || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw failure('INVALID_REQUEST');
    const fingerprint = digest(JSON.stringify({ action: 'remove', serviceId, ...body }));
    const previous = context.accountState(ownerId).modelServiceOperations?.[body.requestId];
    if (previous) { if (previous.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409); return previous.response; }
    if (context.requestIdUsed(context.accountState(ownerId), body.requestId)) throw failure('REQUEST_CONFLICT', 409);
    const record = requireService(ownerId, serviceId);
    if (record.revision !== body.expectedRevision) throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
    const profileIds = record.models.flatMap(row => row.profileIds ?? (row.profileId ? [row.profileId] : []));
    if (context.accountModelManager.disableService) await context.accountModelManager.disableService({ ownerId, profileIds, stageRefs: record.stageRef ? [record.stageRef] : [] });
    else await context.accountModelManager.disable({ ownerId, profileIds: profileIds.filter(id => id.startsWith('private-model-')), stageRefs: record.stageRef ? [record.stageRef] : [] });
    await context.serial(() => context.mutate(ownerId, next => {
      if (next.modelServices[serviceId].revision !== body.expectedRevision) throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
      const service = next.modelServices[serviceId]; service.status = 'removed'; service.revision++; service.updatedAt = now();
      for (const model of Object.values(next.accountModels ?? {})) if (Object.values(model.revisions).some(row => profileIds.includes(row.profileId))) { model.status = 'removed'; model.revision++; }
      next.modelServiceOperations ??= {}; next.modelServiceOperations[body.requestId] = { fingerprint, response: { removed: true } };
    }));
    return { removed: true };
  }
  async function check(ownerId, body) {
    exactKeys(body, ['baseUrl', 'apiKey', 'interfaceType', 'serviceId'], []);
    const service = body.serviceId ? requireService(ownerId, body.serviceId) : null;
    const baseUrl = canonicalAccountBaseUrl(body.baseUrl ?? service?.baseUrl);
    if (service && baseUrl !== service.baseUrl && !body.apiKey) throw failure('ACCOUNT_MODEL_SECRET_REQUIRED');
    const apiKey = body.apiKey ?? (service ? await secretFor(ownerId, service) : null);
    if (!baseUrl || typeof apiKey !== 'string' || !apiKey || apiKey.length > 4096) throw failure('INVALID_REQUEST');
    return queryServiceCatalog({ baseUrl, apiKey, interfaceType: body.interfaceType ?? service?.interfaceType ?? 'openai-compatible',
      ...(context.accountModelManager.fetchCatalog ? { fetchImpl: context.accountModelManager.fetchCatalog } : {}), signal: context.closingSignal });
  }
  return { migrate, list, configure, select, refresh, remove, check, ensureProfile, applyPendingSelection,
    refreshing: (ownerId, serviceId) => refreshes.has(`${ownerId}|${serviceId}`),
    async close() { await Promise.allSettled([...refreshes.values(), ...migrations.values()]); } };
}
