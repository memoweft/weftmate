import { setTimeout as pause } from 'node:timers/promises';

// Command writes are asynchronous. Counted polls measure the host filesystem,
// not acceptance; the owning test/file deadline still bounds a stuck fixture.
export async function waitForCommand(read, { accepted = row => row.state === 'accepted_by_dsh', label = 'synthetic command', signal } = {}) {
  for (;;) {
    signal?.throwIfAborted();
    const row = await read();
    if (accepted(row)) return row;
    if (!['pending', 'dispatching'].includes(row?.state))
      throw Error(`${label} reached a terminal state: ${JSON.stringify(row)}`);
    await pause(10, undefined, {signal});
  }
}
