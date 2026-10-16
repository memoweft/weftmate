import { setTimeout as pause } from 'node:timers/promises';

// Poll a fact, never assume that an I/O operation finished after a fixed sleep.
export async function waitForCondition(read, { timeoutMs = 5000, label = 'fixture condition' } = {}) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (performance.now() >= deadline) throw Error(`Timed out waiting for ${label}`);
    await pause(5);
  }
}
