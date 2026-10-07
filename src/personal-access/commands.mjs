import { digest, failure, id, modelTextWithAttachments, safeCode, withDeadline } from './common.mjs';
import { TEXT_ATTACHMENT_TYPES } from '../personal-sync/attachments.mjs';
import { DISPATCH_TIMEOUT_MS, ID, IMAGE_REASONS, MAX_COMMANDS } from './constants.mjs';
import { canonicalCommand, explicitNotepadOpenIntent, publicCommand } from './command-policy.mjs';
import { randomUUID } from 'node:crypto';

export function createCommandOperations(context) {
  function requestIdUsed(account, requestId) {
    return !!account.modelOperations?.[requestId] || !!account.projectOperations?.[requestId] ||
      Object.values(account.commands).some(command => command.requestId === requestId ||
        command.taskControl?.stopRequests.some(entry => entry.requestId === requestId) ||
        command.toolApprovals?.some(row => row.decisionRequestId === requestId) ||
        command.userQuestions?.some(row => row.answerRequestId === requestId));
  }

  async function dispatch(ownerId, commandId) {
    try {
      if (context.closing || context.storageFault) return;
      let snapshot;
      let callback;
      const pending = context.accountState(ownerId).commands[commandId];
      if (!pending || pending.state !== 'pending') return;
      const pendingSession = pending.kind === 'session.message'
        ? context.accountState(ownerId).sessions[pending.sessionId] : null;
      if (pending.toolSource) {
        let safePreset = false;
        try {
          const described = await context.callBackend(() => context.backend.describeSession(pending.toolSource.sessionId));
          safePreset = described?.sessionId === pending.toolSource.sessionId &&
            described.agentPreset === 'personal-remote';
        } catch { /* A tool task must not dispatch without live preset evidence. */ }
        if (!safePreset) {
          await context.serial(() => context.mutate(ownerId, (next) => {
            if (next.commands[commandId]?.state !== 'pending') return;
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'SESSION_READ_ONLY';
            next.commands[commandId].updatedAt = new Date().toISOString();
          }));
          return;
        }
      }
      if (pending.kind === 'desktop.open_app' && typeof context.backend.openDesktopApp !== 'function') {
        await context.serial(() => context.mutate(ownerId, (next) => {
          next.commands[commandId].state = 'rejected';
          next.commands[commandId].errorCode = 'CAPABILITY_UNAVAILABLE';
          next.commands[commandId].updatedAt = new Date().toISOString();
        }));
        return;
      }
      if (pending.kind === 'session.message' &&
          !context.messageModelUsable(ownerId, context.accountState(ownerId).sessions[pending.sessionId])) {
        await context.serial(() => context.mutate(ownerId, (next) => {
          if (next.commands[commandId]?.state !== 'pending') return;
          next.commands[commandId].state = 'rejected';
          next.commands[commandId].errorCode = 'MODEL_UNAVAILABLE';
          next.commands[commandId].updatedAt = new Date().toISOString();
        }));
        return;
      }
      if (pending.payload.conversationId) {
        const bound = context.accountState(ownerId).conversationBindings?.[pending.payload.conversationId];
        const selected = pending.kind === 'session.message'
          ? context.accountState(ownerId).sessions[pending.sessionId] : null;
        let modelMatches = context.modelVisible(ownerId, bound?.modelProfileId);
        if (modelMatches && selected) {
          try {
            const described = await context.callBackend(() => context.backend.describeSession(pending.sessionId, ownerId));
            modelMatches = described?.sessionId === pending.sessionId &&
              ['personal-remote', 'personal-shared-chat'].includes(described.agentPreset) &&
              described.modelProfileId === bound.modelProfileId &&
              selected.modelProfileId === bound.modelProfileId;
          } catch { modelMatches = false; }
        }
        if (!bound || !modelMatches || (selected && bound.status !== 'active')) {
          await context.serial(() => context.mutate(ownerId, (next) => {
            if (next.commands[commandId]?.state !== 'pending') return;
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'MODEL_UNAVAILABLE';
            next.commands[commandId].updatedAt = new Date().toISOString();
          }));
          return;
        }
      }
      if (pending.payload.projectId) {
        const project = context.accountState(ownerId).projects?.[pending.payload.projectId];
        const session = pending.kind === 'session.message'
          ? context.accountState(ownerId).sessions[pending.sessionId] : null;
        let modelMatches = true;
        if (session) {
          try {
            const described = await context.callBackend(() => context.backend.describeSession(pending.sessionId, ownerId));
            modelMatches = described?.sessionId === pending.sessionId &&
              described.agentPreset === 'personal-remote' &&
              described.modelProfileId === session.modelProfileId;
          } catch { modelMatches = false; }
        }
        if (!project || project.revoked || project.revision !== pending.payload.projectRevision ||
            !modelMatches) {
          await context.serial(() => context.mutate(ownerId, (next) => {
            if (next.commands[commandId]?.state !== 'pending') return;
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = !modelMatches ? 'PROJECT_MODEL_CHANGED' : 'PROJECT_REVOKED';
            next.commands[commandId].updatedAt = new Date(context.timestamp()).toISOString();
          }));
          return;
        }
      }
      if (pending.payload.workspaceKind === 'browser') {
        const session = pending.kind === 'session.message'
          ? context.accountState(ownerId).sessions[pending.sessionId] : null;
        let modelMatches = context.browserReader?.status()?.available === true;
        if (modelMatches && session) {
          try {
            const described = await context.callBackend(() => context.backend.describeSession(pending.sessionId, ownerId));
            modelMatches = described?.sessionId === pending.sessionId &&
              described.agentPreset === 'personal-remote' &&
              described.modelProfileId === session.modelProfileId;
          } catch { modelMatches = false; }
        }
        if (!modelMatches) {
          await context.serial(() => context.mutate(ownerId, (next) => {
            if (next.commands[commandId]?.state !== 'pending') return;
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'BROWSER_UNAVAILABLE';
            next.commands[commandId].updatedAt = new Date(context.timestamp()).toISOString();
          }));
          return;
        }
      }
      if ((context.accountState(ownerId).devices[pending.sourceDeviceId]?.authKind === 'cloud' &&
          context.cloudIdentity?.validSession(ownerId, pending.sourceDeviceId) !== true) ||
          context.accountState(ownerId).devices[pending.sourceDeviceId]?.revoked ||
          (pending.sourceAuthEpoch !== undefined &&
            context.accountState(ownerId).devices[pending.sourceDeviceId]?.authEpoch !== pending.sourceAuthEpoch) ||
          (['password', 'cloud'].includes(context.accountState(ownerId).devices[pending.sourceDeviceId]?.authKind) &&
            Date.parse(context.accountState(ownerId).devices[pending.sourceDeviceId].expiresAt) <= context.timestamp())) {
        await context.serial(() => context.mutate(ownerId, (next) => {
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
        await context.callBackend(() => context.backend.preflight({ ...pending.payload, ownerId }));
      } catch (error) {
        if (context.closing) return;
        await context.serial(async () => {
          if (context.accountState(ownerId).commands[commandId]?.state !== 'pending') return;
          await context.mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = safeCode(error);
            next.commands[commandId].updatedAt = new Date().toISOString();
          });
        });
        return;
      }
      if (context.closing || context.storageFault) return;
      await context.serial(async () => {
        if (context.storageFault) throw failure('STORAGE_UNAVAILABLE', 503);
        const command = context.accountState(ownerId).commands[commandId];
        if (!command || command.state !== 'pending') return;
        if (command.payload.projectId && (context.accountState(ownerId).projects?.[command.payload.projectId]?.revoked ||
            context.accountState(ownerId).projects?.[command.payload.projectId]?.revision !== command.payload.projectRevision)) {
          await context.mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'PROJECT_REVOKED';
            next.commands[commandId].updatedAt = new Date(context.timestamp()).toISOString();
          });
          return;
        }
        if (command.payload.workspaceKind === 'browser' && context.browserReader?.status()?.available !== true) {
          await context.mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'BROWSER_UNAVAILABLE';
            next.commands[commandId].updatedAt = new Date(context.timestamp()).toISOString();
          });
          return;
        }
        if (command.kind === 'session.create' &&
            !context.modelSelectable(ownerId, command.payload.modelProfileId)) {
          await context.mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'MODEL_UNAVAILABLE';
            next.commands[commandId].updatedAt = new Date(context.timestamp()).toISOString();
          });
          return;
        }
        if (command.kind === 'session.message') {
          const session = context.accountState(ownerId).sessions[command.sessionId];
          if (!session || session.ownerId !== ownerId || !pendingSession ||
              session.modelProfileId !== pendingSession.modelProfileId ||
              session.conversationId !== pendingSession.conversationId ||
              !context.messageModelUsable(ownerId, session)) {
            await context.mutate(ownerId, (next) => {
              next.commands[commandId].state = 'rejected';
              next.commands[commandId].errorCode = 'MODEL_UNAVAILABLE';
              next.commands[commandId].updatedAt = new Date(context.timestamp()).toISOString();
            });
            return;
          }
        }
        if (command.payload.conversationId) {
          const bound = context.accountState(ownerId).conversationBindings?.[command.payload.conversationId];
          const session = command.kind === 'session.message'
            ? context.accountState(ownerId).sessions[command.sessionId] : null;
          let actualMatches = true;
          if (session) {
            try {
              const described = await context.callBackend(() => context.backend.describeSession(command.sessionId, ownerId));
              actualMatches = described?.sessionId === command.sessionId &&
                ['personal-remote', 'personal-shared-chat'].includes(described.agentPreset) &&
                described.modelProfileId === bound?.modelProfileId;
            } catch { actualMatches = false; }
          }
          if (!bound || !context.modelVisible(ownerId, bound.modelProfileId) ||
              (session && (bound.status !== 'active' ||
                session.modelProfileId !== bound.modelProfileId || !actualMatches))) {
            await context.mutate(ownerId, (next) => {
              next.commands[commandId].state = 'rejected';
              next.commands[commandId].errorCode = 'MODEL_UNAVAILABLE';
              next.commands[commandId].updatedAt = new Date().toISOString();
            });
            return;
          }
        }
        if (command.toolSource) {
          const source = context.accountState(ownerId).commands[command.toolSource.sourceCommandId];
          const root = context.accountState(ownerId).commands[source?.rootTaskId ?? source?.commandId];
          if (!source || root?.taskControl?.state === 'stop_requested' || source.state !== 'accepted_by_dsh' ||
              source.dshTurn !== command.toolSource.turn ||
              context.accountState(ownerId).sessions[command.toolSource.sessionId]?.origin !== 'personal-remote') {
            await context.mutate(ownerId, (next) => {
              next.commands[commandId].state = 'rejected';
              next.commands[commandId].errorCode = 'TOOL_SOURCE_UNAVAILABLE';
              next.commands[commandId].updatedAt = new Date().toISOString();
            });
            return;
          }
        }
        if (command.rootTaskId && (context.accountState(ownerId).commands[command.rootTaskId]?.taskControl?.state === 'stop_requested' ||
            context.taskHasUnknownEffects(context.accountState(ownerId), command.rootTaskId))) {
          await context.mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = 'TASK_NOT_READY';
            next.commands[commandId].updatedAt = new Date().toISOString();
          });
          return;
        }
        if ((context.accountState(ownerId).devices[command.sourceDeviceId]?.authKind === 'cloud' &&
            context.cloudIdentity?.validSession(ownerId, command.sourceDeviceId) !== true) ||
            context.accountState(ownerId).devices[command.sourceDeviceId]?.revoked ||
            (command.sourceAuthEpoch !== undefined &&
              context.accountState(ownerId).devices[command.sourceDeviceId]?.authEpoch !== command.sourceAuthEpoch) ||
            (['password', 'cloud'].includes(context.accountState(ownerId).devices[command.sourceDeviceId]?.authKind) &&
              Date.parse(context.accountState(ownerId).devices[command.sourceDeviceId].expiresAt) <= context.timestamp())) {
          await context.mutate(ownerId, (next) => {
            next.commands[commandId].state = 'rejected';
            next.commands[commandId].errorCode = next.devices[command.sourceDeviceId]?.revoked
              ? 'DEVICE_REVOKED' : command.sourceAuthEpoch !== undefined &&
                next.devices[command.sourceDeviceId]?.authEpoch !== command.sourceAuthEpoch
                ? 'SESSION_REPLACED' : 'SESSION_EXPIRED';
            next.commands[commandId].updatedAt = new Date().toISOString();
          });
          return;
        }
        await context.mutate(ownerId, (next) => {
          next.commands[commandId].state = 'dispatching';
          next.commands[commandId].updatedAt = new Date().toISOString();
        });
        context.requireOpen();
        snapshot = structuredClone(context.accountState(ownerId).commands[commandId]);
        // The backend invocation starts before the serial boundary is released.
        // A concurrent revoke linearizes either before this point or afterward.
        try {
          if (snapshot.kind === 'session.create') callback = Promise.resolve(context.backend.createSession({
            sessionId: snapshot.sessionId, modelProfileId: snapshot.payload.modelProfileId, ownerId,
          }));
          else if (snapshot.kind === 'session.message') {
            const staged = snapshot.payload.attachments
              ? await context.sharedAttachmentStores.get(ownerId).resolve({ sessionId: snapshot.sessionId,
                requestId: snapshot.requestId, attachments: snapshot.payload.attachments }) : [];
            callback = Promise.resolve(context.backend.sendMessage({
              sessionId: snapshot.sessionId, text: modelTextWithAttachments(snapshot.payload.text, staged,
                snapshot.payload.originalAttachments), mode: snapshot.payload.mode, ownerId,
              attachments: staged.filter((item) => !TEXT_ATTACHMENT_TYPES.has(item.contentType))
                .map((item) => ({ name: item.name, contentType: item.contentType,
                data: item.bytes.toString('base64') })),
            }));
          }
          else if (snapshot.kind === 'session.cancel') callback = Promise.resolve(context.backend.cancelSession({ sessionId: snapshot.sessionId, ownerId }));
          else callback = Promise.resolve(context.backend.openDesktopApp({ appId: snapshot.appId, commandId, ownerId }));
        } catch (error) {
          callback = Promise.reject(error);
        }
      });
      if (!snapshot) return;
      let result;
      try { result = await withDeadline(() => callback, DISPATCH_TIMEOUT_MS); }
      catch (error) {
        if (context.closing) return;
        await context.serial(() => context.mutate(ownerId, (next) => {
          if (next.commands[commandId].state === 'dispatching') {
            next.commands[commandId].state = 'uncertain';
            next.commands[commandId].errorCode = error?.code === 'BACKEND_TIMEOUT' ? 'RECEIPT_TIMEOUT' : safeCode(error);
            next.commands[commandId].updatedAt = new Date().toISOString();
          }
        }));
        return;
      }
      if (context.closing) return;
      await context.serial(() => context.mutate(ownerId, (next) => {
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
              approvalMode: next.defaultApprovalMode ?? 'auto',
              origin: !['password', 'cloud'].includes(next.devices[snapshot.sourceDeviceId]?.authKind)
                ? 'legacy-local' : context.hostOwner(ownerId) ? 'personal-remote' : 'shared-chat',
              modelProfileId: snapshot.payload.modelProfileId,
              ...(snapshot.payload.conversationId ? { conversationId: snapshot.payload.conversationId } : {}),
              ...(snapshot.payload.workspaceKind ? { workspaceKind: snapshot.payload.workspaceKind } : {}),
              ...(snapshot.payload.projectId ? { projectId: snapshot.payload.projectId,
                projectRevision: snapshot.payload.projectRevision } : {}) };
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
          context.accountState(ownerId).commands[commandId]?.state === 'accepted_by_dsh') {
        await context.sharedAttachmentStores.get(ownerId).release({ sessionId: snapshot.sessionId,
          requestId: snapshot.requestId, attachments: snapshot.payload.attachments });
      }
      if (snapshot.kind === 'session.message') {
        const taskId = snapshot.rootTaskId ?? snapshot.commandId;
        if (context.accountState(ownerId).commands[taskId]?.taskControl?.state === 'stop_requested') {
          await context.driveTaskStop(ownerId, taskId, true);
        }
      }
    } catch {
      // A failed store write leaves dispatching on disk. Recovery marks it
      // uncertain. Do not issue another backend call or claim success.
    }
  }

  function schedule(ownerId, commandId) {
    const key = `${ownerId}|${commandId}`;
    if (context.scheduled.has(key) || context.closing) return;
    context.scheduled.add(key);
    const work = Promise.resolve().then(() => dispatch(ownerId, commandId)).finally(() => {
      context.scheduled.delete(key);
      context.active.delete(work);
      context.activeByCommand.delete(key);
    });
    context.active.add(work);
    context.activeByCommand.set(key, work);
  }

  return {
    requestIdUsed,
    dispatch,
    schedule,
    hasUnissuedDshCommands() {
      return Object.values(context.rootState.accounts).some((account) =>
        Object.values(account.commands).some((command) =>
          ['pending', 'dispatching'].includes(command.state)));
    },
    /** Main-process only: a DSH tool call from an owner-bound restricted turn. */
    async submitToolDesktop({ sessionId, turn, callId, messageHash, appId }) {
      const ownerId = context.rootState.legacyOwnerId;
      const state = context.accountState(ownerId);
      id(sessionId);
      if (!Number.isSafeInteger(turn) || turn < 0 || typeof callId !== 'string' ||
          !/^[A-Za-z0-9._:-]{1,160}$/.test(callId) ||
          typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash) || appId !== 'notepad') {
        throw failure('INVALID_COMMAND');
      }
      if (!Object.hasOwn(state.sessions, sessionId) || state.sessions[sessionId].origin !== 'personal-remote') {
        throw failure('SESSION_READ_ONLY', 409);
      }
      const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
      if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote') {
        throw failure('SESSION_READ_ONLY', 409);
      }
      const requestId = `tool-${digest(`${state.ownerId}|${sessionId}|${turn}|${callId}`).slice(0, 48)}`;
      const payload = canonicalCommand({ requestId, kind: 'desktop.open_app',
        targetDeviceId: state.hostId, appId }, state.hostId);
      if (typeof context.backend.openDesktopApp !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
      await context.callBackend(() => context.backend.preflight({ ...payload, ownerId }));
      const sourceCandidates = () => Object.values(context.accountState(ownerId).commands).filter((item) =>
        item.kind === 'session.message' && item.sessionId === sessionId &&
        typeof item.payload.text === 'string' && digest(item.payload.text) === messageHash);
      if (!sourceCandidates().length) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      for (let attempt = 0; attempt < 20 && sourceCandidates().some((item) => item.state === 'dispatching'); attempt++) {
        if (context.closing) throw failure('SERVICE_CLOSING', 503);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const commandId = await context.serial(() => context.mutate(ownerId, (next) => {
        const existing = Object.values(next.commands).find((item) => item.requestId === requestId);
        if (existing) return existing.commandId;
        if (requestIdUsed(next, requestId)) throw failure('REQUEST_CONFLICT', 409);
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
          return ['password', 'cloud'].includes(device?.authKind) && !device.revoked &&
            device.authEpoch === item.sourceAuthEpoch && Date.parse(device.expiresAt) > context.timestamp();
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
        const now = new Date(context.timestamp()).toISOString();
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
      const work = context.activeByCommand.get(`${ownerId}|${commandId}`);
      if (work) {
        let timer;
        try { await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, 6_000); })]); }
        finally { clearTimeout(timer); }
      }
      return publicCommand(context.accountState(ownerId).commands[commandId]);
    }
  };
}
