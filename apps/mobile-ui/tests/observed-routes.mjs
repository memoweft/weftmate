// Keep route identity and ownership visible without logging URLs or headers.
export function observedRoutes(page) {
  const events = [], pending = new Set();
  let nextId = 0, closing = false;
  const record = (id, phase, extra = {}) => events.push({ seq: events.length + 1, id, phase, ...extra });
  return {
    events,
    async route(pattern, name, handler) {
      await page.route(pattern, route => {
        const id = ++nextId;
        if (closing) {
          record(id, 'intake.rejected', { name });
          return route.abort('aborted');
        }
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
    async close({ timeoutMs = 5000 } = {}) {
      closing = true;
      record(0, 'teardown.start');
      record(0, 'intake.stopped');
      // unrouteAll(wait) clears the client route list before waiting. In
      // Playwright 1.58 a second handler finishing in that interval can remove
      // the server interceptor and continue another route still fetching.
      // Keep interception installed while draining the handlers already owned
      // at this boundary. Later polling is aborted above, without entering the
      // business handler or extending this snapshot or its total deadline.
      const inFlight = [...pending];
      let timer, expired = false;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          record(0, 'teardown.timeout');
          reject(Object.assign(new Error('Route teardown exceeded ' + timeoutMs + 'ms; route lifecycle=' + JSON.stringify(events)),
            { code: 'ROUTE_TEARDOWN_TIMEOUT' }));
        }, timeoutMs);
      });
      const drain = async () => {
        await Promise.all(inFlight);
        if (expired) return;
        record(0, 'handlers.drained');
        record(0, 'unroute.start');
        await page.unrouteAll({ behavior: 'wait' });
        record(0, 'unroute.done');
      };
      try {
        await Promise.race([drain(), deadline]);
      } catch (error) {
        expired = true;
        // Do not wait again for a timed-out or rejected handler. The caller's
        // finally still closes the browser; preserve both errors if removal fails.
        record(0, 'cleanup.unroute.start');
        try {
          await page.unrouteAll({ behavior: 'default' });
          record(0, 'cleanup.unroute.done');
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Route teardown and route removal failed');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
