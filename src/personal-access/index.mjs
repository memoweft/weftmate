import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { lstat, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { createPersonalSyncStore } from '../personal-sync/index.mjs';
import { createAttachmentStore, MAX_ATTACHMENT_BYTES, MAX_DISPLAY_BYTES } from '../personal-sync/attachments.mjs';
import { createSharedAttachmentStore, canonicalSharedAttachment, MAX_SHARED_IMAGE_BYTES,
  MAX_SHARED_MESSAGE_IMAGES, MAX_SHARED_MESSAGE_BYTES } from './shared-attachments.mjs';
import { hashPassword, normalizeUsername, validPassword, validPasswordRecord, verifyPassword } from './password.mjs';
import { avatarImage, displayName, publicProfile, validStoredProfile } from './profile.mjs';
import { canonicalCompletion, projectCompletion } from './model-completion.mjs';
import { createMobileUiPublisher } from './mobile-ui-release.mjs';
import { handlePersonalMemoryHttp } from '../personal-memory/http.mjs';
import { canonicalArtifact, createPersonalArtifactStore, validArtifactFileName } from '../personal-artifacts/index.mjs';

const VERSION = 3;
const SINGLE_ACCOUNT_VERSION = 2;
const LEGACY_VERSION = 1;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SETUP_GRANT_MS = 10 * 60 * 1000;
const COOKIE = 'wm_personal_session';
const CSRF_HEADER = 'x-weftmate-csrf';
const MAX_BODY = 12 * 1024;
const MAX_TEXT = 8 * 1024;
const MAX_PAGE = 200;
const MAX_COMMANDS = 5_000;
const MAX_ACTIVE_PASSWORD_DEVICES = 32;
const MAX_ACCOUNTS = 64;
const MAX_UNRECONCILED_TEXT_BYTES = 8 * 1024 * 1024;
const DISPATCH_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 3_000;
const MODEL_TIMEOUT_MS = 300_000;
const MODEL_JSON_MAX = 4 * 1024 * 1024;
const MODEL_SSE_MAX = 8 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MODEL_PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_CODES = new Set([
  'RUNTIME_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'SESSION_UNAVAILABLE',
  'CAPABILITY_UNAVAILABLE', 'TARGET_UNAVAILABLE', 'MODEL_ROUTE_BLOCKED',
  'INVALID_COMMAND', 'NOT_FOUND', 'CONFLICT', 'HISTORY_WINDOW_LIMIT', 'SESSION_READ_ONLY',
]);
const PUBLIC_CODES = new Set([
  ...SAFE_CODES, 'INVALID_REQUEST', 'REQUEST_CONFLICT', 'UNAUTHORIZED',
  'FORBIDDEN', 'UNSUPPORTED_MEDIA_TYPE', 'BODY_TOO_LARGE', 'ORIGIN_NOT_ALLOWED',
  'SERVICE_CLOSING', 'SERVICE_UNAVAILABLE', 'BACKEND_UNAVAILABLE', 'BACKEND_TIMEOUT',
  'CAPACITY_LIMIT', 'STORAGE_UNAVAILABLE', 'INVALID_CREDENTIALS', 'INVALID_SETUP_GRANT',
  'LOGIN_RATE_LIMITED', 'ACCOUNT_ALREADY_CONFIGURED', 'ACCOUNT_ALREADY_EXISTS',
  'ACCOUNT_LOGIN_REQUIRED', 'AMBIGUOUS_AUTH',
  'DEVICE_LIMIT', 'SESSION_REPLACED', 'SESSION_READ_ONLY', 'SESSION_EXPIRED',
  'TOOL_SOURCE_UNAVAILABLE',
  'TOOL_INTENT_UNCONFIRMED',
  'MEMORY_DISABLED', 'MEMORY_UNAVAILABLE', 'MEMORY_DELETE_UNAVAILABLE',
  'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_SEARCH_LIMIT', 'MEMORY_REVISION_CHANGED',
  'MEMORY_RESPONSE_INVALID', 'MEMORY_NOT_CURRENT', 'MEMORY_DELETE_CONFLICT',
  'MEMORY_SOURCE_UNRECOVERABLE', 'MEMORY_COMMAND_REJECTED',
  'MEMORY_REQUEST_CONFLICT',
  'MEMORY_REPLAY_REDACTED',
  'ATTACHMENT_NOT_FOUND',
  'ARTIFACT_UNVERIFIED',
  'TASK_NOT_READY',
  'IMAGE_REJECTED',
]);
const LEGACY_SCOPES = new Set(['sessions:read', 'commands:write']);
const SCOPES = new Set([...LEGACY_SCOPES, 'account:manage']);
const KINDS = new Set(['session.create', 'session.message', 'session.cancel', 'desktop.open_app']);
const INTERNAL_ARTIFACT_KIND = 'desktop.write_artifact';
const IMAGE_REASONS = new Set(['MODEL_DOES_NOT_SUPPORT_IMAGES', 'INVALID_IMAGE_BASE64',
  'TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH',
  'IMAGE_TOO_LARGE', 'IMAGE_TOO_MANY_PIXELS']);

function failure(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function safeCode(error) {
  return SAFE_CODES.has(error?.code) ? error.code : 'BACKEND_UNAVAILABLE';
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function csrfForToken(token) {
  return createHmac('sha256', token).update('weftmate-personal-csrf-v1').digest('base64url');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, required = []) {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) throw failure('INVALID_REQUEST');
}

function id(value) {
  if (!validId(value)) throw failure('INVALID_REQUEST');
  return value;
}
function modelProfileId(value) {
  if (typeof value !== 'string' || !MODEL_PROFILE_ID.test(value) ||
      Object.hasOwn(Object.prototype, value)) throw failure('INVALID_REQUEST');
  return value;
}

function validId(value) {
  return typeof value === 'string' && ID.test(value) && value !== 'prototype' &&
    !Object.hasOwn(Object.prototype, value);
}

function validTime(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/** A bounded permission hint for the one fixed desktop app, not language understanding. */
export function explicitNotepadOpenIntent(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const text = value.normalize('NFKC').toLowerCase();
  const candidates = [
    { pattern: /(?:打开|启动|开启|运行|唤起)(?:一下|下|这台电脑上的?|电脑上的?|windows的?|微软的?|\s){0,3}记事本/gu,
      refused: /(?:不要|别|无需|不用|不必|不需要|禁止|勿|不可)(?:再|去|请|帮我|\s)*$/u,
      instructions: /(?:如何|怎么|怎样|教我)(?:在电脑上|\s)*$/u },
    { pattern: /\b(?:open|launch|start|bring\s+up)\s+(?:the\s+)?(?:windows\s+|microsoft\s+)?notepad(?:\.exe|\s+app)?\b/gu,
      refused: /(?:do\s+not|don't|never|without|not\s+to|no\s+need\s+to|shouldn't)\s*$/u,
      instructions: /(?:how\s+to|ways?\s+to|tell\s+me\s+how\s+to)\s*$/u },
  ];
  return candidates.some(({ pattern, refused, instructions }) =>
    [...text.matchAll(pattern)].some((match) => {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      const quotedBefore = text[match.index - 1];
      const quotedAfter = text[match.index + match[0].length];
      return !refused.test(before) && !instructions.test(before) &&
        !(/['"`“‘]/u.test(quotedBefore ?? '') && /['"`”’]/u.test(quotedAfter ?? ''));
    }));
}

function canonicalCommand(value, hostId, internal = false) {
  exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'modelProfileId', 'sessionId', 'text', 'mode', 'appId', 'attachments',
    ...(internal ? ['taskId', 'artifactId', 'fileName', 'size', 'sha256', 'rootTaskId', 'taskAction'] : [])],
    ['requestId', 'kind', 'targetDeviceId']);
  if (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) ||
      !(KINDS.has(value.kind) || (internal && value.kind === INTERNAL_ARTIFACT_KIND))) {
    throw failure('INVALID_REQUEST');
  }
  if (value.targetDeviceId !== hostId) throw failure('TARGET_UNAVAILABLE', 409);
  if (value.kind === 'session.create') {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'modelProfileId'],
      ['requestId', 'kind', 'targetDeviceId', 'modelProfileId']);
    modelProfileId(value.modelProfileId);
  } else if (value.kind === 'session.message') {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'sessionId', 'text', 'mode', 'attachments',
      ...(internal ? ['rootTaskId', 'taskAction'] : [])],
      ['requestId', 'kind', 'targetDeviceId', 'sessionId', 'text']);
    id(value.sessionId);
    if (value.rootTaskId !== undefined && (!internal || !validId(value.rootTaskId) ||
        !['supplement', 'resume'].includes(value.taskAction))) throw failure('INVALID_REQUEST');
    if (value.taskAction !== undefined && value.rootTaskId === undefined) throw failure('INVALID_REQUEST');
    const attachments = value.attachments === undefined ? null : value.attachments;
    if (attachments !== null && (!Array.isArray(attachments) || attachments.length < 1 ||
        attachments.length > MAX_SHARED_MESSAGE_IMAGES)) throw failure('INVALID_REQUEST');
    const canonical = attachments?.map(canonicalSharedAttachment);
    if (canonical && (new Set(canonical.map((item) => item.attachmentId)).size !== canonical.length ||
        canonical.reduce((sum, item) => sum + item.size, 0) > MAX_SHARED_MESSAGE_BYTES)) throw failure('INVALID_REQUEST');
    if (typeof value.text !== 'string' || (!value.text.trim() && !canonical) || value.text.length > MAX_TEXT) {
      throw failure('INVALID_REQUEST');
    }
    if (value.mode !== undefined && !['queue', 'steer'].includes(value.mode)) throw failure('INVALID_REQUEST');
  } else if (value.kind === 'session.cancel') {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'sessionId'],
      ['requestId', 'kind', 'targetDeviceId', 'sessionId']);
    id(value.sessionId);
  } else if (value.kind === INTERNAL_ARTIFACT_KIND) {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'sessionId', 'taskId', 'artifactId',
      'fileName', 'size', 'sha256'], ['requestId', 'kind', 'targetDeviceId', 'sessionId',
      'taskId', 'artifactId', 'fileName', 'size', 'sha256']);
    id(value.sessionId); id(value.taskId); id(value.artifactId);
    if (!validArtifactFileName(value.fileName) || !Number.isSafeInteger(value.size) ||
        value.size < 1 || value.size > 128 * 1024 || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw failure('INVALID_COMMAND');
    }
  } else {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'appId'],
      ['requestId', 'kind', 'targetDeviceId', 'appId']);
    if (value.appId !== 'notepad') throw failure('INVALID_COMMAND');
  }
  return Object.fromEntries(['requestId', 'kind', 'targetDeviceId', 'modelProfileId', 'sessionId', 'text', 'mode', 'appId', 'attachments',
    'taskId', 'artifactId', 'fileName', 'size', 'sha256', 'rootTaskId', 'taskAction']
    .filter((key) => Object.hasOwn(value, key) || (key === 'mode' && value.kind === 'session.message'))
    .map((key) => [key, key === 'mode' ? (value.mode ?? 'queue')
      : key === 'attachments' ? value.attachments.map(canonicalSharedAttachment) : value[key]]));
}

async function durableWrite(file, state, shouldCommit = () => true) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(state), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await ensurePrivateFile(tmp);
    for (let attempt = 0; ; attempt++) {
      if (!shouldCommit()) throw failure('SERVICE_CLOSING', 503);
      try { await rename(tmp, file); break; }
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
  }
}

function validateSingleStore(store) {
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
    if (store.version === SINGLE_ACCOUNT_VERSION && (device.authKind === 'legacy-local'
      ? device.scopes.includes('account:manage')
      : device.authKind === 'password'
        ? accountDeviceInvalid(device, store.account)
        : true)) throw failure('STORE_CORRUPT', 500);
  }
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    if (!validId(sessionId) || !plainObject(session) || session.ownerId !== store.ownerId ||
        (session.origin !== undefined && !['personal-remote', 'shared-chat', 'legacy-local', 'local-attached'].includes(session.origin)) ||
        (session.modelProfileId !== undefined && (typeof session.modelProfileId !== 'string' ||
          !MODEL_PROFILE_ID.test(session.modelProfileId))) ||
        (session.origin === 'shared-chat' && !MODEL_PROFILE_ID.test(session.modelProfileId ?? ''))) {
      throw failure('STORE_CORRUPT', 500);
    }
  }
  const requestIds = new Set();
  for (const [commandId, command] of Object.entries(store.commands)) {
    if (!validId(commandId) || !plainObject(command) || command.commandId !== commandId ||
        command.ownerId !== store.ownerId || !REQUEST_ID.test(command.requestId ?? '') ||
        !/^[a-f0-9]{64}$/.test(command.payloadHash ?? '') ||
        !(KINDS.has(command.kind) || command.kind === INTERNAL_ARTIFACT_KIND) ||
        !['pending', 'dispatching', 'accepted_by_dsh', 'accepted_by_host', 'observed', 'uncertain', 'rejected'].includes(command.state) ||
        !validId(command.sourceDeviceId) || !Object.hasOwn(store.devices, command.sourceDeviceId) ||
        !plainObject(command.payload) || requestIds.has(command.requestId)) {
      throw failure('STORE_CORRUPT', 500);
    }
    requestIds.add(command.requestId);
    try {
      const payload = canonicalCommand(command.payload, store.hostId, true);
      if (JSON.stringify(payload) !== JSON.stringify(command.payload) ||
          digest(JSON.stringify(payload)) !== command.payloadHash ||
          command.kind !== payload.kind || command.requestId !== payload.requestId ||
          command.targetDeviceId !== store.hostId ||
          (command.kind === INTERNAL_ARTIFACT_KIND &&
            (command.sessionId !== payload.sessionId || command.taskId !== payload.taskId ||
              command.artifactId !== payload.artifactId || command.fileName !== payload.fileName ||
              command.size !== payload.size || command.sha256 !== payload.sha256 ||
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
                store.sessions[command.sessionId].modelProfileId !== payload.modelProfileId))) ||
          (command.rootTaskId !== undefined && (command.kind !== 'session.message' ||
            command.rootTaskId !== payload.rootTaskId || command.taskAction !== payload.taskAction ||
            command.rootTaskId === commandId ||
            store.commands[command.rootTaskId]?.kind !== 'session.message' ||
            store.commands[command.rootTaskId]?.rootTaskId !== undefined ||
            store.commands[command.rootTaskId]?.sessionId !== command.sessionId)) ||
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
              Object.keys(item).some((key) => !['requestId', 'at', 'targets', 'lastAttemptAt'].includes(key))) ||
            !validTime(command.taskControl.updatedAt) ||
            Object.keys(command.taskControl).some((key) => !['state', 'stopRequests', 'updatedAt'].includes(key)))) ||
          (command.receiptId !== undefined && !validId(command.receiptId)) ||
          (command.sourceAuthEpoch !== undefined && (!Number.isSafeInteger(command.sourceAuthEpoch) ||
            command.sourceAuthEpoch < 0 || store.devices[command.sourceDeviceId].authKind !== 'password' ||
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
}

function validateStore(store) {
  if (!plainObject(store) || store.version !== VERSION || !validId(store.hostId) ||
      !validId(store.legacyOwnerId) || !plainObject(store.accounts) ||
      !Object.hasOwn(store.accounts, store.legacyOwnerId) ||
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

function validSharedProfile(value) {
  return plainObject(value) && Object.keys(value).sort().join(',') ===
    'baseUrl,credentialHash,id,model,provider,source' &&
    typeof value.id === 'string' && MODEL_PROFILE_ID.test(value.id) &&
    typeof value.model === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value.model) &&
    typeof value.baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}\/v1$/.test(value.baseUrl) &&
    value.provider === 'openai-compatible' && value.source === 'formal-host-catalog' &&
    typeof value.credentialHash === 'string' && /^[a-f0-9]{64}$/.test(value.credentialHash);
}

function accountDeviceInvalid(device, account) {
  return account === null || !device.scopes.includes('account:manage') ||
    !validTime(device.expiresAt) || !/^[a-f0-9]{64}$/.test(device.csrfHash ?? '') ||
    !Number.isSafeInteger(device.authEpoch) || device.authEpoch < 0 || device.authEpoch > account.authEpoch;
}

function publicCommand(command) {
  const result = {
    commandId: command.commandId,
    requestId: command.requestId,
    kind: command.kind,
    targetDeviceId: command.targetDeviceId,
    state: command.state,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  };
  if (command.sessionId) result.sessionId = command.sessionId;
  if (command.kind === 'session.message' && !command.rootTaskId && typeof command.payload?.text === 'string') {
    const normalized = command.payload.text.replace(/\s+/g, ' ').trim();
    const characters = Array.from(normalized);
    if (characters.length) result.taskLabel = characters.length > 72
      ? `${characters.slice(0, 72).join('')}…` : normalized;
  }
  if (command.appId) result.appId = command.appId;
  if (command.taskId) result.taskId = command.taskId;
  if (command.rootTaskId) result.rootTaskId = command.rootTaskId;
  if (command.taskAction) result.taskAction = command.taskAction;
  if (command.artifactId) result.artifactId = command.artifactId;
  if (command.fileName) result.fileName = command.fileName;
  if (command.size !== undefined) result.size = command.size;
  if (command.sha256) result.sha256 = command.sha256;
  if (command.receiptId) result.receiptId = command.receiptId;
  if (command.verification) result.verification = { ...command.verification };
  if (command.errorCode) result.errorCode = command.errorCode;
  if (command.imageReasonCode) result.imageReasonCode = command.imageReasonCode;
  return result;
}

function bounded(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

function modelProjection(value) {
  if (!Array.isArray(value)) throw failure('BACKEND_UNAVAILABLE', 503);
  return value.slice(0, 500).filter(plainObject).map((model) => ({
    id: bounded(model.id, 128),
    name: bounded(model.name, 256),
    model: bounded(model.model, 128),
    configured: model.configured === true,
    ...(model.source === 'host' ? { source: 'host' } : {}),
    ...(['local', 'cloud'].includes(model.sourceKind) ? { sourceKind: model.sourceKind } : {}),
  })).filter((model) => model.id && MODEL_PROFILE_ID.test(model.id));
}

function statusProjection(value) {
  if (!plainObject(value)) throw failure('BACKEND_UNAVAILABLE', 503);
  const capability = (entry, appIds = false) => ({
    available: entry?.available === true,
    ...(typeof entry?.reasonCode === 'string' && /^[A-Z_]{2,48}$/.test(entry.reasonCode)
      ? { reasonCode: entry.reasonCode } : {}),
    ...(typeof entry?.inferenceVerified === 'boolean' ? { inferenceVerified: entry.inferenceVerified } : {}),
    ...(appIds ? { appIds: entry?.available === true ? ['notepad'] : [] } : {}),
  });
  const moduleState = (name) => ['connected', 'disabled', 'unknown'].includes(value.modules?.[name])
    ? value.modules[name] : 'unknown';
  return {
    runtime: ['ready', 'unavailable'].includes(value.runtime) ? value.runtime : 'unavailable',
    referenceScan: ['ready', 'failed', 'pending'].includes(value.referenceScan)
      ? value.referenceScan : 'pending',
    capabilities: {
      chat: capability(value.capabilities?.chat),
      desktopOpenApp: capability(value.capabilities?.desktopOpenApp, true),
      naturalLanguageDesktop: capability(value.capabilities?.naturalLanguageDesktop),
    },
    modules: Object.fromEntries(['memory', 'mods', 'tasks', 'notifications', 'workspaces', 'capabilities']
      .map((name) => [name, moduleState(name)])),
  };
}

function withDeadline(task, ms) {
  let timeout;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(failure('BACKEND_TIMEOUT', 503)), ms); }),
  ]).finally(() => clearTimeout(timeout));
}

async function boundedUpstreamBody(upstream, limit) {
  const parts = [];
  let bytes = 0;
  if (!upstream.body) throw failure('BACKEND_UNAVAILABLE', 503);
  for await (const part of upstream.body) {
    bytes += part.byteLength;
    if (bytes > limit) throw failure('BACKEND_UNAVAILABLE', 503);
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts).toString('utf8');
}

async function writeStreamPart(response, part) {
  if (response.write(part)) return;
  await new Promise((resolve, reject) => {
    const drained = () => { response.off('close', closed); resolve(); };
    const closed = () => { response.off('drain', drained); reject(failure('SERVICE_UNAVAILABLE', 503)); };
    response.once('drain', drained);
    response.once('close', closed);
  });
}

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
  allowedOrigins = [], trustedProxy = false, clock = Date.now }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) ||
      !Number.isInteger(port) || port < 0 || port > 65535 || !plainObject(backend) ||
      (uiHandler !== undefined && typeof uiHandler !== 'function') ||
      typeof sharedProfileIsFormal !== 'function' ||
      (memoryManager !== null && (typeof memoryManager.status !== 'function' ||
        typeof memoryManager.peek !== 'function' || typeof memoryManager.query !== 'function' ||
        typeof memoryManager.submitCommand !== 'function' ||
        typeof memoryManager.receiptByRequest !== 'function' ||
        typeof memoryManager.retryCleanupByRequest !== 'function')) ||
      (androidPackagePath !== null && (typeof androidPackagePath !== 'string' ||
        !path.isAbsolute(androidPackagePath) || path.basename(androidPackagePath).toLowerCase() !== 'android-candidate.apk')) ||
      (mobileUiDir !== null && (typeof mobileUiDir !== 'string' || !path.isAbsolute(mobileUiDir))) ||
      !Array.isArray(allowedOrigins) || typeof trustedProxy !== 'boolean' ||
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
  await ensurePrivateDirectory(root);
  const storeFile = path.join(root, 'store.json');
  let rootState;
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
  const artifactStore = createPersonalArtifactStore(path.join(root, 'artifacts'));
  const hostOwner = (ownerId) => ownerId === rootState.legacyOwnerId;
  const modelVisible = (ownerId, profileId) => {
    if (hostOwner(ownerId)) return true;
    const marker = rootState.sharedModelProfiles.find((item) => item.id === profileId);
    if (!marker) return false;
    try { return sharedProfileIsFormal(marker) === true; } catch { return false; }
  };
  const registeredAccountCount = () => Object.values(rootState.accounts)
    .filter((entry) => entry.account !== null).length;
  // A callback may have run before the process died. Never replay these commands.
  if (Object.values(rootState.accounts).some((account) =>
    Object.values(account.commands).some((command) => command.state === 'dispatching'))) {
    const recovered = structuredClone(rootState);
    for (const [ownerId, account] of Object.entries(recovered.accounts)) {
      for (const command of Object.values(account.commands)) {
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
  const active = new Set();
  const activeByCommand = new Map();
  const scheduled = new Set();
  const stopping = new Map();
  const pendingPreflights = new Map();

  function timestamp() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw failure('SERVICE_UNAVAILABLE', 503);
    return value;
  }

  function hashWork(task) {
    if (queuedHashes >= 4) throw failure('LOGIN_RATE_LIMITED', 429);
    queuedHashes++;
    const result = hashQueue.then(task);
    hashQueue = result.catch(() => {});
    return result.finally(() => { queuedHashes--; });
  }

  function requireOpen() {
    if (closing) throw failure('SERVICE_CLOSING', 503);
  }

  function callBackend(task) {
    return withDeadline(() => { requireOpen(); return task(); }, DISPATCH_TIMEOUT_MS);
  }

  function taskSource(account, taskId) {
    const source = account.commands[taskId];
    if (!source || source.kind !== 'session.message' || source.rootTaskId !== undefined ||
        account.sessions[source.sessionId]?.origin !== 'personal-remote') throw failure('NOT_FOUND', 404);
    return source;
  }

  function taskChildren(account, taskId) {
    return Object.values(account.commands).filter((item) => item.rootTaskId === taskId);
  }

  function taskHasUnknownEffects(account, taskId) {
    const messageIds = new Set([taskId, ...taskChildren(account, taskId).map((item) => item.commandId)]);
    return Object.values(account.commands).some((item) =>
      (messageIds.has(item.commandId) && ['dispatching', 'uncertain'].includes(item.state)) ||
      ((item.taskId === taskId || messageIds.has(item.toolSource?.sourceCommandId)) &&
        ['pending', 'dispatching', 'uncertain', 'accepted_by_host'].includes(item.state)));
  }

  // A stop freezes command identities. A receipt learned after dispatch is
  // attached only to a command already in that frozen set.
  function stopTargets(account, taskId) {
    return [taskSource(account, taskId), ...taskChildren(account, taskId)]
      .map((item) => ({ commandId: item.commandId,
        ...(item.receiptId ? { receiptId: item.receiptId } : {}) }));
  }

  function latestStop(account, taskId) {
    return taskSource(account, taskId).taskControl?.stopRequests.at(-1) ?? null;
  }

  // Native turn identity and source.rpcId are necessary. Text equality is
  // never evidence: two user messages may contain identical text.
  async function taskStopEvidence(account, taskId) {
    const deadline = timestamp() + 2_500;
    const observe = (work) => {
      const remaining = deadline - timestamp();
      if (remaining <= 0) throw failure('BACKEND_TIMEOUT', 503);
      return withDeadline(() => { requireOpen(); return work(); }, remaining);
    };
    const source = taskSource(account, taskId);
    const stop = latestStop(account, taskId);
    if (!stop) return { ready: false, status: 'unconfirmed', pendingCount: 1 };
    // Stage 08 recorded intent without a target snapshot. Derive only the
    // commands that already existed at that instant for read-only history
    // observation. Never send these inferred identities to stopTask.
    const legacy = !stop.targets;
    const targets = stop.targets ?? stopTargets(account, taskId).filter((target) =>
      Date.parse(account.commands[target.commandId].createdAt) <= Date.parse(stop.at));
    const needsHistory = targets.some((target) => target.receiptId && target.ack !== 'queue_removed');
    const turns = new Map();
    const receiptTurns = new Map();
    let historyComplete = !needsHistory;
    let invalidHistory = false;
    if (needsHistory) {
    let described;
    try { described = await observe(() => backend.describeSession(source.sessionId, account.ownerId)); }
    catch { return { ready: false, status: 'unconfirmed', pendingCount: targets.length }; }
    if (described?.sessionId !== source.sessionId || described.agentPreset !== 'personal-remote') {
      return { ready: false, status: 'unconfirmed', pendingCount: targets.length };
    }
    let afterSeq = -1;
    let openTurn = null;
    try {
      for (let pageNo = 0; pageNo < 50; pageNo++) {
        const page = await observe(() => backend.readEvents({ sessionId: source.sessionId,
          afterSeq, limit: 200, ownerId: account.ownerId }));
        if (!Array.isArray(page?.events) || !Number.isSafeInteger(page.nextSeq) ||
            page.nextSeq < afterSeq) break;
        for (const event of page.events) {
          if (event.type === 'turn.started') {
            const turn = event.data?.turn;
            if (!Number.isSafeInteger(turn) || turn < 0 || openTurn !== null || turns.has(turn)) {
              invalidHistory = true; break;
            }
            openTurn = turn;
            turns.set(turn, { receipts: new Set(), unknownUser: false, startedAt: event.at, ended: false });
          } else if (event.type === 'user.message') {
            const receiptId = event.data?.receiptId;
            if (openTurn === null) { invalidHistory = true; break; }
            if (typeof receiptId !== 'string' || !ID.test(receiptId)) {
              turns.get(openTurn).unknownUser = true; continue;
            }
            turns.get(openTurn).receipts.add(receiptId);
            if (receiptTurns.has(receiptId)) receiptTurns.set(receiptId, null);
            else receiptTurns.set(receiptId, openTurn);
          } else if (event.type === 'turn.ended') {
            const turn = event.data?.turn;
            if (openTurn !== null && turn === openTurn) {
              const record = turns.get(turn);
              record.ended = true;
              record.reason = event.data?.reason;
              record.endedAt = event.at;
              openTurn = null;
            }
          }
        }
        if (invalidHistory) break;
        if (!page.hasMore) { historyComplete = true; break; }
        if (page.nextSeq === afterSeq) break;
        afterSeq = page.nextSeq;
      }
    } catch { /* Incomplete history is not proof of a closed turn. */ }
    }
    let pendingCount = 0;
    let aborted = false;
    let removed = false;
    let completed = false;
    let cancelRequested = false;
    let uncertain = invalidHistory;
    const terminalTimes = [];
    const targetReceipts = new Set(targets.map((item) => item.receiptId).filter(Boolean));
    for (const target of targets) {
      const command = account.commands[target.commandId];
      if (target.ack === 'queue_removed' && target.receiptId) {
        removed = true;
        if (target.ackAt) terminalTimes.push(target.ackAt);
        continue;
      }
      if (!target.receiptId) {
        if (command?.state === 'rejected' && command.errorCode === 'TASK_NOT_READY') {
          removed = true;
          if (command.updatedAt) terminalTimes.push(command.updatedAt);
          continue;
        }
        if (command?.state === 'uncertain') uncertain = true;
        pendingCount++;
        continue;
      }
      const turnId = receiptTurns.get(target.receiptId);
      const turn = turns.get(turnId);
      if (invalidHistory || !historyComplete || !turn?.ended || turn.unknownUser || turn.receipts.size === 0 ||
          [...turn.receipts].some((receipt) => !targetReceipts.has(receipt))) {
        if (target.ack === 'unconfirmed' || turn?.unknownUser ||
            (turn && [...turn.receipts].some((receipt) => !targetReceipts.has(receipt)))) uncertain = true;
        pendingCount++;
        if (target.ack === 'cancel_requested') cancelRequested = true;
        continue;
      }
      if (turn.reason === 'aborted' && validTime(turn.endedAt) &&
          Date.parse(turn.endedAt) >= Date.parse(stop.at)) aborted = true;
      else if (turn.reason === 'completed') completed = true;
      if (validTime(turn.endedAt)) terminalTimes.push(turn.endedAt);
    }
    const effectsUnknown = taskHasUnknownEffects(account, taskId);
    if (effectsUnknown) { pendingCount++; uncertain = true; }
    if (targets.some((target) => target.attemptAt || target.ack === 'unconfirmed')) uncertain = true;
    const status = pendingCount ? cancelRequested ? 'cancel_requested' : uncertain || legacy ? 'unconfirmed' : 'requested'
      : aborted || removed ? 'stopped' : completed ? 'completed' : 'unconfirmed';
    return { ready: pendingCount === 0, legacy,
      ...(status === 'stopped' && terminalTimes.length ? {
        observedAt: terminalTimes.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) } : {}),
      status, pendingCount };
  }

  async function taskDetail(account, taskId) {
    const source = taskSource(account, taskId);
    const children = taskChildren(account, taskId);
    const messageIds = new Set([taskId, ...children.map((item) => item.commandId)]);
    const artifacts = Object.values(account.commands).filter((item) =>
      item.kind === INTERNAL_ARTIFACT_KIND && item.taskId === taskId).map(publicCommand);
    const steps = Object.values(account.commands).filter((item) =>
      item.kind === 'desktop.open_app' && item.toolSource &&
      (item.taskId === taskId || messageIds.has(item.toolSource.sourceCommandId))).map(publicCommand);
    const storedState = source.taskControl?.state ?? 'active';
    const state = storedState === 'active' && taskHasUnknownEffects(account, taskId)
      ? 'uncertain' : storedState;
    const evidence = state === 'stop_requested' ? await taskStopEvidence(account, taskId) : null;
    return { taskId, sessionId: source.sessionId, sourceText: source.payload.text,
      source: publicCommand(source), artifacts, steps,
      supplements: children.filter((item) => item.taskAction === 'supplement').map(publicCommand),
      resumes: children.filter((item) => item.taskAction === 'resume').map(publicCommand),
      control: { state, updatedAt: source.taskControl?.updatedAt ?? source.updatedAt,
        ...(state === 'stop_requested' && source.taskControl?.stopRequests?.length ? {
          stopRequestedAt: source.taskControl.stopRequests.at(-1).at } : {}),
        canSupplement: state === 'active', canStop: storedState === 'active',
        canResume: state === 'stop_requested' && evidence?.ready === true,
        ...(state === 'stop_requested' ? { stopStatus: evidence.status,
          pendingReceipts: evidence.pendingCount,
          ...(evidence.observedAt ? { stopObservedAt: evidence.observedAt } : {}),
          ...(evidence.legacy ? { legacyStopIntent: true } : {}) } : {}),
        ...(state === 'uncertain' ? { reasonCode: 'EFFECT_OUTCOME_UNCONFIRMED' } : {}),
        ...(state === 'stop_requested' ? { reasonCode: evidence.status === 'stopped'
          ? 'STOP_OBSERVED' : evidence.status === 'completed'
            ? 'TURN_ENDED_AFTER_STOP_REQUEST' : evidence.status === 'cancel_requested'
              ? 'STOP_CANCEL_REQUESTED' : evidence.status === 'requested'
                ? 'STOP_REQUEST_PENDING' : evidence.ready
                ? 'TURN_ENDED_AFTER_STOP_REQUEST' : evidence.legacy
                  ? 'LEGACY_STOP_RECHECK_REQUIRED' : 'TURN_OUTCOME_UNCONFIRMED' } : {}) } };
  }

  function driveTaskStop(ownerId, taskId, force = false) {
    const key = `${ownerId}|${taskId}`;
    if (stopping.has(key)) return stopping.get(key);
    const work = (async () => {
      if (closing || storageFault || typeof backend.stopTask !== 'function') return;
      const account = accountState(ownerId);
      const source = taskSource(account, taskId);
      if (source.taskControl?.state !== 'stop_requested') return;
      const stop = latestStop(account, taskId);
      if (!stop?.targets) return;
      if (!force && stop.lastAttemptAt && timestamp() - Date.parse(stop.lastAttemptAt) < 1_000) return;
      const candidates = stop.targets.filter((target) => target.receiptId && target.ack !== 'queue_removed' &&
        account.commands[target.commandId]?.state === 'accepted_by_dsh')
        .sort((left, right) => (left.attemptAt ? Date.parse(left.attemptAt) : 0) -
          (right.attemptAt ? Date.parse(right.attemptAt) : 0)).slice(0, 16);
      if (!candidates.length) return;
      const described = await withDeadline(() => backend.describeSession(source.sessionId, ownerId), 2_500)
        .catch(() => null);
      if (described?.sessionId !== source.sessionId || described.agentPreset !== 'personal-remote') return;
      await serial(() => mutate(ownerId, (next) => {
        const current = latestStop(next, taskId);
        if (current?.requestId !== stop.requestId) return;
        const at = new Date(timestamp()).toISOString();
        current.lastAttemptAt = at;
        for (const candidate of candidates) {
          const target = current.targets.find((item) => item.commandId === candidate.commandId);
          if (target?.receiptId === candidate.receiptId) target.attemptAt = at;
        }
      }));
      {
        const receipts = candidates.map((item) => item.receiptId);
        let result;
        try {
          result = await withDeadline(() => backend.stopTask({ sessionId: source.sessionId,
            ownerId, requestId: stop.requestId, receiptIds: receipts }), 3_000);
        } catch { return; }
        if (!Array.isArray(result?.outcomes) || result.outcomes.length !== receipts.length ||
            new Set(result.outcomes.map((item) => item.receiptId)).size !== receipts.length ||
            result.outcomes.some((item) => !receipts.includes(item.receiptId) ||
              !['cancel_requested', 'queue_removed', 'unconfirmed'].includes(item.status))) return;
        if (closing) return;
        await serial(() => mutate(ownerId, (next) => {
          const current = latestStop(next, taskId);
          if (current?.requestId !== stop.requestId) return;
          const at = new Date(timestamp()).toISOString();
          for (const outcome of result.outcomes) {
            const target = current.targets.find((item) => item.receiptId === outcome.receiptId);
            if (!target || target.ack === 'queue_removed') continue;
            target.ack = outcome.status;
            target.ackAt = at;
          }
        }));
      }
    })().finally(() => stopping.delete(key));
    stopping.set(key, work);
    return work;
  }

  function serial(task) {
    const result = queue.then(() => { requireOpen(); return task(); });
    queue = result.catch(() => {});
    return result;
  }

  async function mutateRoot(change) {
    requireOpen();
    if (storageFault) throw failure('STORAGE_UNAVAILABLE', 503);
    const next = structuredClone(rootState);
    const value = await change(next);
    requireOpen();
    validateStore(next);
    try { await durableWrite(storeFile, next, () => !closing); }
    catch (error) {
      if (error?.code !== 'SERVICE_CLOSING') storageFault = true;
      throw error;
    }
    rootState = next;
    return value;
  }

  async function mutate(ownerId, change) {
    return mutateRoot(async (nextRoot) => {
      const account = nextRoot.accounts[ownerId];
      if (!account) throw failure('UNAUTHORIZED', 401);
      const next = { version: SINGLE_ACCOUNT_VERSION, hostId: nextRoot.hostId, ownerId, ...account };
      const value = await change(next);
      if (next.ownerId !== ownerId || next.hostId !== nextRoot.hostId) throw failure('STORE_CORRUPT', 500);
      const { version: _version, hostId: _hostId, ownerId: _ownerId, ...updated } = next;
      nextRoot.accounts[ownerId] = updated;
      return value;
    });
  }

  function requestAuthority(request) {
    const host = request.headers.host;
    if (typeof host !== 'string') return null;
    if (host === new URL(origin).host) {
      return Object.keys(request.headers).some((key) => key === 'forwarded' || key.startsWith('x-forwarded-'))
        ? null : origin;
    }
    const configured = allowedOrigins.find((candidate) => new URL(candidate).host === host);
    if (!configured || !trustedProxy || request.headers.forwarded !== undefined ||
        !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress) ||
        request.headers['x-forwarded-proto'] !== 'https' ||
        request.headers['x-forwarded-host'] !== host) return null;
    return configured;
  }

  function matchingOrigin(request) {
    const authority = requestAuthority(request);
    const supplied = request.headers.origin;
    return typeof supplied === 'string' && supplied === authority ? authority : null;
  }

  function requireBrowserOrigin(request, setup = false) {
    const matched = matchingOrigin(request);
    if (!matched) throw failure('ORIGIN_NOT_ALLOWED', 403);
    if (setup && (matched !== origin || request.headers.host !== new URL(origin).host ||
        Object.keys(request.headers).some((key) => key === 'forwarded' || key.startsWith('x-forwarded-')))) {
      throw failure('ORIGIN_NOT_ALLOWED', 403);
    }
    return matched;
  }

  function cookieToken(request) {
    const header = request.headers.cookie;
    if (typeof header !== 'string' || header.length > 4096) return null;
    const matches = header.split(';').map((item) => item.trim())
      .filter((item) => item.startsWith(`${COOKIE}=`));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{40,128}$/.test(token) ? token : null;
  }

  function ownerForRequest(request) {
    const bearer = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.authorization ?? '');
    const token = bearer?.[1] ?? cookieToken(request);
    if (!token) return null;
    const hash = Buffer.from(digest(token), 'hex');
    for (const [ownerId, account] of Object.entries(rootState.accounts)) {
      if (Object.values(account.devices).some((device) => {
        const stored = Buffer.from(device.tokenHash, 'hex');
        return stored.length === hash.length && timingSafeEqual(stored, hash);
      })) return ownerId;
    }
    return null;
  }

  function authenticate(request, scope) {
    const authorization = request.headers.authorization;
    const fromCookie = cookieToken(request);
    const namedCookie = typeof request.headers.cookie === 'string' &&
      request.headers.cookie.split(';').some((item) => item.trim().startsWith(`${COOKIE}=`));
    if (authorization !== undefined && namedCookie) throw failure('AMBIGUOUS_AUTH');
    let token;
    let via;
    if (authorization !== undefined) {
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]+$/.test(authorization)) {
        throw failure('UNAUTHORIZED', 401);
      }
      token = authorization.slice(7);
      via = 'bearer';
    } else if (fromCookie !== null) {
      token = fromCookie;
      via = 'cookie';
    } else throw failure('UNAUTHORIZED', 401);
    const ownerId = ownerForRequest(request);
    if (ownerId === null) throw failure('UNAUTHORIZED', 401);
    const state = accountState(ownerId);
    const hash = Buffer.from(digest(token), 'hex');
    const selected = Object.entries(state.devices).find(([, item]) => {
      const stored = Buffer.from(item.tokenHash, 'hex');
      return stored.length === hash.length && timingSafeEqual(stored, hash);
    });
    if (!selected || selected[1].revoked) throw failure('UNAUTHORIZED', 401);
    const [deviceId, device] = selected;
    if (device.authKind === 'password' &&
        (Date.parse(device.expiresAt) <= timestamp() || state.account === null ||
          device.authEpoch !== state.account.authEpoch)) throw failure('UNAUTHORIZED', 401);
    if (!device.scopes.includes(scope) || (scope === 'account:manage' && via !== 'cookie')) {
      throw failure('FORBIDDEN', 403);
    }
    if (via === 'cookie' && ['POST', 'DELETE', 'PATCH', 'PUT'].includes(request.method)) {
      requireBrowserOrigin(request);
      const csrf = request.headers[CSRF_HEADER];
      if (typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(csrf) ||
          !device.csrfHash || !timingSafeEqual(Buffer.from(digest(csrf), 'hex'), Buffer.from(device.csrfHash, 'hex'))) {
        throw failure('FORBIDDEN', 403);
      }
    }
    return { ownerId, deviceId, device, via,
      csrfToken: via === 'cookie' ? csrfForToken(token) : null };
  }

  function json(response, status, value, headers = {}) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    response.end(JSON.stringify(value));
  }

  function sessionCookie(token, secure) {
    return `${COOKIE}=${token}; Path=/personal/v1; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  function clearCookie(secure) {
    return `${COOKIE}=; Path=/personal/v1; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  function newPasswordDevice(next, name, at) {
    if (Object.values(next.devices).filter((device) => device.authKind === 'password' && !device.revoked &&
        Date.parse(device.expiresAt) > at && device.authEpoch === next.account.authEpoch).length >= MAX_ACTIVE_PASSWORD_DEVICES) {
      throw failure('DEVICE_LIMIT', 429);
    }
    const deviceId = `device-${randomUUID()}`;
    const token = randomBytes(32).toString('base64url');
    const csrfToken = csrfForToken(token);
    const expiresAt = new Date(at + SESSION_MS).toISOString();
    next.devices[deviceId] = {
      name, tokenHash: digest(token), csrfHash: digest(csrfToken),
      scopes: ['sessions:read', 'commands:write', 'account:manage'],
      revoked: false, enrolledAt: new Date(at).toISOString(),
      authKind: 'password', authEpoch: next.account.authEpoch, expiresAt,
    };
    return { deviceId, token, csrfToken, expiresAt };
  }

  function rotatePasswordDevice(next, deviceId, at) {
    const device = next.devices[deviceId];
    const token = randomBytes(32).toString('base64url');
    const csrfToken = csrfForToken(token);
    const expiresAt = new Date(at + SESSION_MS).toISOString();
    device.tokenHash = digest(token);
    device.csrfHash = digest(csrfToken);
    device.authEpoch = next.account.authEpoch;
    device.expiresAt = expiresAt;
    device.lastSeenAt = new Date(at).toISOString();
    device.revoked = false;
    delete device.revokedAt;
    return { deviceId, token, csrfToken, expiresAt };
  }

  function publicAuth(ownerId, deviceId, device, csrfToken) {
    return { account: { ...publicProfile(accountState(ownerId).account), ownerId },
      device: { id: deviceId, name: device.name, expiresAt: device.expiresAt },
      csrfToken };
  }

  async function readJson(request, maxBytes = MAX_BODY) {
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
      throw failure('UNSUPPORTED_MEDIA_TYPE', 415);
    }
    let length = 0;
    const parts = [];
    for await (const part of request) {
      length += part.length;
      if (length > maxBytes) throw failure('BODY_TOO_LARGE', 413);
      parts.push(part);
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw failure('INVALID_REQUEST'); }
  }

  function deviceName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw failure('INVALID_REQUEST');
    return value.trim();
  }

  function assertLoginWindow(ownerId) {
    if (accountState(ownerId).authLimits.lockUntil > timestamp()) throw failure('LOGIN_RATE_LIMITED', 429);
  }

  async function recordFailedPassword(ownerId, at) {
    await mutate(ownerId, (next) => {
      const limits = next.authLimits;
      limits.failures = at - limits.lastFailureAt > 15 * 60 * 1000 ? 1 : limits.failures + 1;
      limits.lastFailureAt = at;
      limits.lockUntil = limits.failures >= 5
        ? at + Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(limits.failures - 5, 5)) : 0;
    });
  }

  async function setupAccount(body) {
    const ownerId = rootState.legacyOwnerId;
    exactKeys(body, ['grant', 'username', 'password', 'deviceName'],
      ['grant', 'username', 'password', 'deviceName']);
    const user = normalizeUsername(body.username);
    const name = deviceName(body.deviceName);
    if (!user || !validPassword(body.password) || typeof body.grant !== 'string' ||
        !/^[A-Za-z0-9_-]{40,128}$/.test(body.grant)) throw failure('INVALID_REQUEST');
    if (accountState(ownerId).account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
    if (Object.values(rootState.accounts).some((entry) =>
      entry.account?.usernameCanonical === user.canonical)) throw failure('ACCOUNT_ALREADY_EXISTS', 409);
    const grant = accountState(ownerId).setupGrant;
    if (!grant || grant.expiresAt <= timestamp() ||
        !timingSafeEqual(Buffer.from(digest(body.grant), 'hex'), Buffer.from(grant.hash, 'hex'))) {
      throw failure('INVALID_SETUP_GRANT', 401);
    }
    const password = await hashWork(() => hashPassword(body.password));
    const result = await serial(() => mutate(ownerId, (next) => {
      if (next.account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
      if (Object.values(rootState.accounts).some((entry) =>
        entry.account?.usernameCanonical === user.canonical)) throw failure('ACCOUNT_ALREADY_EXISTS', 409);
      if (!next.setupGrant || next.setupGrant.expiresAt <= timestamp() ||
          !timingSafeEqual(Buffer.from(digest(body.grant), 'hex'), Buffer.from(next.setupGrant.hash, 'hex'))) {
        throw failure('INVALID_SETUP_GRANT', 401);
      }
      const at = timestamp();
      next.account = { username: user.display, usernameCanonical: user.canonical,
        password, authEpoch: 1, displayName: user.display, avatar: null, profileRevision: 0 };
      next.setupGrant = null;
      next.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
      for (const device of Object.values(next.devices)) {
        device.revoked = true;
        device.revokedAt = new Date(at).toISOString();
      }
      return newPasswordDevice(next, name, at);
    }));
    return { ...publicAuth(ownerId, result.deviceId,
      accountState(ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function registerAccount(body) {
    exactKeys(body, ['username', 'password', 'deviceName', 'displayName'],
      ['username', 'password', 'deviceName']);
    const user = normalizeUsername(body.username);
    const name = deviceName(body.deviceName);
    if (!user || !validPassword(body.password)) throw failure('INVALID_REQUEST');
    const nickname = body.displayName === undefined ? user.display : displayName(body.displayName);
    if (Object.values(rootState.accounts).some((entry) => entry.account?.usernameCanonical === user.canonical)) {
      throw failure('ACCOUNT_ALREADY_EXISTS', 409);
    }
    if (registeredAccountCount() >= MAX_ACCOUNTS) throw failure('CAPACITY_LIMIT', 429);
    const password = await hashWork(() => hashPassword(body.password));
    const ownerId = `owner-${randomUUID()}`;
    const newSync = await createPersonalSyncStore({ root: syncRoot(ownerId), ownerId });
    let result;
    try {
      result = await serial(() => mutateRoot((nextRoot) => {
        if (Object.values(nextRoot.accounts).some((entry) => entry.account?.usernameCanonical === user.canonical)) {
          throw failure('ACCOUNT_ALREADY_EXISTS', 409);
        }
        if (Object.values(nextRoot.accounts).filter((entry) => entry.account !== null).length >= MAX_ACCOUNTS) {
          throw failure('CAPACITY_LIMIT', 429);
        }
        if (Object.hasOwn(nextRoot.accounts, ownerId)) throw failure('ACCOUNT_ALREADY_EXISTS', 409);
        const next = { version: SINGLE_ACCOUNT_VERSION, hostId: nextRoot.hostId, ownerId,
          account: { username: user.display, usernameCanonical: user.canonical,
            password, authEpoch: 1, displayName: nickname, avatar: null, profileRevision: 0 },
          setupGrant: null, authLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 },
          devices: {}, sessions: {}, commands: {} };
        const device = newPasswordDevice(next, name, timestamp());
        const { version: _version, hostId: _hostId, ownerId: _ownerId, ...account } = next;
        nextRoot.accounts[ownerId] = account;
        return device;
      }));
    } catch (error) {
      await newSync.close();
      throw error;
    }
    syncStores.set(ownerId, newSync);
    attachmentStores.set(ownerId, await createAttachmentStore({ root: path.join(syncRoot(ownerId), 'attachments') }));
    sharedAttachmentStores.set(ownerId, await createSharedAttachmentStore({ root: path.join(syncRoot(ownerId), 'shared-attachments') }));
    return { ...publicAuth(ownerId, result.deviceId,
      accountState(ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function updateAccountProfile(request, body) {
    exactKeys(body, ['expectedRevision', 'displayName', 'avatar'], ['expectedRevision']);
    if (!Object.hasOwn(body, 'displayName') && !Object.hasOwn(body, 'avatar')) throw failure('INVALID_REQUEST');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
        body.expectedRevision >= Number.MAX_SAFE_INTEGER - 1) throw failure('INVALID_REQUEST');
    const nickname = Object.hasOwn(body, 'displayName') ? displayName(body.displayName) : undefined;
    const avatar = Object.hasOwn(body, 'avatar') ? avatarImage(body.avatar) : undefined;
    const current = authenticate(request, 'account:manage');
    return serial(() => mutate(current.ownerId, (next) => {
      const latest = authenticate(request, 'account:manage');
      if (latest.ownerId !== current.ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
      if ((next.account.profileRevision ?? 0) !== body.expectedRevision) throw failure('REQUEST_CONFLICT', 409);
      next.account.displayName = nickname ?? next.account.displayName ?? next.account.username;
      next.account.avatar = avatar === undefined ? next.account.avatar ?? null : avatar;
      next.account.profileRevision = body.expectedRevision + 1;
      return publicProfile(next.account);
    }));
  }

  async function loginAccount(body) {
    exactKeys(body, ['username', 'password', 'deviceName'], ['username', 'password', 'deviceName']);
    const user = normalizeUsername(body.username);
    const name = deviceName(body.deviceName);
    if (typeof body.password !== 'string') throw failure('INVALID_REQUEST');
    const ownerId = Object.entries(rootState.accounts)
      .find(([, entry]) => entry.account?.usernameCanonical === user?.canonical)?.[0];
    if (!ownerId) {
      if (rootState.unknownAuthLimits.lockUntil > timestamp()) throw failure('LOGIN_RATE_LIMITED', 429);
      await hashWork(() => verifyPassword(body.password, undefined));
      await serial(() => mutateRoot((next) => {
        const at = timestamp();
        const limits = next.unknownAuthLimits;
        limits.failures = at - limits.lastFailureAt > 15 * 60 * 1000 ? 1 : limits.failures + 1;
        limits.lastFailureAt = at;
        limits.lockUntil = limits.failures >= 5
          ? at + Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(limits.failures - 5, 5)) : 0;
      }));
      throw failure('INVALID_CREDENTIALS', 401);
    }
    return loginAccountForOwner(ownerId, body, user, name);
  }

  async function loginAccountForOwner(ownerId, body, user, name) {
    assertLoginWindow(ownerId);
    const snapshot = accountState(ownerId).account;
    const checked = await hashWork(() => verifyPassword(body.password, snapshot?.password));
    const result = await serial(async () => {
      assertLoginWindow(ownerId);
      const latest = accountState(ownerId).account;
      if (latest?.authEpoch !== snapshot?.authEpoch ||
          latest?.password.hash !== snapshot?.password.hash) throw failure('INVALID_CREDENTIALS', 401);
      if (!snapshot || !user || user.canonical !== snapshot.usernameCanonical ||
          !validPassword(body.password) || !checked) {
        await recordFailedPassword(ownerId, timestamp());
        throw failure('INVALID_CREDENTIALS', 401);
      }
      return mutate(ownerId, (next) => {
        next.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
        return newPasswordDevice(next, name, timestamp());
      });
    });
    return { ...publicAuth(ownerId, result.deviceId,
      accountState(ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function changeAccountPassword(request, body) {
    exactKeys(body, ['currentPassword', 'newPassword'], ['currentPassword', 'newPassword']);
    if (typeof body.currentPassword !== 'string' || !validPassword(body.newPassword)) throw failure('INVALID_REQUEST');
    const initial = authenticate(request, 'account:manage');
    assertLoginWindow(initial.ownerId);
    const snapshot = accountState(initial.ownerId).account;
    const verified = await hashWork(() => verifyPassword(body.currentPassword, snapshot.password));
    if (!verified) {
      await serial(async () => {
        authenticate(request, 'account:manage');
        await recordFailedPassword(initial.ownerId, timestamp());
      });
      throw failure('INVALID_CREDENTIALS', 401);
    }
    const password = await hashWork(() => hashPassword(body.newPassword));
    const result = await serial(() => mutate(initial.ownerId, (next) => {
      const current = authenticate(request, 'account:manage');
      if (current.ownerId !== initial.ownerId || current.deviceId !== initial.deviceId ||
          next.account.authEpoch !== snapshot.authEpoch ||
          next.account.password.hash !== snapshot.password.hash) throw failure('UNAUTHORIZED', 401);
      const at = timestamp();
      for (const [deviceId, device] of Object.entries(next.devices)) {
        if (deviceId === current.deviceId) continue;
        device.revoked = true;
        device.revokedAt = new Date(at).toISOString();
      }
      for (const command of Object.values(next.commands)) {
        if (command.sourceDeviceId !== current.deviceId || command.state !== 'pending') continue;
        command.state = 'rejected';
        command.errorCode = 'SESSION_REPLACED';
        command.updatedAt = new Date(at).toISOString();
      }
      next.account.password = password;
      next.account.authEpoch++;
      next.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
      return rotatePasswordDevice(next, current.deviceId, at);
    }));
    return { ...publicAuth(initial.ownerId, result.deviceId,
      accountState(initial.ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function dispatch(ownerId, commandId) {
    try {
      if (closing || storageFault) return;
      let snapshot;
      let callback;
      const pending = accountState(ownerId).commands[commandId];
      if (!pending || pending.state !== 'pending') return;
      if (pending.toolSource) {
        let safePreset = false;
        try {
          const described = await callBackend(() => backend.describeSession(pending.toolSource.sessionId));
          safePreset = described?.sessionId === pending.toolSource.sessionId &&
            described.agentPreset === 'personal-remote';
        } catch { /* A tool task must not dispatch without live preset evidence. */ }
        if (!safePreset) {
          await serial(() => mutate(ownerId, (next) => {
            if (next.commands[commandId]?.state !== 'pending') return;
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'SESSION_READ_ONLY';
            next.commands[commandId].updatedAt = new Date().toISOString();
          }));
          return;
        }
      }
      if (pending.kind === 'desktop.open_app' && typeof backend.openDesktopApp !== 'function') {
        await serial(() => mutate(ownerId, (next) => {
          next.commands[commandId].state = 'rejected';
          next.commands[commandId].errorCode = 'CAPABILITY_UNAVAILABLE';
          next.commands[commandId].updatedAt = new Date().toISOString();
        }));
        return;
      }
      if (pending.kind === 'session.message' && !hostOwner(ownerId) &&
          !modelVisible(ownerId, accountState(ownerId).sessions[pending.sessionId]?.modelProfileId)) {
        await serial(() => mutate(ownerId, (next) => {
          if (next.commands[commandId]?.state !== 'pending') return;
          next.commands[commandId].state = 'rejected';
          next.commands[commandId].errorCode = 'MODEL_UNAVAILABLE';
          next.commands[commandId].updatedAt = new Date().toISOString();
        }));
        return;
      }
      if (accountState(ownerId).devices[pending.sourceDeviceId]?.revoked ||
          (pending.sourceAuthEpoch !== undefined &&
            accountState(ownerId).devices[pending.sourceDeviceId]?.authEpoch !== pending.sourceAuthEpoch) ||
          (accountState(ownerId).devices[pending.sourceDeviceId]?.authKind === 'password' &&
            Date.parse(accountState(ownerId).devices[pending.sourceDeviceId].expiresAt) <= timestamp())) {
        await serial(() => mutate(ownerId, (next) => {
          if (next.commands[commandId]?.state !== 'pending') return;
          next.commands[commandId].state = 'rejected';
          next.commands[commandId].errorCode = next.devices[pending.sourceDeviceId]?.revoked
            ? 'DEVICE_REVOKED' : pending.sourceAuthEpoch !== undefined &&
              next.devices[pending.sourceDeviceId]?.authEpoch !== pending.sourceAuthEpoch
              ? 'SESSION_REPLACED' : 'SESSION_EXPIRED';
          next.commands[commandId].updatedAt = new Date().toISOString();
        }));
        return;
      }
      try {
        await callBackend(() => backend.preflight({ ...pending.payload, ownerId }));
      } catch (error) {
        if (closing) return;
        await serial(async () => {
          if (accountState(ownerId).commands[commandId]?.state !== 'pending') return;
          await mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = safeCode(error);
            next.commands[commandId].updatedAt = new Date().toISOString();
          });
        });
        return;
      }
      if (closing || storageFault) return;
      await serial(async () => {
        if (storageFault) throw failure('STORAGE_UNAVAILABLE', 503);
        const command = accountState(ownerId).commands[commandId];
        if (!command || command.state !== 'pending') return;
        if (command.toolSource) {
          const source = accountState(ownerId).commands[command.toolSource.sourceCommandId];
          const root = accountState(ownerId).commands[source?.rootTaskId ?? source?.commandId];
          if (!source || root?.taskControl?.state === 'stop_requested' || source.state !== 'accepted_by_dsh' ||
              source.dshTurn !== command.toolSource.turn ||
              accountState(ownerId).sessions[command.toolSource.sessionId]?.origin !== 'personal-remote') {
            await mutate(ownerId, (next) => {
              next.commands[commandId].state = 'rejected';
              next.commands[commandId].errorCode = 'TOOL_SOURCE_UNAVAILABLE';
              next.commands[commandId].updatedAt = new Date().toISOString();
            });
            return;
          }
        }
        if (command.rootTaskId && (accountState(ownerId).commands[command.rootTaskId]?.taskControl?.state === 'stop_requested' ||
            taskHasUnknownEffects(accountState(ownerId), command.rootTaskId))) {
          await mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'TASK_NOT_READY';
            next.commands[commandId].updatedAt = new Date().toISOString();
          });
          return;
        }
        if (accountState(ownerId).devices[command.sourceDeviceId]?.revoked ||
            (command.sourceAuthEpoch !== undefined &&
              accountState(ownerId).devices[command.sourceDeviceId]?.authEpoch !== command.sourceAuthEpoch) ||
            (accountState(ownerId).devices[command.sourceDeviceId]?.authKind === 'password' &&
              Date.parse(accountState(ownerId).devices[command.sourceDeviceId].expiresAt) <= timestamp())) {
          await mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = next.devices[command.sourceDeviceId]?.revoked
              ? 'DEVICE_REVOKED' : command.sourceAuthEpoch !== undefined &&
                next.devices[command.sourceDeviceId]?.authEpoch !== command.sourceAuthEpoch
                ? 'SESSION_REPLACED' : 'SESSION_EXPIRED';
            next.commands[commandId].updatedAt = new Date().toISOString();
          });
          return;
        }
        await mutate(ownerId, (next) => {
          next.commands[commandId].state = 'dispatching';
          next.commands[commandId].updatedAt = new Date().toISOString();
        });
        requireOpen();
        snapshot = structuredClone(accountState(ownerId).commands[commandId]);
        // The backend invocation starts before the serial boundary is released.
        // A concurrent revoke linearizes either before this point or afterward.
        try {
          if (snapshot.kind === 'session.create') callback = Promise.resolve(backend.createSession({
            sessionId: snapshot.sessionId, modelProfileId: snapshot.payload.modelProfileId, ownerId,
          }));
          else if (snapshot.kind === 'session.message') {
            const staged = snapshot.payload.attachments
              ? await sharedAttachmentStores.get(ownerId).resolve({ sessionId: snapshot.sessionId,
                requestId: snapshot.requestId, attachments: snapshot.payload.attachments }) : [];
            callback = Promise.resolve(backend.sendMessage({
              sessionId: snapshot.sessionId, text: snapshot.payload.text, mode: snapshot.payload.mode, ownerId,
              attachments: staged.map((item) => ({ name: item.name, contentType: item.contentType,
                data: item.bytes.toString('base64') })),
            }));
          }
          else if (snapshot.kind === 'session.cancel') callback = Promise.resolve(backend.cancelSession({ sessionId: snapshot.sessionId, ownerId }));
          else callback = Promise.resolve(backend.openDesktopApp({ appId: snapshot.appId, commandId, ownerId }));
        } catch (error) {
          callback = Promise.reject(error);
        }
      });
      if (!snapshot) return;
      let result;
      try { result = await withDeadline(() => callback, DISPATCH_TIMEOUT_MS); }
      catch (error) {
        if (closing) return;
        await serial(() => mutate(ownerId, (next) => {
          if (next.commands[commandId].state === 'dispatching') {
            next.commands[commandId].state = 'uncertain';
            next.commands[commandId].errorCode = error?.code === 'BACKEND_TIMEOUT' ? 'RECEIPT_TIMEOUT' : safeCode(error);
            next.commands[commandId].updatedAt = new Date().toISOString();
          }
        }));
        return;
      }
      if (closing) return;
      await serial(() => mutate(ownerId, (next) => {
        const command = next.commands[commandId];
        if (command.state !== 'dispatching') return;
        const accepted = snapshot.kind === 'session.create'
          ? result?.sessionId === snapshot.sessionId
          : result?.accepted === true;
        if (!accepted) {
          command.state = result?.rejected === true && result?.errorCode === 'IMAGE_REJECTED'
            ? 'rejected' : 'uncertain';
          command.errorCode = command.state === 'rejected' ? 'IMAGE_REJECTED' : 'RECEIPT_UNKNOWN';
          if (command.state === 'rejected' && IMAGE_REASONS.has(result?.imageReasonCode))
            command.imageReasonCode = result.imageReasonCode;
        } else {
          command.state = snapshot.kind === 'desktop.open_app'
            ? result?.observed === true ? 'observed' : 'accepted_by_host'
            : 'accepted_by_dsh';
          if (snapshot.kind === 'session.create') {
            next.sessions[snapshot.sessionId] = { ownerId: next.ownerId, attachedAt: new Date().toISOString(),
              origin: next.devices[snapshot.sourceDeviceId]?.authKind !== 'password'
                ? 'legacy-local' : hostOwner(ownerId) ? 'personal-remote' : 'shared-chat',
              modelProfileId: snapshot.payload.modelProfileId };
          }
          if (snapshot.kind === 'desktop.open_app') command.verification = result?.observed === true
            ? { status: 'observed', method: 'visible_window', observedAt: new Date().toISOString(),
              outcome: result?.outcome === 'already_open' ? 'already_open' : 'opened' }
            : { status: 'unconfirmed', method: 'visible_window' };
          if (typeof result.receiptId === 'string' && ID.test(result.receiptId)) command.receiptId = result.receiptId;
          if (snapshot.kind === 'session.message' && command.receiptId) {
            const taskId = command.rootTaskId ?? command.commandId;
            const stop = next.commands[taskId]?.taskControl?.state === 'stop_requested'
              ? next.commands[taskId].taskControl.stopRequests.at(-1) : null;
            const target = stop?.targets?.find((item) => item.commandId === commandId);
            if (target && !target.receiptId) target.receiptId = command.receiptId;
          }
          // The source of truth for events is DSH history. A callback receipt
          // alone does not prove that a turn completed.
          if (snapshot.kind !== 'session.message') delete command.payload.text;
        }
        command.updatedAt = new Date().toISOString();
      }));
      if (snapshot.kind === 'session.message' && snapshot.payload.attachments &&
          accountState(ownerId).commands[commandId]?.state === 'accepted_by_dsh') {
        await sharedAttachmentStores.get(ownerId).release({ sessionId: snapshot.sessionId,
          requestId: snapshot.requestId, attachments: snapshot.payload.attachments });
      }
      if (snapshot.kind === 'session.message') {
        const taskId = snapshot.rootTaskId ?? snapshot.commandId;
        if (accountState(ownerId).commands[taskId]?.taskControl?.state === 'stop_requested') {
          await driveTaskStop(ownerId, taskId, true);
        }
      }
    } catch {
      // A failed store write leaves dispatching on disk. Recovery marks it
      // uncertain. Do not issue another backend call or claim success.
    }
  }

  function schedule(ownerId, commandId) {
    const key = `${ownerId}|${commandId}`;
    if (scheduled.has(key) || closing) return;
    scheduled.add(key);
    const work = Promise.resolve().then(() => dispatch(ownerId, commandId)).finally(() => {
      scheduled.delete(key);
      active.delete(work);
      activeByCommand.delete(key);
    });
    active.add(work);
    activeByCommand.set(key, work);
  }

  function handle(request, response) {
    const largeUpload = request.method === 'PUT' &&
      /^\/personal\/v1\/sync\/attachments\/[^/?]+(?:\?.*)?$/.test(request.url ?? '');
    if (!largeUpload && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      // Small control bodies retain the previous ten-second total receive deadline.
      const timer = setTimeout(() => { request.destroy(); response.destroy(); }, 10_000);
      request.once('end', () => clearTimeout(timer));
      request.once('close', () => clearTimeout(timer));
    }
    const ownerId = ownerForRequest(request);
    return handleScoped(request, response, ownerId);
  }

  async function handleScoped(request, response, ownerId) {
    const state = ownerId === null ? null : accountState(ownerId);
    try {
      if (closing) throw failure('SERVICE_CLOSING', 503);
      const url = new URL(request.url, 'http://127.0.0.1');
      const encodedDshImageId = /^\/personal\/v1\/sessions\/[A-Za-z0-9_-]{1,128}\/attachments\/sha256%3A[a-f0-9]{64}$/i.test(url.pathname);
      if ((url.pathname.includes('%') && !encodedDshImageId) || url.pathname.includes('//') || url.searchParams.has('token')) {
        throw failure('INVALID_REQUEST');
      }
      const pathname = url.pathname;
      if (!pathname.startsWith('/personal/v1/')) throw failure('NOT_FOUND', 404);
      if (!requestAuthority(request) ||
          (request.headers.origin !== undefined && !matchingOrigin(request))) {
        throw failure('ORIGIN_NOT_ALLOWED', 403);
      }
      const staticPaths = new Set(['/personal/v1/ui', '/personal/v1/ui/', '/personal/v1/ui/index.html',
        '/personal/v1/ui/app.js', '/personal/v1/ui/styles.css', '/personal/v1/ui/favicon.svg']);
      if (request.method === 'GET' && !url.search && staticPaths.has(pathname)) {
        if (uiHandler && await uiHandler(request, response) === true) return;
        throw failure('NOT_FOUND', 404);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/auth/state') {
        if (url.search) throw failure('INVALID_REQUEST');
        return json(response, 200, { configured: registeredAccountCount() > 0,
          registrationAvailable: registeredAccountCount() < MAX_ACCOUNTS });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/setup') {
        if (url.search) throw failure('INVALID_REQUEST');
        const matched = requireBrowserOrigin(request, true);
        const setupBody = await readJson(request);
        const result = await setupAccount(setupBody);
        const { token, ...publicResult } = result;
        return json(response, 201, publicResult, { 'set-cookie': sessionCookie(token, matched.startsWith('https://')) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/register') {
        if (url.search) throw failure('INVALID_REQUEST');
        const matched = requireBrowserOrigin(request);
        const result = await registerAccount(await readJson(request));
        const { token, ...publicResult } = result;
        return json(response, 201, publicResult, { 'set-cookie': sessionCookie(token, matched.startsWith('https://')) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/login') {
        if (url.search) throw failure('INVALID_REQUEST');
        const matched = requireBrowserOrigin(request);
        const result = await loginAccount(await readJson(request));
        const { token, ...publicResult } = result;
        return json(response, 200, publicResult, { 'set-cookie': sessionCookie(token, matched.startsWith('https://')) });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/auth/me') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = authenticate(request, 'account:manage');
        return json(response, 200, publicAuth(current.ownerId, current.deviceId,
          current.device, current.csrfToken));
      }
      if (request.method === 'PATCH' && pathname === '/personal/v1/auth/profile') {
        if (url.search) throw failure('INVALID_REQUEST');
        authenticate(request, 'account:manage');
        return json(response, 200, { account: await updateAccountProfile(request, await readJson(request, 192 * 1024)) });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/auth/devices') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = authenticate(request, 'account:manage');
        const devices = Object.entries(state.devices).map(([deviceId, device]) => ({
          id: deviceId, name: device.name, createdAt: device.enrolledAt,
          ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt } : {}),
          expiresAt: device.expiresAt ?? null, revoked: device.revoked,
          current: deviceId === current.deviceId,
        }));
        return json(response, 200, { devices });
      }
      const deviceMatch = /^\/personal\/v1\/auth\/devices\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (request.method === 'PATCH' && deviceMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = authenticate(request, 'account:manage');
        const target = id(deviceMatch[1]);
        const body = await readJson(request);
        exactKeys(body, ['name'], ['name']);
        const name = deviceName(body.name);
        const renamed = await serial(() => mutate(current.ownerId, (next) => {
          const latest = authenticate(request, 'account:manage');
          if (latest.ownerId !== current.ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
          if (!Object.hasOwn(next.devices, target)) throw failure('NOT_FOUND', 404);
          next.devices[target].name = name;
          return { id: target, name, revoked: next.devices[target].revoked };
        }));
        return json(response, 200, { device: renamed });
      }
      if (request.method === 'DELETE' && deviceMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = authenticate(request, 'account:manage');
        const target = id(deviceMatch[1]);
        const matched = matchingOrigin(request);
        await serial(() => mutate(current.ownerId, (next) => {
          const latest = authenticate(request, 'account:manage');
          if (latest.ownerId !== current.ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
          if (!Object.hasOwn(next.devices, target)) throw failure('NOT_FOUND', 404);
          next.devices[target].revoked = true;
          next.devices[target].revokedAt = new Date(timestamp()).toISOString();
        }));
        return json(response, 200, { revoked: true },
          target === current.deviceId ? { 'set-cookie': clearCookie(matched.startsWith('https://')) } : {});
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/logout') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = authenticate(request, 'account:manage');
        const matched = matchingOrigin(request);
        await serial(() => mutate(current.ownerId, (next) => {
          if (authenticate(request, 'account:manage').ownerId !== current.ownerId) throw failure('UNAUTHORIZED', 401);
          next.devices[current.deviceId].revoked = true;
          next.devices[current.deviceId].revokedAt = new Date(timestamp()).toISOString();
        }));
        return json(response, 200, { ok: true }, { 'set-cookie': clearCookie(matched.startsWith('https://')) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/change-password') {
        if (url.search) throw failure('INVALID_REQUEST');
        authenticate(request, 'account:manage');
        const matched = matchingOrigin(request);
        const result = await changeAccountPassword(request, await readJson(request));
        const { token, ...publicResult } = result;
        return json(response, 200, publicResult, { 'set-cookie': sessionCookie(token, matched.startsWith('https://')) });
      }
      const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
      const { deviceId, ownerId: authenticatedOwnerId } = authenticate(request,
        write ? 'commands:write' : 'sessions:read');
      if (authenticatedOwnerId !== ownerId) throw failure('UNAUTHORIZED', 401);
      if (pathname.startsWith('/personal/v1/memory/')) {
        const mutation = ['POST', 'PATCH', 'DELETE'].includes(request.method);
        const current = authenticate(request, mutation ? 'account:manage' : 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        if (memoryManager === null) {
          if (request.method === 'GET' && !url.search && pathname === '/personal/v1/memory/status') {
            return json(response, 200, { state: 'disabled', worldRevision: null,
              ownerId,
              capabilities: { list: false, source: false, correct: false, mute: false,
                inject: false, deleteEvidence: false, deleteWorldItem: false } });
          }
          throw failure('MEMORY_DISABLED', 503);
        }
        const result = await handlePersonalMemoryHttp({ manager: memoryManager,
          ownerId, request, pathname, url, readJson });
        return json(response, result.status, { ownerId, ...result.body });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/app/manifest') {
        if (url.search || !mobileUi) throw failure('NOT_FOUND', 404);
        const manifest = await mobileUi.current();
        if (!manifest) throw failure('NOT_FOUND', 404);
        return json(response, 200, manifest);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/app/updates') {
        if (url.search || !mobileUi) throw failure('NOT_FOUND', 404);
        await mobileUi.updates(response, () => authenticate(request, 'sessions:read'));
        return;
      }
      const mobileAsset = /^\/personal\/v1\/app\/assets\/([a-f0-9]{64})\/(.+)$/.exec(pathname);
      if (request.method === 'GET' && mobileAsset) {
        if (url.search || !mobileUi) throw failure('NOT_FOUND', 404);
        const asset = await mobileUi.asset(mobileAsset[1], mobileAsset[2]).catch(() => null);
        if (!asset) throw failure('NOT_FOUND', 404);
        if (request.headers['if-none-match'] === asset.etag) {
          response.writeHead(304, { etag: asset.etag,
            'cache-control': 'private, max-age=31536000, immutable' });
          return response.end();
        }
        response.writeHead(200, { 'content-type': asset.contentType,
          'content-length': String(asset.bytes.length), etag: asset.etag,
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff' });
        return response.end(asset.bytes);
      }
      if (pathname === '/personal/v1/downloads/android' && request.method === 'GET') {
        if (url.search || !androidPackagePath) throw failure('NOT_FOUND', 404);
        const entry = await androidPackageEntry();
        if (!entry) throw failure('NOT_FOUND', 404);
        const handle = await open(androidPackagePath, 'r').catch(() => { throw failure('NOT_FOUND', 404); });
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.size !== entry.size) throw failure('NOT_FOUND', 404);
          response.writeHead(200, { 'content-type': 'application/vnd.android.package-archive',
            'content-disposition': 'attachment; filename="WeftMate-Android.apk"',
            'content-length': String(opened.size), 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff' });
          await new Promise((resolve, reject) => {
            const stream = handle.createReadStream({ autoClose: false });
            const stopped = () => { stream.destroy(); reject(failure('SERVICE_UNAVAILABLE', 503)); };
            response.once('close', stopped);
            stream.once('error', (error) => { response.off('close', stopped); reject(error); });
            stream.once('end', () => { response.off('close', stopped); resolve(); });
            stream.pipe(response);
          });
          return;
        } finally { await handle.close(); }
      }
      const sharedImageMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]{1,128})\/attachments\/((?:attachment-[0-9a-f-]{36})|(?:sha256:[a-f0-9]{64}))$/i.exec(pathname.replace(/%3a/ig, ':'));
      if (sharedImageMatch) {
        const [, sessionId, attachmentId] = sharedImageMatch;
        const ownedSession = () => {
          const session = accountState(ownerId).sessions[sessionId];
          if (!session || session.ownerId !== ownerId ||
              !['personal-remote', 'shared-chat'].includes(session.origin)) throw failure('SESSION_UNAVAILABLE', 404);
        };
        ownedSession();
        if (request.method === 'PUT') {
          if ([...url.searchParams.keys()].some((key) => !['requestId', 'name'].includes(key)) ||
              ['requestId', 'name'].some((key) => url.searchParams.getAll(key).length !== 1)) throw failure('INVALID_REQUEST');
          const lengthHeader = request.headers['content-length'];
          if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) ||
              Number(lengthHeader) > MAX_SHARED_IMAGE_BYTES)) throw failure('BODY_TOO_LARGE', 413);
          const chunks = []; let total = 0;
          for await (const chunk of request) {
            total += chunk.length;
            if (total > MAX_SHARED_IMAGE_BYTES) throw failure('BODY_TOO_LARGE', 413);
            chunks.push(chunk);
          }
          const authorize = () => {
            const current = authenticate(request, 'commands:write');
            if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
            ownedSession();
          };
          const result = await sharedAttachmentStores.get(ownerId).put({ sessionId, attachmentId,
            requestId: url.searchParams.get('requestId'), name: url.searchParams.get('name'),
            contentType: request.headers['content-type'], sha256: request.headers['x-weftmate-sha256'],
            bytes: Buffer.concat(chunks), authorize });
          return json(response, result.duplicate ? 200 : 201, result);
        }
        if (request.method === 'GET') {
          if (url.search || typeof backend.readAttachment !== 'function') throw failure('INVALID_REQUEST');
          const found = await callBackend(() => backend.readAttachment({ sessionId, attachmentId, ownerId }));
          const current = authenticate(request, 'sessions:read');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          ownedSession();
          if (!Buffer.isBuffer(found?.bytes) || found.bytes.length < 1 ||
              found.bytes.length > MAX_SHARED_IMAGE_BYTES ||
              !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(found?.contentType)) {
            throw failure('BACKEND_UNAVAILABLE', 503);
          }
          response.writeHead(200, { 'content-type': found.contentType,
            'content-length': String(found.bytes.length), 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff' });
          return response.end(found.bytes);
        }
      }
      const attachmentMatch = /^\/personal\/v1\/sync\/attachments\/((?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.exec(pathname);
      if (attachmentMatch && request.method === 'PUT') {
        const display = url.searchParams.get('variant') === 'display';
        const nameCount = url.searchParams.getAll('name').length;
        if ([...url.searchParams.keys()].some((key) => !['conversationId', 'messageId', 'name', 'variant'].includes(key)) ||
            ['conversationId', 'messageId'].some((key) => url.searchParams.getAll(key).length !== 1) ||
            (display ? nameCount > 1 : nameCount !== 1) ||
            url.searchParams.getAll('variant').length > 1 ||
            (url.searchParams.has('variant') && !display)) {
          throw failure('INVALID_REQUEST');
        }
        const lengthHeader = request.headers['content-length'];
        if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) ||
            Number(lengthHeader) > (display ? MAX_DISPLAY_BYTES : MAX_ATTACHMENT_BYTES))) {
          throw failure('BODY_TOO_LARGE', 413);
        }
        const authorize = () => {
          const latest = authenticate(request, 'commands:write');
          if (latest.ownerId !== ownerId || latest.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        };
        const result = await attachmentStores.get(ownerId).put({ attachmentId: attachmentMatch[1],
          conversationId: url.searchParams.get('conversationId'),
          messageId: url.searchParams.get('messageId'), name: url.searchParams.get('name'),
          contentType: request.headers['content-type'], sha256: request.headers['x-weftmate-sha256'],
          stream: request, expectedSize: lengthHeader === undefined ? undefined : Number(lengthHeader),
          display, authorize });
        return json(response, result.duplicate ? 200 : 201, result);
      }
      if (attachmentMatch && request.method === 'GET') {
        const display = url.search === '?variant=display';
        if (url.search && !display) throw failure('INVALID_REQUEST');
        const stored = await attachmentStores.get(ownerId).get(attachmentMatch[1], display);
        if (!syncStores.get(ownerId).references(attachmentMatch[1], stored.conversationId, stored.messageId)) {
          throw failure('NOT_FOUND', 404);
        }
        authenticate(request, 'sessions:read');
        response.writeHead(200, { 'content-type': stored.meta.contentType,
          'content-length': String(stored.meta.size), 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff' });
        await pipeline(createReadStream(stored.file, { start: stored.offset }), response);
        return;
      }
      if (pathname === '/personal/v1/sync/events' && request.method === 'POST') {
        if (url.search) throw failure('INVALID_REQUEST');
        const body = await readJson(request, 256 * 1024);
        exactKeys(body, ['events'], ['events']);
        const accepted = await serial(async () => {
          const authorize = () => {
            const latest = authenticate(request, 'commands:write');
            if (latest.ownerId !== ownerId || latest.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          };
          authorize();
          return syncStores.get(ownerId).append({ events: body.events, sourceDeviceId: deviceId, authorize,
            validateAttachment: (reference) => attachmentStores.get(ownerId).referenced(reference) });
        });
        return json(response, 200, accepted);
      }
      if (pathname === '/personal/v1/sync/events' && request.method === 'GET') {
        if ([...url.searchParams.keys()].some((key) => !['afterSeq', 'limit'].includes(key)) ||
            url.searchParams.getAll('afterSeq').length > 1 || url.searchParams.getAll('limit').length > 1) {
          throw failure('INVALID_REQUEST');
        }
        const afterText = url.searchParams.get('afterSeq') ?? '0';
        const limitText = url.searchParams.get('limit') ?? '100';
        if (!/^\d+$/.test(afterText) || !/^\d+$/.test(limitText)) throw failure('INVALID_REQUEST');
        return json(response, 200, syncStores.get(ownerId).page({ afterSeq: Number(afterText), limit: Number(limitText) }));
      }
      if (request.method === 'GET' && pathname === '/personal/v1/status') {
        if (url.search) throw failure('INVALID_REQUEST');
        const backendStatus = statusProjection(await callBackend(() => backend.getStatus({ ownerId })));
        backendStatus.modules.memory = memoryManager?.peek(ownerId) ?? 'disabled';
        if (!hostOwner(ownerId)) {
          const models = modelProjection(await callBackend(() => backend.listModels({ ownerId })))
            .filter((item) => modelVisible(ownerId, item.id));
          if (!models.some((item) => item.configured)) {
            backendStatus.capabilities.chat = { available: false, reasonCode: 'MODEL_UNAVAILABLE' };
          }
          backendStatus.capabilities.desktopOpenApp = {
            available: false, reasonCode: 'CAPABILITY_UNAVAILABLE', appIds: [],
          };
          backendStatus.capabilities.naturalLanguageDesktop = {
            available: false, reasonCode: 'CAPABILITY_UNAVAILABLE',
          };
        }
        return json(response, 200, {
          ...service.status(ownerId),
          sync: { available: true }, downloads: { android: (await androidPackageEntry()) !== null },
          backend: backendStatus,
        });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/models') {
        if (url.search) throw failure('INVALID_REQUEST');
        return json(response, 200, { models: modelProjection(await callBackend(() => backend.listModels({ ownerId })))
          .filter((item) => modelVisible(ownerId, item.id)) });
      }
      const modelMatch = /^\/personal\/v1\/models\/([A-Za-z0-9._-]+)\/(verify|chat\/completions)$/.exec(pathname);
      if (request.method === 'POST' && modelMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const profileId = modelProfileId(modelMatch[1]);
        if (!modelVisible(ownerId, profileId)) throw failure('MODEL_UNAVAILABLE', 422);
        if (modelMatch[2] === 'verify') {
          if (typeof backend.verifyModelProfile !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
          exactKeys(await readJson(request), [], []);
          authenticate(request, 'commands:write');
          let value;
          try { value = await callBackend(() => backend.verifyModelProfile(profileId, ownerId)); }
          catch (error) { throw error?.code === 'MODEL_UNAVAILABLE'
            ? failure('MODEL_UNAVAILABLE', 422) : error; }
          if (!plainObject(value)) throw failure('BACKEND_UNAVAILABLE', 503);
          return json(response, 200, { configured: value.configured === true,
            reachable: value.reachable === true, modelListed: value.modelListed === true,
            inferenceVerified: false });
        }
        if (typeof backend.modelCompletion !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
        const body = canonicalCompletion(await readJson(request, 256 * 1024));
        const current = authenticate(request, 'commands:write');
        if (current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
        const authWatch = setInterval(() => {
          try { authenticate(request, 'commands:write'); }
          catch { controller.abort(); }
        }, 1000);
        response.once('close', disconnected);
        try {
          let upstream;
          try { upstream = await backend.modelCompletion({ profileId, body, signal: controller.signal, ownerId }); }
          catch (error) { throw error?.code === 'MODEL_UNAVAILABLE'
            ? failure('MODEL_UNAVAILABLE', 422) : error; }
          if (controller.signal.aborted || !upstream?.ok || !upstream.body) throw failure('BACKEND_UNAVAILABLE', 503);
          if (!body.stream) {
            const raw = await boundedUpstreamBody(upstream, MODEL_JSON_MAX);
            let value;
            try { value = JSON.parse(raw); } catch { throw failure('BACKEND_UNAVAILABLE', 503); }
            let projected;
            try { projected = projectCompletion(value); }
            catch { throw failure('BACKEND_UNAVAILABLE', 503); }
            return json(response, 200, projected);
          }
          if (!/^text\/event-stream(?:\s*;|$)/i.test(upstream.headers?.get?.('content-type') ?? '')) {
            throw failure('BACKEND_UNAVAILABLE', 503);
          }
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
          let bytes = 0;
          let tail = '';
          for await (const part of upstream.body) {
            if (controller.signal.aborted) throw failure('SERVICE_UNAVAILABLE', 503);
            bytes += part.byteLength;
            if (bytes > MODEL_SSE_MAX) throw failure('BACKEND_UNAVAILABLE', 503);
            tail = (tail + Buffer.from(part).toString('utf8')).slice(-256);
            await writeStreamPart(response, part);
          }
          if (!tail.includes('data: [DONE]')) throw failure('BACKEND_UNAVAILABLE', 503);
          response.end();
          return;
        } finally {
          clearTimeout(timer);
          clearInterval(authWatch);
          response.off('close', disconnected);
          controller.abort();
        }
      }
      if (request.method === 'GET' && pathname === '/personal/v1/sessions') {
        if (url.search) throw failure('INVALID_REQUEST');
        const sessions = [];
        for (const sessionId of Object.keys(state.sessions).sort()) {
          try {
            const described = await callBackend(() => backend.describeSession(sessionId, ownerId));
            if (described?.sessionId === sessionId) sessions.push({
              sessionId,
              title: bounded(described.title, 256) ?? '',
              running: described.running === true,
              sendAvailable: (state.sessions[sessionId].origin === 'personal-remote' &&
                described.agentPreset === 'personal-remote') ||
                (state.sessions[sessionId].origin === 'shared-chat' &&
                described.agentPreset === 'personal-shared-chat' &&
                modelVisible(ownerId, state.sessions[sessionId].modelProfileId)),
            });
          } catch { sessions.push({ sessionId, title: '', running: false, sendAvailable: false, unavailable: true }); }
        }
        return json(response, 200, { sessions });
      }
      const eventMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/events$/.exec(pathname);
      if (request.method === 'GET' && eventMatch) {
        const sessionId = id(eventMatch[1]);
        if (!Object.hasOwn(state.sessions, sessionId)) throw failure('SESSION_UNAVAILABLE', 404);
        if ([...url.searchParams.keys()].some((key) => !['afterSeq', 'limit'].includes(key)) ||
            url.searchParams.getAll('afterSeq').length > 1 || url.searchParams.getAll('limit').length > 1) {
          throw failure('INVALID_REQUEST');
        }
        const afterText = url.searchParams.get('afterSeq') ?? '-1';
        const limitText = url.searchParams.get('limit') ?? '100';
        if (!/^-?\d+$/.test(afterText) || !/^\d+$/.test(limitText)) throw failure('INVALID_REQUEST');
        const afterSeq = Number(afterText), limit = Number(limitText);
        if (!Number.isSafeInteger(afterSeq) || afterSeq < -1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) {
          throw failure('INVALID_REQUEST');
        }
        let page;
        try { page = await callBackend(() => backend.readEvents({ sessionId, afterSeq, limit, ownerId })); }
        catch (error) {
          if (error?.code === 'HISTORY_WINDOW_LIMIT') throw failure('HISTORY_WINDOW_LIMIT', 422);
          throw error;
        }
        if (!plainObject(page) || !Array.isArray(page.events) || page.events.length > limit ||
            typeof page.hasMore !== 'boolean' || !Number.isSafeInteger(page.nextSeq)) {
          throw failure('BACKEND_UNAVAILABLE', 503);
        }
        let last = afterSeq;
        for (const event of page.events) {
          if (!plainObject(event) || !Number.isSafeInteger(event.seq) || event.seq <= last ||
              typeof event.type !== 'string' || event.type.length > 128) throw failure('BACKEND_UNAVAILABLE', 503);
          last = event.seq;
        }
        if (page.nextSeq < last || page.nextSeq < afterSeq ||
            (page.hasMore && page.nextSeq === afterSeq)) throw failure('BACKEND_UNAVAILABLE', 503);
        for (const event of page.events) {
          if (!Object.hasOwn(event, 'data') || event.seq > page.nextSeq ||
              (event.at !== undefined && (typeof event.at !== 'string' || event.at.length > 64)) ||
              !(event.data === null || plainObject(event.data) || Array.isArray(event.data))) {
            throw failure('BACKEND_UNAVAILABLE', 503);
          }
        }
        const projection = {
          events: page.events.map((event) => ({
            seq: event.seq, type: event.type,
            ...(typeof event.at === 'string' ? { at: event.at.slice(0, 64) } : {}),
            data: event.data,
          })),
          nextSeq: page.nextSeq, hasMore: page.hasMore,
        };
        if (Buffer.byteLength(JSON.stringify(projection), 'utf8') > 1024 * 1024) {
          throw failure('BACKEND_UNAVAILABLE', 503);
        }
        return json(response, 200, projection);
      }
      const taskMatch = /^\/personal\/v1\/tasks\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (request.method === 'GET' && taskMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const taskId = id(taskMatch[1]);
        taskSource(state, taskId);
        await driveTaskStop(ownerId, taskId);
        return json(response, 200, await taskDetail(accountState(ownerId), taskId));
      }
      const taskActionMatch = /^\/personal\/v1\/tasks\/([A-Za-z0-9_-]+)\/(supplements|stop|resume)$/.exec(pathname);
      if (request.method === 'POST' && taskActionMatch?.[2] === 'stop') {
        if (url.search) throw failure('INVALID_REQUEST');
        const taskId = id(taskActionMatch[1]);
        const body = await readJson(request);
        exactKeys(body, ['requestId'], ['requestId']);
        if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) throw failure('INVALID_REQUEST');
        await serial(() => mutate(ownerId, (next) => {
          const current = authenticate(request, 'commands:write');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          const source = taskSource(next, taskId);
          const usedByCommand = Object.values(next.commands).some((item) => item.requestId === body.requestId);
          const priorTask = Object.values(next.commands).find((item) =>
            item.taskControl?.stopRequests.some((entry) => entry.requestId === body.requestId));
          if (usedByCommand || (priorTask && priorTask.commandId !== taskId)) throw failure('REQUEST_CONFLICT', 409);
          if (priorTask) return;
          const now = new Date(timestamp()).toISOString();
          const control = source.taskControl ?? { state: 'active', stopRequests: [], updatedAt: now };
          if (control.state === 'stop_requested' || control.stopRequests.length >= 100) {
            throw failure('TASK_NOT_READY', 409);
          }
          control.state = 'stop_requested';
          control.stopRequests.push({ requestId: body.requestId, at: now,
            targets: stopTargets(next, taskId) });
          control.updatedAt = now;
          source.taskControl = control;
          for (const item of [source, ...taskChildren(next, taskId)]) {
            if (item.state === 'pending') {
              item.state = 'rejected'; item.errorCode = 'TASK_NOT_READY'; item.updatedAt = now;
            }
          }
        }));
        await driveTaskStop(ownerId, taskId, true);
        return json(response, 202, { task: await taskDetail(accountState(ownerId), taskId) });
      }
      const artifactMatch = /^\/personal\/v1\/artifacts\/([A-Za-z0-9_-]+)(?:\/(preview|download))?$/.exec(pathname);
      if (request.method === 'GET' && artifactMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const artifactId = id(artifactMatch[1]);
        const command = Object.values(state.commands).find((item) =>
          item.kind === INTERNAL_ARTIFACT_KIND && item.artifactId === artifactId);
        if (!command || command.state !== 'observed' ||
            command.verification?.status !== 'observed' ||
            state.sessions[command.sessionId]?.origin !== 'personal-remote' ||
            state.commands[command.taskId]?.kind !== 'session.message') throw failure('NOT_FOUND', 404);
        let bytes;
        try { bytes = await artifactStore.inspect(ownerId, command.taskId, artifactId, command); }
        catch { throw failure('ARTIFACT_UNVERIFIED', 409); }
        // Credentials may be revoked while the private file is being read.
        const current = authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        if (!artifactMatch[2]) return json(response, 200, { artifact: publicCommand(command) });
        if (artifactMatch[2] === 'preview') return json(response, 200,
          { artifact: publicCommand(command), text: bytes.toString('utf8') });
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename="WeftMate-artifact.${command.fileName.endsWith('.md') ? 'md' : 'txt'}"; filename*=UTF-8''${encodeURIComponent(command.fileName)}`,
          'content-length': String(bytes.length), 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        return response.end(bytes);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/commands') {
        if ([...url.searchParams.keys()].some((key) => !['before', 'limit'].includes(key)) ||
            url.searchParams.getAll('before').length > 1 || url.searchParams.getAll('limit').length > 1) {
          throw failure('INVALID_REQUEST');
        }
        const before = url.searchParams.get('before');
        const limitText = url.searchParams.get('limit') ?? '50';
        if (!/^\d+$/.test(limitText)) throw failure('INVALID_REQUEST');
        const limit = Number(limitText);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure('INVALID_REQUEST');
        if (before !== null && (!validId(before) || !Object.hasOwn(state.commands, before))) {
          throw failure('NOT_FOUND', 404);
        }
        const ordered = Object.values(state.commands).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.commandId.localeCompare(a.commandId));
        const start = before === null ? 0 : ordered.findIndex((item) => item.commandId === before) + 1;
        const page = ordered.slice(start, start + limit);
        const hasMore = start + limit < ordered.length;
        return json(response, 200, { commands: page.map(publicCommand),
          nextBefore: hasMore ? page.at(-1).commandId : null, hasMore });
      }
      const requestMatch = /^\/personal\/v1\/commands\/by-request\/([A-Za-z0-9_.:-]+)$/.exec(pathname);
      if (request.method === 'GET' && requestMatch) {
        if (url.search || requestMatch[1].length > 128 || !REQUEST_ID.test(requestMatch[1])) {
          throw failure('INVALID_REQUEST');
        }
        const command = Object.values(state.commands).find((item) => item.requestId === requestMatch[1]);
        if (!command) throw failure('NOT_FOUND', 404);
        return json(response, 200, { command: publicCommand(command) });
      }
      if (request.method === 'GET' && /^\/personal\/v1\/commands\/[A-Za-z0-9_-]+$/.test(pathname)) {
        if (url.search) throw failure('INVALID_REQUEST');
        const commandId = pathname.split('/').at(-1);
        if (!Object.hasOwn(state.commands, commandId)) throw failure('NOT_FOUND', 404);
        const command = state.commands[commandId];
        return json(response, 200, { command: publicCommand(command) });
      }
      if (request.method === 'POST' && (pathname === '/personal/v1/commands' ||
          (taskActionMatch && taskActionMatch[2] !== 'stop'))) {
        if (url.search) throw failure('INVALID_REQUEST');
        const taskAction = taskActionMatch?.[2] === 'supplements' ? 'supplement'
          : taskActionMatch?.[2] === 'resume' ? 'resume' : null;
        const rootTaskId = taskAction ? id(taskActionMatch[1]) : null;
        const body = await readJson(request);
        if (taskAction) exactKeys(body, ['requestId', 'text'], ['requestId', 'text']);
        const rootSource = taskAction ? taskSource(state, rootTaskId) : null;
        const payload = canonicalCommand(taskAction ? {
          requestId: body.requestId, kind: 'session.message', targetDeviceId: state.hostId,
          sessionId: rootSource.sessionId, text: body.text,
          mode: 'queue', rootTaskId, taskAction,
        } : body, state.hostId, Boolean(taskAction));
        requireOpen();
        if (storageFault) throw failure('STORAGE_UNAVAILABLE', 503);
        if (payload.kind === 'desktop.open_app' && typeof backend.openDesktopApp !== 'function') {
          throw failure('CAPABILITY_UNAVAILABLE', 503);
        }
        if (payload.kind === 'desktop.open_app' && !hostOwner(ownerId)) {
          throw failure('CAPABILITY_UNAVAILABLE', 403);
        }
        if (payload.kind === 'session.create' && !modelVisible(ownerId, payload.modelProfileId)) {
          throw failure('MODEL_UNAVAILABLE', 422);
        }
        const payloadHash = digest(JSON.stringify(payload));
        if (Object.values(state.commands).some((command) =>
          command.taskControl?.stopRequests.some((entry) => entry.requestId === payload.requestId))) {
          throw failure('REQUEST_CONFLICT', 409);
        }
        const prior = Object.values(state.commands).find((command) => command.requestId === payload.requestId);
        if (prior) {
          if (prior.payloadHash !== payloadHash) throw failure('REQUEST_CONFLICT', 409);
          return json(response, 202, taskAction
            ? { task: await taskDetail(state, rootTaskId), command: publicCommand(prior) }
            : { command: publicCommand(prior) });
        }
        if (taskAction === 'supplement' &&
            (rootSource.taskControl?.state === 'stop_requested' || taskHasUnknownEffects(state, rootTaskId))) {
          throw failure('TASK_NOT_READY', 409);
        }
        const resumeReady = taskAction === 'resume' && rootSource.taskControl?.state === 'stop_requested'
          ? (await taskStopEvidence(state, rootTaskId)).ready : false;
        if (taskAction === 'resume' && !resumeReady) throw failure('TASK_NOT_READY', 409);
        // A session must be bound to this owner before even the read-only
        // backend preflight can inspect its model or history.
        if (payload.sessionId && (!Object.hasOwn(state.sessions, payload.sessionId) ||
            state.sessions[payload.sessionId].ownerId !== state.ownerId)) {
          throw failure('SESSION_UNAVAILABLE', 404);
        }
        if (payload.kind === 'session.message' &&
            !['personal-remote', 'shared-chat'].includes(state.sessions[payload.sessionId].origin)) {
          throw failure('SESSION_READ_ONLY', 409);
        }
        if (payload.kind === 'session.message' && !hostOwner(ownerId) &&
            !modelVisible(ownerId, state.sessions[payload.sessionId].modelProfileId)) {
          throw failure('MODEL_UNAVAILABLE', 422);
        }
        if (payload.kind === 'session.message' && payload.attachments) {
          await sharedAttachmentStores.get(ownerId).resolve({ sessionId: payload.sessionId,
            requestId: payload.requestId, attachments: payload.attachments });
        }
        const preflightKey = `${ownerId}|${payload.requestId}`;
        const pendingPreflight = pendingPreflights.get(preflightKey);
        if (pendingPreflight && pendingPreflight.hash !== payloadHash) throw failure('REQUEST_CONFLICT', 409);
        let preflight;
        if (pendingPreflight) preflight = pendingPreflight.promise;
        else {
          preflight = callBackend(() => backend.preflight({ ...payload, ownerId }));
          pendingPreflights.set(preflightKey, { hash: payloadHash, promise: preflight });
          preflight.finally(() => {
            if (pendingPreflights.get(preflightKey)?.promise === preflight) {
              pendingPreflights.delete(preflightKey);
            }
          }).catch(() => {});
        }
        try { await preflight; }
        catch (error) { throw failure(safeCode(error), error?.code === 'MODEL_UNAVAILABLE' ? 422
          : error?.code === 'SESSION_READ_ONLY' ? 409 : 503); }
        requireOpen();
        const result = await serial(async () => {
          requireOpen();
          const current = authenticate(request, 'commands:write');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          const latest = accountState(ownerId);
          if (Object.values(latest.commands).some((command) =>
            command.taskControl?.stopRequests.some((entry) => entry.requestId === payload.requestId))) {
            throw failure('REQUEST_CONFLICT', 409);
          }
          const existing = Object.values(latest.commands).find((command) =>
            command.ownerId === ownerId && command.requestId === payload.requestId);
          if (existing) {
            if (existing.payloadHash !== payloadHash) throw failure('REQUEST_CONFLICT', 409);
            return publicCommand(existing);
          }
          if (taskAction) {
            const source = taskSource(latest, rootTaskId);
            if (source.sessionId !== payload.sessionId ||
                (taskAction === 'supplement' && (source.taskControl?.state === 'stop_requested' ||
                  taskHasUnknownEffects(latest, rootTaskId))) ||
                (taskAction === 'resume' &&
                  (source.taskControl?.state !== 'stop_requested' ||
                    source.taskControl.updatedAt !== rootSource.taskControl.updatedAt ||
                    source.taskControl.stopRequests.length !== rootSource.taskControl.stopRequests.length))) {
              throw failure('TASK_NOT_READY', 409);
            }
          }
          if (!Object.hasOwn(latest.devices, deviceId) || latest.devices[deviceId].revoked ||
              !latest.devices[deviceId].scopes.includes('commands:write')) throw failure('UNAUTHORIZED', 401);
          if (payload.sessionId && (!Object.hasOwn(latest.sessions, payload.sessionId) ||
              latest.sessions[payload.sessionId].ownerId !== ownerId)) throw failure('SESSION_UNAVAILABLE', 404);
          if (payload.kind === 'session.message' &&
              !['personal-remote', 'shared-chat'].includes(latest.sessions[payload.sessionId].origin)) {
            throw failure('SESSION_READ_ONLY', 409);
          }
          if (payload.kind === 'session.message' && !hostOwner(ownerId) &&
              !modelVisible(ownerId, latest.sessions[payload.sessionId].modelProfileId)) {
            throw failure('MODEL_UNAVAILABLE', 422);
          }
          if (payload.kind === 'session.message' && payload.attachments) {
            await sharedAttachmentStores.get(ownerId).resolve({ sessionId: payload.sessionId,
              requestId: payload.requestId, attachments: payload.attachments });
          }
          const recorded = Object.values(latest.commands);
          if (recorded.length >= MAX_COMMANDS ||
              recorded.reduce((bytes, command) => bytes +
                (typeof command.payload.text === 'string' ? Buffer.byteLength(command.payload.text, 'utf8') : 0), 0) +
                (typeof payload.text === 'string' ? Buffer.byteLength(payload.text, 'utf8') : 0) > MAX_UNRECONCILED_TEXT_BYTES) {
            throw failure('CAPACITY_LIMIT', 429);
          }
          const commandId = `cmd-${randomUUID()}`;
          const sessionId = payload.kind === 'session.create' ? `session-${randomUUID()}` : payload.sessionId;
          const now = new Date().toISOString();
          await mutate(ownerId, (next) => {
            next.commands[commandId] = {
              commandId, ownerId: next.ownerId, requestId: payload.requestId,
              payloadHash, payload, sourceDeviceId: deviceId,
              ...(latest.devices[deviceId].authKind === 'password'
                ? { sourceAuthEpoch: latest.devices[deviceId].authEpoch } : {}),
              targetDeviceId: payload.targetDeviceId, kind: payload.kind,
              ...(taskAction ? { rootTaskId, taskAction } : {}),
              ...(sessionId ? { sessionId } : {}), ...(payload.appId ? { appId: payload.appId } : {}),
              state: 'pending', createdAt: now, updatedAt: now,
            };
            if (taskAction === 'resume') {
              const control = next.commands[rootTaskId].taskControl;
              control.state = 'active'; control.updatedAt = now;
            }
          });
          schedule(ownerId, commandId);
          return publicCommand(accountState(ownerId).commands[commandId]);
        });
        return json(response, 202, taskAction
          ? { task: await taskDetail(accountState(ownerId), rootTaskId), command: result }
          : { command: result });
      }
      throw failure('NOT_FOUND', 404);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const code = PUBLIC_CODES.has(error?.code) ? error.code : 'SERVICE_UNAVAILABLE';
      const status = code === 'SERVICE_UNAVAILABLE' ? 503
        : Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      json(response, status, { error: { code } });
    }
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
      for (const [ownerId, account] of Object.entries(rootState.accounts)) {
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
        ownerId,
        deviceCount: Object.values(account.devices).filter((device) => !device.revoked).length,
      };
    },
    legacyOwnerId() { return rootState.legacyOwnerId; },
    canUseModelProfile(ownerId, profileId) {
      return Object.hasOwn(rootState.accounts, ownerId) &&
        typeof profileId === 'string' && modelVisible(ownerId, profileId);
    },
    isFormalLocalProfile(profileId) {
      const marker = rootState.sharedModelProfiles.find((item) => item.id === profileId);
      if (!marker) return false;
      try { return sharedProfileIsFormal(marker) === true; } catch { return false; }
    },
    ownerForSession(sessionId) {
      return uniqueSessionOwner(rootState.accounts, sessionId);
    },
    async setSharedModelProfiles(profileIds) {
      if (!Array.isArray(profileIds) || profileIds.length > 500 ||
          profileIds.some((value) => !validSharedProfile(value)) ||
          new Set(profileIds.map((value) => value.id)).size !== profileIds.length) throw failure('INVALID_REQUEST');
      return serial(() => mutateRoot((next) => {
        next.sharedModelProfiles = structuredClone(profileIds).sort((a, b) => a.id.localeCompare(b.id));
      }));
    },
    async issueSetupGrant() {
      if (accountState(rootState.legacyOwnerId).account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
      const grant = randomBytes(32).toString('base64url');
      const expiresAt = new Date(timestamp() + SETUP_GRANT_MS).toISOString();
      await serial(() => mutate(rootState.legacyOwnerId, (next) => {
        if (next.account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
        next.setupGrant = { hash: digest(grant), expiresAt: Date.parse(expiresAt) };
      }));
      return { grant, expiresAt };
    },
    async enrollDevice({ name, scopes = ['sessions:read', 'commands:write'] }) {
      if (closing) throw failure('SERVICE_CLOSING', 503);
      if (accountState(rootState.legacyOwnerId).account !== null) throw failure('ACCOUNT_LOGIN_REQUIRED', 409);
      if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
          !Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length ||
          scopes.some((scope) => !LEGACY_SCOPES.has(scope))) throw failure('INVALID_REQUEST');
      const deviceId = `device-${randomUUID()}`;
      const token = randomBytes(32).toString('base64url');
      const enrolledAt = new Date().toISOString();
      await serial(() => mutate(rootState.legacyOwnerId, (next) => {
        if (next.account !== null) throw failure('ACCOUNT_LOGIN_REQUIRED', 409);
        next.devices[deviceId] = { name: name.trim(), tokenHash: digest(token), scopes,
          revoked: false, enrolledAt, authKind: 'legacy-local' };
      }));
      return { deviceId, token, name: name.trim(), scopes, enrolledAt };
    },
    async revokeDevice(deviceId) {
      id(deviceId);
      return serial(() => mutate(rootState.legacyOwnerId, (next) => {
        if (!next.devices[deviceId]) throw failure('NOT_FOUND', 404);
        next.devices[deviceId].revoked = true;
        next.devices[deviceId].revokedAt = new Date().toISOString();
      }));
    },
    listDevices() {
      return Object.entries(accountState(rootState.legacyOwnerId).devices).map(([deviceId, device]) => ({
        deviceId, name: device.name, scopes: [...device.scopes],
        revoked: device.revoked, enrolledAt: device.enrolledAt, revokedAt: device.revokedAt,
      }));
    },
    hasVerifiedPersonalTool() {
      return Object.values(accountState(rootState.legacyOwnerId).commands).some((command) => command.kind === 'desktop.open_app' &&
        command.toolSource && command.state === 'observed' && command.verification?.status === 'observed');
    },
    async attachSession(sessionId) {
      id(sessionId);
      if (Object.entries(rootState.accounts).some(([ownerId, account]) =>
        ownerId !== rootState.legacyOwnerId && Object.hasOwn(account.sessions, sessionId))) {
        throw failure('SESSION_UNAVAILABLE', 404);
      }
      const described = await callBackend(() => backend.describeSession(sessionId, rootState.legacyOwnerId));
      if (described?.sessionId !== sessionId || described.agentPreset === 'personal-shared-chat') {
        throw failure('SESSION_UNAVAILABLE', 404);
      }
      await serial(() => mutate(rootState.legacyOwnerId, (next) => {
        if (Object.entries(rootState.accounts).some(([ownerId, account]) =>
          ownerId !== rootState.legacyOwnerId && Object.hasOwn(account.sessions, sessionId))) {
          throw failure('SESSION_UNAVAILABLE', 404);
        }
        if (!Object.hasOwn(next.sessions, sessionId)) {
          next.sessions[sessionId] = { ownerId: next.ownerId, attachedAt: new Date().toISOString(), origin: 'local-attached' };
        }
      }));
      return { sessionId };
    },
    /** Main-process only: a DSH tool call from an owner-bound restricted turn. */
    async submitToolDesktop({ sessionId, turn, callId, messageHash, appId }) {
      const ownerId = rootState.legacyOwnerId;
      const state = accountState(ownerId);
      id(sessionId);
      if (!Number.isSafeInteger(turn) || turn < 0 || typeof callId !== 'string' ||
          !/^[A-Za-z0-9._:-]{1,160}$/.test(callId) ||
          typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash) || appId !== 'notepad') {
        throw failure('INVALID_COMMAND');
      }
      if (!Object.hasOwn(state.sessions, sessionId) || state.sessions[sessionId].origin !== 'personal-remote') {
        throw failure('SESSION_READ_ONLY', 409);
      }
      const described = await callBackend(() => backend.describeSession(sessionId, ownerId));
      if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote') {
        throw failure('SESSION_READ_ONLY', 409);
      }
      const requestId = `tool-${digest(`${state.ownerId}|${sessionId}|${turn}|${callId}`).slice(0, 48)}`;
      const payload = canonicalCommand({ requestId, kind: 'desktop.open_app',
        targetDeviceId: state.hostId, appId }, state.hostId);
      if (typeof backend.openDesktopApp !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
      await callBackend(() => backend.preflight({ ...payload, ownerId }));
      const sourceCandidates = () => Object.values(accountState(ownerId).commands).filter((item) =>
        item.kind === 'session.message' && item.sessionId === sessionId &&
        typeof item.payload.text === 'string' && digest(item.payload.text) === messageHash);
      if (!sourceCandidates().length) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      for (let attempt = 0; attempt < 20 && sourceCandidates().some((item) => item.state === 'dispatching'); attempt++) {
        if (closing) throw failure('SERVICE_CLOSING', 503);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const commandId = await serial(() => mutate(ownerId, (next) => {
        const existing = Object.values(next.commands).find((item) => item.requestId === requestId);
        if (existing) return existing.commandId;
        if (!Object.hasOwn(next.sessions, sessionId) || next.sessions[sessionId].origin !== 'personal-remote') {
          throw failure('SESSION_READ_ONLY', 409);
        }
        const eligible = Object.values(next.commands).filter((item) => {
          if (item.kind !== 'session.message' || item.sessionId !== sessionId ||
              item.state !== 'accepted_by_dsh' || typeof item.payload.text !== 'string' ||
              digest(item.payload.text) !== messageHash ||
              (item.dshTurn !== undefined && item.dshTurn !== turn) ||
              !Number.isSafeInteger(item.sourceAuthEpoch)) return false;
          const device = next.devices[item.sourceDeviceId];
          return device?.authKind === 'password' && !device.revoked &&
            device.authEpoch === item.sourceAuthEpoch && Date.parse(device.expiresAt) > timestamp();
        });
        if (eligible.length !== 1) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        const source = eligible[0];
        const root = next.commands[source.rootTaskId ?? source.commandId];
        if (root?.taskControl?.state === 'stop_requested') throw failure('TASK_NOT_READY', 409);
        if (!explicitNotepadOpenIntent(source.payload.text)) {
          throw failure('TOOL_INTENT_UNCONFIRMED', 403);
        }
        const priorForTurn = Object.values(next.commands).find((item) => item.kind === 'desktop.open_app' &&
          item.toolSource?.sourceCommandId === source.commandId);
        if (priorForTurn) return priorForTurn.commandId;
        if (Object.keys(next.commands).length >= MAX_COMMANDS) throw failure('CAPACITY_LIMIT', 429);
        source.dshTurn = turn;
        const commandId = `cmd-${randomUUID()}`;
        const now = new Date(timestamp()).toISOString();
        next.commands[commandId] = { commandId, ownerId: next.ownerId, requestId,
          payloadHash: digest(JSON.stringify(payload)), payload,
          sourceDeviceId: source.sourceDeviceId, sourceAuthEpoch: source.sourceAuthEpoch,
          targetDeviceId: next.hostId, kind: 'desktop.open_app', appId,
          taskId: source.rootTaskId ?? source.commandId,
          toolSource: { sessionId, turn, callId, sourceCommandId: source.commandId },
          state: 'pending', createdAt: now, updatedAt: now };
        return commandId;
      }));
      schedule(ownerId, commandId);
      const work = activeByCommand.get(`${ownerId}|${commandId}`);
      if (work) {
        let timer;
        try { await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, 6_000); })]); }
        finally { clearTimeout(timer); }
      }
      return publicCommand(accountState(ownerId).commands[commandId]);
    },
    /** Main-process only: create a bounded document from one accepted owner turn. */
    async submitToolArtifact({ sessionId, turn, callId, messageHash, fileName, content }) {
      const ownerId = rootState.legacyOwnerId;
      id(sessionId);
      if (!Number.isSafeInteger(turn) || turn < 0 || typeof callId !== 'string' ||
          !/^[A-Za-z0-9._:-]{1,160}$/.test(callId) ||
          typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash)) {
        throw failure('INVALID_COMMAND');
      }
      const artifact = canonicalArtifact(fileName, content);
      const state = accountState(ownerId);
      if (state.sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
      const described = await callBackend(() => backend.describeSession(sessionId, ownerId));
      if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote') {
        throw failure('SESSION_READ_ONLY', 409);
      }
      await callBackend(() => backend.preflight({ kind: INTERNAL_ARTIFACT_KIND,
        targetDeviceId: state.hostId, sessionId, ownerId }));
      const requestId = `artifact-${digest(`${ownerId}|${sessionId}|${turn}|${callId}`).slice(0, 48)}`;
      const sourceCandidates = () => Object.values(accountState(ownerId).commands).filter((item) =>
        item.kind === 'session.message' && item.sessionId === sessionId &&
        typeof item.payload.text === 'string' && digest(item.payload.text) === messageHash);
      if (!sourceCandidates().length) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      for (let attempt = 0; attempt < 20 && sourceCandidates().some((item) => item.state === 'dispatching'); attempt++) {
        if (closing) throw failure('SERVICE_CLOSING', 503);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const commandId = await serial(() => mutate(ownerId, (next) => {
        if (next.sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
        const eligible = Object.values(next.commands).filter((item) => {
          if (item.kind !== 'session.message' || item.sessionId !== sessionId ||
              item.state !== 'accepted_by_dsh' || typeof item.payload.text !== 'string' ||
              digest(item.payload.text) !== messageHash ||
              (item.dshTurn !== undefined && item.dshTurn !== turn) ||
              !Number.isSafeInteger(item.sourceAuthEpoch)) return false;
          const device = next.devices[item.sourceDeviceId];
          return device?.authKind === 'password' && !device.revoked &&
            device.authEpoch === item.sourceAuthEpoch && Date.parse(device.expiresAt) > timestamp();
        });
        if (eligible.length !== 1) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        const source = eligible[0];
        const rootTaskId = source.rootTaskId ?? source.commandId;
        const existing = Object.values(next.commands).find((item) => item.requestId === requestId);
        if (existing) {
          if (existing.kind !== INTERNAL_ARTIFACT_KIND || existing.taskId !== rootTaskId ||
              existing.fileName !== artifact.fileName || existing.size !== artifact.size ||
              existing.sha256 !== artifact.sha256) throw failure('REQUEST_CONFLICT', 409);
          return existing.commandId;
        }
        if (next.commands[rootTaskId]?.taskControl?.state === 'stop_requested') {
          throw failure('TASK_NOT_READY', 409);
        }
        if (Object.keys(next.commands).length >= MAX_COMMANDS) throw failure('CAPACITY_LIMIT', 429);
        source.dshTurn = turn;
        const commandId = `cmd-${randomUUID()}`;
        const artifactId = `artifact-${randomUUID()}`;
        const payload = canonicalCommand({ requestId, kind: INTERNAL_ARTIFACT_KIND,
          targetDeviceId: next.hostId, sessionId, taskId: rootTaskId, artifactId,
          fileName: artifact.fileName, size: artifact.size, sha256: artifact.sha256 }, next.hostId, true);
        const now = new Date(timestamp()).toISOString();
        next.commands[commandId] = { commandId, ownerId, requestId,
          payloadHash: digest(JSON.stringify(payload)), payload,
          sourceDeviceId: source.sourceDeviceId, sourceAuthEpoch: source.sourceAuthEpoch,
          targetDeviceId: next.hostId, kind: INTERNAL_ARTIFACT_KIND, sessionId,
          taskId: rootTaskId, artifactId, fileName: artifact.fileName,
          size: artifact.size, sha256: artifact.sha256,
          toolSource: { sessionId, turn, callId, sourceCommandId: source.commandId },
          state: 'dispatching', createdAt: now, updatedAt: now };
        return commandId;
      }));
      const command = accountState(ownerId).commands[commandId];
      if (command.state !== 'dispatching') return publicCommand(command);
      const workKey = `${ownerId}|${commandId}`;
      let work = activeByCommand.get(workKey);
      if (!work) {
        work = (async () => {
          let observed = false;
          try {
            try { await artifactStore.inspect(ownerId, command.taskId, command.artifactId, command); observed = true; }
            catch (error) {
              if (error?.code !== 'ENOENT') throw error;
              await artifactStore.write(ownerId, command.taskId, command.artifactId, artifact);
              observed = true;
            }
          } catch { /* A write may have completed before its receipt failed. Recheck below. */ }
          if (!observed) {
            try { await artifactStore.inspect(ownerId, command.taskId, command.artifactId, command); observed = true; }
            catch { /* Keep unknown result. */ }
          }
          await serial(() => mutate(ownerId, (next) => {
            const current = next.commands[commandId];
            if (current.state !== 'dispatching') return;
            current.state = observed ? 'observed' : 'uncertain';
            if (observed) current.verification = { status: 'observed', method: 'sha256_readback',
              observedAt: new Date(timestamp()).toISOString() };
            else current.errorCode = 'RECEIPT_UNKNOWN';
            current.updatedAt = new Date(timestamp()).toISOString();
          }));
        })();
        activeByCommand.set(workKey, work);
        work.finally(() => { if (activeByCommand.get(workKey) === work) activeByCommand.delete(workKey); }).catch(() => {});
      }
      await work;
      return publicCommand(accountState(ownerId).commands[commandId]);
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        mobileUi?.close();
        const syncClosed = Promise.all([...syncStores.values()].map((store) => store.close()));
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
            Promise.all([queue, syncClosed]),
            new Promise((_, reject) => { timer = setTimeout(() => reject(failure('CLOSE_TIMEOUT', 503)), CLOSE_TIMEOUT_MS); }),
          ]);
          clearTimeout(timer);
          await Promise.race([
            Promise.allSettled([listeningClosed, ...active, ...stopping.values()]),
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
  return service;
}
