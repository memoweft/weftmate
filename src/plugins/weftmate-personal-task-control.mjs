/** Exact, same-process task cancellation for the pinned DSH agent loop. */
export const name = 'weftmate-personal-task-control';
export const inject = ['agents'];
export const PERSONAL_TASK_CONTROL_PROTOCOL = 'weftmate.personal-task-control.v1';

const RECEIPT = /^[A-Za-z0-9._:-]{1,160}$/;
const REQUEST = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_TARGETS = 16;
const recentLimit = 256;

function validRequest(frame) {
  return frame && typeof frame === 'object' && !Array.isArray(frame) &&
    Object.keys(frame).sort().join(',') === 'id,protocol,receiptIds,requestId,sessionId' &&
    frame.protocol === PERSONAL_TASK_CONTROL_PROTOCOL && typeof frame.id === 'string' &&
    /^stop-[0-9a-f-]{36}$/.test(frame.id) &&
    typeof frame.requestId === 'string' && REQUEST.test(frame.requestId) &&
    typeof frame.sessionId === 'string' && frame.sessionId.length > 0 && frame.sessionId.length <= 160 &&
    Array.isArray(frame.receiptIds) && frame.receiptIds.length > 0 && frame.receiptIds.length <= MAX_TARGETS &&
    frame.receiptIds.every((id) => typeof id === 'string' && RECEIPT.test(id)) &&
    new Set(frame.receiptIds).size === frame.receiptIds.length;
}

function receiptOf(message) {
  const source = message?.source;
  return source?.kind === 'user' && typeof source.rpcId === 'string' && RECEIPT.test(source.rpcId)
    ? source.rpcId : null;
}

function openTurnOf(agent) {
  const events = agent?.session?.events;
  if (!Array.isArray(events) || agent.phase?.kind !== 'running' ||
      agent.phase.abort?.signal?.aborted) return null;
  const last = events.findLast((event) => event?.type === 'turn/start' || event?.type === 'turn/end');
  const turn = last?.type === 'turn/start' ? last.data?.turn : null;
  return Number.isSafeInteger(turn) && turn > 0 && agent.phase.turn === turn ? turn : null;
}

/** The full inspection and mutation have no await boundary. */
export function stopExactTask(agents, claimedBySession, input) {
  const unknown = () => ({ status: 'unconfirmed', outcomes: input.receiptIds.map((receiptId) =>
    ({ receiptId, status: 'unconfirmed' })) });
  const agent = agents.get(input.sessionId);
  if (!agent || agent.session?.id !== input.sessionId ||
      agent.session?.header?.agentPreset !== 'personal-remote' ||
      !Array.isArray(agent.session.events) || !agent.inbox) return unknown();
  const wanted = new Set(input.receiptIds);
  const queued = new Map();
  for (const message of [...(agent.inbox.nextTurn ?? []), ...(agent.inbox.nextStep ?? [])]) {
    const receiptId = receiptOf(message);
    if (receiptId && wanted.has(receiptId)) {
      if (queued.has(receiptId)) return unknown();
      queued.set(receiptId, message.id);
    }
  }
  const openTurn = openTurnOf(agent);
  const activeMessages = [];
  if (openTurn !== null) {
    const startIndex = agent.session.events.findLastIndex((event) => event?.type === 'turn/start' &&
      event.data?.turn === openTurn);
    for (const event of agent.session.events.slice(startIndex + 1)) {
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') activeMessages.push(event.data);
    }
    for (const message of claimedBySession.get(input.sessionId)?.get(openTurn)?.values() ?? []) {
      if (!activeMessages.some((candidate) => candidate.id === message.id)) activeMessages.push(message);
    }
  }
  const activeReceipts = activeMessages.map(receiptOf);
  const activeTargets = activeReceipts.filter((receiptId) => receiptId && wanted.has(receiptId));
  const safeActive = activeTargets.length > 0 && activeReceipts.every((receiptId) => receiptId && wanted.has(receiptId)) &&
    new Set(activeReceipts).size === activeReceipts.length;
  // Inspect every target before mutating. A missing or duplicated identity can
  // never justify cancelling a live turn, even if its text matches.
  const outcomes = input.receiptIds.map((receiptId) => ({ receiptId, status: 'unconfirmed' }));
  for (const outcome of outcomes) {
    const messageId = queued.get(outcome.receiptId);
    if (typeof messageId === 'string' && messageId.length > 0 && agent.inbox.remove(messageId) === true) {
      outcome.status = 'queue_removed';
    }
  }
  if (safeActive && openTurnOf(agent) === openTurn) {
    for (const outcome of outcomes) {
      if (activeReceipts.includes(outcome.receiptId)) {
        outcome.status = 'cancel_requested';
        outcome.turn = openTurn;
      }
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true });
    // rc.5 only re-enters the driver after an abort when wakeRequested was
    // latched. A followup queued before the abort did not latch that flag.
    if (agent.inbox.hasPending && typeof agent.wakeDriver === 'function') agent.wakeDriver(true);
  }
  return { status: outcomes.some((item) => item.status === 'unconfirmed') ? 'unconfirmed'
    : outcomes.some((item) => item.status === 'cancel_requested') ? 'cancel_requested' : 'queue_removed', outcomes };
}

export function createTaskStopHandler(agents, claimedBySession, send) {
  const recent = new Map();
  return (frame) => {
    if (frame?.protocol !== PERSONAL_TASK_CONTROL_PROTOCOL || !validRequest(frame)) return;
    const key = `${frame.sessionId}\u0000${frame.requestId}`;
    const stable = recent.get(key) ?? new Map();
    let result;
    try { result = stopExactTask(agents, claimedBySession, frame); }
    catch { result = { status: 'unconfirmed', outcomes: frame.receiptIds.map((receiptId) =>
      ({ receiptId, status: 'unconfirmed' })) }; }
    result.outcomes = result.outcomes.map((outcome) => {
      const previous = stable.get(outcome.receiptId);
      if (previous) return previous;
      if (outcome.status !== 'unconfirmed') stable.set(outcome.receiptId, outcome);
      return outcome;
    });
    result.status = result.outcomes.some((item) => item.status === 'unconfirmed') ? 'unconfirmed'
      : result.outcomes.some((item) => item.status === 'cancel_requested') ? 'cancel_requested' : 'queue_removed';
    recent.delete(key);
    recent.set(key, stable);
    if (recent.size > recentLimit) recent.delete(recent.keys().next().value);
    send({ protocol: PERSONAL_TASK_CONTROL_PROTOCOL, id: frame.id, ...result });
  };
}

export function apply(ctx) {
  const claimedBySession = new Map();
  const onClaimed = ({ agent, message, turn }) => {
    if (agent?.session?.header?.agentPreset !== 'personal-remote' ||
        typeof agent.session.id !== 'string' || !Number.isSafeInteger(turn)) return;
    let turns = claimedBySession.get(agent.session.id);
    if (!turns) { turns = new Map(); claimedBySession.set(agent.session.id, turns); }
    let messages = turns.get(turn);
    if (!messages) { messages = new Map(); turns.set(turn, messages); }
    if (typeof message?.id === 'string') messages.set(message.id, message);
  };
  ctx.on('agent/inbox/claimed', onClaimed);
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end' || !Number.isSafeInteger(event.data?.turn)) return;
    const turns = claimedBySession.get(session?.id);
    turns?.delete(event.data.turn);
    if (turns?.size === 0) claimedBySession.delete(session.id);
  });
  const onMessage = createTaskStopHandler(ctx.agents, claimedBySession, (frame) => {
    if (typeof process.send === 'function' && process.connected) {
      try { process.send(frame); }
      catch { /* Parent will time out and preserve the stop intent. */ }
    }
  });
  process.on('message', onMessage);
  ctx.effect(() => () => {
    process.off('message', onMessage);
    claimedBySession.clear();
  }, 'weftmate-personal-task-control: exact stop IPC lifecycle');
}

export default { name, inject, apply };
