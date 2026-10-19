import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { createWindowsBoundsBridge } from '../src/windows-bounds-bridge.mjs';

function fixture(verify = () => true, timeoutMs = 1000) {
  const child = { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() };
  let complete: (error?: Error) => void = () => {}, terminated = 0;
  const job = createWindowsBoundsBridge({ input: { handle: '1' }, timeoutMs,
    start: (done: (error?: Error) => void) => { complete = done; return child; },
    convert: (raw: unknown) => raw, verify, terminate: async () => { terminated++; } });
  return { child, job, complete: (error?: Error) => complete(error), terminated: () => terminated };
}
test('native bridge accepts only a completed protocol and exact readback', async () => {
  const f = fixture(); f.child.stdout.write('{"x":1}\n'); f.complete(); await f.job.ready;
  await f.job.cancel(); assert.equal(f.terminated(), 0);
});
test('bridge failure remains a rejection and stops the child', async () => {
  const f = fixture(); const failed = assert.rejects(f.job.ready, /ENOENT/);
  f.complete(new Error('ENOENT')); await failed; await f.job.cancel(); assert.equal(f.terminated(), 1);
});
test('a zero exit without matching geometry is not confirmation', async () => {
  const f = fixture(() => false); const failed = assert.rejects(f.job.ready, /NOT_CONFIRMED/);
  f.child.stdout.write('{}\n'); f.complete(); await failed; await f.job.cancel(); assert.equal(f.terminated(), 1);
});
test('a hung bridge hits its deadline and stops the child', async () => {
  const f = fixture(() => true, 20); await assert.rejects(f.job.ready, /TIMEOUT/);
  await f.job.cancel(); assert.equal(f.terminated(), 1);
});
test('cancel settles a pending restore and never sends a late geometry request', async () => {
  const f = fixture(); const failed = assert.rejects(f.job.ready, /CANCELLED/);
  await f.job.cancel(); f.child.stdout.write('{}\n'); f.complete(); await failed;
  assert.equal(f.terminated(), 1); assert.equal(f.child.stdin.destroyed, true);
});
test('EPIPE is consumed during cancellation without another failure or child leak', async () => {
  const f = fixture(); const failed = assert.rejects(f.job.ready, /CANCELLED/);
  await f.job.cancel(); f.child.stdin.emit('error', Object.assign(new Error('closed pipe'), { code: 'EPIPE' }));
  await failed; assert.equal(f.terminated(), 1);
});
