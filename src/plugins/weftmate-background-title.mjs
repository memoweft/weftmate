import { Config, apply as applyTitle } from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { runWithModelSlot } from '../model-scheduler-client.mjs';
export { Config };
export const name = 'session-title-first-prompt-llm';
export const inject = ['sessionTitle', 'llm', 'sessions'];
export function apply(ctx, config) {
  const title = new Proxy(ctx.sessionTitle, { get(target, method) {
    if (method === 'registerProvider') return provider => target.registerProvider({ ...provider,
      generate: request => runWithModelSlot('background', request.signal, async () => {
        const scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL;
        if (scheduler && request.route) {
          const query = new URLSearchParams({ sessionId: request.session.id, profileId: request.route.provider });
          const response = await fetch(`${scheduler}/route?${query}`, { signal: request.signal });
          if (!response.ok) throw new Error('BACKGROUND_MODEL_UNAVAILABLE');
          request = { ...request, route: await response.json() };
        }
        return provider.generate(request);
      }),
    });
    const value = Reflect.get(target, method);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  applyTitle(new Proxy(ctx, { get(target, property) {
    return property === 'sessionTitle' ? title : Reflect.get(target, property);
  } }), config);
}
export default { Config, name, inject, apply };
