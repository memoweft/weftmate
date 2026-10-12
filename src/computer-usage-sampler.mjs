import { computerUsageInterval, mergeComputerBuckets } from './personal-access/computer-usage.mjs';

/** One unreferenced timer in the desktop process; injected sources also drive acceptance. */
export function createComputerUsageSampler({ powerMonitor, owner, policy, persist, now = Date.now, setTimer = setInterval, clearTimer = clearInterval, onError = () => {} }) {
  let previous, pending = [], identity, locked = powerMonitor.getSystemIdleState?.(300) === 'locked', suspended = false, closed = false, timer, queue = Promise.resolve(), lastFlush = now();
  const serial = action => { const work = queue.then(action); queue = work.catch(error => { previous = undefined; onError(error); }); return work; };
  async function flush() {
    if (!pending.length || !identity) return;
    const rows = pending; pending = [];
    await persist(identity.ownerId, identity.generation, rows);
    lastFlush = now();
  }
  async function sample() {
    if (closed || suspended) return;
    const at = now(), ownerId = await owner(), settings = ownerId ? await policy(ownerId) : null;
    if (!settings?.enabled) { await flush(); pending = []; identity = previous = undefined; return; }
    const next = { ownerId, generation: settings.generation, timeZone: settings.timeZone };
    if (identity && (identity.ownerId !== ownerId || identity.generation !== next.generation || identity.timeZone !== next.timeZone)) {
      await flush(); previous = undefined;
    }
    identity = next;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (previous) pending = mergeComputerBuckets(pending, computerUsageInterval({ from: previous.at, to: at, idleSeconds, locked, timeZone: settings.timeZone }));
    previous = { at };
    if (at - lastFlush >= 15 * 60000) await flush();
  }
  const tick = () => serial(sample);
  const lock = () => serial(async () => { await sample(); locked = true; previous = { at: now() }; });
  const unlock = () => serial(async () => { await sample(); locked = false; previous = { at: now() }; });
  const suspend = () => serial(async () => { await sample(); suspended = true; previous = undefined; await flush(); });
  const resume = () => serial(async () => { suspended = false; previous = undefined; await sample(); });
  for (const [event, handler] of [['lock-screen', lock], ['unlock-screen', unlock], ['suspend', suspend], ['resume', resume]]) powerMonitor.on(event, handler);
  timer = setTimer(() => { void tick().catch(() => {}); }, 60000); timer.unref?.();
  void tick().catch(() => {});
  return { tick, flush: () => serial(flush), checkpoint: ownerId => serial(async () => {
    if (identity?.ownerId !== ownerId) return;
    await sample(); await flush(); previous = undefined;
  }), async close() {
    clearTimer(timer);
    for (const [event, handler] of [['lock-screen', lock], ['unlock-screen', unlock], ['suspend', suspend], ['resume', resume]]) powerMonitor.removeListener(event, handler);
    await serial(async () => {
      // Save observations already sampled; the unobserved tail stays unknown.
      // Quit must not start a session lookup on a closing window/host.
      closed = true; await flush();
    });
  } };
}
