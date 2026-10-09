import { digest, exactKeys, failure, id, modelProfileId, validId } from './common.mjs';
import {
  CONVERSATION_ID,
  INTERNAL_ARTIFACT_KIND,
  KINDS,
  MAX_TEXT,
  REQUEST_ID,
  SNAPSHOT_ID,
  SYNC_EVENT_ID,
  WEB_SNAPSHOT_ID
} from './constants.mjs';
import {
  canonicalSharedAttachment,
  MAX_SHARED_MESSAGE_BYTES,
  MAX_SHARED_MESSAGE_IMAGES,
  MAX_SHARED_MESSAGE_TEXT_BYTES
} from './shared-attachments.mjs';
import { canonicalAttachmentMetadata, MAX_ATTACHMENT_BYTES, TEXT_ATTACHMENT_TYPES } from '../personal-sync/attachments.mjs';
import { artifactContentType, validArtifactFileName } from '../personal-artifacts/index.mjs';

export function sourceMessageHash(command) {
  return command.payload.modelInputHash ?? digest(command.payload.text);
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

export function canonicalCommand(value, hostId, internal = false) {
  exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'modelProfileId', 'sessionId', 'text', 'mode', 'intent', 'appId', 'attachments',
    'attachmentMessageId', 'originalAttachments', 'sourceSyncEventId',
    ...(internal ? ['taskId', 'artifactId', 'fileName', 'size', 'sha256', 'rootTaskId', 'taskAction',
      'projectId', 'projectRevision', 'sourceReceiptId', 'sourceSnapshotIds', 'workspaceKind', 'initialUrls',
      'conversationId', 'cutoverSyncSeq', 'contextHash', 'acknowledgeUncertainLocalTurn', 'modelInputHash'] : [])],
    ['requestId', 'kind', 'targetDeviceId']);
  if (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) ||
      !(KINDS.has(value.kind) || (internal && value.kind === INTERNAL_ARTIFACT_KIND))) {
    throw failure('INVALID_REQUEST');
  }
  if (value.targetDeviceId !== hostId) throw failure('TARGET_UNAVAILABLE', 409);
  if ((value.projectId === undefined) !== (value.projectRevision === undefined) ||
      (value.projectId !== undefined && (!internal || !validId(value.projectId) ||
        !Number.isSafeInteger(value.projectRevision) || value.projectRevision < 1))) throw failure('INVALID_REQUEST');
  if (value.workspaceKind !== undefined && (!internal || value.workspaceKind !== 'browser' ||
      value.projectId !== undefined || !['session.create', 'session.message'].includes(value.kind))) {
    throw failure('INVALID_REQUEST');
  }
  if (value.conversationId !== undefined && (!internal || !CONVERSATION_ID.test(value.conversationId) ||
      value.projectId !== undefined && value.kind !== 'session.message' || value.workspaceKind !== undefined ||
      !['session.create', 'session.message'].includes(value.kind))) throw failure('INVALID_REQUEST');
  if (value.kind === 'session.create') {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'modelProfileId',
      ...(internal ? ['projectId', 'projectRevision', 'workspaceKind',
        'conversationId', 'cutoverSyncSeq', 'contextHash', 'acknowledgeUncertainLocalTurn'] : [])],
      ['requestId', 'kind', 'targetDeviceId', 'modelProfileId']);
    modelProfileId(value.modelProfileId);
    if ((value.conversationId === undefined) !== (value.cutoverSyncSeq === undefined) ||
        (value.conversationId === undefined) !== (value.contextHash === undefined) ||
        (value.conversationId !== undefined && (!Number.isSafeInteger(value.cutoverSyncSeq) ||
          value.cutoverSyncSeq < 1 || !/^[a-f0-9]{64}$/.test(value.contextHash)))) {
      throw failure('INVALID_REQUEST');
    }
    if (value.acknowledgeUncertainLocalTurn !== undefined &&
        (value.conversationId === undefined || value.acknowledgeUncertainLocalTurn !== true)) {
      throw failure('INVALID_REQUEST');
    }
  } else if (value.kind === 'session.message') {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'sessionId', 'text', 'mode', 'intent', 'attachments',
      'attachmentMessageId', 'originalAttachments', 'sourceSyncEventId',
      ...(internal ? ['rootTaskId', 'taskAction', 'projectId', 'projectRevision', 'workspaceKind',
        'initialUrls', 'conversationId', 'modelInputHash'] : [])],
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
        canonical.reduce((sum, item) => sum + item.size, 0) > MAX_SHARED_MESSAGE_BYTES ||
        canonical.filter((item) => TEXT_ATTACHMENT_TYPES.has(item.contentType))
          .reduce((sum, item) => sum + item.size, 0) > MAX_SHARED_MESSAGE_TEXT_BYTES)) throw failure('INVALID_REQUEST');
    const originals = value.originalAttachments === undefined ? null : value.originalAttachments;
    if ((value.attachmentMessageId === undefined) !== (originals === null) ||
        (value.attachmentMessageId !== undefined && !SYNC_EVENT_ID.test(value.attachmentMessageId)) ||
        (originals !== null && (!Array.isArray(originals) || originals.length < 1 || originals.length > 4))) {
      throw failure('INVALID_REQUEST');
    }
    const canonicalOriginals = originals?.map(canonicalAttachmentMetadata);
    if (canonicalOriginals && (new Set(canonicalOriginals.map((item) => item.attachmentId)).size !== canonicalOriginals.length ||
        canonicalOriginals.reduce((sum, item) => sum + item.size, 0) > 4 * MAX_ATTACHMENT_BYTES)) throw failure('INVALID_REQUEST');
    if (typeof value.text !== 'string' || (!value.text.trim() && !canonical && !canonicalOriginals) || value.text.length > MAX_TEXT) {
      throw failure('INVALID_REQUEST');
    }
    if (value.mode !== undefined && !['queue', 'steer'].includes(value.mode)) throw failure('INVALID_REQUEST');
    if (value.intent !== undefined && (!['queue', 'steer'].includes(value.intent) ||
        value.mode !== undefined && value.mode !== value.intent)) throw failure('INVALID_REQUEST');
    if (value.sourceSyncEventId !== undefined &&
        (typeof value.sourceSyncEventId !== 'string' || !SYNC_EVENT_ID.test(value.sourceSyncEventId))) {
      throw failure('INVALID_REQUEST');
    }
    if (value.workspaceKind === 'browser' && (!Array.isArray(value.initialUrls) ||
        value.initialUrls.length < 1 || value.initialUrls.length > 5 ||
        new Set(value.initialUrls).size !== value.initialUrls.length ||
        value.initialUrls.some((url) => {
          if (typeof url !== 'string' || Buffer.byteLength(url, 'utf8') > 2048) return true;
          try { const parsed = new URL(url); return !['http:', 'https:'].includes(parsed.protocol) ||
            Boolean(parsed.username || parsed.password) || parsed.toString() !== url; }
          catch { return true; }
        }))) throw failure('INVALID_REQUEST');
    if (value.workspaceKind !== 'browser' && value.initialUrls !== undefined) throw failure('INVALID_REQUEST');
    if (value.modelInputHash !== undefined && (!internal || !/^[a-f0-9]{64}$/.test(value.modelInputHash))) throw failure('INVALID_REQUEST');
  } else if (value.kind === 'session.cancel') {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'sessionId'],
      ['requestId', 'kind', 'targetDeviceId', 'sessionId']);
    id(value.sessionId);
  } else if (value.kind === INTERNAL_ARTIFACT_KIND) {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'sessionId', 'taskId', 'artifactId',
      'fileName', 'size', 'sha256', 'sourceReceiptId', 'sourceSnapshotIds'], ['requestId', 'kind', 'targetDeviceId', 'sessionId',
      'taskId', 'artifactId', 'fileName', 'size', 'sha256']);
    id(value.sessionId); id(value.taskId); id(value.artifactId);
    if (!validArtifactFileName(value.fileName) || !Number.isSafeInteger(value.size) ||
        value.size < 1 || value.size > 128 * 1024 || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw failure('INVALID_COMMAND');
    }
    if ((value.sourceReceiptId === undefined) !== (value.sourceSnapshotIds === undefined) ||
        (value.sourceReceiptId !== undefined && (!validId(value.sourceReceiptId) ||
          !Array.isArray(value.sourceSnapshotIds) || value.sourceSnapshotIds.length < 1 ||
          value.sourceSnapshotIds.length > 16 ||
          new Set(value.sourceSnapshotIds).size !== value.sourceSnapshotIds.length ||
          value.sourceSnapshotIds.some((sourceId) => !SNAPSHOT_ID.test(sourceId) && !WEB_SNAPSHOT_ID.test(sourceId))))) {
      throw failure('INVALID_COMMAND');
    }
  } else {
    exactKeys(value, ['requestId', 'kind', 'targetDeviceId', 'appId'],
      ['requestId', 'kind', 'targetDeviceId', 'appId']);
    if (value.appId !== 'notepad') throw failure('INVALID_COMMAND');
  }
  return Object.fromEntries(['requestId', 'kind', 'targetDeviceId', 'modelProfileId', 'sessionId', 'text', 'mode', 'appId', 'attachments',
    'attachmentMessageId', 'originalAttachments',
    'sourceSyncEventId',
    'taskId', 'artifactId', 'fileName', 'size', 'sha256', 'rootTaskId', 'taskAction',
    'projectId', 'projectRevision', 'sourceReceiptId', 'sourceSnapshotIds', 'workspaceKind', 'initialUrls',
    'conversationId', 'cutoverSyncSeq', 'contextHash', 'acknowledgeUncertainLocalTurn', 'modelInputHash']
    .filter((key) => Object.hasOwn(value, key) || (key === 'mode' && value.kind === 'session.message'))
    .map((key) => [key, key === 'mode' ? (value.intent ?? value.mode ?? 'steer')
      : key === 'attachments' ? value.attachments.map(canonicalSharedAttachment)
        : key === 'originalAttachments' ? value.originalAttachments.map(canonicalAttachmentMetadata)
        : key === 'initialUrls' ? [...value.initialUrls] : value[key]]));
}

export function publicCommand(command) {
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
  if (command.kind === 'session.message') result.intent = command.payload.mode;
  if (command.payload?.attachmentMessageId) result.attachmentMessageId = command.payload.attachmentMessageId;
  if (command.payload?.originalAttachments) result.originalAttachments = command.payload.originalAttachments.map((item) => ({ ...item }));
  if (command.payload?.conversationId) result.conversationId = command.payload.conversationId;
  if (command.payload?.sourceSyncEventId) result.sourceSyncEventId = command.payload.sourceSyncEventId;
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
  if (command.kind === INTERNAL_ARTIFACT_KIND) result.contentType = artifactContentType(command.fileName);
  if (command.size !== undefined) result.size = command.size;
  if (command.sha256) result.sha256 = command.sha256;
  if (command.payload?.projectId) {
    result.projectId = command.payload.projectId;
    result.projectRevision = command.payload.projectRevision;
  }
  if (command.payload?.workspaceKind) result.workspaceKind = command.payload.workspaceKind;
  if (command.sourceSnapshotIds) result.sourceSnapshotIds = [...command.sourceSnapshotIds];
  if (command.receiptId) result.receiptId = command.receiptId;
  if (command.verification) result.verification = { ...command.verification };
  if (command.errorCode) result.errorCode = command.errorCode;
  if (command.imageReasonCode) result.imageReasonCode = command.imageReasonCode;
  return result;
}
