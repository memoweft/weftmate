import { scheduledCommandSource } from './schedules-authorization.mjs';
import {
  canonicalUserQuestionAnswer,
  canonicalUserQuestions,
  invalidateUserQuestion,
  publicUserQuestion,
  toolApprovals,
  userQuestionAnswerReceipt,
  userQuestions
} from './interaction-policy.mjs';
import { digest, exactKeys, failure, validId } from './common.mjs';
import { MAX_COMMAND_TOOL_APPROVALS, MAX_TOOL_APPROVALS, QUESTION_REASONS, REQUEST_ID, TOOL_RUNTIME_ID } from './constants.mjs';

export function createUserQuestionOperations(context) {
  function interactionRequestIdUsed(account, requestId) {
    return toolApprovals(account).some(row => row.decisionRequestId === requestId) ||
      userQuestions(account).some(row => row.answerRequestId === requestId);
  }

  const questionKey = row => `${row.runtimeId}|${row.questionRpcId}`;

  const questionIdentityFields = ['runtimeId', 'sessionId', 'questionRpcId', 'sourceReceiptId', 'messageHash',
    'turn', 'sourceSeq', 'observedSeq'];

  const questionMatches = (row, input) => questionIdentityFields.every(key => row[key] === input[key]);

  function questionSource(account, input, activeSource = true) {
    const checked = context.personalExecutionSource(account, { ...input, receiptId: input.sourceReceiptId });
    if (activeSource) {
      const device = account.devices[checked.source.sourceDeviceId];
      if (!device || !['password', 'cloud'].includes(device.authKind) || device.revoked ||
          !Number.isSafeInteger(checked.source.sourceAuthEpoch) || device.authEpoch !== checked.source.sourceAuthEpoch ||
          !scheduledCommandSource(account, checked.source) && Date.parse(device.expiresAt) <= context.timestamp()) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      if (!context.messageModelUsable(account.ownerId, account.sessions[input.sessionId], account)) throw failure('MODEL_UNAVAILABLE', 409);
      if (checked.root.taskControl?.state === 'stop_requested') throw failure('TASK_NOT_READY', 409);
      // Providing information does not authorize execution, and can help clarify an unknown result.
    }
    return checked;
  }

  function questionUnavailableReason(account, row) {
    if (context.closedToolRuntimeIds.has(row.runtimeId)) return 'RUNTIME_UNAVAILABLE';
    try { questionSource(account, row); }
    catch (error) {
      return ['TOOL_SOURCE_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'TASK_NOT_READY'].includes(error.code)
        ? error.code : 'TOOL_SOURCE_UNAVAILABLE';
    }
    return null;
  }

  function requireQuestionPending(row) {
    context.requireToolRuntime(row.runtimeId);
    if (context.questionNativeTerminals.has(questionKey(row))) throw failure('QUESTION_NOT_PENDING', 409);
  }

  function validateQuestionIdentity(input) {
    if (input.sourceReady !== true || !validId(input.sessionId) || typeof input.runtimeId !== 'string' ||
        !TOOL_RUNTIME_ID.test(input.runtimeId) || typeof input.questionRpcId !== 'string' || !TOOL_RUNTIME_ID.test(input.questionRpcId) ||
        !validId(input.sourceReceiptId) || typeof input.messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.messageHash) ||
        !Number.isSafeInteger(input.turn) || input.turn < 1 || !Number.isSafeInteger(input.sourceSeq) || input.sourceSeq < 0 ||
        !Number.isSafeInteger(input.observedSeq) || input.observedSeq < input.sourceSeq) throw failure('INVALID_REQUEST');
  }

  async function nativeUserQuestionSnapshot(ownerId, input) {
    if (typeof context.backend.listUserQuestions !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
    const page = await context.callBackend(() => context.backend.listUserQuestions({ sessionId: input.sessionId, ownerId,
      modelProfileId: context.accountState(ownerId).sessions[input.sessionId]?.modelProfileId }));
    context.requireToolRuntime(input.runtimeId);
    if (page?.runtimeId !== input.runtimeId || !Array.isArray(page.questions)) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    const snapshot = page.questions.find(row => row.questionRpcId === input.questionRpcId);
    if (!snapshot) throw failure('QUESTION_NOT_PENDING', 409);
    validateQuestionIdentity({ ...snapshot, runtimeId: page.runtimeId });
    if (!questionMatches(input, { ...snapshot, runtimeId: page.runtimeId })) throw failure('REQUEST_CONFLICT', 409);
    if (snapshot.nativeState !== 'pending') {
      if (['answered', 'cancelled'].includes(snapshot.nativeState)) context.questionNativeTerminals.set(questionKey(input), snapshot.nativeState);
      throw failure('QUESTION_NOT_PENDING', 409);
    }
    return snapshot;
  }

  async function trackUserQuestion(input) {
    exactKeys(input, ['action', 'runtimeId', 'sessionId', 'questionRpcId', 'sourceReady', 'sourceReceiptId', 'messageHash',
      'turn', 'sourceSeq', 'observedSeq', 'questions', 'outcome']);
    validateQuestionIdentity(input);
    if (!['register_question', 'resolve_question'].includes(input.action) ||
        (input.action === 'register_question' ? input.outcome !== undefined : input.questions !== undefined ||
          !['answered', 'cancelled'].includes(input.outcome))) throw failure('INVALID_REQUEST');
    context.requireToolRuntime(input.runtimeId);
    const ownerId = context.rootState.legacyOwnerId;
    const account = context.accountState(ownerId);
    if (account.sessions[input.sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
    const prior = userQuestions(account).find(row => row.questionRpcId === input.questionRpcId);
    if (prior && !questionMatches(prior, input)) throw failure('REQUEST_CONFLICT', 409);
    if (input.action === 'resolve_question') {
      questionSource(account, input, false);
      context.questionNativeTerminals.set(questionKey(input), input.outcome);
      if (!prior) return null; // A native terminal fact cannot reconstruct a historical pending batch.
      return context.serial(() => context.mutate(ownerId, next => {
        const row = userQuestions(next).find(item => item.questionRpcId === input.questionRpcId);
        if (!row || !questionMatches(row, input)) throw failure('REQUEST_CONFLICT', 409);
        if (row.status === 'resolved') {
          if (row.outcome !== input.outcome) throw failure('REQUEST_CONFLICT', 409);
        } else {
          const reason = questionUnavailableReason(next, row);
          if (reason) invalidateUserQuestion(row, reason, new Date(context.timestamp()).toISOString());
          else if (row.status !== 'unavailable' || ['QUESTION_NOT_PENDING', 'QUESTION_OUTCOME_UNCONFIRMED'].includes(row.reasonCode)) {
            row.status = 'resolved'; row.outcome = input.outcome; row.resolvedAt = new Date(context.timestamp()).toISOString();
            delete row.unavailableAt;
            if (row.answer !== undefined && row.answerAcceptedAt === undefined) {
              row.reasonCode = row.deliveryState === 'not-pending' || input.outcome === 'cancelled'
                ? 'QUESTION_NOT_PENDING' : 'QUESTION_OUTCOME_UNCONFIRMED';
            } else delete row.reasonCode;
          }
        }
        return publicUserQuestion(row);
      }, () => context.requireToolRuntime(input.runtimeId)));
    }
    const questions = canonicalUserQuestions(input.questions), questionsHash = digest(JSON.stringify(questions));
    if (prior) {
      if (prior.questionsHash !== questionsHash) throw failure('REQUEST_CONFLICT', 409);
      return publicUserQuestion(prior);
    }
    requireQuestionPending(input);
    for (let attempt = 0; attempt < 20 && Object.values(context.accountState(ownerId).commands).some(command =>
      command.kind === 'session.message' && command.sessionId === input.sessionId && command.state === 'dispatching'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      requireQuestionPending(input);
    }
    questionSource(context.accountState(ownerId), input);
    const described = await context.callBackend(() => context.backend.describeSession(input.sessionId, ownerId));
    requireQuestionPending(input);
    const session = context.accountState(ownerId).sessions[input.sessionId];
    if (described?.sessionId !== input.sessionId || described.agentPreset !== 'personal-remote' || described.running !== true ||
        session.modelProfileId !== undefined && described.modelProfileId !== session.modelProfileId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    const native = await nativeUserQuestionSnapshot(ownerId, input);
    if (digest(JSON.stringify(canonicalUserQuestions(native.questions))) !== questionsHash) throw failure('REQUEST_CONFLICT', 409);
    const saved = await context.serial(() => context.mutate(ownerId, next => {
      requireQuestionPending(input);
      const checked = questionSource(next, input), existing = userQuestions(next).find(row => row.questionRpcId === input.questionRpcId);
      if (existing) {
        if (!questionMatches(existing, input) || existing.questionsHash !== questionsHash) throw failure('REQUEST_CONFLICT', 409);
        return publicUserQuestion(existing);
      }
      const rows = checked.source.userQuestions ?? [];
      if (rows.length >= MAX_COMMAND_TOOL_APPROVALS || userQuestions(next).length >= MAX_TOOL_APPROVALS) throw failure('CAPACITY_LIMIT', 429);
      checked.source.dshTurn = input.turn;
      const row = { ...Object.fromEntries(questionIdentityFields.map(key => [key, input[key]])),
        taskId: checked.root.commandId, sourceCommandId: checked.source.commandId, questions, questionsHash,
        status: 'pending', createdAt: new Date(context.timestamp()).toISOString() };
      checked.source.userQuestions = [...rows, row];
      return publicUserQuestion(row);
    }, () => requireQuestionPending(input)));
    requireQuestionPending(input);
    return saved;
  }

  async function syncUserQuestions(ownerId, sessionId) {
    const account = context.accountState(ownerId);
    if (!account.sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
    if (account.sessions[sessionId].origin !== 'personal-remote' || !context.hostOwner(ownerId)) return;
    if (typeof context.backend.listUserQuestions !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
    const localInvalid = userQuestions(account).filter(row => row.sessionId === sessionId &&
      ['pending', 'answered'].includes(row.status) && questionUnavailableReason(account, row));
    if (localInvalid.length) await context.serial(() => context.mutate(ownerId, next => {
      for (const snapshot of localInvalid) {
        const row = userQuestions(next).find(item => questionMatches(item, snapshot));
        const reason = row && questionUnavailableReason(next, row);
        if (reason) invalidateUserQuestion(row, reason, new Date(context.timestamp()).toISOString());
      }
    }));
    let page;
    try { page = await context.callBackend(() => context.backend.listUserQuestions({ sessionId, ownerId,
      modelProfileId: context.accountState(ownerId).sessions[sessionId]?.modelProfileId })); }
    catch (error) {
      const rows = userQuestions(context.accountState(ownerId)).filter(row => row.sessionId === sessionId && ['pending', 'answered'].includes(row.status));
      if (!rows.length) throw error;
      await context.serial(() => context.mutate(ownerId, next => {
        for (const row of userQuestions(next)) if (rows.some(snapshot => questionMatches(row, snapshot))) {
          invalidateUserQuestion(row, ['MODEL_UNAVAILABLE', 'TOOL_SOURCE_UNAVAILABLE'].includes(error.code) ? error.code : 'RUNTIME_UNAVAILABLE', new Date(context.timestamp()).toISOString());
        }
      }));
      return;
    }
    if (typeof page?.runtimeId !== 'string' || !TOOL_RUNTIME_ID.test(page.runtimeId) || !Array.isArray(page.questions) ||
        page.questions.length > MAX_TOOL_APPROVALS || new Set(page.questions.map(row => row?.questionRpcId)).size !== page.questions.length) {
      throw failure('BACKEND_UNAVAILABLE', 503);
    }
    context.requireToolRuntime(page.runtimeId);
    const snapshots = page.questions.map(snapshot => {
      exactKeys(snapshot, ['sessionId', 'questionRpcId', 'sourceReady', 'sourceReceiptId', 'messageHash', 'turn', 'sourceSeq',
        'observedSeq', 'questions', 'nativeState'], ['sessionId', 'questionRpcId', 'sourceReady', 'nativeState']);
      if (snapshot.sessionId !== sessionId || typeof snapshot.questionRpcId !== 'string' || !TOOL_RUNTIME_ID.test(snapshot.questionRpcId) ||
          !['pending', 'answered', 'cancelled'].includes(snapshot.nativeState) || typeof snapshot.sourceReady !== 'boolean') throw failure('BACKEND_UNAVAILABLE', 503);
      if (!snapshot.sourceReady) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      const row = { ...snapshot, runtimeId: page.runtimeId };
      validateQuestionIdentity(row);
      if (row.nativeState !== 'pending') context.questionNativeTerminals.set(questionKey(row), row.nativeState);
      return row;
    });
    // A temporarily incomplete reconnect snapshot is not proof that a native wait has gone.
    if (userQuestions(context.accountState(ownerId)).some(row => row.sessionId === sessionId && row.runtimeId === page.runtimeId &&
        ['pending', 'answered'].includes(row.status) && !snapshots.some(snapshot => snapshot.questionRpcId === row.questionRpcId))) {
      throw failure('BACKEND_UNAVAILABLE', 503);
    }
    // Native terminals seal IDs before pending registrations reach their awaits.
    for (const row of snapshots.filter(row => row.nativeState !== 'pending')) {
      const { questions: _questions, nativeState, ...identity } = row;
      await trackUserQuestion({ ...identity, action: 'resolve_question', outcome: nativeState });
    }
    let modelReason = null;
    if (snapshots.some(row => row.nativeState === 'pending')) {
      const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
      context.requireToolRuntime(page.runtimeId);
      const session = context.accountState(ownerId).sessions[sessionId];
      if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote' || described.running !== true) modelReason = 'TOOL_SOURCE_UNAVAILABLE';
      else if (session.modelProfileId !== undefined && described.modelProfileId !== session.modelProfileId) modelReason = 'MODEL_UNAVAILABLE';
      if (modelReason) {
        const activeRows = userQuestions(context.accountState(ownerId)).filter(row => row.sessionId === sessionId && ['pending', 'answered'].includes(row.status));
        if (!activeRows.length && !userQuestions(context.accountState(ownerId)).some(row => row.sessionId === sessionId)) throw failure(modelReason, 409);
        if (activeRows.length) await context.serial(() => context.mutate(ownerId, next => {
          for (const row of userQuestions(next)) if (activeRows.some(snapshot => questionMatches(row, snapshot))) {
            invalidateUserQuestion(row, modelReason, new Date(context.timestamp()).toISOString());
          }
        }));
      }
    }
    for (const row of snapshots.filter(row => row.nativeState === 'pending' && !modelReason)) {
      const { nativeState: _nativeState, ...identity } = row;
      await trackUserQuestion({ ...identity, action: 'register_question' });
    }
    const affected = userQuestions(context.accountState(ownerId)).filter(row => row.sessionId === sessionId &&
      ['pending', 'answered'].includes(row.status) && (questionUnavailableReason(context.accountState(ownerId), row) ||
        row.runtimeId !== page.runtimeId));
    if (affected.length) await context.serial(() => context.mutate(ownerId, next => {
      for (const snapshot of affected) {
        const row = userQuestions(next).find(item => questionMatches(item, snapshot));
        if (!row) continue;
        const reason = questionUnavailableReason(next, row) ?? 'SESSION_REPLACED';
        invalidateUserQuestion(row, reason, new Date(context.timestamp()).toISOString());
      }
    }));
  }

  function scheduleUserQuestionDelivery(ownerId, questionRpcId) {
    const key = `${ownerId}|${questionRpcId}`;
    if (context.closing || context.questionDeliveries.has(key)) return;
    const work = Promise.resolve().then(async () => {
      const row = userQuestions(context.accountState(ownerId)).find(item => item.questionRpcId === questionRpcId);
      if (!row || row.status !== 'answered' || row.deliveryState !== 'ready') return;
      const dispatch = await context.serial(() => context.mutate(ownerId, next => {
        const current = userQuestions(next).find(item => item.questionRpcId === questionRpcId);
        if (!current || current.status !== 'answered' || current.deliveryState !== 'ready') return null;
        const reason = questionUnavailableReason(next, current);
        if (reason) { invalidateUserQuestion(current, reason, new Date(context.timestamp()).toISOString()); return null; }
        requireQuestionPending(current);
        current.deliveryState = 'dispatching'; current.deliveryAttemptedAt = new Date(context.timestamp()).toISOString();
        return structuredClone(current);
      }, () => context.requireToolRuntime(row.runtimeId)));
      if (!dispatch) return;
      let result, reason = 'QUESTION_OUTCOME_UNCONFIRMED';
      try {
        context.requireToolRuntime(dispatch.runtimeId);
        if (typeof context.backend.respondUserQuestion !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
        result = await context.callBackend(() => context.backend.respondUserQuestion({ ownerId, runtimeId: dispatch.runtimeId,
          sessionId: dispatch.sessionId, questionRpcId, answer: dispatch.answer,
          modelProfileId: context.accountState(ownerId).sessions[dispatch.sessionId]?.modelProfileId }));
        if (result?.accepted === false && result.reason === 'not-pending') reason = 'QUESTION_NOT_PENDING';
      } catch (error) {
        if (QUESTION_REASONS.has(error.code)) reason = error.code;
      }
      await context.serial(() => context.mutate(ownerId, next => {
        const current = userQuestions(next).find(item => item.questionRpcId === questionRpcId);
        if (!current || !['answered', 'resolved'].includes(current.status) || current.deliveryState !== 'dispatching') return;
        const local = questionUnavailableReason(next, current);
        if (local) { invalidateUserQuestion(current, local, new Date(context.timestamp()).toISOString()); return; }
        if (result?.accepted === true) {
          current.deliveryState = 'accepted'; current.status = 'resolved'; current.outcome = 'answered';
          current.resolvedAt = current.answerAcceptedAt = new Date(context.timestamp()).toISOString();
          delete current.reasonCode; delete current.unavailableAt;
          context.questionNativeTerminals.set(questionKey(current), 'answered');
        } else {
          current.deliveryState = reason === 'QUESTION_NOT_PENDING' ? 'not-pending' : 'unconfirmed';
          if (current.status === 'resolved') current.reasonCode = reason;
          else invalidateUserQuestion(current, reason, new Date(context.timestamp()).toISOString());
        }
      }));
    }).catch(async error => {
      if (context.closing) return;
      await context.serial(() => context.mutate(ownerId, next => {
        const row = userQuestions(next).find(item => item.questionRpcId === questionRpcId);
        if (row) invalidateUserQuestion(row, QUESTION_REASONS.has(error.code) ? error.code : 'QUESTION_OUTCOME_UNCONFIRMED', new Date(context.timestamp()).toISOString());
      })).catch(() => {});
    }).finally(() => { context.questionDeliveries.delete(key); context.active.delete(work); });
    context.questionDeliveries.set(key, work); context.active.add(work);
  }

  async function answerUserQuestion(request, ownerId, deviceId, sessionId, questionRpcId, body) {
    exactKeys(body, ['requestId', 'answer'], ['requestId', 'answer']);
    if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) throw failure('INVALID_REQUEST');
    if (!context.accountState(ownerId).sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
    let prior = userQuestions(context.accountState(ownerId)).find(row => row.sessionId === sessionId && row.questionRpcId === questionRpcId);
    if (!prior || prior.answerRequestId !== body.requestId) await syncUserQuestions(ownerId, sessionId);
    prior = userQuestions(context.accountState(ownerId)).find(row => row.sessionId === sessionId && row.questionRpcId === questionRpcId);
    if (!prior) throw failure('NOT_FOUND', 404);
    const answer = canonicalUserQuestionAnswer(body.answer, prior.questions), answerHash = digest(JSON.stringify(answer));
    const replay = prior.answerRequestId === body.requestId;
    const assertCurrent = () => { if (!replay) requireQuestionPending(prior); };
    const receipt = await context.serial(() => context.mutate(ownerId, next => {
      const current = context.authenticate(request, 'commands:write');
      if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
      const row = userQuestions(next).find(item => item.sessionId === sessionId && item.questionRpcId === questionRpcId);
      if (!row) throw failure('NOT_FOUND', 404);
      if (row.answerRequestId === body.requestId) {
        if (row.answerHash !== answerHash) throw failure('REQUEST_CONFLICT', 409);
        return userQuestionAnswerReceipt(row);
      }
      if (context.requestIdUsed(next, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
      if (row.status !== 'pending' || questionUnavailableReason(next, row)) throw failure('QUESTION_NOT_PENDING', 409);
      row.answer = answer; row.answerHash = answerHash; row.answerRequestId = body.requestId;
      row.answeredAt = new Date(context.timestamp()).toISOString(); row.status = 'answered'; row.deliveryState = 'ready';
      return userQuestionAnswerReceipt(row);
    }, assertCurrent));
    assertCurrent();
    if (!replay) scheduleUserQuestionDelivery(ownerId, questionRpcId);
    return receipt;
  }

  return {
    interactionRequestIdUsed,
    questionKey,
    questionIdentityFields,
    questionMatches,
    questionSource,
    questionUnavailableReason,
    requireQuestionPending,
    validateQuestionIdentity,
    nativeUserQuestionSnapshot,
    trackUserQuestion,
    syncUserQuestions,
    scheduleUserQuestionDelivery,
    answerUserQuestion
  };
}
