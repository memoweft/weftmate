import { Config, apply as applyTitle } from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { runWithModelSlot } from '../model-scheduler-client.mjs';
import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title';
export { Config };
export const name = 'session-title-first-prompt-llm';
export const inject = ['sessionTitle', 'llm', 'sessions'];
export function titleForConversation(result, messages, targetCharacters) {
  const first = String(messages[0]?.text || '');
  // The observed failure is an English title for Chinese input. Preserve the
  // user's own topic when a model ignores the language instruction; no retry.
  if (/\p{Script=Han}/u.test(first) && !/[\u3040-\u30ff\uac00-\ud7af]/u.test(first) && !/\p{Script=Han}/u.test(result.title)) {
    const text = first.slice(first.search(/\p{Script=Han}/u)).replace(/\s+/g, ' ').trim();
    return { ...result, title: normalizeSessionTitle(Array.from(text).slice(0,targetCharacters).join(''),Number.MAX_SAFE_INTEGER) };
  }
  return result;
}
export function titleLanguageInstruction(messages) {
  const framed = messages.flatMap(message => message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  let source = framed;
  try { source = JSON.parse(framed.slice(framed.indexOf('['))).map(message => message.text || '').join('\n'); } catch { /* The first prompt remains the language source. */ }
  const language = /[\u3040-\u30ff]/u.test(source) ? 'Japanese' : /[\uac00-\ud7af]/u.test(source) ? 'Korean' : /\p{Script=Han}/u.test(source) ? 'Chinese' : '';
  return language ? `The human conversation is in ${language}. Write the title in ${language}, even when it mentions English tool names, filenames or code. Do not translate the conversation into an English title.`
    : 'Write the title in the language of the human conversation, ignoring filenames, code and tool names when choosing its language.';
}
export function apply(ctx, config) {
  const title = new Proxy(ctx.sessionTitle, { get(target, method) {
    if (method === 'register' || method === 'registerProvider') return provider => target[method]({ ...provider,
      generate: async request => {
        const scheduler = process.env.WEFTMATE_MODEL_SCHEDULER_URL;
        if (scheduler && request.route) {
          const query = new URLSearchParams({ sessionId: request.session.id, profileId: request.route.provider });
          const response = await fetch(`${scheduler}/route?${query}`, { signal: request.signal });
          if (!response.ok) throw new Error('BACKGROUND_MODEL_UNAVAILABLE');
          request = { ...request, route: await response.json() };
        }
        const result = await runWithModelSlot('background', request.signal, () => provider.generate(request),
          scheduler, { profileId: request.route?.provider ?? '' });
        return titleForConversation(result,request.messages,config.targetCjkCharacters);
      },
    });
    const value = Reflect.get(target, method);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const llm = new Proxy(ctx.llm, { get(target, method) {
    if (method === 'stream') return options => target.stream(options.purpose === 'session-title'
      ? { ...options, system: `${options.system}\n${titleLanguageInstruction(options.messages)}` } : options);
    const value = Reflect.get(target, method);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  applyTitle(new Proxy(ctx, { get(target, property) {
    return property === 'sessionTitle' ? title : property === 'llm' ? llm : Reflect.get(target, property);
  } }), config);
}
export default { Config, name, inject, apply };
