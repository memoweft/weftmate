// Keep route identity and ownership visible without logging URLs or headers.
export function observedRoutes(page) {
  const events = [], pending = new Set();
  let nextId = 0;
  const record = (id, phase, extra = {}) => events.push({ seq: events.length + 1, id, phase, ...extra });
  return {
    events,
    async route(pattern, name, handler) {
      await page.route(pattern, route => {
        const id = ++nextId;
        record(id, 'handler.start', { name });
        const observed = new Proxy(route, { get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          if (!['fetch', 'fulfill', 'continue', 'fallback', 'abort'].includes(key)) return value.bind(target);
          return async (...args) => {
            record(id, key + '.start');
            try {
              const result = await Reflect.apply(value, target, args);
              record(id, key + '.done');
              return result;
            } catch (error) {
              record(id, key + '.error');
              error.message += '; route lifecycle=' + JSON.stringify(events);
              throw error;
            }
          };
        } });
        const work = Promise.resolve().then(() => handler(observed));
        pending.add(work);
        // Observe both outcomes without changing the Promise returned to Playwright.
        work.then(() => { pending.delete(work); record(id, 'handler.done'); },
          () => { pending.delete(work); record(id, 'handler.error'); });
        return work;
      });
    },
    async close() {
      record(0, 'teardown.start');
      // unrouteAll(wait) clears the client route list before waiting. In
      // Playwright 1.58 a second handler finishing in that interval can remove
      // the server interceptor and continue another route still fetching.
      // Leave interception installed until every handler we own has returned.
      while (pending.size) await Promise.all([...pending]);
      record(0, 'handlers.drained');
      record(0, 'unroute.start');
      await page.unrouteAll({ behavior: 'wait' });
      record(0, 'unroute.done');
    },
  };
}
