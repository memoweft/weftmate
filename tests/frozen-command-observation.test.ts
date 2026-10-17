import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForFrozenSessionCreate } from './integration/bl29-rework/frozen-command-observation.mjs';

const prefix = 'create did not complete; diagnostic=';
async function failureOf(action: () => Promise<unknown>) {
  try { await action(); assert.fail('The original non-accepted path must still fail'); }
  catch (error) { return error as Error; }
}
function details(error: Error) {
  assert.ok(error.message.startsWith(prefix), 'The original failure must preserve whitelisted final-state diagnostics');
  return JSON.parse(error.message.slice(prefix.length));
}

test('accepted returns immediately without a wait or reading failure diagnostics', async () => {
  let reads = 0, waits = 0;
  const value = await waitForFrozenSessionCreate(async () => {
    reads++; return { command: { state: 'accepted_by_dsh', get errorCode() { throw Error('Failure metadata must not be read on success'); } } };
  }, { pause: async () => { waits++; }, now: () => 0 });
  assert.equal(value, undefined); assert.equal(reads, 1); assert.equal(waits, 0);
});

test('an accepted third read retains the first two original waits and returns no diagnostic', async () => {
  let reads = 0; const waits: number[] = [];
  const value = await waitForFrozenSessionCreate(async () => ({ command: { state: ['pending', 'dispatching', 'accepted_by_dsh'][reads++] } }),
    { pause: async ms => { waits.push(ms); }, now: () => 0 });
  assert.equal(value, undefined); assert.equal(reads, 3); assert.deepEqual(waits, [5, 5]);
});

for (const state of ['pending', 'dispatching', 'rejected', 'uncertain']) test(`${state} retains all 100 reads and all 100 waits before the original failure`, async () => {
  let reads = 0, clock = 20; const events: string[] = [];
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => {
    reads++; clock += 2; events.push('read');
    return { command: { state, errorCode: 'RECEIPT_UNKNOWN', commandId: 'synthetic-secret-id', sessionId: 'synthetic-secret-session' } };
  }, { pause: async ms => { assert.equal(ms, 5); clock += ms; events.push('wait'); }, now: () => clock }));
  assert.equal(reads, 100); assert.equal(events.filter(event => event === 'wait').length, 100);
  assert.equal(events.at(-1), 'wait', 'The original last unsuccessful read must still be followed by its 5ms wait');
  assert.deepEqual(details(error), { polls: 100, lastState: state, errorCode: 'RECEIPT_UNKNOWN', elapsedMs: 700, interval: 'first-poll-start-to-final-wait-end' });
  assert.equal(error.message.includes('synthetic-secret'), false);
});

test('the failure reports the actual last state and a known backend code', async () => {
  let polls = 0;
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => ({ command: {
    state: ++polls === 100 ? 'uncertain' : 'pending', errorCode: 'BACKEND_UNAVAILABLE',
  } }), { pause: async () => {}, now: () => 0 }));
  assert.equal(details(error).lastState, 'uncertain'); assert.equal(details(error).errorCode, 'BACKEND_UNAVAILABLE');
});

test('unknown strings and arbitrary command fields never enter the failure output', async () => {
  const secret = 'synthetic-private@example.test';
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => ({ command: {
    state: secret, errorCode: 'SYNTHETIC_PRIVATE_TOKEN', commandId: secret, sessionId: secret, request: { text: secret },
  } }), { pause: async () => {}, now: () => 0 }));
  const diagnostic = details(error);
  assert.equal(diagnostic.lastState, 'unknown'); assert.equal(diagnostic.errorCode, 'unknown');
  assert.equal(error.message.includes(secret), false); assert.equal(error.message.includes('SYNTHETIC_PRIVATE_TOKEN'), false);
  assert.deepEqual(Object.keys(diagnostic), ['polls', 'lastState', 'errorCode', 'elapsedMs', 'interval']);
});

test('non-string metadata is not coerced or serialized', async () => {
  const forbidden = { toString() { throw Error('Do not coerce external metadata'); }, toJSON() { throw Error('Do not serialize external metadata'); } };
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => ({ command: { state: forbidden, errorCode: forbidden } }),
    { pause: async () => {}, now: () => 0 }));
  assert.equal(details(error).lastState, 'unknown'); assert.equal(details(error).errorCode, 'unknown');
});

test('a read exception is still the identical exception and starts no wait', async () => {
  const original = Error('Synthetic read failure'); let waits = 0;
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => { throw original; }, { pause: async () => { waits++; }, now: () => 0 }));
  assert.equal(error, original); assert.equal(waits, 0);
});

test('a wait exception is still the identical exception and starts no further read', async () => {
  const original = Error('Synthetic wait failure'); let reads = 0;
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => { reads++; return { command: { state: 'pending' } }; },
    { pause: async () => { throw original; }, now: () => 0 }));
  assert.equal(error, original); assert.equal(reads, 1);
});

test('an observation exception preserves the original final-state diagnostic after all 100 waits', async () => {
  let reads = 0, waits = 0, clock = 20;
  const privateDetail = 'synthetic-private-observation-detail';
  const error = await failureOf(() => waitForFrozenSessionCreate(async () => {
    reads++; clock += 2;
    return { command: { state: 'dispatching', errorCode: 'BACKEND_UNAVAILABLE' } };
  }, {
    pause: async ms => { assert.equal(ms, 5); waits++; clock += ms; }, now: () => clock,
    observe: () => { throw Error(privateDetail); },
  }));
  const diagnostic = details(error);
  assert.deepEqual(diagnostic, { polls: 100, lastState: 'dispatching', errorCode: 'BACKEND_UNAVAILABLE', elapsedMs: 700,
    interval: 'first-poll-start-to-final-wait-end', observationFailed: true, observationError: 'OBSERVER_EXCEPTION' });
  assert.equal(reads, 100); assert.equal(waits, 100);
  assert.equal(error.message.includes(privateDetail), false);
});

test('observer exceptions are classified without reading or serializing arbitrary thrown values', async () => {
  const forbidden = { get name() { throw Error('Do not read error names'); },
    toJSON() { throw Error('Do not serialize errors'); }, toString() { throw Error('Do not coerce errors'); } };
  for (const thrown of [undefined, forbidden, 'synthetic-private-error-text']) {
    const error = await failureOf(() => waitForFrozenSessionCreate(async () => ({ command: { state: 'uncertain', errorCode: 'RECEIPT_TIMEOUT' } }),
      { pause: async () => {}, now: () => 0, observe: () => { throw thrown; } }));
    assert.deepEqual(details(error), { polls: 100, lastState: 'uncertain', errorCode: 'RECEIPT_TIMEOUT', elapsedMs: 0,
      interval: 'first-poll-start-to-final-wait-end', observationFailed: true, observationError: 'OBSERVER_EXCEPTION' });
    assert.equal(error.message.includes('synthetic-private-error-text'), false);
  }
});
