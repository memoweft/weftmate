import { SAFE_CODES } from '../../../src/personal-access/constants.mjs';

const states = new Set(['pending', 'dispatching', 'accepted_by_dsh', 'accepted_by_host', 'observed', 'uncertain', 'rejected']);
const errorCodes = new Set([...SAFE_CODES, 'BACKEND_UNAVAILABLE', 'RECEIPT_TIMEOUT', 'RECEIPT_UNKNOWN',
  'DEVICE_REVOKED', 'SESSION_REPLACED', 'SESSION_EXPIRED', 'PROJECT_REVOKED', 'PROJECT_ROOT_CHANGED',
  'PROJECT_MODEL_CHANGED', 'CAPACITY_LIMIT', 'STORAGE_UNAVAILABLE', 'SERVICE_CLOSING']);

const phases = new Set(['schedule', 'dispatch.enter', 'dispatch.commit.start', 'dispatch.commit.done',
  'backend.await', 'backend.receipt', 'backend.error', 'receipt.commit.start', 'receipt.commit.done', 'dispatch.error']);
const observationFailure = () => ({ observationFailed: true, observationError: 'OBSERVER_EXCEPTION' });

export function observeFrozenCommand(context, requestId, { now = () => performance.now() } = {}) {
  const events = [], waiters = [];
  let commandId, ownerId, started, observationFailed = false;
  try { started = now(); }
  catch { observationFailed = true; }
  context.__reviewCommandPhase = (owner, id, phase, code) => {
    if (observationFailed) return;
    try {
      const command = context.accountState(owner).commands[id];
      if (command?.requestId !== requestId || !phases.has(phase)) return;
      commandId = id; ownerId = owner;
      events.push({ phase, elapsedMs: Math.max(0, Math.round(now() - started)),
        state: states.has(command.state) ? command.state : 'unknown',
        ...(code === undefined ? {} : { errorCode: errorCodes.has(code) ? code : 'unknown' }) });
    } catch { observationFailed = true; }
    for (const waiter of waiters.splice(0)) waiter();
  };
  return {
    snapshot() {
      const snapshot = { events: events.map(event => ({ ...event })) };
      try {
        const key = `${ownerId}|${commandId}`;
        Object.assign(snapshot, { scheduled: context.scheduled.has(key), active: context.activeByCommand.has(key),
          closing: context.closing, storageFault: context.storageFault });
      } catch { observationFailed = true; }
      if (observationFailed) Object.assign(snapshot, observationFailure());
      return snapshot;
    },
    async waitFor(phase) {
      while (!events.some(event => event.phase === phase)) {
        if (observationFailed) throw Object.assign(Error('Frozen command observation failed'), { code: 'OBSERVER_EXCEPTION' });
        await new Promise(resolve => waiters.push(resolve));
      }
    },
    close() { delete context.__reviewCommandPhase; },
  };
}

// Keep the frozen-state probe's original acceptance and counted wait policy.
export async function waitForFrozenSessionCreate(read, {
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => performance.now(),
  observe,
} = {}) {
  const started = now();
  let polls = 0, lastCommand, lastState;
  for (let i = 0; i < 100; i++) {
    const response = await read();
    polls++; lastCommand = response.command; lastState = lastCommand.state;
    if (lastState === 'accepted_by_dsh') return;
    await pause(5);
  }
  // This ends after the original final pause. It excludes POST /commands and
  // is neither the complete create operation nor the parent test duration.
  const elapsedMs = Math.max(0, Math.round(now() - started));
  const errorCode = lastCommand.errorCode;
  const diagnostic = { polls, lastState: states.has(lastState) ? lastState : 'unknown',
    errorCode: errorCodes.has(errorCode) ? errorCode : 'unknown', elapsedMs,
    interval: 'first-poll-start-to-final-wait-end' };
  if (observe) {
    try { diagnostic.dispatch = observe(); }
    catch { Object.assign(diagnostic, observationFailure()); }
  }
  throw Error('create did not complete; diagnostic=' + JSON.stringify(diagnostic));
}
