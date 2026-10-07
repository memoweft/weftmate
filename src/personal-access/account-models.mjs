import { PRIVATE_PROFILE_ID, publicAccountModel, publicModelOperation } from '../personal-account-models/index.mjs';
import { failure } from './common.mjs';
import { PUBLIC_CODES } from './constants.mjs';

export function createAccountModelOperations(context) {
  const accountModelForProfile = (ownerId, profileId, account = context.accountState(ownerId)) => Object.values(account.accountModels ?? {})
    .find((model) => Object.values(model.revisions).some((revision) => revision.profileId === profileId));

  const modelVisible = (ownerId, profileId, account = context.accountState(ownerId)) => {
    if (typeof profileId !== 'string') return false;
    if (profileId.startsWith('private-model-')) {
      const model = PRIVATE_PROFILE_ID.test(profileId) ? accountModelForProfile(ownerId, profileId, account) : null;
      if (model?.status !== 'active') return false;
      return !Object.values(account.modelOperations ?? {}).some((operation) =>
        operation.accountModelId === model.accountModelId &&
        ['stop_using', 'remove'].includes(operation.kind) &&
        ['pending', 'applying', 'uncertain'].includes(operation.status));
    }
    if (context.hostOwner(ownerId)) return true;
    const marker = context.rootState.sharedModelProfiles.find((item) => item.id === profileId);
    if (!marker) return false;
    try { return context.sharedProfileIsFormal(marker) === true; } catch { return false; }
  };

  const modelSelectable = (ownerId, profileId) => {
    if (!modelVisible(ownerId, profileId)) return false;
    if (!profileId.startsWith('private-model-')) return true;
    const model = accountModelForProfile(ownerId, profileId);
    return model?.revisions[String(model.runtimeRevision)]?.profileId === profileId;
  };

  const messageModelUsable = (ownerId, session, account = context.accountState(ownerId)) => !!session &&
    (modelVisible(ownerId, session.modelProfileId, account) ||
      (context.hostOwner(ownerId) && session.modelProfileId === undefined));

  function accountModelView(ownerId, record) {
    const profileId = record.revisions[String(record.runtimeRevision)].profileId;
    let configured = false;
    try { configured = context.accountModelManager?.hasCredential(profileId) === true; } catch { /* Unknown is not configured. */ }
    return publicAccountModel(record, configured);
  }

  function modelOperationResponse(ownerId, operation) {
    const model = context.accountState(ownerId).accountModels?.[operation.accountModelId];
    return { operation: publicModelOperation(operation),
      ...(model ? { model: accountModelView(ownerId, model) } : {}) };
  }

  function completeModelOperation(next, operation, result) {
    const model = next.accountModels[operation.accountModelId];
    if (!model || operation.status !== 'applying' && operation.status !== 'uncertain') return;
    const now = new Date(context.timestamp()).toISOString();
    if (operation.kind === 'create') {
      model.status = 'active';
    } else if (operation.kind === 'update') {
      if (operation.target) {
        const target = operation.target;
        model.revisions[String(target.runtimeRevision)] = {
          revision: target.runtimeRevision, profileId: target.profileId,
          baseUrl: target.baseUrl, modelId: target.modelId,
          routeFingerprint: target.routeFingerprint, createdAt: now,
        };
        model.runtimeRevision = target.runtimeRevision;
      }
      if (operation.name !== undefined) model.name = operation.name;
      model.revision++;
      model.updatedAt = now;
    } else if (operation.kind === 'stop_using' || operation.kind === 'remove') {
      model.status = operation.kind === 'remove' ? 'removed' : 'stopped';
      model.revision++;
      model.updatedAt = now;
    } else if (operation.kind === 'test') {
      operation.testResult = { configured: result?.configured === true,
        reachable: result?.reachable === true, modelListed: result?.modelListed === true };
    }
    operation.status = 'succeeded'; operation.resultRevision = model.revision;
    delete operation.reasonCode; delete operation.errorCode;
    operation.updatedAt = now;
  }

  async function reconcileModelOperation(ownerId, requestId) {
    if (!context.accountModelManager) return;
    const operation = context.accountState(ownerId).modelOperations?.[requestId];
    if (!operation || operation.status !== 'uncertain' || operation.kind === 'test') return;
    let observed;
    try {
      observed = await context.accountModelManager.inspect({ ownerId, kind: operation.kind,
        target: operation.target, profileIds: Object.values(
          context.accountState(ownerId).accountModels[operation.accountModelId].revisions)
          .map((item) => item.profileId) });
    } catch { return; }
    if (observed?.applied !== true && observed?.clean !== true) return;
    await context.serial(() => context.mutate(ownerId, (next) => {
      const current = next.modelOperations?.[requestId];
      if (current?.status !== 'uncertain') return;
      if (observed.applied === true) completeModelOperation(next, current, observed);
      else {
        current.status = 'failed'; current.errorCode = 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED';
        delete current.reasonCode;
        current.updatedAt = new Date(context.timestamp()).toISOString();
        if (current.kind === 'create') next.accountModels[current.accountModelId].status = 'failed';
      }
    }));
  }

  async function driveModelOperation(ownerId, requestId) {
    if (!context.accountModelManager || context.closing || context.storageFault) return;
    const before = context.accountState(ownerId).modelOperations?.[requestId];
    if (before?.status !== 'pending') return;
    await context.serial(() => context.mutate(ownerId, (next) => {
      const current = next.modelOperations?.[requestId];
      if (current?.status !== 'pending') return;
      current.status = 'applying'; current.updatedAt = new Date(context.timestamp()).toISOString();
      delete current.reasonCode;
    }));
    const operation = context.accountState(ownerId).modelOperations[requestId];
    if (operation.status !== 'applying') return;
    let result;
    try {
      if (operation.kind === 'create' || operation.kind === 'update') {
        result = operation.target ? await context.accountModelManager.apply({ ownerId,
          requestId, kind: operation.kind, accountModelId: operation.accountModelId,
          target: operation.target, stageRef: operation.stageRef,
          previousProfileId: operation.previousProfileId }) : { applied: true };
      } else if (operation.kind === 'test') {
        const model = context.accountState(ownerId).accountModels[operation.accountModelId];
        result = await context.accountModelManager.test({ ownerId,
          profileId: model.revisions[String(model.runtimeRevision)].profileId });
      } else {
        const model = context.accountState(ownerId).accountModels[operation.accountModelId];
        result = await context.accountModelManager.disable({ ownerId,
          profileIds: Object.values(model.revisions).map((item) => item.profileId),
          stageRefs: Object.values(context.accountState(ownerId).modelOperations ?? {})
            .filter((item) => item.accountModelId === operation.accountModelId && item.stageRef)
            .map((item) => item.stageRef) });
      }
      if (result?.applied === false) throw failure('ACCOUNT_MODEL_ROUTE_UNCONFIRMED', 503);
    } catch (error) {
      if (context.closing) return;
      const busy = error?.code === 'ACCOUNT_MODEL_BUSY';
      await context.serial(() => context.mutate(ownerId, (next) => {
        const current = next.modelOperations?.[requestId];
        if (current?.status !== 'applying') return;
        current.status = busy ? 'pending' : error?.definite === true ? 'failed' : 'uncertain';
        current.reasonCode = busy ? 'RUNTIME_BUSY' : 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED';
        if (!busy) current.errorCode = PUBLIC_CODES.has(error?.code)
          ? error.code : 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED';
        current.updatedAt = new Date(context.timestamp()).toISOString();
        if (current.status === 'failed' && current.kind === 'create') {
          next.accountModels[current.accountModelId].status = 'failed';
        }
      }));
      if (busy && !context.closing) {
        const timer = setTimeout(() => scheduleModelOperation(ownerId, requestId), 2000);
        timer.unref?.();
      }
      return;
    }
    if (context.closing) return;
    await context.serial(() => context.mutate(ownerId, (next) => {
      const current = next.modelOperations?.[requestId];
      if (current?.status === 'applying') completeModelOperation(next, current, result);
    }));
  }

  function scheduleModelOperation(ownerId, requestId) {
    const key = `${ownerId}|${requestId}`;
    if (context.activeModelOperations.has(key) || context.closing) return;
    const work = Promise.resolve().then(() => driveModelOperation(ownerId, requestId))
      .catch(() => {}).finally(() => context.activeModelOperations.delete(key));
    context.activeModelOperations.set(key, work);
  }

  return {
    accountModelForProfile,
    modelVisible,
    modelSelectable,
    messageModelUsable,
    accountModelView,
    modelOperationResponse,
    completeModelOperation,
    reconcileModelOperation,
    driveModelOperation,
    scheduleModelOperation,
    canUseModelProfile(ownerId, profileId, usage = 'bound') {
      return Object.hasOwn(context.rootState.accounts, ownerId) &&
        typeof profileId === 'string' && (usage === 'new' ? modelSelectable(ownerId, profileId)
          : modelVisible(ownerId, profileId));
    },
    isFormalLocalProfile(profileId) {
      const marker = context.rootState.sharedModelProfiles.find((item) => item.id === profileId);
      if (!marker) return false;
      try { return context.sharedProfileIsFormal(marker) === true; } catch { return false; }
    },
    privateAccountModelProof(ownerId, profileId) {
      if (!PRIVATE_PROFILE_ID.test(profileId ?? '') || !Object.hasOwn(context.rootState.accounts, ownerId)) return null;
      const model = accountModelForProfile(ownerId, profileId);
      const revision = model && Object.values(model.revisions)
        .find((item) => item.profileId === profileId);
      if (!revision || !modelVisible(ownerId, profileId)) return null;
      return { active: true, profileId, baseUrl: revision.baseUrl, modelId: revision.modelId,
        routeFingerprint: revision.routeFingerprint };
    }
  };
}
