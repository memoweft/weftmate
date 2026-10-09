import { scheduledCommandSource } from './schedules-authorization.mjs';
import { readSourceEvents } from './source-history.mjs';
import { exactKeys, failure, validId, withDeadline } from './common.mjs';
import { sourceMessageHash } from './command-policy.mjs';
import { approvalCategories } from '../plugins/personal-approval-policy.mjs';
import { redactProjectPath } from '../personal-projects/projects.mjs';
import {
  approvalDecisionReceipt,
  invalidateToolApproval,
  invalidateUserQuestion,
  publicToolApproval,
  toolApprovals
} from './interaction-policy.mjs';
import {
  APPROVAL_DECISIONS,
  APPROVAL_OUTCOMES,
  GENERAL_TOOL_NAME,
  MAX_COMMAND_TOOL_APPROVALS,
  MAX_TOOL_APPROVALS,
  REQUEST_ID,
  TOOL_RUNTIME_ID
} from './constants.mjs';

export function createApprovalOperations(context) {
  function requireToolRuntime(runtimeId) {
    context.requireOpen();
    if (runtimeId !== undefined && context.closedToolRuntimeIds.has(runtimeId)) {
      throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    }
  }

  function personalExecutionSource(account, { sessionId, turn, receiptId, messageHash }, activeSource = false) {
    if (account.sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
    const candidates = Object.values(account.commands).filter(command => command.kind === 'session.message' &&
      command.sessionId === sessionId && command.receiptId === receiptId && command.state === 'accepted_by_dsh');
    if (candidates.length !== 1) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    const source = candidates[0], root = account.commands[source.rootTaskId ?? source.commandId];
    if (sourceMessageHash(source) !== messageHash || source.dshTurn !== undefined && source.dshTurn !== turn ||
        !root || root.kind !== 'session.message' || root.rootTaskId !== undefined || root.sessionId !== sessionId) {
      throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    }
    if (activeSource) {
      const device = account.devices[source.sourceDeviceId];
      if (!device || !['password', 'cloud'].includes(device.authKind) || device.revoked || !Number.isSafeInteger(source.sourceAuthEpoch) ||
          device.authEpoch !== source.sourceAuthEpoch || !scheduledCommandSource(account, source) && Date.parse(device.expiresAt) <= context.timestamp()) {
        throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      }
      if (!context.messageModelUsable(account.ownerId, account.sessions[sessionId], account)) throw failure('MODEL_UNAVAILABLE', 409);
      if (root.taskControl?.state === 'stop_requested' || context.taskHasUnknownEffects(account, root.commandId)) {
        throw failure('TASK_NOT_READY', 409);
      }
    }
    return { source, root };
  }

  function approvalMatches(row, input, source) {
    return row.sourceCommandId === source.commandId && row.sourceReceiptId === input.receiptId &&
      ['sessionId', 'turn', 'callId', 'rootCallId', 'toolName', 'messageHash', 'argumentsHash', 'runtimeId']
        .every(key => row[key] === input[key]);
  }

  function approvalUnavailableReason(account, row) {
    if (row.status === 'pending' && context.timestamp() - Date.parse(row.createdAt) >= 600_000) return 'approval_timeout';
    if (context.closedToolRuntimeIds.has(row.runtimeId)) return 'runtime_unavailable';
    try { personalExecutionSource(account, { ...row, receiptId: row.sourceReceiptId }, true); }
    catch (error) {
      return error.code === 'TASK_NOT_READY' && account.commands[row.taskId]?.taskControl?.state === 'stop_requested' ? 'task_stopped'
        : error.code === 'MODEL_UNAVAILABLE' ? 'model_unavailable' : 'source_unavailable';
    }
    return null;
  }

  async function liveToolApprovalSource(ownerId, row, fresh = false) {
    const inspect = async () => {
      if (typeof context.backend.readSourceEvents !== 'function' && typeof context.backend.getTaskReplyEvidence === 'function') {
        const evidence = await withDeadline(() => {
          context.requireOpen();
          return context.backend.getTaskReplyEvidence({ sessionId: row.sessionId, ownerId,
            rootTaskId: row.taskId, receiptId: row.sourceReceiptId, turn: row.turn });
        }, 2_500);
        return evidence?.turn === row.turn && ['waiting', 'streaming'].includes(evidence.status);
      }
      const deadline = context.timestamp() + 2_500;
      const live = await readSourceEvents(context, { ownerId, sessionId: row.sessionId,
        turn: row.turn, receiptId: row.sourceReceiptId }, work => {
          const remaining = deadline - context.timestamp();
          if (remaining <= 0) throw failure('BACKEND_TIMEOUT', 503);
          return withDeadline(() => { context.requireOpen(); return work(); }, remaining);
        });
      const starts = live.events.filter(event => event.type === 'turn.started');
      const receipts = live.events.filter(event => event.type === 'user.message' && event.data?.receiptId === row.sourceReceiptId);
      return live.current === true && starts.length === 1 && starts[0].data?.turn === row.turn &&
        !live.events.some(event => event.type === 'turn.ended') && receipts.length === 1 &&
        receipts[0].data?.messageHash === row.messageHash;
    };
    // The production callback reads current-child evidence; coalesce normal polling, never user answers.
    const key = `${ownerId}|${row.sessionId}|${row.runtimeId}|${row.sourceReceiptId}`;
    const now = context.timestamp(), prior = context.approvalLivenessChecks.get(key);
    if (!fresh && prior?.expiresAt > now) return prior.work;
    for (const [entryKey, entry] of context.approvalLivenessChecks) if (entry.expiresAt <= now) context.approvalLivenessChecks.delete(entryKey);
    if (context.approvalLivenessChecks.size >= 256) context.approvalLivenessChecks.delete(context.approvalLivenessChecks.keys().next().value);
    const work = inspect();
    context.approvalLivenessChecks.set(key, { work, expiresAt: now + 500 });
    work.catch(() => { if (context.approvalLivenessChecks.get(key)?.work === work) context.approvalLivenessChecks.delete(key); });
    return work;
  }

  // Check only the snapshotted IDs: a delayed check must never invalidate a new child.
  async function refreshToolApprovals(ownerId, sessionId, fresh = false) {
    const account = context.accountState(ownerId);
    if (!account.sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
    const rows = toolApprovals(account).filter(row => row.sessionId === sessionId &&
      ['pending', 'answered'].includes(row.status));
    if (!rows.length) return;
    let described, unavailable = null;
    const live = new Map();
    if (rows.some(row => !approvalUnavailableReason(account, row))) {
      try {
        described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
        if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote' || described.running !== true) {
          unavailable = 'source_unavailable';
        } else {
          const sources = new Map(rows.filter(row => !approvalUnavailableReason(account, row))
            .map(row => [`${row.runtimeId}|${row.sourceReceiptId}`, row]));
          await Promise.all([...sources].map(async ([key, row]) => live.set(key, await liveToolApprovalSource(ownerId, row, fresh))));
        }
      } catch { unavailable = 'runtime_unavailable'; }
    }
    const observedReason = (next, row) => {
      const local = approvalUnavailableReason(next, row) ?? unavailable;
      if (local) return local;
      const session = next.sessions[sessionId];
      if (session.modelProfileId !== undefined && described?.modelProfileId !== session.modelProfileId) return 'model_unavailable';
      return live.get(`${row.runtimeId}|${row.sourceReceiptId}`) === true ? null : 'source_unavailable';
    };
    const affected = rows.filter(row => observedReason(context.accountState(ownerId), row));
    if (!affected.length) return;
    await context.serial(() => context.mutate(ownerId, next => {
      const at = new Date(context.timestamp()).toISOString();
      for (const snapshot of affected) {
        const row = next.commands[snapshot.sourceCommandId]?.toolApprovals?.find(item => item.approvalId === snapshot.approvalId);
        if (!row || row.runtimeId !== snapshot.runtimeId || !['pending', 'answered'].includes(row.status)) continue;
        const reason = observedReason(next, row);
        if (reason) invalidateToolApproval(row, reason, at);
      }
    }));
  }

  async function answerToolApproval(request, ownerId, deviceId, sessionId, approvalId, body) {
    exactKeys(body, ['requestId', 'outcome', 'scope'], ['requestId', 'outcome']);
    if (body.scope !== undefined && (!['once', 'conversation-category'].includes(body.scope) || body.outcome !== 'allowed-once')) throw failure('INVALID_REQUEST');
    if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId) || !APPROVAL_DECISIONS.has(body.outcome)) throw failure('INVALID_REQUEST');
    const account = context.accountState(ownerId);
    if (!account.sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
    const prior = toolApprovals(account).find(row => row.sessionId === sessionId && row.approvalId === approvalId);
    if (!prior) throw failure('NOT_FOUND', 404);
    const replay = prior.decisionRequestId === body.requestId;
    if (!replay) await refreshToolApprovals(ownerId, sessionId, true);
    const assertCurrent = () => {
      if (!replay && context.closedToolRuntimeIds.has(prior.runtimeId)) throw failure('APPROVAL_NOT_PENDING', 409);
    };
    const receipt = await context.serial(() => context.mutate(ownerId, next => {
      const current = context.authenticate(request, 'commands:write');
      if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
      const row = toolApprovals(next).find(item => item.sessionId === sessionId && item.approvalId === approvalId);
      if (!row) throw failure('NOT_FOUND', 404);
      if (row.decisionRequestId === body.requestId) {
        if (row.decisionOutcome !== body.outcome || (row.decisionScope ?? 'once') !== (body.scope ?? 'once')) throw failure('REQUEST_CONFLICT', 409);
        return approvalDecisionReceipt(row);
      }
      if (context.requestIdUsed(next, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
      if (row.status !== 'pending' || approvalUnavailableReason(next, row)) throw failure('APPROVAL_NOT_PENDING', 409);
      row.status = 'answered'; row.decisionOutcome = body.outcome; row.decisionRequestId = body.requestId;
      row.decisionScope = body.scope ?? 'once';
      if (row.decisionScope === 'conversation-category') {
        if (!row.riskCategories?.length) throw failure('INVALID_REQUEST');
        const session = next.sessions[sessionId];
        session.allowedApprovalCategories = [...new Set([...(session.allowedApprovalCategories ?? []), ...row.riskCategories])];
      }
      row.answeredAt = new Date(context.timestamp()).toISOString();
      return approvalDecisionReceipt(row);
    }, assertCurrent));
    assertCurrent();
    return receipt;
  }

  return {
    requireToolRuntime,
    personalExecutionSource,
    approvalMatches,
    approvalUnavailableReason,
    liveToolApprovalSource,
    refreshToolApprovals,
    answerToolApproval,
    /** Managed-child only: native approvals are bound to the exact original tool call. */
    async trackToolApproval(input) {
      exactKeys(input, ['id', 'action', 'sessionId', 'turn', 'callId', 'rootCallId', 'receiptId', 'messageHash',
        'toolName', 'argumentsHash', 'approvalId', 'runtimeId', 'reason', 'outcome']);
      const { action, sessionId, turn, callId, rootCallId, receiptId, approvalId, runtimeId } = input;
      if (!['register_approval', 'read_approval', 'resolve_approval'].includes(action) || !validId(sessionId) ||
          !Number.isSafeInteger(turn) || turn < 1 || typeof callId !== 'string' || typeof rootCallId !== 'string' ||
          !REQUEST_ID.test(callId) || !REQUEST_ID.test(rootCallId) ||
          !validId(receiptId) || !TOOL_RUNTIME_ID.test(approvalId ?? '') || !TOOL_RUNTIME_ID.test(runtimeId ?? '') ||
          typeof input.toolName !== 'string' || !GENERAL_TOOL_NAME.test(input.toolName) ||
          typeof input.messageHash !== 'string' || typeof input.argumentsHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.messageHash) || !/^[a-f0-9]{64}$/.test(input.argumentsHash) ||
          (action === 'register_approval' ? typeof input.reason !== 'string' || input.reason.length > 1000 || input.outcome !== undefined
            : input.reason !== undefined || (action === 'read_approval' ? input.outcome !== undefined : !APPROVAL_OUTCOMES.has(input.outcome)))) {
        throw failure('INVALID_COMMAND');
      }
      context.requireOpen();
      const ownerId = context.sessionOperations.executionOwnerForSession(sessionId);
      if (action === 'register_approval') {
        requireToolRuntime(runtimeId);
        // A real tool can ask before sendMessage has returned the native receipt.
        for (let attempt = 0; attempt < 20 && Object.values(context.accountState(ownerId).commands).some(command =>
          command.kind === 'session.message' && command.sessionId === sessionId && command.state === 'dispatching'); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          requireToolRuntime(runtimeId);
        }
      }
      const { source } = personalExecutionSource(context.accountState(ownerId), input);
      if (action === 'register_approval') {
        const project = context.accountState(ownerId).projects?.[source.payload.projectId];
        input = { ...input, reason: redactProjectPath(input.reason, project?.rootPath) };
      }
      const prior = toolApprovals(context.accountState(ownerId)).find(row => row.approvalId === approvalId);
      if (prior && (!approvalMatches(prior, input, source) || action === 'register_approval' && prior.reason !== input.reason)) {
        throw failure('REQUEST_CONFLICT', 409);
      }
      if (action !== 'register_approval' && !prior) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      if (action === 'read_approval' || action === 'register_approval' && prior) {
        if (['pending', 'answered'].includes(prior.status)) await refreshToolApprovals(ownerId, sessionId);
        context.requireOpen();
        return publicToolApproval(toolApprovals(context.accountState(ownerId)).find(row => row.approvalId === approvalId));
      }
      if (action === 'resolve_approval') return context.serial(() => context.mutate(ownerId, next => {
        const checked = personalExecutionSource(next, input);
        const row = checked.source.toolApprovals?.find(item => item.approvalId === approvalId);
        if (!row || !approvalMatches(row, input, checked.source)) throw failure('REQUEST_CONFLICT', 409);
        if (row.status === 'resolved') {
          if (row.outcome !== input.outcome) throw failure('REQUEST_CONFLICT', 409);
        } else if (row.status !== 'unavailable') {
          const at = new Date(context.timestamp()).toISOString(), reason = approvalUnavailableReason(next, row);
          if (reason) invalidateToolApproval(row, reason, at);
          else {
            if (APPROVAL_DECISIONS.has(input.outcome) &&
                (row.status !== 'answered' || row.decisionOutcome !== input.outcome)) throw failure('REQUEST_CONFLICT', 409);
            row.status = 'resolved'; row.outcome = input.outcome; row.resolvedAt = at;
          }
        }
        return publicToolApproval(row);
      }));
      personalExecutionSource(context.accountState(ownerId), input, true);
      const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
      requireToolRuntime(runtimeId);
      const session = context.accountState(ownerId).sessions[sessionId];
      if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote' || described.running !== true ||
          session.modelProfileId !== undefined && described.modelProfileId !== session.modelProfileId) {
        throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      }
      const live = await liveToolApprovalSource(ownerId, { ...input, sourceReceiptId: receiptId,
        taskId: source.rootTaskId ?? source.commandId }, true);
      requireToolRuntime(runtimeId);
      if (!live) {
        throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      }
      const saved = await context.serial(() => context.mutate(ownerId, next => {
        requireToolRuntime(runtimeId);
        const checked = personalExecutionSource(next, input, true);
        const existing = toolApprovals(next).find(row => row.approvalId === approvalId);
        if (existing) {
          if (!approvalMatches(existing, input, checked.source) || existing.reason !== input.reason) throw failure('REQUEST_CONFLICT', 409);
          return publicToolApproval(existing);
        }
        // Native tools can ask during execute; that exact running row has not yet performed the approved action.
        const running = checked.source.toolExecutions?.find(row => row.callId === callId);
        if (running && (running.state !== 'running' || running.rootCallId !== rootCallId || running.turn !== turn ||
            running.toolName !== input.toolName || running.argumentsHash !== input.argumentsHash ||
            running.runtimeId !== undefined && running.runtimeId !== runtimeId)) throw failure('REQUEST_CONFLICT', 409);
        const rows = checked.source.toolApprovals ?? [];
        if (rows.length >= MAX_COMMAND_TOOL_APPROVALS || toolApprovals(next).length >= MAX_TOOL_APPROVALS) throw failure('CAPACITY_LIMIT', 429);
        checked.source.dshTurn = turn;
        const row = { approvalId, runtimeId, sessionId, taskId: checked.root.commandId,
          sourceCommandId: checked.source.commandId, sourceReceiptId: receiptId, turn, callId, rootCallId,
          toolName: input.toolName, messageHash: input.messageHash, argumentsHash: input.argumentsHash,
          reason: input.reason, riskCategories: approvalCategories(input.reason), status: 'pending', createdAt: new Date(context.timestamp()).toISOString() };
        checked.source.toolApprovals = [...rows, row];
        return publicToolApproval(row);
      }, () => requireToolRuntime(runtimeId)));
      requireToolRuntime(runtimeId);
      return saved;
    },
    /** Trusted parent lifecycle only. Seal synchronously before any pending registration can commit. */
    async invalidateToolApprovals(input) {
      exactKeys(input, ['runtimeId', 'outcome', 'reasonCode'], ['runtimeId']);
      const { runtimeId, outcome = 'unavailable', reasonCode = 'RUNTIME_UNAVAILABLE' } = input;
      const reasons = { RUNTIME_UNAVAILABLE: 'runtime_unavailable', SESSION_REPLACED: 'runtime_replaced', SERVICE_CLOSING: 'service_closing' };
      if (!TOOL_RUNTIME_ID.test(runtimeId ?? '') || outcome !== 'unavailable' || !Object.hasOwn(reasons, reasonCode)) {
        throw failure('INVALID_REQUEST');
      }
      context.closedToolRuntimeIds.add(runtimeId);
      for (const key of context.questionNativeTerminals.keys()) if (key.startsWith(`${runtimeId}|`)) context.questionNativeTerminals.delete(key);
      return context.serial(() => context.mutateRoot(nextRoot => {
        const at = new Date(context.timestamp()).toISOString();
        let invalidatedCount = 0;
        for (const account of Object.values(nextRoot.accounts)) for (const command of Object.values(account.commands)) {
          for (const row of command.userQuestions ?? []) if (row.runtimeId === runtimeId) invalidateUserQuestion(row, reasonCode, at);
          for (const row of command.toolApprovals ?? []) if (row.runtimeId === runtimeId &&
              invalidateToolApproval(row, reasons[reasonCode], at)) invalidatedCount++;
          for (const row of command.toolExecutions ?? []) if (row.runtimeId === runtimeId) {
            if (row.state === 'running') { row.state = 'uncertain'; row.updatedAt = at; }
            if (['running', 'stopping'].includes(row.jobState)) { row.jobState = 'uncertain'; row.jobObservedAt = row.updatedAt = at; }
          }
        }
        return { runtimeId, invalidatedCount };
      }));
    }
  };
}
