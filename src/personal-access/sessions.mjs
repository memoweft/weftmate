import { digest, failure, id, plainObject, validId } from './common.mjs';
import { CONVERSATION_ID, IMAGE_CONTENT_TYPES } from './constants.mjs';
import { uniqueSessionOwner } from './store.mjs';
import { validConversationContext } from '../personal-conversations/context.mjs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createSessionMetadata } from './session-metadata.mjs';
import { protectMainSession } from './chat-identity.mjs';
import { eraseChatCopies } from './chat-erasure.mjs';

export function createSessionOperations(context) {
  const deletions = new Set();
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
    // DSH's native Inbox excludes all constructor seed events. An anchor fork
    // may contain the old insertion before its claim; it is historical input,
    // never a pending task of the child. Match that native seed boundary in UI.
    if (event.type === 'task.queued' && Object.values(context.accountState(ownerId).messageBranches ?? {}).some(operation =>
        operation.response.sessionId === sessionId && event.seq <= operation.response.seedThroughSeq))
      return { ...event, data: { ...publicData, inherited: true } };
    if (event.type.startsWith('task.')) {
      const bind = data => {
        const source = Object.values(context.accountState(ownerId).commands).find(command =>
          command.kind === 'session.message' && command.sessionId === sessionId &&
          command.receiptId === data.receiptId);
        return source ? { ...data, taskId: source.rootTaskId ?? source.commandId,
          commandId: source.commandId, requestId: source.requestId,
          ...(event.type === 'task.queued' ? { text: source.payload.text } : {}),
          ...(data.turn !== undefined ? { turnTaskId: `turn-${data.turn}` } : {}) } : data;
      };
      return { ...event, data: { ...bind(publicData),
        ...(publicData.tasks ? { tasks: publicData.tasks.map(bind) } : {}) } };
    }
    if (event.type !== 'user.message') return { ...event, data: publicData };
    if (typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash) ||
        typeof publicData.receiptId !== 'string') return { ...event, data: publicData };
    const account = context.accountState(ownerId), ancestry = new Set();
    // A native fork replays its parent's input receipts. Restore only an
    // owner-bound ancestor's exact input, still verified by the native hash.
    for (let sourceId = sessionId; sourceId && account.sessions[sourceId] && !ancestry.has(sourceId);
        sourceId = account.sessions[sourceId].parentSessionId) ancestry.add(sourceId);
    const matching = Object.values(context.accountState(ownerId).commands).filter((command) =>
      command.kind === 'session.message' &&
      ancestry.has(command.sessionId) && command.state === 'accepted_by_dsh' &&
      command.receiptId === publicData.receiptId && typeof command.payload?.text === 'string' &&
      (command.payload.modelInputHash ?? digest(command.payload.text)) === messageHash);
    if (matching.length !== 1) return { ...event, data: publicData };
    const source = matching[0];
    const stagedIds = new Set((source.payload.attachments ?? []).map((item) => item.attachmentId));
    const unpreviewedOriginalImageIds = (source.payload.originalAttachments ?? [])
      .filter((item) => IMAGE_CONTENT_TYPES.has(item.contentType) && !stagedIds.has(item.attachmentId))
      .map((item) => item.attachmentId);
    return { ...event, data: {
      ...publicData, text: source.payload.text,
      ...(source.payload.originalAttachments ? { originalAttachments: source.payload.originalAttachments.map((item) => ({ ...item })),
        attachmentMessageId: source.payload.attachmentMessageId } : {}),
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
    ...createSessionMetadata(context),
    async archiveSession(ownerId, sessionId, archived) {
      id(sessionId);
      protectMainSession(context.accountState(ownerId), sessionId);
      await context.serial(() => context.mutate(ownerId, next => {
        if (!next.sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
        if (next.sessions[sessionId].deleting) throw failure('SESSION_BUSY', 409);
        next.sessions[sessionId].archived = archived;
      }));
      return { sessionId, archived };
    },
    async previewSessionForget(ownerId, sessionId) {
      id(sessionId);
      if (!context.accountState(ownerId).sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
      const result = await context.memoryManager?.query(ownerId, 'preview_forget', { conversation_id: sessionId });
      const { forgetPreviewView } = await import('../personal-memory/http.mjs');
      return forgetPreviewView(result);
    },
    async deleteSession(ownerId, sessionId, { forgetMemories = false, deleteConversationSnippets = false, memoryWorldRevision } = {}) {
      id(sessionId);
      protectMainSession(context.accountState(ownerId), sessionId);
      const key = `${ownerId}\0${sessionId}`;
      if (deletions.has(key)) throw failure('SESSION_BUSY', 409);
      deletions.add(key);
      try { await context.serial(async () => {
        const account = context.accountState(ownerId), session = account.sessions[sessionId];
        if (!session) throw failure('SESSION_UNAVAILABLE', 404);
        if (Object.values(account.commands).some(command => command.sessionId === sessionId &&
            ['pending', 'preflight', 'dispatching', 'uncertain'].includes(command.state)))
          throw failure('SESSION_BUSY', 409);
        if (typeof context.backend.deleteSession !== 'function') throw failure('BACKEND_UNAVAILABLE', 503);
        await context.mutate(ownerId, next => { next.sessions[sessionId].deleting = true; });
      }); } catch (error) { deletions.delete(key); throw error; }
      try {
        const account = context.accountState(ownerId);
        const backgroundReceipts = [...new Set(Object.values(account.commands).filter(command =>
          command.sessionId === sessionId && command.receiptId && command.toolExecutions?.some(row =>
            row.jobId && !['completed', 'failed', 'killed'].includes(row.jobState))).map(command => command.receiptId))];
        for (let offset = 0; offset < backgroundReceipts.length; offset += 16) {
          if (typeof context.backend.stopTask !== 'function') throw failure('SESSION_BUSY', 409);
          const receiptIds = backgroundReceipts.slice(offset, offset + 16);
          const result = await context.callBackend(() => context.backend.stopTask({ ownerId, sessionId,
            requestId: `delete-${sessionId}-${offset}`, receiptIds }));
          if (!Array.isArray(result?.outcomes) || result.outcomes.length !== receiptIds.length ||
              result.outcomes.some(outcome => outcome.status === 'unconfirmed' ||
              outcome.backgroundJobs?.some(job => !['completed', 'failed', 'killed'].includes(job.state))))
            throw failure('SESSION_BUSY', 409);
          const observedJobs = new Map(result.outcomes.flatMap(outcome => outcome.backgroundJobs ?? [])
            .map(job => [job.jobId, job.state]));
          if (Object.values(context.accountState(ownerId).commands).some(command => command.sessionId === sessionId &&
              receiptIds.includes(command.receiptId) && command.toolExecutions?.some(row => row.jobId &&
                !['completed', 'failed', 'killed'].includes(row.jobState) &&
                !['completed', 'failed', 'killed'].includes(observedJobs.get(row.jobId)))))
            throw failure('SESSION_BUSY', 409);
        }
        let described;
        try { described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId)); }
        catch (error) { if (error.code !== 'SESSION_UNAVAILABLE') throw error; described = { running: false }; }
        if (described.running) {
          await context.callBackend(() => context.backend.cancelSession({ sessionId, ownerId }));
          const deadline = Date.now() + 10000;
          do {
            await new Promise(resolve => setTimeout(resolve, 100));
            described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
          } while (described.running && Date.now() < deadline);
          if (described.running) throw failure('SESSION_BUSY', 409);
        }
        let forgottenEvidenceCount = 0;
        if (forgetMemories) {
          await context.memoryManager?.discardPendingSources?.(ownerId, { sessionId });
          const manager = context.memoryManager;
          const status = await manager?.status(ownerId);
          if (!status?.capabilities?.deleteEvidence) throw failure('MEMORY_DELETE_UNAVAILABLE', 503);
          if (status.pendingBoundaryCount > 0 || status.blockedBoundaryCount > 0) throw failure('SESSION_BUSY', 409);
          const preview = memoryWorldRevision !== undefined || deleteConversationSnippets
            ? await manager.query(ownerId, 'preview_forget', { conversation_id: sessionId }) : null;
          if (memoryWorldRevision !== undefined && preview.world_revision !== memoryWorldRevision)
            throw failure('MEMORY_REVISION_CHANGED', 409);
          const jobs = await manager.query(ownerId, 'query_jobs', { operation: 'list' });
          const evidenceIds = new Set([...(preview?.evidence_ids ?? []), ...(account.sessions[sessionId].forgetEvidenceIds ?? []), ...(jobs.jobs ?? []).filter(job =>
            job.acceptance?.parent_session_id === sessionId || job.acceptance?.result_session_id === sessionId)
            .flatMap(job => job.acceptance.evidence_ids ?? [])]);
          // Core removes the source job during erasure. Keep identifiers only
          // until deletion completes so a crash/pending cleanup can still retry.
          await context.serial(() => context.mutate(ownerId, next => {
            next.sessions[sessionId].forgetEvidenceIds = [...evidenceIds];
          }));
          let confirmedRevision = memoryWorldRevision;
          for (const evidenceId of evidenceIds) {
            const requestId = `session-delete-${digest(`${sessionId}\0${evidenceId}`).slice(0, 48)}`;
            let result;
            if (manager.receiptByRequest) {
              try { result = await manager.receiptByRequest(ownerId, requestId); }
              catch (error) { if (error.code !== 'command_receipt_not_found') throw error; }
            }
            if (!result) {
              const revision = await manager.query(ownerId, 'query_world', { operation: 'revision' });
              if (confirmedRevision !== undefined && revision.world_revision !== confirmedRevision)
                throw failure('MEMORY_REVISION_CHANGED', 409);
              result = await manager.submitCommand(ownerId, { requestId,
                expectedWorldRevision: revision.world_revision, operation: 'delete_evidence',
                targetKind: 'evidence', targetId: evidenceId,
                payload: deleteConversationSnippets ? { delete_conversation_snippets: true } : {}, deleteConversationSnippets });
            }
            if ((result.receipt ?? result).storage_cleanup?.state === 'pending' && manager.retryCleanupByRequest)
              result = await manager.retryCleanupByRequest(ownerId, requestId);
            const receipt = result.receipt ?? result;
            if (!['applied', 'no_change'].includes(receipt.result_state) || receipt.storage_cleanup?.state === 'pending')
              throw failure('MEMORY_DELETE_CONFLICT', 409);
            if (confirmedRevision !== undefined) confirmedRevision = receipt.after_revision;
            forgottenEvidenceCount++;
          }
          if (manager.eraseConversationContext) {
            const erased = await manager.eraseConversationContext(ownerId, sessionId);
            forgottenEvidenceCount += erased.erased_evidence_count ?? 0;
            if (!['applied', 'no_change'].includes(erased.result_state) || erased.storage_cleanup?.state !== 'complete')
              throw failure('MEMORY_DELETE_CONFLICT', 409);
          }
        }
        if (context.backend.schedules) await context.backend.schedules({ sessionId, ownerId, action: 'erase' });
        if (context.backend.goals) await context.backend.goals({ sessionId, ownerId, action: 'erase' });
        await context.callBackend(() => context.backend.deleteSession({ sessionId, ownerId }));
        await context.offline?.invalidate(ownerId);
        await context.sharedAttachmentStores?.get(ownerId)?.removeSession(sessionId);
        await context.attachmentStores?.get(ownerId)?.removeConversation(sessionId);
        const commands = Object.values(account.commands).filter(command => command.sessionId === sessionId);
        for (const command of commands) {
          if (command.taskId || command.rootTaskId || command.kind === 'session.message')
            await rm(path.join(context.root, 'artifacts', ownerId, command.taskId ?? command.rootTaskId ?? command.commandId), { recursive: true, force: true });
        }
        await context.serial(() => context.mutate(ownerId, next => {
          for (const chatId of eraseChatCopies(next, { sessionId })) context.chatTimeline?.invalidate(ownerId, chatId);
          delete next.sessions[sessionId];
          for (const field of ['commands', 'toolApprovals', 'userQuestions', 'projectSources', 'browserSources', 'conversationBindings'])
            for (const [key, value] of Object.entries(next[field] ?? {}))
              if (value.sessionId === sessionId) delete next[field][key];
        }));
        return { sessionId, deleted: true, forgetMemories, forgottenEvidenceCount };
      } catch (error) {
        await context.serial(() => context.mutate(ownerId, next => {
          if (next.sessions[sessionId]) delete next.sessions[sessionId].deleting;
        }));
        throw error;
      } finally { deletions.delete(key); }
    },
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
    executionOwnerForSession(sessionId) {
      id(sessionId);
      const ownerId = uniqueSessionOwner(context.rootState.accounts, sessionId)?.ownerId;
      if (!ownerId || !context.hostOwner(ownerId) ||
          context.accountState(ownerId).sessions[sessionId]?.origin !== 'personal-remote')
        throw failure('SESSION_READ_ONLY', 409);
      return ownerId;
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
