import path from 'node:path';

// Cooperative gate for complete atomic file transactions, scoped to one profile.
// Synchronous main-process settings writes are held by the main mutation lane
// and cannot interleave with the synchronous file capture.
const gates = new Set();
export async function enterProfileWrite(file) {
  const absolute = path.resolve(file).toLowerCase();
  const gate = [...gates].find(item => absolute.startsWith(item.root + path.sep) &&
    !absolute.startsWith(path.join(item.root, 'personal-backup') + path.sep));
  if (!gate) return () => {};
  while (gate.paused) await gate.released;
  gate.active++;
  return () => { if (--gate.active === 0) gate.drained?.(); };
}
export function createProfileWriteBarrier(root) {
  const gate = { root: path.resolve(root).toLowerCase(), active: 0, paused: false };
  gates.add(gate);
  return {
    async pause(signal) {
      signal.throwIfAborted();
      gate.paused = true;
      let release;
      gate.released = new Promise(resolve => { release = resolve; });
      const resume = () => { gate.paused = false; release(); signal.removeEventListener('abort', resume); };
      signal.addEventListener('abort', resume, { once: true });
      try {
        if (gate.active) await Promise.race([
          new Promise(resolve => { gate.drained = resolve; }),
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
        ]);
        signal.throwIfAborted();
        return resume;
      } catch (error) { resume(); throw error; }
      finally { gate.drained = null; }
    },
    dispose() { gates.delete(gate); },
  };
}
