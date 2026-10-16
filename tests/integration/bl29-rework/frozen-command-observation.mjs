import { SAFE_CODES } from '../../../src/personal-access/constants.mjs';

const states = new Set(['pending', 'dispatching', 'accepted_by_dsh', 'accepted_by_host', 'observed', 'uncertain', 'rejected']);
const errorCodes = new Set([...SAFE_CODES, 'BACKEND_UNAVAILABLE', 'RECEIPT_TIMEOUT', 'RECEIPT_UNKNOWN',
  'DEVICE_REVOKED', 'SESSION_REPLACED', 'SESSION_EXPIRED', 'PROJECT_REVOKED', 'PROJECT_ROOT_CHANGED',
  'PROJECT_MODEL_CHANGED', 'CAPACITY_LIMIT', 'STORAGE_UNAVAILABLE', 'SERVICE_CLOSING']);

// Keep the frozen-state probe's original acceptance and counted wait policy.
export async function waitForFrozenSessionCreate(read, {
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => performance.now(),
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
  throw Error('create did not complete; diagnostic=' + JSON.stringify(diagnostic));
}
