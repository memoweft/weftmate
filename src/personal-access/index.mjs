import path from 'node:path';
import { failure, plainObject, withDeadline } from './common.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import {
  CLOSE_TIMEOUT_MS,
  DISPATCH_TIMEOUT_MS,
  INTERNAL_ARTIFACT_KIND,
  LEGACY_VERSION,
  SINGLE_ACCOUNT_VERSION,
  VERSION
} from './constants.mjs';
import { durableWrite, validateSingleStore, validateStore, validSharedProfile } from './store.mjs';
import { randomUUID } from 'node:crypto';
import { createPersonalArtifactStore } from '../personal-artifacts/index.mjs';
import { invalidateToolApproval, invalidateUserQuestion } from './interaction-policy.mjs';
import { createPersonalSyncStore } from '../personal-sync/index.mjs';
import { createAttachmentStore } from '../personal-sync/attachments.mjs';
import { createSharedAttachmentStore } from './shared-attachments.mjs';
import { createMobileUiPublisher } from './mobile-ui-release.mjs';
import { createNativeDownloadPublisher } from './native-downloads.mjs';
import { createServer } from 'node:http';
import { createSessionOperations } from './sessions.mjs';
import { createAuthenticationOperations } from './authentication.mjs';
import { createUserQuestionOperations } from './user-questions.mjs';
import { createApprovalOperations } from './approvals.mjs';
import { createTaskOperations } from './tasks.mjs';
import { createWorkspaceOperations } from './workspaces.mjs';
import { createCommandOperations } from './commands.mjs';
import { createAccountModelOperations } from './account-models.mjs';
import { createArtifactOperations } from './artifacts.mjs';
import { createHttpHandler } from './http.mjs';
import { createMemoryHttpHandler } from './memory-http.mjs';
import { createPersonalHealthStore } from '../personal-health/index.mjs';
import { createHostCloudIdentity } from '../personal-cloud/index.mjs';
import { createHostRelay } from '../personal-relay/index.mjs';
import { backupBeforeCloud } from '../personal-cloud/storage.mjs';
export { explicitNotepadOpenIntent } from './command-policy.mjs';
export { uniqueSessionOwner } from './store.mjs';

/**
 * Create one owner-scoped access service in the Electron main process.
 * Factory restores durable state without listening. `start()` binds 127.0.0.1;
 * port 0 is for isolated tests. Enrollment, revocation and attachSession are
 * local-host management calls and are never exposed over HTTP.
 *
 * Backend callbacks: getStatus(), listModels(), preflight(command),
 * createSession({sessionId,modelProfileId}), sendMessage({sessionId,text,mode}),
 * cancelSession({sessionId}), readEvents({sessionId,afterSeq,limit}),
 * describeSession(sessionId). `preflight` must not send a model request.
 * Message mode is the DSH mode `queue` or `steer`, defaulting to `queue`.
 * readEvents must project durable DSH history into increasing seq values;
 * nextSeq is the scanned durable-history watermark, including filtered records.
 */
export async function createPersonalAccessService({ root, port, backend, uiHandler, androidPackagePath = null,
  mobileUiDir = null, sharedProfileIsFormal = () => false, memoryManager = null,
  allowedOrigins = [], trustedProxy = false, clock = Date.now, verifyToolResult = null,
  browserReader = null, accountModelManager = null, cloudIdentity = null, relay = null }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) ||
      !Number.isInteger(port) || port < 0 || port > 65535 || !plainObject(backend) ||
      (uiHandler !== undefined && typeof uiHandler !== 'function') ||
      typeof sharedProfileIsFormal !== 'function' ||
      (accountModelManager !== null && (typeof accountModelManager.stageSecret !== 'function' ||
        typeof accountModelManager.apply !== 'function' ||
        typeof accountModelManager.inspect !== 'function' ||
        typeof accountModelManager.hasCredential !== 'function' ||
        typeof accountModelManager.test !== 'function' ||
        typeof accountModelManager.disable !== 'function' ||
        typeof accountModelManager.readSecret !== 'function')) ||
      (memoryManager !== null && (typeof memoryManager.status !== 'function' ||
        typeof memoryManager.peek !== 'function' || typeof memoryManager.query !== 'function' ||
        typeof memoryManager.submitCommand !== 'function' ||
        typeof memoryManager.receiptByRequest !== 'function' ||
        typeof memoryManager.retryCleanupByRequest !== 'function')) ||
      (androidPackagePath !== null && (typeof androidPackagePath !== 'string' ||
        !path.isAbsolute(androidPackagePath) || path.basename(androidPackagePath).toLowerCase() !== 'android-candidate.apk')) ||
      (mobileUiDir !== null && (typeof mobileUiDir !== 'string' || !path.isAbsolute(mobileUiDir))) ||
      !Array.isArray(allowedOrigins) || typeof trustedProxy !== 'boolean' ||
      (verifyToolResult !== null && typeof verifyToolResult !== 'function') ||
      (browserReader !== null && (typeof browserReader.read !== 'function' ||
        typeof browserReader.cancelTask !== 'function' || typeof browserReader.close !== 'function' ||
        typeof browserReader.status !== 'function' || typeof browserReader.canonicalUrl !== 'function')) ||
      (allowedOrigins.length > 0 && !trustedProxy) || allowedOrigins.some((value) => {
        try { return new URL(value).origin !== value || !value.startsWith('https://'); }
        catch { return true; }
      }) || typeof clock !== 'function') {
    throw failure('INVALID_CONFIGURATION');
  }
  for (const method of ['getStatus', 'listModels', 'preflight', 'createSession',
    'sendMessage', 'cancelSession', 'readEvents', 'describeSession']) {
    if (typeof backend[method] !== 'function') throw failure('INVALID_CONFIGURATION');
  }
  if (backend.getTaskReplyEvidence !== undefined &&
      typeof backend.getTaskReplyEvidence !== 'function') throw failure('INVALID_CONFIGURATION');
  await ensurePrivateDirectory(root);
  if (cloudIdentity) await backupBeforeCloud(root);
  let hostRelay = null;
  const storeFile = path.join(root, 'store.json');
  let rootState;
  // Accessors preserve the original service's live state across module boundaries.
  const context = {
    get root() { return root; },
    get cloudIdentity() { return hostCloudIdentity; },
    get accountModelForProfile() { return accountModelForProfile; },
    get accountModelManager() { return accountModelManager; },
    get accountModelView() { return accountModelView; },
    get accountState() { return accountState; },
    get active() { return active; },
    get activeByCommand() { return activeByCommand; },
    get activeModelOperations() { return activeModelOperations; },
    get allowedOrigins() { return allowedOrigins; },
    get androidPackageEntry() { return androidPackageEntry; },
    get androidPackagePath() { return androidPackagePath; },
    get answerToolApproval() { return answerToolApproval; },
    get answerUserQuestion() { return answerUserQuestion; },
    get approvalLivenessChecks() { return approvalLivenessChecks; },
    get artifactStore() { return artifactStore; },
    get attachmentStores() { return attachmentStores; },
    get authenticate() { return authenticate; },
    get backend() { return backend; },
    get browserReader() { return browserReader; },
    get browserToolSource() { return browserToolSource; },
    get callBackend() { return callBackend; },
    get changeAccountPassword() { return changeAccountPassword; },
    get checkedBrowserSession() { return checkedBrowserSession; },
    get checkedProjectSession() { return checkedProjectSession; },
    get clearCookie() { return clearCookie; },
    get closedToolRuntimeIds() { return closedToolRuntimeIds; },
    get closing() { return closing; },
    set closing(value) { closing = value; },
    get commandReferencesOriginal() { return commandReferencesOriginal; },
    get conversationProjection() { return conversationProjection; },
    get conversationSnapshot() { return conversationSnapshot; },
    get deviceName() { return deviceName; },
    get driveTaskStop() { return driveTaskStop; },
    get handleMemoryHttp() { return handleMemoryHttp; },
    get hashQueue() { return hashQueue; },
    set hashQueue(value) { hashQueue = value; },
    get hostOwner() { return hostOwner; },
    get interactionRequestIdUsed() { return interactionRequestIdUsed; },
    get json() { return json; },
    get localTurnState() { return localTurnState; },
    get loginAccount() { return loginAccount; },
    get matchingOrigin() { return matchingOrigin; },
    get memoryManager() { return memoryManager; },
    get healthStore() { return healthStore; },
    get messageModelUsable() { return messageModelUsable; },
    get mobileUi() { return mobileUi; },
    get modelOperationResponse() { return modelOperationResponse; },
    get modelSelectable() { return modelSelectable; },
    get modelVisible() { return modelVisible; },
    get mutate() { return mutate; },
    get mutateRoot() { return mutateRoot; },
    get nativeDownloads() { return nativeDownloads; },
    get origin() { return origin; },
    set origin(value) { origin = value; },
    get ownerForRequest() { return ownerForRequest; },
    get pendingPreflights() { return pendingPreflights; },
    get personalExecutionSource() { return personalExecutionSource; },
    get projectGrant() { return projectGrant; },
    get projectToolSource() { return projectToolSource; },
    get publicAuth() { return publicAuth; },
    get publicHistoryEvent() { return publicHistoryEvent; },
    get questionDeliveries() { return questionDeliveries; },
    get questionNativeTerminals() { return questionNativeTerminals; },
    get queuedHashes() { return queuedHashes; },
    set queuedHashes(value) { queuedHashes = value; },
    get readJson() { return readJson; },
    get reconcileModelOperation() { return reconcileModelOperation; },
    get refreshToolApprovals() { return refreshToolApprovals; },
    get registerAccount() { return registerAccount; },
    get registeredAccountCount() { return registeredAccountCount; },
    get requestAuthority() { return requestAuthority; },
    get requestIdUsed() { return requestIdUsed; },
    get requireBrowserOrigin() { return requireBrowserOrigin; },
    get requireOpen() { return requireOpen; },
    get requireOriginalAttachments() { return requireOriginalAttachments; },
    get requireToolRuntime() { return requireToolRuntime; },
    get rootState() { return rootState; },
    set rootState(value) { rootState = value; },
    get schedule() { return schedule; },
    get scheduled() { return scheduled; },
    get scheduleModelOperation() { return scheduleModelOperation; },
    get serial() { return serial; },
    get service() { return service; },
    get sessionCookie() { return sessionCookie; },
    get setupAccount() { return setupAccount; },
    get sharedAttachmentStores() { return sharedAttachmentStores; },
    get sharedProfileIsFormal() { return sharedProfileIsFormal; },
    get sourceDevicesUpgraded() { return sourceDevicesUpgraded; },
    get stopping() { return stopping; },
    get stopTargets() { return stopTargets; },
    get storageFault() { return storageFault; },
    set storageFault(value) { storageFault = value; },
    get syncRoot() { return syncRoot; },
    get syncStores() { return syncStores; },
    get syncUserQuestions() { return syncUserQuestions; },
    get taskChildren() { return taskChildren; },
    get taskDetail() { return taskDetail; },
    get taskHasUnknownEffects() { return taskHasUnknownEffects; },
    get taskSource() { return taskSource; },
    get taskStopEvidence() { return taskStopEvidence; },
    get timestamp() { return timestamp; },
    get trustedProxy() { return trustedProxy; },
    get uiHandler() { return uiHandler; },
    get updateAccountProfile() { return updateAccountProfile; },
    get verifiedSyncUserEvent() { return verifiedSyncUserEvent; },
    get verifyToolResult() { return verifyToolResult; },
  };
  const sessions = createSessionOperations(context);
  const {
    requireOriginalAttachments, commandReferencesOriginal, publicHistoryEvent,
    conversationSnapshot, conversationProjection, verifiedSyncUserEvent, sourceDevicesUpgraded,
    localTurnState,
  } = sessions;
  const authentication = createAuthenticationOperations(context);
  const {
    hashWork, requestAuthority, matchingOrigin, requireBrowserOrigin, cookieToken, ownerForRequest,
    authenticate, json, sessionCookie, clearCookie, newPasswordDevice, rotatePasswordDevice,
    publicAuth, readJson, deviceName, assertLoginWindow, recordFailedPassword, setupAccount,
    registerAccount, updateAccountProfile, loginAccount, loginAccountForOwner,
    changeAccountPassword,
  } = authentication;
  const userQuestions = createUserQuestionOperations(context);
  const {
    interactionRequestIdUsed, questionKey, questionIdentityFields, questionMatches, questionSource,
    questionUnavailableReason, requireQuestionPending, validateQuestionIdentity,
    nativeUserQuestionSnapshot, trackUserQuestion, syncUserQuestions, scheduleUserQuestionDelivery,
    answerUserQuestion,
  } = userQuestions;
  const approvals = createApprovalOperations(context);
  const {
    requireToolRuntime, personalExecutionSource, approvalMatches, approvalUnavailableReason,
    liveToolApprovalSource, refreshToolApprovals, answerToolApproval,
  } = approvals;
  const tasks = createTaskOperations(context);
  const {
    taskSource, taskChildren, taskHasUnknownEffects, stopTargets, latestStop, taskStopEvidence,
    taskDetail, driveTaskStop,
  } = tasks;
  const workspaces = createWorkspaceOperations(context);
  const {
    frozenBrowserCapture, projectGrant, projectToolSource, checkedProjectSession,
    checkedBrowserSession, browserToolSource,
  } = workspaces;
  const commands = createCommandOperations(context);
  const { requestIdUsed, dispatch, schedule } = commands;
  const accountModels = createAccountModelOperations(context);
  const {
    accountModelForProfile, modelVisible, modelSelectable, messageModelUsable, accountModelView,
    modelOperationResponse, completeModelOperation, reconcileModelOperation, driveModelOperation,
    scheduleModelOperation,
  } = accountModels;
  const artifacts = createArtifactOperations(context);
  const http = createHttpHandler(context);
  const { handle, handleScoped } = http;
  const { handleMemoryHttp } = createMemoryHttpHandler(context);

  try {
    await ensurePrivateFile(storeFile);
    rootState = JSON.parse(await readFile(storeFile, 'utf8'));
    if (rootState.version === VERSION) {
      let upgraded = false;
      if (!Object.hasOwn(rootState, 'unknownAuthLimits')) {
        rootState.unknownAuthLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
        upgraded = true;
      }
      if (Array.isArray(rootState.sharedModelProfiles) &&
          rootState.sharedModelProfiles.some((item) => typeof item === 'string')) {
        rootState.sharedModelProfiles = []; // Pre-release ID-only markers cannot prove formal source.
        upgraded = true;
      }
      validateStore(rootState);
      if (upgraded) await durableWrite(storeFile, rootState);
    }
    else validateSingleStore(rootState);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw failure('STORE_CORRUPT', 500);
    rootState = {
      version: SINGLE_ACCOUNT_VERSION,
      ownerId: `owner-${randomUUID()}`,
      hostId: `host-${randomUUID()}`,
      devices: {}, sessions: {}, commands: {}, account: null, setupGrant: null,
      authLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 },
    };
    await durableWrite(storeFile, rootState);
  }
  if (rootState.version === LEGACY_VERSION) {
    const migrated = structuredClone(rootState);
    migrated.version = SINGLE_ACCOUNT_VERSION;
    migrated.account = null;
    migrated.setupGrant = null;
    migrated.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
    for (const device of Object.values(migrated.devices)) device.authKind = 'legacy-local';
    validateSingleStore(migrated);
    await durableWrite(storeFile, migrated);
    rootState = migrated;
  }
  if (rootState.version === SINGLE_ACCOUNT_VERSION) {
    const { version: _version, hostId, ownerId, ...account } = rootState;
    const migrated = { version: VERSION, hostId, legacyOwnerId: ownerId,
      unknownAuthLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 },
      sharedModelProfiles: [], accounts: { [ownerId]: account } };
    validateStore(migrated);
    await durableWrite(storeFile, migrated);
    rootState = migrated;
  }
  const accountState = (ownerId) => {
    const account = rootState.accounts[ownerId];
    if (!account) throw failure('UNAUTHORIZED', 401);
    return { version: SINGLE_ACCOUNT_VERSION, hostId: rootState.hostId, ownerId, ...account };
  };
  const healthStore = memoryManager?.healthStore ?? createPersonalHealthStore({ root, clock });
  const artifactStore = createPersonalArtifactStore(path.join(root, 'artifacts'));
  const hostOwner = (ownerId) => ownerId === rootState.legacyOwnerId;
  const registeredAccountCount = () => Object.values(rootState.accounts)
    .filter((entry) => entry.account !== null).length;
  // A callback may have run before the process died. Never replay these commands.
  if (Object.values(rootState.accounts).some((account) =>
    Object.values(account.commands).some((command) => command.state === 'dispatching' ||
      command.toolExecutions?.some(row => row.state === 'running' || ['running', 'stopping'].includes(row.jobState)) ||
      command.toolApprovals?.some(row => ['pending', 'answered'].includes(row.status)) ||
      command.userQuestions?.some(row => ['pending', 'answered'].includes(row.status))) ||
    Object.values(account.modelOperations ?? {}).some((operation) => operation.status === 'applying'))) {
    const recovered = structuredClone(rootState);
    for (const [ownerId, account] of Object.entries(recovered.accounts)) {
      for (const command of Object.values(account.commands)) {
        for (const row of command.userQuestions ?? []) invalidateUserQuestion(row, 'RUNTIME_UNAVAILABLE', new Date(timestamp()).toISOString());
        for (const row of command.toolApprovals ?? []) {
          invalidateToolApproval(row, 'service_recovered', new Date(timestamp()).toISOString());
        }
        for (const row of command.toolExecutions ?? []) {
          if (row.state === 'running') { row.state = 'uncertain'; row.updatedAt = new Date(timestamp()).toISOString(); }
          if (['running', 'stopping'].includes(row.jobState)) {
            row.jobState = 'uncertain'; row.jobObservedAt = row.updatedAt = new Date(timestamp()).toISOString();
          }
        }
        if (command.state === 'dispatching') {
          let observed = false;
          if (command.kind === INTERNAL_ARTIFACT_KIND) {
            try {
              await artifactStore.inspect(ownerId, command.taskId, command.artifactId, command);
              observed = true;
            } catch { /* Missing or unverified file retains an uncertain result. */ }
          }
          command.state = observed ? 'observed' : 'uncertain';
          if (observed) command.verification = { status: 'observed', method: 'sha256_readback',
            observedAt: new Date().toISOString() };
          else command.errorCode = 'RECEIPT_UNKNOWN';
          command.updatedAt = new Date().toISOString();
        }
      }
      for (const binding of Object.values(account.conversationBindings ?? {})) {
        if (binding.status === 'creating' && account.commands[binding.adoptCommandId]?.state === 'uncertain') {
          binding.status = 'uncertain';
          binding.updatedAt = new Date().toISOString();
        }
      }
      for (const operation of Object.values(account.modelOperations ?? {})) {
        if (operation.status === 'applying') {
          operation.status = 'uncertain';
          operation.reasonCode = 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED';
          operation.updatedAt = new Date().toISOString();
        }
      }
    }
    await durableWrite(storeFile, recovered);
    rootState = recovered;
  }
  const syncStores = new Map();
  const attachmentStores = new Map();
  const sharedAttachmentStores = new Map();
  const syncRoot = (ownerId) => ownerId === rootState.legacyOwnerId
    ? path.join(root, 'sync') : path.join(root, 'accounts', ownerId, 'sync');
  for (const ownerId of Object.keys(rootState.accounts)) {
    syncStores.set(ownerId, await createPersonalSyncStore({ root: syncRoot(ownerId), ownerId }));
    attachmentStores.set(ownerId, await createAttachmentStore({ root: path.join(syncRoot(ownerId), 'attachments') }));
    const sharedRoot = path.join(syncRoot(ownerId), 'shared-attachments');
    sharedAttachmentStores.set(ownerId, await createSharedAttachmentStore({ root: sharedRoot }));
    const hasStagedImages = (await readdir(sharedRoot)).some((name) => name.endsWith('.image'));
    if (hasStagedImages) for (const command of Object.values(accountState(ownerId).commands)) {
      if (command.kind === 'session.message' && command.state === 'accepted_by_dsh' &&
          Array.isArray(command.payload.attachments)) {
        await sharedAttachmentStores.get(ownerId).release({ sessionId: command.sessionId,
          requestId: command.requestId, attachments: command.payload.attachments });
      }
    }
  }
  const mobileUi = mobileUiDir === null ? null : createMobileUiPublisher({ root: mobileUiDir });
  const nativeDownloads = createNativeDownloadPublisher(root);
  const androidPackageEntry = async () => {
    if (!androidPackagePath) return null;
    const entry = await lstat(androidPackagePath).catch(() => null);
    return entry?.isFile() && !entry.isSymbolicLink() && entry.size >= 1 &&
      entry.size <= 512 * 1024 * 1024 ? entry : null;
  };

  let queue = Promise.resolve();
  let server;
  let origin;
  let closing = false;
  let closePromise;
  let storageFault = false;
  let hashQueue = Promise.resolve();
  let queuedHashes = 0;
  let hostCloudIdentity = null;
  const active = new Set();
  const activeByCommand = new Map();
  const scheduled = new Set();
  const stopping = new Map();
  const pendingPreflights = new Map();
  const activeModelOperations = new Map();
  const approvalLivenessChecks = new Map();
  const questionNativeTerminals = new Map();
  const questionDeliveries = new Map();
  // Persisted approvals belong to a previous process, including historical grants.
  const closedToolRuntimeIds = new Set(Object.values(rootState.accounts).flatMap(account =>
    Object.values(account.commands).flatMap(command => [
      ...(command.toolApprovals ?? []).map(row => row.runtimeId),
      ...(command.toolExecutions ?? []).map(row => row.runtimeId),
      ...(command.userQuestions ?? []).map(row => row.runtimeId),
    ])).filter(Boolean));

  function timestamp() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw failure('SERVICE_UNAVAILABLE', 503);
    return value;
  }

  function requireOpen() {
    if (closing) throw failure('SERVICE_CLOSING', 503);
  }

  function callBackend(task) {
    return withDeadline(() => { requireOpen(); return task(); }, DISPATCH_TIMEOUT_MS);
  }

  function serial(task) {
    const result = queue.then(() => { requireOpen(); return task(); });
    queue = result.catch(() => {});
    return result;
  }

  async function mutateRoot(change, assertCurrent = () => {}) {
    requireOpen();
    assertCurrent();
    if (storageFault) throw failure('STORAGE_UNAVAILABLE', 503);
    const next = structuredClone(rootState);
    const value = await change(next);
    requireOpen();
    assertCurrent();
    for (const account of Object.values(next.accounts)) {
      for (const [conversationId, binding] of Object.entries(account.conversationBindings ?? {})) {
        const state = account.commands[binding.adoptCommandId]?.state;
        if (state === 'rejected') delete account.conversationBindings[conversationId];
        else if (state === 'uncertain' && binding.status !== 'uncertain') {
          binding.status = 'uncertain'; binding.updatedAt = new Date().toISOString();
        } else if (state === 'accepted_by_dsh' && binding.status !== 'active') {
          binding.status = 'active'; binding.updatedAt = new Date().toISOString();
        }
      }
    }
    validateStore(next);
    try { await durableWrite(storeFile, next, () => {
      if (closing) return false;
      assertCurrent();
      return true;
    }); }
    catch (error) {
      if (!['SERVICE_CLOSING', 'TOOL_SOURCE_UNAVAILABLE', 'APPROVAL_NOT_PENDING', 'QUESTION_NOT_PENDING'].includes(error?.code)) storageFault = true;
      throw error;
    }
    rootState = next;
    hostCloudIdentity?.closeInvalidResponses();
    return value;
  }

  async function mutate(ownerId, change, assertCurrent) {
    return mutateRoot(async (nextRoot) => {
      const account = nextRoot.accounts[ownerId];
      if (!account) throw failure('UNAUTHORIZED', 401);
      const next = { version: SINGLE_ACCOUNT_VERSION, hostId: nextRoot.hostId, ownerId, ...account };
      const value = await change(next);
      if (next.ownerId !== ownerId || next.hostId !== nextRoot.hostId) throw failure('STORE_CORRUPT', 500);
      const { version: _version, hostId: _hostId, ownerId: _ownerId, ...updated } = next;
      nextRoot.accounts[ownerId] = updated;
      return value;
    }, assertCurrent);
  }

  const service = {
    async start() {
      if (closing) throw failure('SERVICE_CLOSING', 503);
      if (server) return { origin, hostId: rootState.hostId, ownerId: rootState.legacyOwnerId };
      const candidate = createServer({ maxHeaderSize: 8192, requestTimeout: 0 }, handle);
      try {
        await new Promise((resolve, reject) => {
          candidate.once('error', reject);
          candidate.listen(port, '127.0.0.1', resolve);
        });
      } catch (error) {
        candidate.close();
        throw error;
      }
      if (closing) {
        candidate.close();
        throw failure('SERVICE_CLOSING', 503);
      }
      server = candidate;
      origin = `http://127.0.0.1:${candidate.address().port}`;
      hostCloudIdentity?.start();
      hostRelay?.start(origin);
      for (const [ownerId, account] of Object.entries(rootState.accounts)) {
        for (const operation of Object.values(account.modelOperations ?? {})) {
          if (operation.status === 'pending') scheduleModelOperation(ownerId, operation.requestId);
        }
        for (const command of Object.values(account.commands)) {
          if (command.state === 'pending') schedule(ownerId, command.commandId);
          if (command.taskControl?.state === 'stop_requested') {
            driveTaskStop(ownerId, command.commandId).catch(() => {});
          }
        }
      }
      return { origin, hostId: rootState.hostId, ownerId: rootState.legacyOwnerId };
    },
    status(ownerId = rootState.legacyOwnerId) {
      const account = accountState(ownerId);
      return {
        state: closing ? 'closing' : storageFault ? 'storage_fault' : server ? 'ready' : 'stopped',
        ...(storageFault ? { errorCode: 'STORAGE_UNAVAILABLE' } : {}),
        origin: server ? origin : null,
        hostId: rootState.hostId,
        relay: service.relayStatus(),
        ownerId,
        deviceCount: Object.values(account.devices).filter((device) => !device.revoked).length,
      };
    },
    relayStatus: () => hostRelay?.status() ?? { state: 'disabled', baseUrl: null },
    rotateRelayCredential: (requestId) => hostRelay?.rotate(requestId),
    reloadRelayCertificate: () => hostRelay?.reloadCertificate(),
    legacyOwnerId() { return rootState.legacyOwnerId; },
    canUseModelProfile: accountModels.canUseModelProfile,
    isFormalLocalProfile: accountModels.isFormalLocalProfile,
    privateAccountModelProof: accountModels.privateAccountModelProof,
    ownerForSession: sessions.ownerForSession,
    hasUnissuedDshCommands: commands.hasUnissuedDshCommands,
    getConversationContext: sessions.getConversationContext,
    async setSharedModelProfiles(profileIds) {
      if (!Array.isArray(profileIds) || profileIds.length > 500 ||
          profileIds.some((value) => !validSharedProfile(value)) ||
          new Set(profileIds.map((value) => value.id)).size !== profileIds.length) throw failure('INVALID_REQUEST');
      return serial(() => mutateRoot((next) => {
        next.sharedModelProfiles = structuredClone(profileIds).sort((a, b) => a.id.localeCompare(b.id));
      }));
    },
    issueSetupGrant: authentication.issueSetupGrant,
    enrollDevice: authentication.enrollDevice,
    revokeDevice: authentication.revokeDevice,
    syncCloudRevocations: () => hostCloudIdentity?.syncRevocations(),
    receiveCloudRevocations: (token) => hostCloudIdentity?.applyEvents(token),
    listDevices: authentication.listDevices,
    hasVerifiedPersonalTool() {
      return Object.values(accountState(rootState.legacyOwnerId).commands).some((command) => command.kind === 'desktop.open_app' &&
        command.toolSource && command.state === 'observed' && command.verification?.status === 'observed');
    },
    attachSession: sessions.attachSession,
    projectForSession: workspaces.projectForSession,
    browserForSession: workspaces.browserForSession,
    submitToolProject: workspaces.submitToolProject,
    submitToolBrowser: workspaces.submitToolBrowser,
    /** Trusted current-child snapshots only; information answers never grant execution authority. */
    trackUserQuestion,
    trackToolApproval: approvals.trackToolApproval,
    invalidateToolApprovals: approvals.invalidateToolApprovals,
    trackToolExecution: tasks.trackToolExecution,
    submitToolDesktop: commands.submitToolDesktop,
    submitToolArtifact: artifacts.submitToolArtifact,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const account of Object.values(rootState.accounts)) for (const command of Object.values(account.commands)) {
        for (const row of [...(command.toolApprovals ?? []), ...(command.toolExecutions ?? []), ...(command.userQuestions ?? [])]) {
          if (row.runtimeId) closedToolRuntimeIds.add(row.runtimeId);
        }
      }
      closePromise = (async () => {
        await hostRelay?.close();
        hostCloudIdentity?.close();
        mobileUi?.close();
        const browserClosed = Promise.resolve(browserReader?.close());
        const syncClosed = Promise.all([...syncStores.values()].map((store) => store.close()));
        const approvalsClosed = queue.then(async () => {
          const next = structuredClone(rootState), at = new Date(timestamp()).toISOString();
          let changed = false;
          for (const account of Object.values(next.accounts)) for (const command of Object.values(account.commands)) {
            for (const row of command.toolApprovals ?? []) changed = invalidateToolApproval(row, 'service_closing', at) || changed;
            for (const row of command.userQuestions ?? []) changed = invalidateUserQuestion(row, 'SERVICE_CLOSING', at) || changed;
          }
          if (changed) {
            validateStore(next);
            await durableWrite(storeFile, next);
            rootState = next;
          }
        });
        const current = server;
        server = undefined;
        origin = undefined;
        let listeningClosed = Promise.resolve();
        if (current) {
          listeningClosed = new Promise((resolve) => current.close(resolve));
          current.closeIdleConnections();
        }
        let timer;
        try {
          // Store transactions contain no backend await. Successful close waits
          // for the last atomic write before another instance may open this root.
          await Promise.race([
            Promise.all([approvalsClosed, syncClosed, browserClosed]),
            new Promise((_, reject) => { timer = setTimeout(() => reject(failure('CLOSE_TIMEOUT', 503)), CLOSE_TIMEOUT_MS); }),
          ]);
          clearTimeout(timer);
          await Promise.race([
            Promise.allSettled([listeningClosed, ...active, ...stopping.values(),
              ...activeModelOperations.values()]),
            new Promise((resolve) => { timer = setTimeout(resolve, CLOSE_TIMEOUT_MS); }),
          ]);
        } finally {
          clearTimeout(timer);
          current?.closeAllConnections();
        }
      })();
      return closePromise;
    },
  };
  if (cloudIdentity) hostCloudIdentity = await createHostCloudIdentity(context, cloudIdentity);
  if (relay) hostRelay = await createHostRelay({ root, identity: hostCloudIdentity, options: relay,
    setPublicOrigin(value) { if (!allowedOrigins.includes(value)) allowedOrigins.push(value); trustedProxy = true; } });
  return service;
}
