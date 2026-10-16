import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('./integration/bl29-rework/exit-entry.mjs', import.meta.url), 'utf8');
const begin = source.indexOf('const exitPhases=[];');
const end = source.indexOf('const original=Tray.prototype.setContextMenu;');
assert.ok(begin >= 0 && end > begin, 'The actual exit observation block must be available');
const observation = source.slice(begin, end);

// Execute the fixture's own wrapper without Electron. Only its stdout sink and
// native exit dependency are controlled; the observation code is not replaced.
function fixture({ failPublication = false, nativeError = null as Error | null } = {}) {
  const calls: { receiver: unknown, args: unknown[] }[] = [], output: string[] = [];
  const result = { originalResult: true };
  const app: any = new EventEmitter(), processEvents = new EventEmitter();
  app.exit = function (...args: unknown[]) {
    calls.push({ receiver: this, args });
    if (nativeError) throw nativeError;
    return result;
  };
  const fs = { writeSync(fd: number, text: string) {
    assert.equal(fd, 1); output.push(text);
    if (failPublication) throw Object.assign(Error('Synthetic observation pipe closed'), { code: 'EPIPE' });
    return Buffer.byteLength(text);
  } };
  runInNewContext(observation, { fs, app, process: processEvents, performance, Date });
  return { app, calls, output, result, processEvents };
}

test('exit observation preserves the native result and receiver when publishing succeeds', () => {
  const f = fixture();
  assert.equal(f.app.exit(7), f.result);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.app);
  assert.deepEqual(f.calls[0].args, [7]);
  assert.equal(f.output.length, 1);
  const phases = JSON.parse(f.output[0].slice('BL29_EXIT_PHASES '.length));
  assert.equal(phases.at(-1).name, 'native-app-exit');
});

test('a failed phase publication still invokes native exit exactly once and preserves its return', () => {
  const f = fixture({ failPublication: true });
  assert.equal(f.app.exit(13), f.result);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.app);
  assert.deepEqual(f.calls[0].args, [13]);
  assert.equal(f.output.length, 1, 'Observation failure must not start another output or retry');
});

test('exit observation retains the original app receiver and all native arguments', () => {
  const f = fixture(), extra = { syntheticArgument: true };
  assert.equal(f.app.exit.call({ otherReceiver: true }, 17, extra), f.result);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.app);
  assert.deepEqual(f.calls[0].args, [17, extra]);
});

for (const failPublication of [false, true]) test(`native exit errors remain unchanged when publication failure is ${failPublication}`, () => {
  const nativeError = Object.assign(Error('Synthetic native exit failure'), { code: 'SYNTHETIC_NATIVE_EXIT' });
  const f = fixture({ failPublication, nativeError });
  assert.throws(() => f.app.exit(19), error => error === nativeError);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.app);
  assert.deepEqual(f.calls[0].args, [19]);
  assert.equal(f.output.length, 1);
});

test('process exit observation does not throw or invoke native exit when the output pipe fails', () => {
  const f = fixture({ failPublication: true });
  assert.doesNotThrow(() => f.processEvents.emit('exit', 0));
  assert.equal(f.calls.length, 0);
  assert.equal(f.output.length, 1);
});
