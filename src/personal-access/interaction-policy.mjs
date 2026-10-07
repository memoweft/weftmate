import { digest, exactKeys, failure, plainObject, validId, validTime } from './common.mjs';
import {
  APPROVAL_DECISIONS,
  APPROVAL_FIELDS,
  APPROVAL_INVALIDATION_REASONS,
  APPROVAL_OUTCOMES,
  APPROVAL_PUBLIC_FIELDS,
  APPROVAL_STATES,
  EXECUTION_FIELDS,
  EXECUTION_STATES,
  GENERAL_TOOL_NAME,
  JOB_STATES,
  MAX_BODY,
  MAX_COMMAND_TOOL_APPROVALS,
  QUESTION_DELIVERY_STATES,
  QUESTION_FIELDS,
  QUESTION_PUBLIC_FIELDS,
  QUESTION_REASONS,
  REQUEST_ID,
  TOOL_RUNTIME_ID
} from './constants.mjs';
import { RISK_CATEGORIES } from '../plugins/personal-approval-policy.mjs';
import { sourceMessageHash } from './command-policy.mjs';

export function questionText(value) {
  return typeof value === 'string';
}

export function canonicalUserQuestions(value) {
  if (!Array.isArray(value) || value.length < 1) throw failure('INVALID_REQUEST');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BODY) throw failure('BODY_TOO_LARGE', 413);
  const questions = value.map(question => {
    exactKeys(question, ['id', 'question', 'header', 'detail', 'options', 'multiSelect', 'intent'], ['id', 'question']);
    if (!questionText(question.id) || !questionText(question.question) ||
        ['header', 'detail'].some(key => question[key] !== undefined && !questionText(question[key])) ||
        question.multiSelect !== undefined && typeof question.multiSelect !== 'boolean') throw failure('INVALID_REQUEST');
    let options;
    if (question.options !== undefined) {
      if (!Array.isArray(question.options)) throw failure('INVALID_REQUEST');
      options = question.options.map(option => {
        exactKeys(option, ['label', 'description'], ['label']);
        if (!questionText(option.label) || option.description !== undefined && !questionText(option.description)) throw failure('INVALID_REQUEST');
        return { label: option.label, ...(option.description !== undefined ? { description: option.description } : {}) };
      });
    }
    let intent;
    if (question.intent !== undefined) {
      exactKeys(question.intent, ['kind', 'approve'], ['kind', 'approve']);
      if (question.intent.kind !== 'plan-review' || !questionText(question.intent.approve) ||
          question.detail === undefined || !options?.some(option => option.label === question.intent.approve)) throw failure('INVALID_REQUEST');
      intent = { kind: 'plan-review', approve: question.intent.approve };
    }
    return { id: question.id, question: question.question,
      ...(question.header !== undefined ? { header: question.header } : {}),
      ...(question.detail !== undefined ? { detail: question.detail } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(question.multiSelect !== undefined ? { multiSelect: question.multiSelect } : {}),
      ...(intent !== undefined ? { intent } : {}) };
  });
  if (Buffer.byteLength(JSON.stringify(questions), 'utf8') > MAX_BODY) throw failure('BODY_TOO_LARGE', 413);
  return questions;
}

export function canonicalUserQuestionAnswer(value, questions) {
  exactKeys(value, ['answers'], ['answers']);
  if (!Array.isArray(value.answers) || value.answers.length !== questions.length) throw failure('INVALID_REQUEST');
  const answers = value.answers.map((answer, index) => {
    exactKeys(answer, ['id', 'selected', 'custom'], ['id', 'selected']);
    const question = questions[index];
    if (answer.id !== question.id || !Array.isArray(answer.selected) ||
        answer.selected.some(label => !questionText(label)) || new Set(answer.selected).size !== answer.selected.length ||
        answer.custom !== undefined && (!questionText(answer.custom) || !answer.custom.trim()) ||
        question.multiSelect !== true && (answer.selected.length > 1 || answer.custom !== undefined && answer.selected.length > 0)) {
      throw failure('INVALID_REQUEST');
    }
    const labels = new Set((question.options ?? []).map(option => option.label));
    if (answer.selected.some(label => !labels.has(label))) throw failure('INVALID_REQUEST');
    return { id: answer.id, selected: [...answer.selected], ...(answer.custom !== undefined ? { custom: answer.custom } : {}) };
  });
  const answer = { answers };
  if (Buffer.byteLength(JSON.stringify(answer), 'utf8') > MAX_BODY) throw failure('BODY_TOO_LARGE', 413);
  return answer;
}

export function userQuestions(account) {
  return Object.values(account.commands).flatMap(command => command.userQuestions ?? []);
}

export function publicUserQuestion(row) {
  return structuredClone(Object.fromEntries([...QUESTION_PUBLIC_FIELDS, 'observedSeq'].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
}

export function userQuestionAnswerReceipt(row) {
  const question = publicUserQuestion(row);
  question.status = 'answered';
  for (const key of ['outcome', 'resolvedAt', 'answerAcceptedAt', 'reasonCode', 'unavailableAt']) delete question[key];
  return { question, requestId: row.answerRequestId };
}

export function invalidateUserQuestion(row, reasonCode, at) {
  if (!['pending', 'answered'].includes(row.status)) return false;
  row.status = 'unavailable'; row.reasonCode = reasonCode; row.unavailableAt = at;
  return true;
}

export function validUserQuestions(command, store) {
  const rows = command.userQuestions;
  if (rows === undefined) return true;
  if (command.kind !== 'session.message' || store.sessions[command.sessionId]?.origin !== 'personal-remote' ||
      !Array.isArray(rows) || rows.length > MAX_COMMAND_TOOL_APPROVALS ||
      new Set(rows.map(row => row?.questionRpcId)).size !== rows.length) return false;
  return rows.every(row => {
    if (!plainObject(row) || Object.keys(row).some(key => !QUESTION_FIELDS.includes(key)) ||
        typeof row.questionRpcId !== 'string' || !TOOL_RUNTIME_ID.test(row.questionRpcId) ||
        typeof row.runtimeId !== 'string' || !TOOL_RUNTIME_ID.test(row.runtimeId) || row.sessionId !== command.sessionId ||
        row.sourceCommandId !== command.commandId || row.sourceReceiptId !== command.receiptId || !validId(row.sourceReceiptId) ||
        row.taskId !== (command.rootTaskId ?? command.commandId) || store.commands[row.taskId]?.kind !== 'session.message' ||
        store.commands[row.taskId]?.rootTaskId !== undefined || store.commands[row.taskId]?.sessionId !== row.sessionId ||
        !Number.isSafeInteger(row.turn) || row.turn < 1 || row.turn !== command.dshTurn ||
        row.messageHash !== sourceMessageHash(command) || !Number.isSafeInteger(row.sourceSeq) || row.sourceSeq < 0 ||
        !Number.isSafeInteger(row.observedSeq) || row.observedSeq < row.sourceSeq ||
        !validTime(row.createdAt) || !APPROVAL_STATES.has(row.status)) return false;
    try {
      if (JSON.stringify(canonicalUserQuestions(row.questions)) !== JSON.stringify(row.questions) ||
          digest(JSON.stringify(row.questions)) !== row.questionsHash) return false;
      const hasAnswer = [row.answer, row.answerRequestId, row.answeredAt, row.answerHash].some(value => value !== undefined);
      if (hasAnswer && (typeof row.answerRequestId !== 'string' || !REQUEST_ID.test(row.answerRequestId) || !validTime(row.answeredAt) ||
          JSON.stringify(canonicalUserQuestionAnswer(row.answer, row.questions)) !== JSON.stringify(row.answer) ||
          digest(JSON.stringify(row.answer)) !== row.answerHash || !QUESTION_DELIVERY_STATES.has(row.deliveryState))) return false;
      if (row.status === 'pending' && (hasAnswer || row.deliveryState !== undefined || row.deliveryAttemptedAt !== undefined) ||
          row.status === 'answered' && !hasAnswer ||
          row.status === 'resolved' && (!['answered', 'cancelled'].includes(row.outcome) || !validTime(row.resolvedAt)) ||
          row.status !== 'resolved' && (row.outcome !== undefined || row.resolvedAt !== undefined) ||
          row.status === 'unavailable' && (!QUESTION_REASONS.has(row.reasonCode) || !validTime(row.unavailableAt)) ||
          row.answerAcceptedAt !== undefined && (!hasAnswer || row.deliveryState !== 'accepted' || !validTime(row.answerAcceptedAt)) ||
          row.status !== 'unavailable' && (row.unavailableAt !== undefined || row.reasonCode !== undefined &&
            !(row.status === 'resolved' && hasAnswer && row.answerAcceptedAt === undefined &&
              QUESTION_REASONS.has(row.reasonCode))) ||
          row.deliveryAttemptedAt !== undefined && !validTime(row.deliveryAttemptedAt) ||
          !hasAnswer && (row.deliveryState !== undefined || row.deliveryAttemptedAt !== undefined) ||
          hasAnswer && (row.deliveryState === 'ready' ? row.deliveryAttemptedAt !== undefined : !validTime(row.deliveryAttemptedAt))) return false;
      return true;
    } catch { return false; }
  });
}

export function validToolApprovals(command, store) {
  const rows = command.toolApprovals;
  if (rows === undefined) return true;
  if (command.kind !== 'session.message' || store.sessions[command.sessionId]?.origin !== 'personal-remote' ||
      !Array.isArray(rows) || rows.length > MAX_COMMAND_TOOL_APPROVALS ||
      new Set(rows.map(row => row?.approvalId)).size !== rows.length) return false;
  return rows.every(row => {
    if (row?.decisionScope !== undefined && (!['once', 'conversation-category'].includes(row.decisionScope) ||
        row.decisionScope === 'conversation-category' && row.decisionOutcome !== 'allowed-once') ||
        row?.riskCategories !== undefined && (!Array.isArray(row.riskCategories) || row.riskCategories.some(x => !RISK_CATEGORIES.includes(x)))) return false;
    if (!plainObject(row) || Object.keys(row).some(key => !APPROVAL_FIELDS.includes(key)) ||
        !TOOL_RUNTIME_ID.test(row.approvalId ?? '') || row.sessionId !== command.sessionId ||
        row.taskId !== (command.rootTaskId ?? command.commandId) ||
        store.commands[row.taskId]?.kind !== 'session.message' ||
        store.commands[row.taskId]?.rootTaskId !== undefined ||
        store.commands[row.taskId]?.sessionId !== row.sessionId ||
        row.sourceCommandId !== command.commandId || row.sourceReceiptId !== command.receiptId ||
        !validId(row.sourceReceiptId) || typeof row.callId !== 'string' || typeof row.rootCallId !== 'string' ||
        !REQUEST_ID.test(row.callId) || !REQUEST_ID.test(row.rootCallId) ||
        typeof row.toolName !== 'string' || !GENERAL_TOOL_NAME.test(row.toolName) ||
        !Number.isSafeInteger(row.turn) || row.turn < 1 || row.turn !== command.dshTurn ||
        typeof row.reason !== 'string' || row.reason.length > 1000 ||
        !validTime(row.createdAt) || !APPROVAL_STATES.has(row.status) ||
        !/^[a-f0-9]{64}$/.test(row.messageHash ?? '') || row.messageHash !== sourceMessageHash(command) ||
        !/^[a-f0-9]{64}$/.test(row.argumentsHash ?? '') ||
        !TOOL_RUNTIME_ID.test(row.runtimeId ?? '')) return false;
    const hasDecision = [row.decisionOutcome, row.decisionRequestId, row.answeredAt].some(value => value !== undefined);
    if (hasDecision && (!APPROVAL_DECISIONS.has(row.decisionOutcome) ||
        typeof row.decisionRequestId !== 'string' || !REQUEST_ID.test(row.decisionRequestId) || !validTime(row.answeredAt))) return false;
    if (row.status === 'pending' && (hasDecision || row.outcome !== undefined || row.resolvedAt !== undefined) ||
        row.status === 'answered' && (!hasDecision || row.outcome !== undefined || row.resolvedAt !== undefined) ||
        row.status === 'resolved' && (!APPROVAL_OUTCOMES.has(row.outcome) || !validTime(row.resolvedAt)) ||
        row.status === 'unavailable' && (!['cancelled', 'unavailable'].includes(row.outcome) ||
          !validTime(row.invalidatedAt) || !APPROVAL_INVALIDATION_REASONS.has(row.invalidationReason))) return false;
    if (row.outcome !== undefined && !APPROVAL_OUTCOMES.has(row.outcome) ||
        row.resolvedAt !== undefined && !validTime(row.resolvedAt) ||
        row.status === 'resolved' && APPROVAL_DECISIONS.has(row.outcome) && !hasDecision ||
        row.status !== 'unavailable' && (row.invalidatedAt !== undefined || row.invalidationReason !== undefined) ||
        hasDecision && row.status === 'resolved' && APPROVAL_DECISIONS.has(row.outcome) &&
          row.decisionOutcome !== row.outcome) return false;
    return true;
  });
}

export function publicToolApproval(row) {
  return Object.fromEntries(APPROVAL_PUBLIC_FIELDS.filter(key => row[key] !== undefined)
    .map(key => [key, row[key]]));
}

export function approvalDecisionReceipt(row) {
  const approval = publicToolApproval(row);
  approval.status = 'answered';
  delete approval.outcome;
  delete approval.resolvedAt;
  return { approval, requestId: row.decisionRequestId };
}

export function toolApprovals(account) {
  return Object.values(account.commands).flatMap(command => command.toolApprovals ?? []);
}

export function invalidateToolApproval(row, reason, at) {
  if (!['pending', 'answered'].includes(row.status)) return false;
  row.status = 'unavailable';
  row.outcome = reason === 'task_stopped' ? 'cancelled' : 'unavailable';
  row.invalidatedAt = at;
  row.invalidationReason = reason;
  return true;
}

export function validToolExecutions(command, store) {
  const rows = command.toolExecutions;
  if (rows === undefined) return true;
  if (command.kind !== 'session.message' || store.sessions[command.sessionId]?.origin !== 'personal-remote' ||
      !Array.isArray(rows) || rows.length > 256 || new Set(rows.map(row => row?.executionId)).size !== rows.length ||
      new Set(rows.map(row => row?.callId)).size !== rows.length) return false;
  return rows.every(row => plainObject(row) && Object.keys(row).every(key => EXECUTION_FIELDS.includes(key)) &&
    /^exec-[a-f0-9]{48}$/.test(row.executionId ?? '') && row.sourceCommandId === command.commandId &&
    row.sourceReceiptId === command.receiptId && typeof row.rootCallId === 'string' && typeof row.callId === 'string' &&
    REQUEST_ID.test(row.rootCallId) && REQUEST_ID.test(row.callId) &&
    typeof row.toolName === 'string' && GENERAL_TOOL_NAME.test(row.toolName) && Number.isSafeInteger(row.turn) && row.turn > 0 && row.turn === command.dshTurn &&
    EXECUTION_STATES.has(row.state) && /^[a-f0-9]{64}$/.test(row.argumentsHash ?? '') &&
    (row.runtimeId === undefined || TOOL_RUNTIME_ID.test(row.runtimeId)) &&
    validTime(row.startedAt) && validTime(row.updatedAt) &&
    (row.finishedAt === undefined || validTime(row.finishedAt)) &&
    (row.resultHash === undefined || /^[a-f0-9]{64}$/.test(row.resultHash)) &&
    ((row.jobId === undefined && row.jobState === undefined && row.jobObservedAt === undefined) ||
      row.toolName === 'pwsh' && REQUEST_ID.test(row.jobId ?? '') && JOB_STATES.has(row.jobState) && validTime(row.jobObservedAt)) &&
    (['running', 'uncertain'].includes(row.state) ? row.finishedAt === undefined && row.resultHash === undefined
      : row.finishedAt !== undefined && row.resultHash !== undefined));
}
