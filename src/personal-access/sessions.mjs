import { digest, failure, id, plainObject, validId } from './common.mjs';
import { CONVERSATION_ID, IMAGE_CONTENT_TYPES } from './constants.mjs';
import { uniqueSessionOwner } from './store.mjs';
import { validConversationContext } from '../personal-conversations/context.mjs';

export function createSessionOperations(context) {
  async function requireOriginalAttachments(ownerId, sessionId, messageId, originals) {
    if (!Array.isArray(originals)) return;
    for (const reference of originals) {
      const found = await context.attachmentStores.get(ownerId).get(reference.attachmentId);
      if (found.conversationId !== sessionId || found.messageId !== messageId ||
          JSON.stringify(found.meta) !== JSON.stringify(reference)) throw failure('ATTACHMENT_NOT_FOUND', 404);
    }
  }

  function commandReferencesOriginal(ownerId, sessionId, messageId, attachment) {
    return Object.values(context.accountState(ownerId).commands).some((command) =>
      command.kind === 'session.message' && command.sessionId === sessionId &&
      command.payload.attachmentMessageId === messageId &&
      command.payload.originalAttachments?.some((reference) =>
        reference.attachmentId === attachment.attachmentId &&
        JSON.stringify(reference) === JSON.stringify(attachment)));
  }

  function publicHistoryEvent(ownerId, sessionId, event) {
    if (!plainObject(event.data)) return event;
    const { messageHash, ...publicData } = event.data;
    if (event.type !== 'user.message') return { ...event, data: publicData };
    if (typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash) ||
        typeof publicData.receiptId !== 'string') return { ...event, data: publicData };
    const matching = Object.values(context.accountState(ownerId).commands).filter((command) =>
      command.kind === 'session.message' && command.rootTaskId === undefined &&
      command.sessionId === sessionId && command.state === 'accepted_by_dsh' &&
      command.receiptId === publicData.receiptId && command.payload?.modelInputHash === messageHash &&
      typeof command.payload.text === 'string' && Array.isArray(command.payload.originalAttachments) &&
      typeof command.payload.attachmentMessageId === 'string');
    if (matching.length !== 1) return { ...event, data: publicData };
    const source = matching[0];
    const stagedIds = new Set((source.payload.attachments ?? []).map((item) => item.attachmentId));
    const unpreviewedOriginalImageIds = source.payload.originalAttachments
      .filter((item) => IMAGE_CONTENT_TYPES.has(item.contentType) && !stagedIds.has(item.attachmentId))
      .map((item) => item.attachmentId);
    return { ...event, data: {
      ...publicData, text: source.payload.text,
      originalAttachments: source.payload.originalAttachments.map((item) => ({ ...item })),
      attachmentMessageId: source.payload.attachmentMessageId,
      ...(unpreviewedOriginalImageIds.length ? { unpreviewedOriginalImageIds } : {}),
      truncated: false,
    } };
  }

  function conversationSnapshot(ownerId, conversationId) {
    if (!CONVERSATION_ID.test(conversationId)) throw failure('NOT_FOUND', 404);
    const snapshot = context.syncStores.get(ownerId)?.conversationSnapshot(conversationId);
    if (snapshot?.createdCount !== 1) throw failure('NOT_FOUND', 404);
    return snapshot;
  }

  function conversationProjection(ownerId, conversationId) {
    const snapshot = conversationSnapshot(ownerId, conversationId);
    const account = context.accountState(ownerId);
    const binding = account.conversationBindings?.[conversationId];
    const sourceReady = sourceDevicesUpgraded(ownerId, snapshot);
    const terminalByDevice = new Map();
    for (const event of snapshot.events) {
      if (event.kind !== 'turn.finished' ||
          event.seq > (binding?.cutoverSyncSeq ?? snapshot.latestSeq)) continue;
      const prior = terminalByDevice.get(event.sourceDeviceId);
      if (!prior || event.clientSeq > prior.clientSeq) terminalByDevice.set(event.sourceDeviceId, event);
    }
    const models = [...terminalByDevice.values()].map((event) => event.payload.originalModel ?? null);
    const originalModel = models.length && models[0] !== null &&
      models.every((item) => JSON.stringify(item) === JSON.stringify(models[0])) ? models[0] : null;
    const adopted = Object.values(account.commands).filter((command) =>
      command.kind === 'session.message' && command.payload.conversationId === conversationId &&
      command.payload.sourceSyncEventId).map((command) => ({
        commandId: command.commandId, requestId: command.requestId,
        sourceSyncEventId: command.payload.sourceSyncEventId,
        ...(command.receiptId ? { receiptId: command.receiptId } : {}), state: command.state,
      }));
    const adoptedIds = new Set(adopted.filter((item) => item.state === 'accepted_by_dsh' && item.receiptId)
      .map((item) => item.sourceSyncEventId));
    const late = binding ? snapshot.events.filter((event) => event.seq > binding.cutoverSyncSeq &&
      !adoptedIds.has(event.eventId)) : [];
    const localTurns = Object.values(account.conversationLocalTurns ?? {})
      .filter((turn) => turn.conversationId === conversationId);
    const pendingTurns = localTurns.filter((turn) => localTurnState(snapshot, turn) !== 'finished');
    const running = pendingTurns.some((turn) => localTurnState(snapshot, turn) === 'running');
    const uncertain = pendingTurns.some((turn) => localTurnState(snapshot, turn) === 'uncertain');
    const ready = sourceReady && !snapshot.unfinished && !running && !uncertain;
    return { source: 'host', conversationId, hostId: context.rootState.hostId,
      syncThroughSeq: snapshot.latestSeq,
      originalModel,
      status: binding?.status ?? 'unbound', canAdopt: !binding && ready,
      ...(!binding && !ready ? { reasonCode: !sourceReady ? 'SOURCE_DEVICE_UPGRADE_REQUIRED'
        : running ? 'LOCAL_TURN_RUNNING' : uncertain ? 'LOCAL_TURN_UNCONFIRMED'
          : 'CONVERSATION_NOT_READY' } : {}),
      localTurns: localTurns.slice(-20).map((turn) => ({ turnId: turn.turnId,
        sourceSyncEventId: turn.sourceSyncEventId, state: localTurnState(snapshot, turn),
        expiresAt: turn.expiresAt })),
      ...(binding ? { binding: { conversationId, sessionId: binding.sessionId,
        modelProfileId: binding.modelProfileId, revision: binding.revision,
        cutoverSyncSeq: binding.cutoverSyncSeq, contextHash: binding.contextHash,
        historyMessageCount: binding.historyMessageCount, truncated: binding.truncated,
        omittedImages: binding.omittedImages, adoptCommandId: binding.adoptCommandId },
        lateSegment: { count: late.length, events: late.slice(0, 100),
          hasMore: late.length > 100 }, adoptedMessages: adopted } : {}),
    };
  }

  function verifiedSyncUserEvent(ownerId, conversationId, eventId, text, deviceId) {
    const snapshot = conversationSnapshot(ownerId, conversationId);
    const event = snapshot.events.find((item) => item.eventId === eventId);
    return event?.kind === 'message.created' && event.sourceDeviceId === deviceId &&
      event.payload.role === 'user' && event.payload.text === text;
  }

  function sourceDevicesUpgraded(ownerId, snapshot) {
    const account = context.accountState(ownerId);
    const sourceIds = new Set(snapshot.events.filter((event) =>
      ['conversation.created', 'turn.finished'].includes(event.kind))
      .map((event) => event.sourceDeviceId));
    return [...sourceIds].every((deviceId) => {
      const device = account.devices[deviceId];
      return !device || device.revoked || device.syncCapabilities?.sharedConversations === 1 &&
        device.syncCapabilities.nativeVersionCode >= 11;
    });
  }

  function localTurnState(snapshot, turn) {
    const sourceSeq = snapshot.events.find((event) => event.eventId === turn.sourceSyncEventId)?.seq ?? 0;
    if (sourceSeq > 0 && snapshot.events.some((event) => event.kind === 'turn.finished' &&
        event.payload.turnId === turn.turnId && event.sourceDeviceId === turn.deviceId &&
        event.seq > sourceSeq)) return 'finished';
    if (turn.state !== 'running') return turn.state;
    return Date.parse(turn.expiresAt) > context.timestamp() ? 'running' : 'uncertain';
  }

  return {
    requireOriginalAttachments,
    commandReferencesOriginal,
    publicHistoryEvent,
    conversationSnapshot,
    conversationProjection,
    verifiedSyncUserEvent,
    sourceDevicesUpgraded,
    localTurnState,
    ownerForSession(sessionId) {
      return uniqueSessionOwner(context.rootState.accounts, sessionId);
    },
    async getConversationContext({ sessionId, turn, step, receiptId, messageHash }) {
      if (!validId(sessionId) || !Number.isSafeInteger(turn) || turn < 0 || step !== 1 ||
          !validId(receiptId) || typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash)) {
        throw failure('CONVERSATION_CONTEXT_UNAVAILABLE', 409);
      }
      const match = uniqueSessionOwner(context.rootState.accounts, sessionId);
      if (!match) throw failure('CONVERSATION_CONTEXT_UNAVAILABLE', 409);
      const ownerId = match.ownerId;
      const session = context.accountState(ownerId).sessions[sessionId];
      if (!session?.conversationId) return { state: 'none' };
      for (let attempt = 0; attempt < 20; attempt++) {
        if (context.closing || context.storageFault) throw failure('CONVERSATION_CONTEXT_UNAVAILABLE', 503);
        const account = context.accountState(ownerId);
        const bound = account.conversationBindings?.[session.conversationId];
        const currentSession = account.sessions[sessionId];
        if (!bound || bound.status !== 'active' || bound.sessionId !== sessionId ||
            currentSession?.conversationId !== bound.conversationId ||
            currentSession.modelProfileId !== bound.modelProfileId ||
            !validConversationContext(bound)) throw failure('CONVERSATION_CONTEXT_UNAVAILABLE', 409);
        const source = Object.values(account.commands).find((item) =>
          item.kind === 'session.message' && item.sessionId === sessionId &&
          item.receiptId === receiptId);
        if (source) {
          const device = account.devices[source.sourceDeviceId];
          if (source.state !== 'accepted_by_dsh' || source.payload.conversationId !== bound.conversationId ||
              (source.payload.modelInputHash ?? digest(source.payload.text)) !== messageHash ||
              (source.dshTurn !== undefined && source.dshTurn !== turn) ||
              source.taskControl?.state === 'stop_requested' ||
              account.commands[source.rootTaskId]?.taskControl?.state === 'stop_requested' ||
              !device || device.revoked ||
              (source.sourceAuthEpoch !== undefined && device.authEpoch !== source.sourceAuthEpoch) ||
              (['password', 'cloud'].includes(device.authKind) && Date.parse(device.expiresAt) <= context.timestamp())) {
            throw failure('CONVERSATION_CONTEXT_UNAVAILABLE', 409);
          }
          return { state: 'ready', contextText: bound.contextText,
            contextHash: bound.contextHash, throughSeq: bound.cutoverSyncSeq,
            truncated: bound.truncated, omittedImages: bound.omittedImages,
            historyMessageCount: bound.historyMessageCount };
        }
        const matching = Object.values(account.commands).some((item) =>
          item.kind === 'session.message' && item.sessionId === sessionId &&
          item.state === 'dispatching' && item.payload.conversationId === bound.conversationId &&
          digest(item.payload.text) === messageHash);
        if (!matching) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw failure('CONVERSATION_CONTEXT_UNAVAILABLE', 409);
    },
    async attachSession(sessionId) {
      id(sessionId);
      if (Object.entries(context.rootState.accounts).some(([ownerId, account]) =>
        ownerId !== context.rootState.legacyOwnerId && Object.hasOwn(account.sessions, sessionId))) {
        throw failure('SESSION_UNAVAILABLE', 404);
      }
      const described = await context.callBackend(() => context.backend.describeSession(sessionId, context.rootState.legacyOwnerId));
      if (described?.sessionId !== sessionId || described.agentPreset === 'personal-shared-chat') {
        throw failure('SESSION_UNAVAILABLE', 404);
      }
      await context.serial(() => context.mutate(context.rootState.legacyOwnerId, (next) => {
        if (Object.entries(context.rootState.accounts).some(([ownerId, account]) =>
          ownerId !== context.rootState.legacyOwnerId && Object.hasOwn(account.sessions, sessionId))) {
          throw failure('SESSION_UNAVAILABLE', 404);
        }
        if (!Object.hasOwn(next.sessions, sessionId)) {
          next.sessions[sessionId] = { ownerId: next.ownerId, attachedAt: new Date().toISOString(), origin: 'local-attached' };
        }
      }));
      return { sessionId };
    }
  };
}
