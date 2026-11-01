/**
 * One main-process lane for journalled route changes and runtime replacement.
 * Session work shares it: different sessions run side by side, one session
 * runs in order, and every exclusive change waits for all admitted work.
 */
export function createRouteMutationQueue() {
  let tail: Promise<void> = Promise.resolve();
  let shared = new Set<Promise<void>>();
  const sessionTails = new Map<string, Promise<void>>();
  let accepting = true;
  // A rejected task must not poison the next user retry.
  const settled = (work: Promise<unknown>): Promise<void> => work.then(() => undefined, () => undefined);
  const admitted = (): Promise<unknown> => shared.size ? Promise.all([tail, ...shared]) : tail;
  const closed = () => Promise.reject(new Error('WeftMate 正在退出，已拒绝新的模型、设置或会话操作。'));
  const enqueue = <T>(work: () => Promise<T> | T): Promise<T> => {
    const result = admitted().then(work, work);
    tail = settled(result);
    shared = new Set();
    return result;
  };
  return {
    run<T>(work: () => Promise<T> | T): Promise<T> {
      if (!accepting) return closed();
      return enqueue(work);
    },
    /** Waits for exclusive changes and earlier work on this session only. */
    runSession<T>(sessionId: string, work: () => Promise<T> | T): Promise<T> {
      if (!accepting) return closed();
      const previous = sessionTails.get(sessionId);
      const result = (previous ? Promise.all([tail, previous]) : tail).then(() => work());
      const done = settled(result);
      shared.add(done);
      sessionTails.set(sessionId, done);
      void done.then(() => {
        shared.delete(done);
        if (sessionTails.get(sessionId) === done) sessionTails.delete(sessionId);
      });
      return result;
    },
    /** Atomically reject new work, drain admitted work, then run one final lane task. */
    async stopAcceptingAndDrain<T>(finalWork?: () => Promise<T> | T): Promise<T | undefined> {
      accepting = false;
      await admitted();
      return finalWork ? enqueue(finalWork) : undefined;
    },
    isAccepting(): boolean { return accepting; },
  };
}
