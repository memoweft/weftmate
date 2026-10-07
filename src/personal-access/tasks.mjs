import { readSourceEvents } from './source-history.mjs';
import {
  digest,
  exactKeys,
  failure,
  plainObject,
  publicProject,
  publicSource,
  validId,
  validTime,
  withDeadline
} from './common.mjs';
import { GENERAL_TOOL_NAME, ID, INTERNAL_ARTIFACT_KIND, JOB_STATES, REQUEST_ID, TOOL_RUNTIME_ID } from './constants.mjs';
import { publicCommand } from './command-policy.mjs';

export function createTaskOperations(context) {
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
      (messageIds.has(item.commandId) && (['dispatching', 'uncertain'].includes(item.state) ||
        item.toolExecutions?.some(row => row.state === 'uncertain' || ['uncertain', 'unconfirmed'].includes(row.jobState)))) ||
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
    const deadline = context.timestamp() + 2_500;
    const observe = (work) => {
      const remaining = deadline - context.timestamp();
      if (remaining <= 0) throw failure('BACKEND_TIMEOUT', 503);
      return withDeadline(() => { context.requireOpen(); return work(); }, remaining);
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
    try { described = await observe(() => context.backend.describeSession(source.sessionId, account.ownerId)); }
    catch { return { ready: false, status: 'unconfirmed', pendingCount: targets.length }; }
    if (described?.sessionId !== source.sessionId || described.agentPreset !== 'personal-remote') {
      return { ready: false, status: 'unconfirmed', pendingCount: targets.length };
    }
    let openTurn = null;
    try {
      const scoped = await Promise.all(targets.filter(target => target.receiptId && target.ack !== 'queue_removed')
        .map(target => readSourceEvents(context, { sessionId: source.sessionId, ownerId: account.ownerId,
          receiptId: target.receiptId, turn: account.commands[target.commandId]?.dshTurn }, observe)));
      const bySeq = new Map();
      for (const range of scoped) for (const event of range.events) bySeq.set(event.seq, event);
      const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
        for (const event of events) {
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
      historyComplete = true;
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
    const jobSteps = [taskSource(account, taskId), ...taskChildren(account, taskId)].flatMap(command => command.toolExecutions ?? [])
      .filter(row => row.jobId);
    if (jobSteps.some(row => ['running', 'stopping'].includes(row.jobState))) { pendingCount++; uncertain = true; }
    for (const row of jobSteps) if (row.jobState === 'killed' && validTime(row.jobObservedAt)) terminalTimes.push(row.jobObservedAt);
    if (effectsUnknown) { pendingCount++; uncertain = true; }
    if (targets.some((target) => target.attemptAt || target.ack === 'unconfirmed')) uncertain = true;
    const status = pendingCount ? cancelRequested ? 'cancel_requested' : uncertain || legacy ? 'unconfirmed' : 'requested'
      : aborted || removed || jobSteps.some(row => row.jobState === 'killed') ? 'stopped' : completed ? 'completed' : 'unconfirmed';
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
    const citedIds = new Set(artifacts.filter((item) => item.state === 'observed')
      .flatMap((item) => item.sourceSnapshotIds ?? []));
    const sources = [...Object.values(account.projectSources ?? {}), ...Object.values(account.browserSources ?? {})]
      .filter((item) => item.taskId === taskId)
      .map((item) => ({ ...publicSource(item), cited: citedIds.has(item.snapshotId) }));
    const projectRecord = source.payload.projectId ? account.projects?.[source.payload.projectId] : null;
    const steps = Object.values(account.commands).filter((item) =>
      item.kind === 'desktop.open_app' && item.toolSource &&
      (item.taskId === taskId || messageIds.has(item.toolSource.sourceCommandId))).map(publicCommand);
    const executionSteps = [source, ...children].flatMap(command => command.toolExecutions ?? []).map(row => ({ ...row }));
    const storedState = source.taskControl?.state ?? 'active';
    const state = storedState === 'active' && taskHasUnknownEffects(account, taskId)
      ? 'uncertain' : storedState;
    const evidence = state === 'stop_requested' ? await taskStopEvidence(account, taskId) : null;
    const latestMessage = [source, ...children].filter((item) =>
      item.kind === 'session.message').sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
    const latestAccepted = latestMessage?.state === 'accepted_by_dsh' &&
      typeof latestMessage.receiptId === 'string' ? latestMessage : null;
    let replyEvidence = { status: 'unconfirmed', turn: null,
      assistantChunks: 0, textChunks: 0, reasoningChunks: 0,
      assistantMessages: 0, toolSaveObserved: false };
    if (latestAccepted && typeof context.backend.getTaskReplyEvidence === 'function') {
      try {
        const reported = await withDeadline(() => context.backend.getTaskReplyEvidence({
          sessionId: latestAccepted.sessionId, rootTaskId: taskId,
          receiptId: latestAccepted.receiptId, turn: latestAccepted.dshTurn, ownerId: account.ownerId,
        }), 3_000);
        if (reported && ['waiting', 'streaming', 'completed', 'aborted', 'blocked',
          'failed', 'unconfirmed'].includes(reported.status) &&
            (reported.turn === null || Number.isSafeInteger(reported.turn) && reported.turn >= 0) &&
            ['assistantChunks', 'textChunks', 'reasoningChunks', 'assistantMessages'].every((key) =>
              Number.isSafeInteger(reported[key]) && reported[key] >= 0 && reported[key] <= 100_000) &&
            typeof reported.toolSaveObserved === 'boolean') replyEvidence = {
          status: reported.status, turn: reported.turn,
          assistantChunks: reported.assistantChunks, textChunks: reported.textChunks,
          reasoningChunks: reported.reasoningChunks, assistantMessages: reported.assistantMessages,
          toolSaveObserved: reported.toolSaveObserved,
          ...(reported.status === 'failed' && reported.endReasonKind === 'max-tokens' &&
            Number.isSafeInteger(reported.turn) && validTime(reported.terminalAt)
            ? { endReasonKind: 'max-tokens' } : {}),
          ...(Number.isSafeInteger(reported.step) && reported.step >= 0 ? { step: reported.step } : {}),
          ...Object.fromEntries(['observedAt', 'terminalAt', 'firstChunkAt', 'lastChunkAt']
            .filter((key) => validTime(reported[key])).map((key) => [key, reported[key]])),
        };
      } catch { /* An unreadable native turn remains unconfirmed. */ }
    }
    return { taskId, sessionId: source.sessionId, sourceText: source.payload.text,
      ...(source.payload.conversationId ? { conversationId: source.payload.conversationId } : {}),
      source: publicCommand(source), artifacts, steps, executionSteps, sources, replyEvidence,
      ...(source.payload.workspaceKind === 'browser' ? { workspace: { kind: 'browser' } } : {}),
      ...(projectRecord ? { project: publicProject(projectRecord) } : {}),
      supplements: children.filter((item) => item.taskAction === 'supplement').map(publicCommand),
      resumes: children.filter((item) => item.taskAction === 'resume').map(publicCommand),
      control: { state, updatedAt: source.taskControl?.updatedAt ?? source.updatedAt,
        backgroundJobs: { active: executionSteps.filter(row => ['running', 'stopping'].includes(row.jobState)).length,
          unconfirmed: executionSteps.filter(row => ['uncertain', 'unconfirmed'].includes(row.jobState)).length },
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
    if (context.stopping.has(key)) return context.stopping.get(key);
    const work = (async () => {
      if (context.closing || context.storageFault || typeof context.backend.stopTask !== 'function') return;
      const account = context.accountState(ownerId);
      const source = taskSource(account, taskId);
      if (source.taskControl?.state !== 'stop_requested') return;
      const stop = latestStop(account, taskId);
      if (!stop?.targets) return;
      if (!force && stop.lastAttemptAt && context.timestamp() - Date.parse(stop.lastAttemptAt) < 1_000) return;
      const candidates = stop.targets.filter((target) => target.receiptId && target.ack !== 'queue_removed' &&
        account.commands[target.commandId]?.state === 'accepted_by_dsh')
        .sort((left, right) => (left.attemptAt ? Date.parse(left.attemptAt) : 0) -
          (right.attemptAt ? Date.parse(right.attemptAt) : 0)).slice(0, 16);
      if (!candidates.length) return;
      const described = await withDeadline(() => context.backend.describeSession(source.sessionId, ownerId), 2_500)
        .catch(() => null);
      if (described?.sessionId !== source.sessionId || described.agentPreset !== 'personal-remote') return;
      await context.serial(() => context.mutate(ownerId, (next) => {
        const current = latestStop(next, taskId);
        if (current?.requestId !== stop.requestId) return;
        const at = new Date(context.timestamp()).toISOString();
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
          result = await withDeadline(() => context.backend.stopTask({ sessionId: source.sessionId,
            ownerId, requestId: stop.requestId, receiptIds: receipts }), 3_000);
        } catch { return; }
        if (!Array.isArray(result?.outcomes) || result.outcomes.length !== receipts.length ||
            new Set(result.outcomes.map((item) => item.receiptId)).size !== receipts.length ||
            result.outcomes.some((item) => !receipts.includes(item.receiptId) ||
              !['cancel_requested', 'queue_removed', 'unconfirmed'].includes(item.status))) return;
        if (context.closing) return;
        await context.serial(() => context.mutate(ownerId, (next) => {
          const current = latestStop(next, taskId);
          if (current?.requestId !== stop.requestId) return;
          const at = new Date(context.timestamp()).toISOString();
          for (const outcome of result.outcomes) {
            const target = current.targets.find((item) => item.receiptId === outcome.receiptId);
            if (!target || target.ack === 'queue_removed') continue;
            target.ack = outcome.status;
            target.ackAt = at;
            for (const observed of outcome.backgroundJobs ?? []) {
              if (!plainObject(observed) || !REQUEST_ID.test(observed.jobId ?? '') || !JOB_STATES.has(observed.state)) continue;
              for (const command of [taskSource(next, taskId), ...taskChildren(next, taskId)]) {
                for (const row of command.toolExecutions ?? []) {
                  if (row.sourceReceiptId !== outcome.receiptId || row.jobId !== observed.jobId) continue;
                  if (['completed', 'killed', 'failed'].includes(row.jobState) && row.jobState !== observed.state) continue;
                  row.jobState = observed.state; row.jobObservedAt = row.updatedAt = at;
                }
              }
            }
          }
        }));
      }
    })().finally(() => context.stopping.delete(key));
    context.stopping.set(key, work);
    return work;
  }

  return {
    taskSource,
    taskChildren,
    taskHasUnknownEffects,
    stopTargets,
    latestStop,
    taskStopEvidence,
    taskDetail,
    driveTaskStop,
    /** Managed-child only: bind generic tools to the original authorized receipt, with no new scheduler. */
    async trackToolExecution(input) {
      exactKeys(input, ['id', 'action', 'sessionId', 'turn', 'callId', 'rootCallId', 'receiptId', 'messageHash',
        'toolName', 'argumentsHash', 'executionId', 'state', 'resultHash', 'jobId', 'jobState', 'runtimeId']);
      const { action, sessionId, turn, callId, rootCallId, receiptId, toolName, argumentsHash } = input;
      if (action === 'authorize_execution' && [input.executionId, input.state, input.resultHash, input.jobId, input.jobState].some(value => value !== undefined) ||
          action === 'observe_execution_job' && [input.state, input.resultHash].some(value => value !== undefined)) throw failure('INVALID_COMMAND');
      if (!['authorize_execution', 'finish_execution', 'observe_execution_job'].includes(action) || !validId(sessionId) ||
          !Number.isSafeInteger(turn) || turn < 1 || typeof callId !== 'string' || typeof rootCallId !== 'string' ||
          !REQUEST_ID.test(callId) || !REQUEST_ID.test(rootCallId) ||
          !validId(receiptId) || typeof toolName !== 'string' || !GENERAL_TOOL_NAME.test(toolName) ||
          typeof input.messageHash !== 'string' || typeof argumentsHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.messageHash) || !/^[a-f0-9]{64}$/.test(argumentsHash) ||
          input.runtimeId !== undefined && !TOOL_RUNTIME_ID.test(input.runtimeId)) {
        throw failure('INVALID_COMMAND');
      }
      context.requireToolRuntime(input.runtimeId);
      const ownerId = context.rootState.legacyOwnerId;
      if (context.accountState(ownerId).sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
      const executionId = `exec-${digest(`${ownerId}|${sessionId}|${callId}`).slice(0, 48)}`;
      if (action === 'authorize_execution') {
        const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
        if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
        // Native execution may begin before the send callback has durably recorded its receipt.
        for (let attempt = 0; attempt < 20 && Object.values(context.accountState(ownerId).commands).some(command =>
          command.kind === 'session.message' && command.sessionId === sessionId && command.state === 'dispatching'); attempt++) {
          if (context.closing) throw failure('SERVICE_CLOSING', 503);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      const result = await context.serial(() => context.mutate(ownerId, next => {
        context.requireToolRuntime(input.runtimeId);
        const { source, root } = context.personalExecutionSource(next, input);
        const rows = source.toolExecutions ?? [];
        const prior = rows.find(row => row.executionId === executionId);
        if (action === 'observe_execution_job') {
          if (!prior || input.executionId !== executionId || prior.jobId !== input.jobId || prior.rootCallId !== rootCallId || prior.turn !== turn ||
              prior.toolName !== toolName || prior.argumentsHash !== argumentsHash || prior.runtimeId !== input.runtimeId ||
              !['running', 'stopping', 'completed', 'killed', 'failed'].includes(input.jobState)) throw failure('REQUEST_CONFLICT', 409);
          if (!(['completed', 'killed', 'failed'].includes(prior.jobState) && prior.jobState !== input.jobState)) {
            prior.jobState = input.jobState; prior.jobObservedAt = prior.updatedAt = new Date(context.timestamp()).toISOString();
          }
          return { executionId, taskId: root.commandId, state: prior.state };
        }
        if (action === 'finish_execution') {
          if (!prior || input.executionId !== executionId || prior.callId !== callId || prior.rootCallId !== rootCallId ||
              prior.turn !== turn || prior.toolName !== toolName || prior.argumentsHash !== argumentsHash || prior.runtimeId !== input.runtimeId ||
              !['completed', 'failed', 'cancelled', 'uncertain'].includes(input.state) ||
              (input.state !== 'uncertain' && !/^[a-f0-9]{64}$/.test(input.resultHash ?? ''))) {
            throw failure('REQUEST_CONFLICT', 409);
          }
          if (input.state === 'uncertain') {
            if ([input.resultHash, input.jobId, input.jobState].some(value => value !== undefined)) throw failure('INVALID_COMMAND');
            if (!['running', 'uncertain'].includes(prior.state)) throw failure('REQUEST_CONFLICT', 409);
            if (prior.state === 'running') { prior.state = 'uncertain'; prior.updatedAt = new Date(context.timestamp()).toISOString(); }
            return { executionId, taskId: root.commandId, state: prior.state };
          }
          // An execute-body approval can be awaiting its durable native resolution after side effects.
          if (source.toolApprovals?.some(row => row.callId === callId && row.turn === turn &&
              ['pending', 'answered'].includes(row.status))) throw failure('TASK_NOT_READY', 409);
          if (prior.state !== 'running') {
            if (prior.state !== input.state || prior.resultHash !== input.resultHash || prior.jobId !== input.jobId) throw failure('REQUEST_CONFLICT', 409);
          } else {
            if (input.jobId !== undefined) {
              if (toolName !== 'pwsh' || !REQUEST_ID.test(input.jobId) || !JOB_STATES.has(input.jobState)) throw failure('INVALID_COMMAND');
              prior.jobId = input.jobId; prior.jobState = input.jobState; prior.jobObservedAt = new Date(context.timestamp()).toISOString();
            }
            prior.state = input.state; prior.resultHash = input.resultHash;
            prior.finishedAt = prior.updatedAt = new Date(context.timestamp()).toISOString();
          }
          return { executionId, taskId: root.commandId, state: prior.state };
        }
        context.personalExecutionSource(next, input, true);
        if (root.taskControl?.state === 'stop_requested' || taskHasUnknownEffects(next, root.commandId)) throw failure('TASK_NOT_READY', 409);
        if (prior) throw failure('REQUEST_CONFLICT', 409); // Unknown or completed calls are never executed twice.
        for (const row of source.toolApprovals ?? []) if (row.turn === turn &&
            (row.callId === callId || row.rootCallId === rootCallId)) {
          if (row.callId === callId && (row.toolName !== toolName || row.argumentsHash !== argumentsHash ||
              row.rootCallId !== rootCallId || input.runtimeId !== undefined && row.runtimeId !== input.runtimeId)) {
            throw failure('REQUEST_CONFLICT', 409);
          }
          if (row.status !== 'resolved' || row.outcome !== 'allowed-once' || context.closedToolRuntimeIds.has(row.runtimeId)) {
            throw failure('TASK_NOT_READY', 409);
          }
        }
        if (rows.length >= 256) throw failure('CAPACITY_LIMIT', 429);
        const now = new Date(context.timestamp()).toISOString();
        source.dshTurn = turn;
        source.toolExecutions = [...rows, { executionId, sourceCommandId: source.commandId, sourceReceiptId: receiptId,
          rootCallId, callId, toolName, turn, state: 'running', argumentsHash,
          ...(input.runtimeId !== undefined ? { runtimeId: input.runtimeId } : {}), startedAt: now, updatedAt: now }];
        return { executionId, taskId: root.commandId, state: 'running' };
      }, () => context.requireToolRuntime(input.runtimeId)));
      context.requireToolRuntime(input.runtimeId);
      return result;
    }
  };
}
