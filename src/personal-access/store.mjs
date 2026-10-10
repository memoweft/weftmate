import { personalization } from './personalization.mjs';
import { validateMemorySettings } from './temporary-chats.mjs';
import { enterProfileWrite } from '../personal-backup/write-barrier.mjs';
import { validateChatIdentity } from './chat-identity.mjs';
import { scheduledCommandSource } from './schedules-authorization.mjs';
import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { ensurePrivateFile, forgetPrivateFile, openPrivateFile, renamePrivateFile } from '../private-host-storage.mjs';
import { canonicalAccountBaseUrl, digest, failure, plainObject, validId, validProjectName, validTime } from './common.mjs';
import path from 'node:path';
import {
  CONVERSATION_ID,
  FILE_ID,
  IMAGE_REASONS,
  INTERNAL_ARTIFACT_KIND,
  KINDS,
  LEGACY_SCOPES,
  LEGACY_VERSION,
  LINK_ID,
  MAX_BROWSER_CAPTURES,
  MAX_BROWSER_SNAPSHOTS,
  MAX_COMMANDS,
  MAX_LOCAL_TURNS,
  MAX_PROJECT_FILES,
  MAX_PROJECTS,
  MAX_SOURCE_SNAPSHOTS,
  MAX_TOOL_APPROVALS,
  MODEL_PROFILE_ID,
  PUBLIC_CODES,
  REQUEST_ID,
  SCOPES,
  SINGLE_ACCOUNT_VERSION,
  SNAPSHOT_ID,
  SYNC_EVENT_ID,
  VERSION,
  WEB_SNAPSHOT_ID
} from './constants.mjs';
import { normalizeUsername, validPasswordRecord } from './password.mjs';
import { validStoredProfile } from './profile.mjs';
import { validAccountModel, validModelOperation } from '../personal-account-models/index.mjs';
import { modelRouteFingerprint } from '../model-route-fingerprint.mjs';
import { openAICompatibleEndpoint } from '../openai-compatible-client.ts';
import { validConversationContext } from '../personal-conversations/context.mjs';
import { MAX_CAPTURE_BYTES, MAX_SEGMENT_BYTES } from '../personal-browser/index.mjs';
import { toolApprovals, userQuestions, validToolApprovals, validToolExecutions, validUserQuestions } from './interaction-policy.mjs';
import { canonicalCommand } from './command-policy.mjs';
import { APPROVAL_MODES, RISK_CATEGORIES } from '../plugins/personal-approval-policy.mjs';
import { artifactContentType } from '../personal-artifacts/index.mjs';

export async function durableWrite(file, state, shouldCommit = () => true) {
  const releaseWrite = await enterProfileWrite(file);
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await openPrivateFile(tmp);
    await handle.writeFile(JSON.stringify(state), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await ensurePrivateFile(tmp);
    for (let attempt = 0; ; attempt++) {
      if (!shouldCommit()) throw failure('SERVICE_CLOSING', 503);
      try { await renamePrivateFile(tmp, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    await ensurePrivateFile(file);
    // Directory fsync is not supported by all Windows filesystems. The file itself
    // is flushed before the atomic replacement; unsupported directory sync is benign.
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    forgetPrivateFile(tmp);
    releaseWrite();
  }
}

export function validateSingleStore(store) {
  if (!plainObject(store)) throw failure('STORE_CORRUPT', 500);
  validateChatIdentity(store);
  if (store.personalization !== undefined) { try { personalization.validate(store.personalization); } catch { throw failure('STORE_CORRUPT', 500); } }
  if (store.personalizationUpdatedAt !== undefined && !validTime(store.personalizationUpdatedAt)) throw failure('STORE_CORRUPT', 500);
  if (store.messageBranches !== undefined && !plainObject(store.messageBranches)) throw failure('STORE_CORRUPT', 500);
  for (const [requestId, operation] of Object.entries(store.messageBranches ?? {})) {
    const branch = operation?.response;
    if (!REQUEST_ID.test(requestId) || !plainObject(operation) || !/^[a-f0-9]{64}$/.test(operation.fingerprint ?? '') ||
        !plainObject(branch) || operation.ordinal !== undefined && (!Number.isSafeInteger(operation.ordinal) || operation.ordinal < 1) ||
        ![branch.sessionId, branch.sourceSessionId, branch.inputSourceSessionId, branch.groupId].every(validId) ||
        !REQUEST_ID.test(branch.sendRequestId ?? '') || !['edit', 'regenerate'].includes(branch.action) ||
        !Number.isSafeInteger(branch.sourceSeq) || branch.sourceSeq < 0 || !Number.isSafeInteger(branch.userSeq) || branch.userSeq < 0 ||
        !Number.isSafeInteger(branch.seedThroughSeq) || branch.seedThroughSeq < -1 || typeof branch.text !== 'string' ||
        !MODEL_PROFILE_ID.test(branch.modelProfileId ?? '') || Object.values(store.commands).some(command => command.requestId === requestId))
      throw failure('STORE_CORRUPT', 500);
  }
  if (store.defaultApprovalMode !== undefined && !APPROVAL_MODES.includes(store.defaultApprovalMode)) throw failure('STORE_CORRUPT', 500);
  for (const session of Object.values(store.sessions ?? {})) {
    if (!plainObject(session)) throw failure('STORE_CORRUPT', 500);
    try { validateMemorySettings(session); } catch { throw failure('STORE_CORRUPT', 500); }
    if (session.expiresAt !== undefined && session.expiresAt !== null && !Number.isFinite(Date.parse(session.expiresAt))) throw failure('STORE_CORRUPT', 500);
    if (session.deepThinking !== undefined && typeof session.deepThinking !== 'boolean') throw failure('STORE_CORRUPT', 500);
    if (session.approvalMode !== undefined && !APPROVAL_MODES.includes(session.approvalMode) ||
        session.allowedApprovalCategories !== undefined && (!Array.isArray(session.allowedApprovalCategories) ||
          session.allowedApprovalCategories.some(x => !RISK_CATEGORIES.includes(x)))) throw failure('STORE_CORRUPT', 500);
  }
  if (!plainObject(store) || ![SINGLE_ACCOUNT_VERSION, LEGACY_VERSION].includes(store.version) || !validId(store.hostId) ||
      !validId(store.ownerId) || !plainObject(store.devices) ||
      !plainObject(store.sessions) || !plainObject(store.commands)) throw failure('STORE_CORRUPT', 500);
  if (store.version === LEGACY_VERSION &&
      ['account', 'setupGrant', 'authLimits'].some((key) => Object.hasOwn(store, key))) {
    throw failure('STORE_CORRUPT', 500);
  }
  if (store.version === SINGLE_ACCOUNT_VERSION) {
    const account = store.account;
    if (account !== null && (!plainObject(account) ||
        !normalizeUsername(account.username)?.canonical ||
        normalizeUsername(account.username).display !== account.username ||
        normalizeUsername(account.username).canonical !== account.usernameCanonical ||
        !validPasswordRecord(account.password) ||
        !Number.isSafeInteger(account.authEpoch) || account.authEpoch < 0 || !validStoredProfile(account))) {
      throw failure('STORE_CORRUPT', 500);
    }
    if (!plainObject(store.authLimits) || !Number.isSafeInteger(store.authLimits.failures) ||
        store.authLimits.failures < 0 || !Number.isSafeInteger(store.authLimits.lastFailureAt) ||
        store.authLimits.lastFailureAt < 0 || !Number.isSafeInteger(store.authLimits.lockUntil) ||
        store.authLimits.lockUntil < 0 ||
        (store.setupGrant !== null && (!plainObject(store.setupGrant) || account !== null ||
          !/^[a-f0-9]{64}$/.test(store.setupGrant.hash ?? '') ||
          !Number.isSafeInteger(store.setupGrant.expiresAt) || store.setupGrant.expiresAt < 0))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  const tokenHashes = new Set();
  for (const [deviceId, device] of Object.entries(store.devices)) {
    const allowedScopes = store.version === LEGACY_VERSION ? LEGACY_SCOPES : SCOPES;
    if (!validId(deviceId) || !plainObject(device) || !/^[a-f0-9]{64}$/.test(device.tokenHash ?? '') ||
        typeof device.name !== 'string' || !Array.isArray(device.scopes) ||
        device.scopes.some((scope) => !allowedScopes.has(scope)) || typeof device.revoked !== 'boolean' ||
        tokenHashes.has(device.tokenHash)) {
      throw failure('STORE_CORRUPT', 500);
    }
    tokenHashes.add(device.tokenHash);
    if (device.syncCapabilities !== undefined && (!plainObject(device.syncCapabilities) ||
        device.syncCapabilities.sharedConversations !== 1 ||
        !Number.isSafeInteger(device.syncCapabilities.nativeVersionCode) ||
        device.syncCapabilities.nativeVersionCode < 11 ||
        device.syncCapabilities.nativeVersionCode > 10_000 ||
        !validTime(device.syncCapabilities.declaredAt) ||
        Object.keys(device.syncCapabilities).some((key) =>
          !['sharedConversations', 'nativeVersionCode', 'declaredAt'].includes(key)))) {
      throw failure('STORE_CORRUPT', 500);
    }
    if (store.version === SINGLE_ACCOUNT_VERSION && (device.authKind === 'legacy-local'
      ? device.scopes.includes('account:manage')
      : device.authKind === 'password'
        ? accountDeviceInvalid(device, store.account)
        : device.authKind === 'cloud'
          ? accountDeviceInvalid(device, store.account)
        : true)) throw failure('STORE_CORRUPT', 500);
  }
  for (const key of ['lastChatModelProfileId', 'defaultModelProfileId']) {
    if (store[key] !== undefined && store[key] !== null &&
        (typeof store[key] !== 'string' || !MODEL_PROFILE_ID.test(store[key]))) throw failure('STORE_CORRUPT', 500);
  }
  if (store.backgroundModelProfileId !== undefined && store.backgroundModelProfileId !== null &&
      (typeof store.backgroundModelProfileId !== 'string' || !MODEL_PROFILE_ID.test(store.backgroundModelProfileId))) {
    throw failure('STORE_CORRUPT', 500);
  }
  if (store.accountModels !== undefined && (!plainObject(store.accountModels) ||
      Object.keys(store.accountModels).length > 1000)) throw failure('STORE_CORRUPT', 500);
  for (const [accountModelId, record] of Object.entries(store.accountModels ?? {})) {
    if (!validAccountModel(record, store.ownerId, accountModelId)) throw failure('STORE_CORRUPT', 500);
    for (const revision of Object.values(record.revisions)) {
      if (canonicalAccountBaseUrl(revision.baseUrl) !== revision.baseUrl ||
          modelRouteFingerprint(openAICompatibleEndpoint(revision.baseUrl, 'chat/completions').href,
            revision.modelId) !== revision.routeFingerprint) throw failure('STORE_CORRUPT', 500);
    }
  }
  if (store.modelOperations !== undefined && (!plainObject(store.modelOperations) ||
      Object.keys(store.modelOperations).length > 1000)) throw failure('STORE_CORRUPT', 500);
  for (const [requestId, operation] of Object.entries(store.modelOperations ?? {})) {
    if (!REQUEST_ID.test(requestId) || !validModelOperation(operation, store.ownerId,
      requestId, store.accountModels ?? {})) throw failure('STORE_CORRUPT', 500);
    const model = store.accountModels[operation.accountModelId];
    if (operation.target && (canonicalAccountBaseUrl(operation.target.baseUrl) !== operation.target.baseUrl ||
        modelRouteFingerprint(openAICompatibleEndpoint(operation.target.baseUrl,
          'chat/completions').href, operation.target.modelId) !== operation.target.routeFingerprint ||
        !['create', 'update'].includes(operation.kind) ||
        (operation.kind === 'create' && operation.target.runtimeRevision !== 1) ||
        (operation.kind === 'update' && (operation.status === 'succeeded'
          ? model.revisions[String(operation.target.runtimeRevision)]?.profileId !== operation.target.profileId
          : operation.target.runtimeRevision !== model.runtimeRevision + 1)))) {
      throw failure('STORE_CORRUPT', 500);
    }
    if (operation.previousProfileId && !Object.values(model.revisions).some((row) =>
      row.profileId === operation.previousProfileId)) throw failure('STORE_CORRUPT', 500);
  }
  if (store.conversationBindings !== undefined && (!plainObject(store.conversationBindings) ||
      Object.keys(store.conversationBindings).length > 500)) throw failure('STORE_CORRUPT', 500);
  if (store.conversationLocalTurns !== undefined && (!plainObject(store.conversationLocalTurns) ||
      Object.keys(store.conversationLocalTurns).length > MAX_LOCAL_TURNS)) throw failure('STORE_CORRUPT', 500);
  for (const [turnId, turn] of Object.entries(store.conversationLocalTurns ?? {})) {
    if (!SYNC_EVENT_ID.test(turnId) || !plainObject(turn) || turn.turnId !== turnId ||
        !CONVERSATION_ID.test(turn.conversationId ?? '') || turn.ownerId !== store.ownerId ||
        !REQUEST_ID.test(turn.requestId ?? '') || !SYNC_EVENT_ID.test(turn.sourceSyncEventId ?? '') ||
        !validId(turn.deviceId) || !Object.hasOwn(store.devices, turn.deviceId) ||
        !['running', 'finished', 'uncertain'].includes(turn.state) ||
        !validTime(turn.createdAt) || !validTime(turn.updatedAt) || !validTime(turn.expiresAt) ||
        Object.keys(turn).some((key) => !['turnId', 'conversationId', 'ownerId', 'requestId',
          'sourceSyncEventId', 'deviceId', 'state', 'createdAt', 'updatedAt', 'expiresAt'].includes(key))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  for (const [conversationId, binding] of Object.entries(store.conversationBindings ?? {})) {
    if (!CONVERSATION_ID.test(conversationId) || !plainObject(binding) ||
        binding.conversationId !== conversationId || binding.ownerId !== store.ownerId ||
        !validId(binding.sessionId) || !MODEL_PROFILE_ID.test(binding.modelProfileId ?? '') ||
        !Number.isSafeInteger(binding.revision) || binding.revision !== 1 ||
        !['creating', 'active', 'uncertain'].includes(binding.status) ||
        !Number.isSafeInteger(binding.cutoverSyncSeq) || binding.cutoverSyncSeq < 1 ||
        !validConversationContext(binding) || binding.throughSeq !== binding.cutoverSyncSeq ||
        !REQUEST_ID.test(binding.adoptRequestId ?? '') || !validId(binding.adoptCommandId) ||
        !validTime(binding.createdAt) || !validTime(binding.updatedAt) ||
        Object.keys(binding).some((key) => !['conversationId', 'ownerId', 'sessionId',
          'modelProfileId', 'revision', 'status', 'cutoverSyncSeq', 'contextText',
          'contextHash', 'throughSeq', 'historyMessageCount', 'truncated', 'omittedImages',
          'adoptRequestId', 'adoptCommandId', 'createdAt', 'updatedAt'].includes(key))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    if (!validId(sessionId) || !plainObject(session) || session.ownerId !== store.ownerId ||
        (session.archived !== undefined && typeof session.archived !== 'boolean') ||
        (session.deleting !== undefined && typeof session.deleting !== 'boolean') ||
        (session.pinned !== undefined && typeof session.pinned !== 'boolean') ||
        (session.unread !== undefined && typeof session.unread !== 'boolean') ||
        (session.readMessageSeq !== undefined && (!Number.isSafeInteger(session.readMessageSeq) || session.readMessageSeq < -1)) ||
        (session.title !== undefined && (typeof session.title !== 'string' || !session.title.trim() || session.title.length > 256)) ||
        (session.parentSessionId !== undefined && !validId(session.parentSessionId)) ||
        (session.groupId !== undefined && session.groupId !== null && !Object.hasOwn(store.sessionGroups ?? {}, session.groupId)) ||
        (session.forgetEvidenceIds !== undefined && (!Array.isArray(session.forgetEvidenceIds) ||
          session.forgetEvidenceIds.some(value => typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(value)))) ||
        (session.origin !== undefined && !['personal-remote', 'shared-chat', 'legacy-local', 'local-attached'].includes(session.origin)) ||
        (session.modelProfileId !== undefined && (typeof session.modelProfileId !== 'string' ||
          !MODEL_PROFILE_ID.test(session.modelProfileId))) ||
        (session.origin === 'shared-chat' && !MODEL_PROFILE_ID.test(session.modelProfileId ?? '')) ||
        ((session.projectId === undefined) !== (session.projectRevision === undefined)) ||
        (session.projectId !== undefined && (!validId(session.projectId) ||
          !Number.isSafeInteger(session.projectRevision) || session.projectRevision < 1 ||
          session.origin !== 'personal-remote' || !MODEL_PROFILE_ID.test(session.modelProfileId ?? '') ||
          !Object.hasOwn(store.projects ?? {}, session.projectId))) ||
        (session.conversationId !== undefined && (!CONVERSATION_ID.test(session.conversationId) ||
          store.conversationBindings?.[session.conversationId]?.sessionId !== sessionId ||
          store.conversationBindings[session.conversationId].status !== 'active' ||
          store.conversationBindings[session.conversationId].modelProfileId !== session.modelProfileId ||
          session.workspaceKind !== undefined)) ||
        (session.workspaceKind !== undefined && (session.workspaceKind !== 'browser' ||
          session.projectId !== undefined || session.origin !== 'personal-remote' ||
          !MODEL_PROFILE_ID.test(session.modelProfileId ?? '')))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  if (store.sessionGroups !== undefined && (!plainObject(store.sessionGroups) || Object.entries(store.sessionGroups).some(([key, group]) =>
      !validId(key) || !plainObject(group) || group.id !== key || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 256))) throw failure('STORE_CORRUPT', 500);
  if (store.projects !== undefined && (!plainObject(store.projects) ||
      Object.keys(store.projects).length > MAX_PROJECTS)) throw failure('STORE_CORRUPT', 500);
  for (const [projectId, project] of Object.entries(store.projects ?? {})) {
    if (!validId(projectId) || !plainObject(project) || project.projectId !== projectId ||
        project.ownerId !== store.ownerId || !validProjectName(project.name) ||
        project.permission !== undefined && !['read-only', 'write'].includes(project.permission) ||
        project.instructions !== undefined && (typeof project.instructions !== 'string' || project.instructions.length > 16000) ||
        project.removed !== undefined && typeof project.removed !== 'boolean' ||
        typeof project.rootPath !== 'string' || !/^[A-Za-z]:\\/.test(project.rootPath) ||
        typeof project.rootFinalPath !== 'string' || !/^\\\\\?\\[A-Za-z]:\\/.test(project.rootFinalPath) ||
        !/^[A-F0-9]{8}:[A-F0-9]{16}$/.test(project.rootIdentity ?? '') ||
        !/^[a-f0-9]{64}$/.test(project.fileSecret ?? '') ||
        !Number.isSafeInteger(project.revision) || project.revision < 1 ||
        typeof project.revoked !== 'boolean' || !validTime(project.createdAt) ||
        !validTime(project.updatedAt) || (project.revokedAt !== undefined && !validTime(project.revokedAt)) ||
        !plainObject(project.files) || Object.keys(project.files).length > MAX_PROJECT_FILES ||
        Object.entries(project.files).some(([fileId, file]) => !FILE_ID.test(fileId) ||
          !plainObject(file) || file.fileId !== fileId ||
          typeof file.relativePath !== 'string' || file.relativePath.length > 1024 ||
          !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 8 * 1024 * 1024 ||
          !/^[A-F0-9]{8}:[A-F0-9]{16}$/.test(file.identity ?? '') ||
          !/^\d{1,20}$/.test(file.lastWriteTime ?? '') || !validTime(file.listedAt))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  if (store.projectOperations !== undefined && (!plainObject(store.projectOperations) ||
      Object.keys(store.projectOperations).length > 500)) throw failure('STORE_CORRUPT', 500);
  for (const [requestId, operation] of Object.entries(store.projectOperations ?? {})) {
    if (!REQUEST_ID.test(requestId) || !plainObject(operation) ||
        !['register', 'revoke'].includes(operation.kind) || !validId(operation.projectId) ||
        !Object.hasOwn(store.projects ?? {}, operation.projectId) ||
        !/^[a-f0-9]{64}$/.test(operation.payloadHash ?? '') || !validTime(operation.at)) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  if (store.projectSources !== undefined && (!plainObject(store.projectSources) ||
      Object.keys(store.projectSources).length > MAX_SOURCE_SNAPSHOTS)) throw failure('STORE_CORRUPT', 500);
  for (const [snapshotId, source] of Object.entries(store.projectSources ?? {})) {
    if (!SNAPSHOT_ID.test(snapshotId) || !plainObject(source) || source.snapshotId !== snapshotId ||
        source.ownerId !== store.ownerId || !validId(source.projectId) ||
        !Object.hasOwn(store.projects ?? {}, source.projectId) ||
        !Number.isSafeInteger(source.projectRevision) || source.projectRevision < 1 ||
        !validId(source.taskId) || !validId(source.sourceCommandId) ||
        store.commands[source.sourceCommandId]?.kind !== 'session.message' ||
        (store.commands[source.sourceCommandId].rootTaskId ?? source.sourceCommandId) !== source.taskId ||
        !validId(source.sessionId) || store.commands[source.sourceCommandId].sessionId !== source.sessionId ||
        store.sessions[source.sessionId]?.projectId !== source.projectId ||
        store.sessions[source.sessionId]?.projectRevision !== source.projectRevision ||
        store.commands[source.sourceCommandId].dshTurn !== source.turn ||
        !Number.isSafeInteger(source.turn) || source.turn < 0 ||
        !validId(source.sourceReceiptId) || store.commands[source.sourceCommandId].receiptId !== source.sourceReceiptId ||
        typeof source.readCallId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(source.readCallId) ||
        (source.readTool !== undefined && source.readTool !== 'personal_read_project_file') ||
        !FILE_ID.test(source.fileId ?? '') || typeof source.relativePath !== 'string' ||
        !Number.isSafeInteger(source.lineStart) || source.lineStart < 1 ||
        !Number.isSafeInteger(source.lineEnd) || source.lineEnd < source.lineStart ||
        !Number.isSafeInteger(source.totalLines) || source.totalLines < source.lineEnd ||
        !/^[a-f0-9]{64}$/.test(source.fileSha256 ?? '') ||
        !Number.isSafeInteger(source.textSize) || source.textSize < 0 || source.textSize > 32 * 1024 ||
        !/^[a-f0-9]{64}$/.test(source.textSha256 ?? '') || !validTime(source.readAt) ||
        typeof source.hasMore !== 'boolean') throw failure('STORE_CORRUPT', 500);
  }
  if (store.browserSources !== undefined && (!plainObject(store.browserSources) ||
      Object.keys(store.browserSources).length > MAX_BROWSER_SNAPSHOTS)) throw failure('STORE_CORRUPT', 500);
  if (Object.values(store.browserSources ?? {}).filter((source) =>
    source?.versionHash && source.parentSnapshotId === undefined).length > MAX_BROWSER_CAPTURES)
    throw failure('STORE_CORRUPT', 500);
  for (const [snapshotId, source] of Object.entries(store.browserSources ?? {})) {
    if (!WEB_SNAPSHOT_ID.test(snapshotId) || Object.hasOwn(store.projectSources ?? {}, snapshotId) ||
        !plainObject(source) || source.snapshotId !== snapshotId ||
        source.kind !== 'webpage' || source.ownerId !== store.ownerId ||
        !validId(source.taskId) || !validId(source.sourceCommandId) ||
        store.commands[source.sourceCommandId]?.kind !== 'session.message' ||
        (store.commands[source.sourceCommandId].rootTaskId ?? source.sourceCommandId) !== source.taskId ||
        !validId(source.sessionId) || store.sessions[source.sessionId]?.workspaceKind !== 'browser' ||
        store.commands[source.sourceCommandId].sessionId !== source.sessionId ||
        store.commands[source.sourceCommandId].dshTurn !== source.turn ||
        !Number.isSafeInteger(source.turn) || source.turn < 0 ||
        !validId(source.sourceReceiptId) || store.commands[source.sourceCommandId].receiptId !== source.sourceReceiptId ||
        typeof source.readCallId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(source.readCallId) ||
        !['personal_browser_open', 'personal_browser_follow',
          'personal_browser_read_segment'].includes(source.readTool) ||
        (source.readTool === 'personal_browser_read_segment' && source.versionHash === undefined) ||
        (source.versionHash === undefined && ['segmentIndex', 'segmentCount', 'byteStart',
          'byteEnd', 'totalCapturedBytes', 'captureTruncated', 'outline', 'captureParts',
          'parentSnapshotId'].some((key) => Object.hasOwn(source, key))) ||
        typeof source.title !== 'string' || Array.from(source.title).length > 256 ||
        typeof source.url !== 'string' || Buffer.byteLength(source.url, 'utf8') > 2048 ||
        typeof source.requestedUrl !== 'string' || Buffer.byteLength(source.requestedUrl, 'utf8') > 2048 ||
        !Number.isSafeInteger(source.textSize) || source.textSize < 1 || source.textSize >
          (source.versionHash ? MAX_SEGMENT_BYTES : 32 * 1024) ||
        !/^[a-f0-9]{64}$/.test(source.textSha256 ?? '') || !validTime(source.readAt) ||
        typeof source.truncated !== 'boolean' || !Array.isArray(source.links) || source.links.length > 50 ||
        new Set(source.links.map((link) => link.linkId)).size !== source.links.length ||
        source.links.some((link) => !plainObject(link) || !LINK_ID.test(link.linkId ?? '') ||
          typeof link.url !== 'string' || Buffer.byteLength(link.url, 'utf8') > 2048 ||
          typeof link.label !== 'string' || Array.from(link.label).length > 160) ||
        (source.versionHash !== undefined &&
          (!/^[a-f0-9]{64}$/.test(source.versionHash) ||
            !Number.isSafeInteger(source.segmentIndex) || source.segmentIndex < 0 ||
            source.segmentIndex >= 32 || !Number.isSafeInteger(source.segmentCount) ||
            source.segmentCount < 1 || source.segmentCount > 32 ||
            source.segmentIndex >= source.segmentCount ||
            !Number.isSafeInteger(source.byteStart) || source.byteStart < 0 ||
            !Number.isSafeInteger(source.byteEnd) ||
            source.byteEnd - source.byteStart !== source.textSize ||
            !Number.isSafeInteger(source.totalCapturedBytes) ||
            source.totalCapturedBytes < source.byteEnd ||
            source.totalCapturedBytes > MAX_CAPTURE_BYTES ||
            typeof source.captureTruncated !== 'boolean' ||
            source.truncated !== (source.captureTruncated || source.segmentCount > 1) ||
            (source.parentSnapshotId === undefined
              ? (source.segmentIndex !== 0 || source.byteStart !== 0 ||
                source.readTool === 'personal_browser_read_segment' ||
                !Array.isArray(source.captureParts) || source.captureParts.length < 1 ||
                source.captureParts.length > 2 ||
                source.captureParts.some((item) => !plainObject(item)) ||
                source.captureParts.reduce((sum, item) => sum + item.size, 0) !==
                  source.totalCapturedBytes ||
                source.captureParts.some((item, index) => !plainObject(item) ||
                  item.id !== `capture-${source.snapshotId}-${index}` ||
                  !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 128 * 1024 ||
                  !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) ||
                typeof source.outline !== 'string' ||
                Buffer.byteLength(source.outline, 'utf8') > 2 * 1024)
              : (!WEB_SNAPSHOT_ID.test(source.parentSnapshotId) ||
                source.readTool !== 'personal_browser_read_segment' ||
                source.captureParts !== undefined || source.outline !== undefined ||
                source.links.length !== 0 ||
                !store.browserSources[source.parentSnapshotId] ||
                store.browserSources[source.parentSnapshotId].parentSnapshotId !== undefined ||
                store.browserSources[source.parentSnapshotId].versionHash !== source.versionHash ||
                store.browserSources[source.parentSnapshotId].segmentCount !== source.segmentCount ||
                store.browserSources[source.parentSnapshotId].totalCapturedBytes !== source.totalCapturedBytes ||
                store.browserSources[source.parentSnapshotId].captureTruncated !== source.captureTruncated ||
                store.browserSources[source.parentSnapshotId].sourceCommandId !== source.sourceCommandId ||
                store.browserSources[source.parentSnapshotId].url !== source.url ||
                store.browserSources[source.parentSnapshotId].taskId !== source.taskId ||
                store.browserSources[source.parentSnapshotId].ownerId !== source.ownerId ||
                store.browserSources[source.parentSnapshotId].sessionId !== source.sessionId ||
                store.browserSources[source.parentSnapshotId].turn !== source.turn ||
                store.browserSources[source.parentSnapshotId].sourceReceiptId !== source.sourceReceiptId))))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  const approvalRows = toolApprovals(store);
  const questionRows = userQuestions(store);
  const decisionIds = [...approvalRows.map(row => row?.decisionRequestId), ...questionRows.map(row => row?.answerRequestId)]
    .filter(value => value !== undefined);
  if (approvalRows.length > MAX_TOOL_APPROVALS ||
      questionRows.length > MAX_TOOL_APPROVALS ||
      new Set(questionRows.map(row => row?.questionRpcId)).size !== questionRows.length ||
      new Set(approvalRows.map(row => row?.approvalId)).size !== approvalRows.length ||
      new Set(decisionIds).size !== decisionIds.length || decisionIds.some(requestId =>
        store.modelOperations?.[requestId] || store.projectOperations?.[requestId] ||
        Object.values(store.commands).some(command => command?.requestId === requestId ||
          command?.taskControl?.stopRequests?.some(entry => entry.requestId === requestId)))) {
    throw failure('STORE_CORRUPT', 500);
  }
  const requestIds = new Set();
  for (const [commandId, command] of Object.entries(store.commands)) {
    if (!validId(commandId) || !plainObject(command) || command.commandId !== commandId ||
        command.ownerId !== store.ownerId || !REQUEST_ID.test(command.requestId ?? '') ||
        !/^[a-f0-9]{64}$/.test(command.payloadHash ?? '') ||
        !(KINDS.has(command.kind) || command.kind === INTERNAL_ARTIFACT_KIND) ||
        !['pending', 'dispatching', 'accepted_by_dsh', 'accepted_by_host', 'observed', 'uncertain', 'rejected'].includes(command.state) ||
        !validId(command.sourceDeviceId) || !Object.hasOwn(store.devices, command.sourceDeviceId) ||
        !plainObject(command.payload) || command.nativeFileObserved !== undefined && command.nativeFileObserved !== true || requestIds.has(command.requestId) || !validToolExecutions(command, store) ||
        !validToolApprovals(command, store) || !validUserQuestions(command, store)) {
      throw failure('STORE_CORRUPT', 500);
    }
    requestIds.add(command.requestId);
    try {
      const payload = canonicalCommand(command.payload, store.hostId, true);
      const currentBinding = ['pending', 'dispatching', 'uncertain'].includes(command.state);
      if (JSON.stringify(payload) !== JSON.stringify(command.payload) ||
          digest(JSON.stringify(payload)) !== command.payloadHash ||
          command.kind !== payload.kind || command.requestId !== payload.requestId ||
          command.targetDeviceId !== store.hostId ||
           (payload.projectId !== undefined && (!['session.create', 'session.message'].includes(command.kind) ||
             !Object.hasOwn(store.projects ?? {}, payload.projectId) ||
             (currentBinding && command.kind === 'session.message' &&
               (store.sessions[command.sessionId]?.projectId !== payload.projectId ||
                 store.sessions[command.sessionId]?.projectRevision !== payload.projectRevision)))) ||
           (currentBinding && command.kind === 'session.message' &&
             (payload.projectId ?? null) !== (store.sessions[command.sessionId]?.projectId ?? null)) ||
           (currentBinding && command.kind === 'session.message' &&
             (payload.workspaceKind ?? null) !== (store.sessions[command.sessionId]?.workspaceKind ?? null)) ||
           (command.kind === 'session.message' &&
             ((payload.conversationId ?? null) !== (store.sessions[command.sessionId]?.conversationId ?? null) ||
               (payload.sourceSyncEventId !== undefined && payload.conversationId === undefined))) ||
           (command.kind === 'session.create' && payload.conversationId !== undefined &&
             (store.conversationBindings?.[payload.conversationId]?.adoptCommandId === commandId
               ? store.conversationBindings[payload.conversationId].sessionId !== command.sessionId
               : command.state === 'accepted_by_dsh')) ||
           (command.kind === 'session.message' && payload.workspaceKind === 'browser' &&
             command.rootTaskId !== undefined &&
             JSON.stringify(payload.initialUrls) !==
               JSON.stringify(store.commands[command.rootTaskId]?.payload.initialUrls)) ||
          (command.kind === INTERNAL_ARTIFACT_KIND &&
            (command.sessionId !== payload.sessionId || command.taskId !== payload.taskId ||
              command.artifactId !== payload.artifactId || command.fileName !== payload.fileName ||
              command.size !== payload.size || command.sha256 !== payload.sha256 ||
              (command.contentType !== undefined && command.contentType !== artifactContentType(command.fileName)) ||
               JSON.stringify(command.sourceSnapshotIds ?? null) !== JSON.stringify(payload.sourceSnapshotIds ?? null) ||
               (command.sourceReceiptId ?? null) !== (payload.sourceReceiptId ?? null) ||
               (command.nativeFileObserved !== true && store.commands[command.taskId]?.payload.projectId !== undefined &&
                 (!payload.sourceSnapshotIds?.length ||
                   store.commands[command.toolSource?.sourceCommandId]?.receiptId !== payload.sourceReceiptId ||
                   payload.sourceSnapshotIds.some((sourceId) =>
                     store.projectSources?.[sourceId]?.taskId !== command.taskId ||
                     store.projectSources?.[sourceId]?.sourceReceiptId !== payload.sourceReceiptId))) ||
               (command.nativeFileObserved !== true && store.commands[command.taskId]?.payload.workspaceKind === 'browser' &&
                 (!payload.sourceSnapshotIds?.length ||
                   store.commands[command.toolSource?.sourceCommandId]?.receiptId !== payload.sourceReceiptId ||
                   payload.sourceSnapshotIds.some((sourceId) =>
                     store.browserSources?.[sourceId]?.taskId !== command.taskId ||
                     store.browserSources?.[sourceId]?.sourceReceiptId !== payload.sourceReceiptId))) ||
              command.taskId !== (store.commands[command.toolSource?.sourceCommandId]?.rootTaskId ??
                command.toolSource?.sourceCommandId) ||
              !['dispatching', 'observed', 'uncertain', 'rejected'].includes(command.state) ||
              !Object.hasOwn(store.commands, command.taskId) ||
              store.commands[command.taskId].kind !== 'session.message' ||
              store.commands[command.taskId].sessionId !== command.sessionId)) ||
          (command.kind === 'desktop.open_app'
            ? command.sessionId !== undefined || command.appId !== 'notepad' ||
              !['pending', 'dispatching', 'accepted_by_host', 'observed', 'uncertain', 'rejected'].includes(command.state) ||
              (command.taskId !== undefined && (command.toolSource === undefined ||
                command.taskId !== (store.commands[command.toolSource.sourceCommandId]?.rootTaskId ??
                  command.toolSource.sourceCommandId) ||
                store.commands[command.taskId]?.kind !== 'session.message' ||
                store.commands[command.taskId]?.sessionId !== command.toolSource.sessionId))
            : command.kind === 'chat.message' ? command.sessionId !== undefined || !['pending','rejected'].includes(command.state) || command.appId !== undefined
            : command.kind === INTERNAL_ARTIFACT_KIND ? command.appId !== undefined
            : !validId(command.sessionId) || command.appId !== undefined ||
              ['accepted_by_host'].includes(command.state) ||
              (command.kind === 'session.create'
                ? !/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.sessionId)
                : command.sessionId !== payload.sessionId || !Object.hasOwn(store.sessions, command.sessionId))) ||
          (command.kind === 'session.create' &&
            ['accepted_by_dsh', 'observed'].includes(command.state) &&
            (!Object.hasOwn(store.sessions, command.sessionId) ||
              (store.sessions[command.sessionId].modelProfileId !== undefined &&
                 store.sessions[command.sessionId].modelProfileId !== payload.modelProfileId) ||
               currentBinding && (store.sessions[command.sessionId].projectId ?? null) !== (payload.projectId ?? null) ||
               currentBinding && (store.sessions[command.sessionId].projectRevision ?? null) !== (payload.projectRevision ?? null) ||
               currentBinding && (store.sessions[command.sessionId].workspaceKind ?? null) !== (payload.workspaceKind ?? null))) ||
          (command.rootTaskId !== undefined && (command.kind !== 'session.message' ||
            (command.rootTaskId !== payload.rootTaskId || command.taskAction !== payload.taskAction) &&
              !(payload.rootTaskId === undefined && payload.mode === 'steer' && command.taskAction === 'supplement') ||
            command.rootTaskId === commandId ||
            store.commands[command.rootTaskId]?.kind !== 'session.message' ||
            store.commands[command.rootTaskId]?.rootTaskId !== undefined ||
             store.commands[command.rootTaskId]?.sessionId !== command.sessionId ||
             (store.commands[command.rootTaskId]?.payload.projectId ?? null) !== (payload.projectId ?? null) ||
             (store.commands[command.rootTaskId]?.payload.projectRevision ?? null) !== (payload.projectRevision ?? null) ||
             (store.commands[command.rootTaskId]?.payload.workspaceKind ?? null) !== (payload.workspaceKind ?? null))) ||
          (command.taskAction !== undefined && command.rootTaskId === undefined) ||
          (command.taskControl !== undefined && (command.kind !== 'session.message' ||
            command.rootTaskId !== undefined || !plainObject(command.taskControl) ||
            !['active', 'stop_requested'].includes(command.taskControl.state) ||
            !Array.isArray(command.taskControl.stopRequests) || command.taskControl.stopRequests.length > 100 ||
            command.taskControl.stopRequests.some((item) => !plainObject(item) ||
              !REQUEST_ID.test(item.requestId ?? '') || !validTime(item.at) ||
              (item.targets !== undefined && (!Array.isArray(item.targets) || item.targets.length > MAX_COMMANDS ||
                new Set(item.targets.map((target) => target.commandId)).size !== item.targets.length ||
                new Set(item.targets.map((target) => target.receiptId).filter(Boolean)).size !==
                  item.targets.filter((target) => target.receiptId).length ||
                item.targets.some((target) => !plainObject(target) || !validId(target.commandId) ||
                  !Object.hasOwn(store.commands, target.commandId) ||
                  store.commands[target.commandId].kind !== 'session.message' ||
                  store.commands[target.commandId].sessionId !== command.sessionId ||
                  (target.commandId !== commandId && store.commands[target.commandId].rootTaskId !== commandId) ||
                  (target.receiptId !== undefined && (!validId(target.receiptId) ||
                    target.receiptId !== store.commands[target.commandId].receiptId)) ||
                  (target.ack !== undefined && !['cancel_requested', 'queue_removed', 'unconfirmed'].includes(target.ack)) ||
                  (target.ackAt !== undefined && !validTime(target.ackAt)) ||
                  (target.attemptAt !== undefined && !validTime(target.attemptAt)) ||
                  Object.keys(target).some((key) => !['commandId', 'receiptId', 'ack', 'ackAt', 'attemptAt'].includes(key))))) ||
              (item.lastAttemptAt !== undefined && !validTime(item.lastAttemptAt)) ||
              (item.queuedOnly !== undefined && item.queuedOnly !== true) ||
              (item.resolution !== undefined && (!plainObject(item.resolution) ||
                !['stopped', 'completed'].includes(item.resolution.status) || !validTime(item.resolution.observedAt) ||
                Object.keys(item.resolution).sort().join(',') !== 'observedAt,status')) ||
              Object.keys(item).some((key) => !['requestId', 'at', 'targets', 'lastAttemptAt', 'queuedOnly', 'resolution'].includes(key))) ||
            !validTime(command.taskControl.updatedAt) ||
            Object.keys(command.taskControl).some((key) => !['state', 'stopRequests', 'updatedAt'].includes(key)))) ||
          (command.scheduleSourceId !== undefined && !scheduledCommandSource(store, command)) ||
          (command.receiptId !== undefined && !validId(command.receiptId)) ||
          (command.sourceAuthEpoch !== undefined && (!Number.isSafeInteger(command.sourceAuthEpoch) ||
            command.sourceAuthEpoch < 0 || !['password', 'cloud'].includes(store.devices[command.sourceDeviceId].authKind) ||
            command.sourceAuthEpoch > store.devices[command.sourceDeviceId].authEpoch)) ||
          (command.dshTurn !== undefined && (!Number.isSafeInteger(command.dshTurn) || command.dshTurn < 0 ||
            command.kind !== 'session.message')) ||
          (command.toolSource !== undefined && (!['desktop.open_app', INTERNAL_ARTIFACT_KIND].includes(command.kind) ||
            !plainObject(command.toolSource) || !validId(command.toolSource.sessionId) ||
            !Number.isSafeInteger(command.toolSource.turn) || command.toolSource.turn < 0 ||
            typeof command.toolSource.callId !== 'string' ||
            !/^[A-Za-z0-9._:-]{1,160}$/.test(command.toolSource.callId) ||
            !validId(command.toolSource.sourceCommandId) ||
            !Object.hasOwn(store.sessions, command.toolSource.sessionId) ||
            store.sessions[command.toolSource.sessionId].origin !== 'personal-remote' ||
            !Object.hasOwn(store.commands, command.toolSource.sourceCommandId) ||
            store.commands[command.toolSource.sourceCommandId].kind !== 'session.message' ||
            store.commands[command.toolSource.sourceCommandId].sessionId !== command.toolSource.sessionId ||
            store.commands[command.toolSource.sourceCommandId].sourceDeviceId !== command.sourceDeviceId ||
            store.commands[command.toolSource.sourceCommandId].sourceAuthEpoch !== command.sourceAuthEpoch ||
            store.commands[command.toolSource.sourceCommandId].dshTurn !== command.toolSource.turn ||
            Object.keys(command.toolSource).some((key) => !['sessionId', 'turn', 'callId', 'sourceCommandId'].includes(key)))) ||
          (command.verification !== undefined && (command.kind === INTERNAL_ARTIFACT_KIND
            ? !plainObject(command.verification) ||
              !['observed', 'unconfirmed'].includes(command.verification.status) ||
              command.verification.method !== 'sha256_readback' ||
              (command.verification.status === 'observed' && !validTime(command.verification.observedAt)) ||
              Object.keys(command.verification).some((key) => !['status', 'method', 'observedAt'].includes(key))
            : command.kind !== 'desktop.open_app' ||
            !plainObject(command.verification) || !['observed', 'unconfirmed'].includes(command.verification.status) ||
            command.verification.method !== 'visible_window' ||
            (command.verification.status === 'observed' && !validTime(command.verification.observedAt)) ||
            (command.verification.outcome !== undefined && !['opened', 'already_open'].includes(command.verification.outcome)) ||
            Object.keys(command.verification).some((key) => !['status', 'method', 'observedAt', 'outcome'].includes(key)))) ||
          (command.imageReasonCode !== undefined && (command.kind !== 'session.message' ||
            command.state !== 'rejected' || command.errorCode !== 'IMAGE_REJECTED' ||
            !IMAGE_REASONS.has(command.imageReasonCode))) ||
          (command.errorCode !== undefined && !PUBLIC_CODES.has(command.errorCode) &&
            !['DEVICE_REVOKED', 'RECEIPT_UNKNOWN', 'RECEIPT_TIMEOUT', 'SESSION_REPLACED'].includes(command.errorCode))) {
        throw failure('STORE_CORRUPT', 500);
      }
    } catch {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  for (const binding of Object.values(store.conversationBindings ?? {})) {
    const command = store.commands[binding.adoptCommandId];
    if (command?.kind !== 'session.create' || command.requestId !== binding.adoptRequestId ||
        command.sessionId !== binding.sessionId ||
        command.payload.conversationId !== binding.conversationId ||
        command.payload.cutoverSyncSeq !== binding.cutoverSyncSeq ||
        command.payload.contextHash !== binding.contextHash ||
        command.payload.modelProfileId !== binding.modelProfileId ||
        (binding.status === 'active' &&
          (command.state !== 'accepted_by_dsh' ||
            store.sessions[binding.sessionId]?.conversationId !== binding.conversationId)) ||
        (binding.status === 'creating' && !['pending', 'dispatching'].includes(command.state)) ||
        (binding.status === 'uncertain' && !['uncertain', 'dispatching'].includes(command.state))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
}

export function validateStore(store) {
  if (store?.onboarding !== undefined && (!plainObject(store.onboarding) ||
      !['welcome', 'account', 'model', 'memory', 'import', 'phone', 'first'].includes(store.onboarding.step) ||
      typeof store.onboarding.completed !== 'boolean' || typeof store.onboarding.started !== 'boolean' ||
      store.onboarding.ownerId !== undefined && !validId(store.onboarding.ownerId))) throw failure('STORE_CORRUPT', 500);
  if (!plainObject(store) || store.version !== VERSION || !validId(store.hostId) ||
      !validId(store.legacyOwnerId) || !plainObject(store.accounts) ||
      !Object.hasOwn(store.accounts, store.legacyOwnerId) ||
      (store.executionOwnerId !== undefined && (!validId(store.executionOwnerId) ||
        !store.accounts[store.executionOwnerId]?.account)) ||
      !plainObject(store.unknownAuthLimits) ||
      !Number.isSafeInteger(store.unknownAuthLimits.failures) || store.unknownAuthLimits.failures < 0 ||
      !Number.isSafeInteger(store.unknownAuthLimits.lastFailureAt) || store.unknownAuthLimits.lastFailureAt < 0 ||
      !Number.isSafeInteger(store.unknownAuthLimits.lockUntil) || store.unknownAuthLimits.lockUntil < 0 ||
      !Array.isArray(store.sharedModelProfiles) ||
      store.sharedModelProfiles.length > 500 ||
      store.sharedModelProfiles.some((value) => !validSharedProfile(value)) ||
      new Set(store.sharedModelProfiles.map((value) => value.id)).size !== store.sharedModelProfiles.length) {
    throw failure('STORE_CORRUPT', 500);
  }
  const usernames = new Set();
  const tokenHashes = new Set();
  const deviceIds = new Set();
  const sessionIds = new Set();
  const commandIds = new Set();
  for (const [ownerId, account] of Object.entries(store.accounts)) {
    if (!validId(ownerId) || !plainObject(account) ||
        ['version', 'hostId', 'ownerId'].some((key) => Object.hasOwn(account, key))) {
      throw failure('STORE_CORRUPT', 500);
    }
    validateSingleStore({ version: SINGLE_ACCOUNT_VERSION, hostId: store.hostId, ownerId, ...account });
    if (account.account !== null) {
      if (usernames.has(account.account.usernameCanonical)) throw failure('STORE_CORRUPT', 500);
      usernames.add(account.account.usernameCanonical);
    } else if (ownerId !== store.legacyOwnerId) throw failure('STORE_CORRUPT', 500);
    for (const [key, device] of Object.entries(account.devices)) {
      if (deviceIds.has(key) || tokenHashes.has(device.tokenHash)) throw failure('STORE_CORRUPT', 500);
      deviceIds.add(key);
      tokenHashes.add(device.tokenHash);
    }
    for (const key of Object.keys(account.sessions)) {
      if (sessionIds.has(key)) throw failure('STORE_CORRUPT', 500);
      sessionIds.add(key);
    }
    for (const key of Object.keys(account.commands)) {
      if (commandIds.has(key)) throw failure('STORE_CORRUPT', 500);
      commandIds.add(key);
    }
  }
}

export function uniqueSessionOwner(accounts, sessionId) {
  if (!plainObject(accounts) || !validId(sessionId)) return null;
  let match = null;
  for (const [ownerId, account] of Object.entries(accounts)) {
    if (!validId(ownerId) || !plainObject(account?.sessions) ||
        !Object.hasOwn(account.sessions, sessionId)) continue;
    if (match !== null) return null;
    match = { ownerId, origin: account.sessions[sessionId].origin,
      modelProfileId: account.sessions[sessionId].modelProfileId ?? null };
  }
  return match;
}

export function validSharedProfile(value) {
  return plainObject(value) && Object.keys(value).sort().join(',') ===
    'baseUrl,credentialHash,id,model,provider,source' &&
    typeof value.id === 'string' && MODEL_PROFILE_ID.test(value.id) &&
    typeof value.model === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value.model) &&
    typeof value.baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}\/v1$/.test(value.baseUrl) &&
    value.provider === 'openai-compatible' && value.source === 'formal-host-catalog' &&
    typeof value.credentialHash === 'string' && /^[a-f0-9]{64}$/.test(value.credentialHash);
}

export function accountDeviceInvalid(device, account) {
  return account === null || !device.scopes.includes('account:manage') ||
    !validTime(device.expiresAt) || !/^[a-f0-9]{64}$/.test(device.csrfHash ?? '') ||
    !Number.isSafeInteger(device.authEpoch) || device.authEpoch < 0 || device.authEpoch > account.authEpoch;
}
