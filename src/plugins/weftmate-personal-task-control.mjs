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
    Object.keys(frame).filter(key => key !== 'queuedOnly').sort().join(',') === 'id,protocol,receiptIds,requestId,sessionId' &&
    (frame.queuedOnly === undefined || frame.queuedOnly === true) &&
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
  if (!input.queuedOnly && safeActive && openTurnOf(agent) === openTurn) {
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

/** Cancel and await only native jobs claimed by this exact session and original receipt. */
export async function stopReceiptBackgroundJobs(jobs, claims, input) {
  return Promise.all(input.receiptIds.map(async receiptId => {
    const owned = claims.get(`${input.sessionId}\u0000${receiptId}`) ?? new Map();
    const backgroundJobs = await Promise.all([...owned.entries()].map(async ([jobId, owner]) => {
      try {
        if (owner.session?.id !== input.sessionId) return { jobId, state: 'unconfirmed' };
        const initial = jobs.get(jobId, owner);
        if (initial.ownerSession !== input.sessionId || initial.kind !== 'pwsh') return { jobId, state: 'unconfirmed' };
        if (['running', 'stopping'].includes(initial.status)) {
          jobs.kill(jobId, owner, 'personal task stop');
          await jobs.wait(jobId, 2_000, owner);
        }
        const state = jobs.get(jobId, owner).status;
        return { jobId, state: ['running', 'stopping', 'completed', 'killed', 'failed'].includes(state) ? state : 'unconfirmed' };
      } catch { return { jobId, state: 'unconfirmed' }; }
    }));
    return { receiptId, backgroundJobs };
  }));
}

/** Bind the native record before awaiting anything; a prior stop applies to late registration too. */
export function claimReceiptBackgroundJob(agents, jobs, claims, stoppedReceipts, claim) {
  const owner = agents.get(claim.sessionId);
  if (owner !== claim.owner || owner?.id !== claim.sessionId ||
      owner?.session?.header?.agentPreset !== 'personal-remote' ||
      typeof claim.receiptId !== 'string' || !RECEIPT.test(claim.receiptId) ||
      typeof claim.jobId !== 'string' || !RECEIPT.test(claim.jobId) || !jobs) return false;
  let snapshot;
  try { snapshot = jobs.get(claim.jobId, owner); } catch { return false; }
  if (snapshot.ownerSession !== claim.sessionId || snapshot.kind !== 'pwsh') return false;
  const key = `${claim.sessionId}\u0000${claim.receiptId}`;
  let table = claims.get(key);
  if (!table) {
    if (claims.size >= recentLimit) return false;
    table = new Map(); claims.set(key, table);
  }
  if (!table.has(claim.jobId) && table.size >= 32) return false;
  table.set(claim.jobId, owner);
  return stoppedReceipts.has(key)
    ? stopReceiptBackgroundJobs(jobs, claims, { sessionId: claim.sessionId, receiptIds: [claim.receiptId] }).then(() => true)
    : true;
}

export function createTaskStopHandler(agents, claimedBySession, send, stopJobs = null, onStop = null) {
  const recent = new Map();
  return (frame) => {
    if (frame?.protocol !== PERSONAL_TASK_CONTROL_PROTOCOL || !validRequest(frame)) return;
    const key = `${frame.sessionId}\u0000${frame.requestId}\u0000${frame.queuedOnly === true}`;
    const stable = recent.get(key) ?? new Map();
    recent.delete(key);
    recent.set(key, stable);
    if (recent.size > recentLimit) recent.delete(recent.keys().next().value);
    let result;
    try { if (!frame.queuedOnly) onStop?.(frame); result = stopExactTask(agents, claimedBySession, frame); }
    catch { result = { status: 'unconfirmed', outcomes: frame.receiptIds.map((receiptId) =>
      ({ receiptId, status: 'unconfirmed' })) }; }
    const finish = (jobs = [], forceUnconfirmed = false) => {
      result.outcomes = result.outcomes.map((outcome) => {
        const backgroundJobs = jobs.find(item => item.receiptId === outcome.receiptId)?.backgroundJobs ?? [];
        const previous = stable.get(outcome.receiptId);
        if (previous && !forceUnconfirmed) outcome = { ...previous };
        if (backgroundJobs.length) {
          outcome = { ...outcome, backgroundJobs,
            status: backgroundJobs.some(job => job.state === 'unconfirmed') ? 'unconfirmed' : 'cancel_requested' };
          if (outcome.status === 'unconfirmed') delete outcome.turn;
        }
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
    let work;
    try { if (!frame.queuedOnly) work = stopJobs?.(frame); } catch (error) { work = Promise.reject(error); }
    if (work) Promise.resolve(work).then(finish, () => {
      result.outcomes = result.outcomes.map(outcome => ({ ...outcome, status: 'unconfirmed' }));
      finish([], true);
    });
    else finish();
  };
}

export function apply(ctx) {
  const claimedBySession = new Map();
  const backgroundClaims = new Map();
  const stoppedReceipts = new Map();
  ctx.on('weftmate/personal-job', (claim, next) => {
    const result = claimReceiptBackgroundJob(ctx.agents, ctx.get('jobs'), backgroundClaims, stoppedReceipts, claim);
    return result === false ? next() : Promise.resolve(result);
  });
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
  }, frame => frame.receiptIds.some(receiptId => backgroundClaims.has(`${frame.sessionId}\u0000${receiptId}`))
    ? stopReceiptBackgroundJobs(ctx.get('jobs'), backgroundClaims, frame) : null, frame => {
      for (const receiptId of frame.receiptIds) {
        const key = `${frame.sessionId}\u0000${receiptId}`;
        stoppedReceipts.delete(key); stoppedReceipts.set(key, true);
      }
      while (stoppedReceipts.size > recentLimit * MAX_TARGETS) stoppedReceipts.delete(stoppedReceipts.keys().next().value);
    });
  process.on('message', onMessage);
  ctx.effect(() => () => {
    process.off('message', onMessage);
    claimedBySession.clear();
    backgroundClaims.clear();
    stoppedReceipts.clear();
  }, 'weftmate-personal-task-control: exact stop IPC lifecycle');
}

export default { name, inject, apply };
