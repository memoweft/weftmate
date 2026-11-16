import { scheduledCommandSource } from './schedules-authorization.mjs';
import { offlineCommandSource } from '../personal-offline/tasks.mjs';
import { failure } from './common.mjs';
import { isPersonalSession, isRemoteSession } from './backend-boundary.mjs';

export function requireSendRequestId(context, state, payload) {
  if (context.interactionRequestIdUsed(state, payload.requestId)) throw failure('REQUEST_CONFLICT', 409);
  if (state.modelOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
  if (state.projectOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
  if (state.chatOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
  if (Object.values(state.commands).some((command) =>
    command.taskControl?.stopRequests.some((entry) => entry.requestId === payload.requestId))) {
    throw failure('REQUEST_CONFLICT', 409);
  }
}

export function requireSendProject(state, payload) {
  if (payload.projectId && (state.projects?.[payload.projectId]?.revoked ||
      state.projects?.[payload.projectId]?.revision !== payload.projectRevision)) {
    throw failure('PROJECT_REVOKED', 409);
  }
}

export function requireSendSession(context, ownerId, state, payload) {
  if (payload.sessionId && (!Object.hasOwn(state.sessions, payload.sessionId) ||
      state.sessions[payload.sessionId].ownerId !== state.ownerId)) {
    throw failure('SESSION_UNAVAILABLE', 404);
  }
  if (payload.kind === 'session.message' && state.sessions[payload.sessionId].deleting === true) throw failure('SESSION_UNAVAILABLE', 404);
  if (payload.kind === 'session.message' && state.sessions[payload.sessionId].archived === true) throw failure('SESSION_ARCHIVED', 409);
  if (payload.kind === 'session.message' &&
      !['personal-remote', 'shared-chat'].includes(state.sessions[payload.sessionId].origin)) {
    throw failure('SESSION_READ_ONLY', 409);
  }
  if (payload.kind === 'session.message' &&
      !context.messageModelUsable(ownerId, state.sessions[payload.sessionId])) {
    throw failure('MODEL_UNAVAILABLE', 422);
  }
}

export function requireSendSync(context, ownerId, deviceId, state, payload) {
  if (payload.kind === 'session.message' && payload.sourceSyncEventId &&
      (!payload.conversationId || !context.verifiedSyncUserEvent(ownerId, payload.conversationId,
        payload.sourceSyncEventId, payload.text, deviceId) ||
        Object.values(state.commands).some((item) =>
          item.payload.sourceSyncEventId === payload.sourceSyncEventId))) {
    throw failure('REQUEST_CONFLICT', 409);
  }
}

export async function requireSendAttachments(context, ownerId, payload) {
  if (payload.kind === 'session.message' && payload.attachments) {
    await context.sharedAttachmentStores.get(ownerId).resolve({ sessionId: payload.sessionId,
      requestId: payload.requestId, attachments: payload.attachments });
  }
  if (payload.kind === 'session.message' && payload.originalAttachments) {
    await context.requireOriginalAttachments(ownerId, payload.sessionId, payload.attachmentMessageId,
      payload.originalAttachments);
  }
}

/** The real reason a queued message can no longer go to its session, or null. */
function sessionMessageRejection(context, ownerId, session, admitted) {
  if (!session || session.ownerId !== ownerId || !admitted || session.deleting === true ||
      session.expiresAt && Date.parse(session.expiresAt) <= context.timestamp() ||
      session.conversationId !== admitted.conversationId) return 'SESSION_UNAVAILABLE';
  if (session.archived === true) return 'SESSION_ARCHIVED';
  if (session.modelProfileId !== admitted.modelProfileId) return 'SESSION_MODEL_CHANGED';
  if (!context.messageModelUsable(ownerId, session)) return 'MODEL_UNAVAILABLE';
  return null;
}

export async function dispatchSendRejection(context, ownerId, account, command, admitted, describe, locked = false) {
  if (locked) {
    try { requireSendProject(account, command.payload); }
    catch (error) { return error.code; }
    if (command.payload.workspaceKind === 'browser' && context.browserReader?.status()?.available !== true) return 'BROWSER_UNAVAILABLE';
  }
  const session = command.kind === 'session.message' ? account.sessions[command.sessionId] : null;
  if (command.kind === 'session.message') {
    const reason = sessionMessageRejection(context, ownerId, session, admitted);
    if (reason) return reason;
  }
  if (command.payload.conversationId) {
    const bound = account.conversationBindings?.[command.payload.conversationId];
    let matches = context.modelVisible(ownerId, bound?.modelProfileId);
    if (matches && session) {
      try {
        const described = await describe();
        matches = described?.sessionId === command.sessionId && isPersonalSession(described) &&
          described.modelProfileId === bound.modelProfileId && session.modelProfileId === bound.modelProfileId;
      } catch { matches = false; }
    }
    if (!bound || !matches || session && bound.status !== 'active') return 'MODEL_UNAVAILABLE';
  }
  if (!locked && command.payload.projectId) {
    const project = account.projects?.[command.payload.projectId];
    let matches = true;
    if (session) {
      try {
        const described = await describe();
        matches = described?.sessionId === command.sessionId && isRemoteSession(described) &&
          described.modelProfileId === session.modelProfileId;
      } catch { matches = false; }
    }
    if (!matches) return 'PROJECT_MODEL_CHANGED';
    if (!project || project.revoked || project.revision !== command.payload.projectRevision) return 'PROJECT_REVOKED';
  }
  if (!locked && command.payload.workspaceKind === 'browser') {
    let matches = context.browserReader?.status()?.available === true;
    if (matches && session) {
      try {
        const described = await describe();
        matches = described?.sessionId === command.sessionId && isRemoteSession(described) &&
          described.modelProfileId === session.modelProfileId;
      } catch { matches = false; }
    }
    if (!matches) return 'BROWSER_UNAVAILABLE';
  }
  return null;
}

export function dispatchDeviceRejection(context, ownerId, account, command) {
  const device = account.devices[command.sourceDeviceId];
  if ((device?.authKind === 'cloud' && context.cloudIdentity?.validSession(ownerId, command.sourceDeviceId) !== true) ||
      device?.revoked || command.sourceAuthEpoch !== undefined && device?.authEpoch !== command.sourceAuthEpoch ||
      ['password', 'cloud', 'desktop'].includes(device?.authKind) &&
        !scheduledCommandSource(account, command) && !offlineCommandSource(context, ownerId, command) &&
        Date.parse(device.expiresAt) <= context.timestamp()) {
    return device?.revoked ? 'DEVICE_REVOKED' : command.sourceAuthEpoch !== undefined &&
      device?.authEpoch !== command.sourceAuthEpoch ? 'SESSION_REPLACED' : 'SESSION_EXPIRED';
  }
  return null;
}
