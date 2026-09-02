import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRouteMutationQueue } from '../src/route-mutation-queue.ts';

describe('Stage 2 route mutation queue', () => {
  it('serializes journal/runtime transactions and remains usable after a failed mutation', async () => {
    const queue = createRouteMutationQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = queue.run(async () => { events.push('first:start'); await new Promise<void>((resolve) => { releaseFirst = resolve; }); events.push('first:end'); });
    const failed = queue.run(async () => { events.push('second:start'); throw new Error('expected'); });
    const third = queue.run(async () => { events.push('third:start'); events.push('third:end'); });
    await Promise.resolve();
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    await first; await assert.rejects(failed, /expected/); await third;
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'third:start', 'third:end']);
  });

  it('atomically stops new work, drains an admitted transaction, then closes only the newest runtime before exit', async () => {
    const queue = createRouteMutationQueue();
    const events: string[] = []; let release!: () => void;
    let journal = 'old-journal'; let live = 1; let maxLive = 1; let newestRuntime = 1; let exitCode: number | null = null;
    const first = queue.run(async () => {
      events.push('t1:journal-written'); await new Promise<void>((resolve) => { release = resolve; });
      // Complete a controlled replacement: never more than one live child.
      live -= 1; live += 1; maxLive = Math.max(maxLive, live); newestRuntime = 2; journal = '';
      events.push('t1:complete');
    });
    await Promise.resolve();
    const shutdown = queue.stopAcceptingAndDrain(async () => {
      events.push(`close:${newestRuntime}`); live -= 1; exitCode = 0;
    });
    await assert.rejects(queue.run(async () => events.push('t2:must-not-run')), /正在退出/);
    assert.deepEqual(events, ['t1:journal-written']); assert.equal(journal, 'old-journal'); assert.equal(live, 1);
    release(); await first; await shutdown;
    assert.deepEqual(events, ['t1:journal-written', 't1:complete', 'close:2']);
    assert.equal(journal, ''); assert.equal(maxLive, 1); assert.equal(live, 0); assert.equal(exitCode, 0);
  });
});
