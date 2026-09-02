/** One main-process lane for journalled route changes and runtime replacement. */
export function createRouteMutationQueue() {
  let tail: Promise<void> = Promise.resolve();
  let accepting = true;
  const enqueue = <T>(work: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(work, work);
    // A rejected mutation must not poison the next user retry.
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    run<T>(work: () => Promise<T> | T): Promise<T> {
      if (!accepting) return Promise.reject(new Error('WeftMate 正在退出，已拒绝新的模型、设置或会话操作。'));
      return enqueue(work);
    },
    /** Atomically reject new work, drain admitted work, then run one final lane task. */
    async stopAcceptingAndDrain<T>(finalWork?: () => Promise<T> | T): Promise<T | undefined> {
      accepting = false;
      await tail;
      return finalWork ? enqueue(finalWork) : undefined;
    },
    isAccepting(): boolean { return accepting; },
  };
}
