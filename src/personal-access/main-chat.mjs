import { randomUUID } from 'node:crypto';
import { canonicalCommand, publicCommand } from './command-policy.mjs';
import { digest, failure, modelTextWithAttachments, safeCode } from './common.mjs';
import { MAX_COMMANDS, MAX_UNRECONCILED_TEXT_BYTES } from './constants.mjs';
import { scheduledCommandSource } from './schedules-authorization.mjs';

/** Only coordinates native lifecycle. Durable commands, receipts and dispatch
 * continue to belong to the existing command queue. */
export function createMainChat(context) {
  const flights = new Map();
  const chat = owner => context.accountState(owner).chatIdentity.chats[context.accountState(owner).chatIdentity.mainChatId];
  const active = owner => context.accountState(owner).chatIdentity.segments[chat(owner).activeSegmentId];
  const blocked = (account, sessionId) => Object.values(account.commands).some(command => command.sessionId === sessionId &&
    (['pending','preflight','dispatching','uncertain'].includes(command.state) ||
     command.kind === 'session.message' && !command.rootTaskId && context.taskHasUnknownEffects?.(account, command.commandId) ||
     command.toolApprovals?.some(row => ['pending','answered'].includes(row.status) && row.deliveryState !== 'accepted') ||
     command.userQuestions?.some(row => ['pending','answered'].includes(row.status) && row.deliveryState !== 'accepted') ||
     command.toolExecutions?.some(row => row.jobId && !['completed','failed','killed'].includes(row.jobState))));
  return {
    async drain(ownerId) { await flights.get(ownerId); },
    async submit(ownerId, deviceId, body, authorize) {
      const payload = canonicalCommand(body, context.accountState(ownerId).hostId), hash = digest(JSON.stringify(payload));
      return context.serial(async () => {
        const auth = authorize(), account = context.accountState(ownerId);
        if (auth.ownerId !== ownerId || auth.deviceId !== deviceId || !context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
        if (payload.chatId !== chat(ownerId).chatId) throw failure('CHAT_UNAVAILABLE', 404);
        const previous = Object.values(account.commands).find(row => row.requestId === payload.requestId);
        if (previous) {
          if ((previous.payload.chatRequestHash ?? previous.payloadHash) !== hash) throw failure('REQUEST_CONFLICT', 409);
          return publicCommand(previous);
        }
        if (context.requestIdUsed(account, payload.requestId)) throw failure('REQUEST_CONFLICT', 409);
        if (account.memoryCleanupPending) throw failure('SESSION_BUSY', 409);
        const current = active(ownerId), profile = account.sessions[current?.sessionId]?.modelProfileId ?? payload.modelProfileId;
        if (!profile || !context.modelSelectable(ownerId, profile)) throw failure('MODEL_UNAVAILABLE', 422);
        if (payload.modelProfileId && profile !== payload.modelProfileId) throw failure('REQUEST_CONFLICT', 409);
        const model = (await context.backend.listModels({ ownerId })).find(row => row.id === profile);
        if (model) context.usage.assertAllowed(ownerId, model);
        if (payload.attachments || payload.originalAttachments) {
          const sourceId = payload.attachmentSessionId ?? chat(ownerId).attachmentSessionId;
          const source = account.chatIdentity.segments[account.chatIdentity.sessionSegments[sourceId]];
          if (source?.chatId !== payload.chatId && sourceId !== chat(ownerId).attachmentSessionId) throw failure('SESSION_UNAVAILABLE', 404);
          if (payload.attachments) await context.sharedAttachmentStores.get(ownerId).resolve({ sessionId: sourceId, requestId: payload.requestId, attachments: payload.attachments });
          if (payload.originalAttachments) await context.requireOriginalAttachments(ownerId, sourceId, payload.attachmentMessageId, payload.originalAttachments);
        }
        const commands = Object.values(account.commands);
        if (commands.length >= MAX_COMMANDS || commands.reduce((n,c) => n + Buffer.byteLength(c.payload.text ?? ''), 0) + Buffer.byteLength(payload.text) > MAX_UNRECONCILED_TEXT_BYTES) throw failure('CAPACITY_LIMIT', 429);
        const commandId = `cmd-${randomUUID()}`, now = new Date(context.timestamp()).toISOString();
        await context.mutate(ownerId, next => { next.commands[commandId] = { commandId, ownerId, requestId: payload.requestId,
          kind: 'chat.message', payload, payloadHash: hash, sourceDeviceId: deviceId, sourceAuthEpoch: next.devices[deviceId].authEpoch,
          targetDeviceId: payload.targetDeviceId, state: 'pending', createdAt: now, updatedAt: now }; });
        context.schedule(ownerId, commandId);
        return publicCommand(context.accountState(ownerId).commands[commandId]);
      });
    },
    async bind(ownerId, commandId) {
      const work = (async () => {
      let command = context.accountState(ownerId).commands[commandId];
      if (command?.kind !== 'chat.message' || command.state !== 'pending' || context.accountState(ownerId).memoryCleanupPending) return;
      const request = command.payload, initialRevision = chat(ownerId).contentRevision;
      try {
        const account = context.accountState(ownerId), device = account.devices[command.sourceDeviceId];
        if (!device || device.revoked || device.authEpoch !== command.sourceAuthEpoch ||
            !scheduledCommandSource(account, command) && Date.parse(device.expiresAt) <= context.timestamp() || device.authKind === 'cloud' && context.cloudIdentity?.validSession(ownerId, command.sourceDeviceId) !== true) throw failure('DEVICE_REVOKED', 409);
        let segment = active(ownerId), relay = chat(ownerId).relay;
        const stopsReady = !segment || (await Promise.all(Object.values(context.accountState(ownerId).commands)
          .filter(row => row.sessionId === segment.sessionId && row.taskControl?.state === 'stop_requested')
          .map(row => context.taskStopEvidence(context.accountState(ownerId), row.commandId)))).every(row => row.ready);
        if (segment && !relay && stopsReady && !blocked(context.accountState(ownerId), segment.sessionId)) {
          const status = await context.callBackend(() => context.backend.chatRelayState({ sessionId: segment.sessionId, ownerId }));
          if (status.pending) await context.serial(() => context.mutate(ownerId, next => { next.chatIdentity.chats[request.chatId].relayPending = true; }));
          if (status.safe && chat(ownerId).relayPending) relay = { sourceSessionId: segment.sessionId };
        }
        if (!segment || relay) {
          if (!chat(ownerId).relay) await context.serial(() => context.mutate(ownerId, next => {
            next.chatIdentity.chats[request.chatId].relay = { phase: 'preparing', sessionId: `session-${randomUUID()}`, segmentId: `segment-${randomUUID()}`,
              modelProfileId: segment ? next.sessions[segment.sessionId].modelProfileId : request.modelProfileId,
              ...(segment ? { sourceSessionId: segment.sessionId } : {}) };
          }));
          relay = structuredClone(chat(ownerId).relay);
          if (relay.sourceSessionId && !relay.handoff) {
            try {
              const handoff = await context.callBackend(() => context.backend.prepareChatHandoff({ sessionId: relay.sourceSessionId, ownerId }));
              await context.serial(() => context.mutate(ownerId, next => {
                if (next.memoryCleanupPending || next.chatIdentity.chats[request.chatId].contentRevision !== initialRevision) throw failure('SESSION_BUSY', 409);
                next.chatIdentity.chats[request.chatId].relay.handoff = handoff;
              }));
              relay.handoff = handoff;
            } catch (error) {
              // Failed summary leaves the old segment writable. No phantom
              // segment or silent repeated summary attempt inside one send.
              await context.serial(() => context.mutate(ownerId, next => { const row = next.chatIdentity.chats[request.chatId]; delete row.relay; row.relayError = safeCode(error); }));
              relay = null;
            }
          }
          if (relay) {
            if (context.accountState(ownerId).memoryCleanupPending || chat(ownerId).contentRevision !== initialRevision) throw failure('SESSION_BUSY', 409);
            await context.callBackend(() => context.backend.createSession({ ownerId, sessionId: relay.sessionId,
              modelProfileId: relay.modelProfileId, workspaceChatId: request.chatId, title: 'WeftMate' }));
            if (relay.handoff) await context.callBackend(() => context.backend.installChatHandoff({ ownerId, sessionId: relay.sessionId, handoff: relay.handoff }));
            await context.serial(() => context.mutate(ownerId, next => {
              const row = next.chatIdentity.chats[request.chatId];
              if (next.memoryCleanupPending || row.contentRevision !== initialRevision || row.relay?.sessionId !== relay.sessionId) throw failure('SESSION_BUSY', 409);
              const previous = next.chatIdentity.segments[row.activeSegmentId];
              const now = new Date(context.timestamp()).toISOString();
              next.sessions[relay.sessionId] = { ownerId, origin: 'personal-remote', attachedAt: now, modelProfileId: relay.modelProfileId,
                approvalMode: previous ? next.sessions[previous.sessionId].approvalMode : next.defaultApprovalMode ?? 'auto', workspaceChatId: request.chatId,
                ...(previous && next.sessions[previous.sessionId].allowedApprovalCategories ? { allowedApprovalCategories: structuredClone(next.sessions[previous.sessionId].allowedApprovalCategories) } : {}) };
              next.chatIdentity.segments[relay.segmentId] = { segmentId: relay.segmentId, chatId: request.chatId, sessionId: relay.sessionId,
                hostId: next.hostId, ordinal: previous ? previous.ordinal + 1 : 0, state: 'active', startedAt: now,
                ...(relay.handoff ? { handoffSourceRefs: relay.handoff.sourceRefs } : {}) };
              next.chatIdentity.sessionSegments[relay.sessionId] = relay.segmentId;
              if (previous) { previous.state = 'sealed'; previous.sealedAt = now; }
              row.activeSegmentId = relay.segmentId; row.revision++; delete row.relay; delete row.relayError; delete row.relayPending;
            }));
          }
          segment = active(ownerId);
        }
        if (!segment) throw failure('SESSION_UNAVAILABLE', 503);
        const { chatId, modelProfileId, ...raw } = request;
        let payload = canonicalCommand({ ...raw, kind: 'session.message', sessionId: segment.sessionId, chatId,
          ...(request.attachments || request.originalAttachments ? { attachmentSessionId: request.attachmentSessionId ?? chat(ownerId).attachmentSessionId } : {}),
          chatRequestHash: command.payloadHash }, context.accountState(ownerId).hostId, true);
        if (payload.attachments || payload.originalAttachments) {
          const attachments = payload.attachments ? await context.sharedAttachmentStores.get(ownerId).resolve({ sessionId: payload.attachmentSessionId,
            requestId: payload.requestId, attachments: payload.attachments }) : [];
          payload = canonicalCommand({ ...payload, modelInputHash: digest(modelTextWithAttachments(payload.text, attachments, payload.originalAttachments)) }, context.accountState(ownerId).hostId, true);
        }
        await context.callBackend(() => context.backend.preflight({ ...payload, ownerId }));
        await context.serial(() => context.mutate(ownerId, next => {
          if (next.memoryCleanupPending || next.chatIdentity.chats[chatId].contentRevision !== initialRevision) throw failure('SESSION_BUSY', 409);
          Object.assign(next.commands[commandId], { kind: 'session.message', sessionId: segment.sessionId, payload, payloadHash: digest(JSON.stringify(payload)) });
        }));
      } catch (error) {
        await context.serial(() => context.mutate(ownerId, next => { const row = next.commands[commandId];
          if (row?.kind === 'chat.message') { row.state = 'rejected'; row.errorCode = safeCode(error); } }));
      }
      })();
      flights.set(ownerId, work);
      try { await work; } finally { if (flights.get(ownerId) === work) flights.delete(ownerId); }
    },
  };
}
