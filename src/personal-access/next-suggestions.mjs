import { accountPersonalization } from './personalization.mjs';
import { boundedUpstreamBody, exactKeys, failure } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';

const empty = requestId => ({ requestId, suggestions: [], completion: '' });
const clip = (value, limit) => [...value].slice(0, limit).join('');
export function suggestionContext(events, forgottenSeqs = []) {
  const forgotten = new Set(forgottenSeqs);
  return events.filter(row => !forgotten.has(row.seq) && ['user.message', 'assistant.message'].includes(row.type) &&
    typeof row.data?.text === 'string').slice(-6).map(row => ({
      role: row.type === 'user.message' ? 'user' : 'assistant', content: clip(row.data.text, row.type === 'assistant.message' ? 1000 : 600),
    }));
}
export function parseSuggestions(text, kind, draft = '') {
  let value;
  try { value = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); } catch { return { suggestions: [], completion: '' }; }
  const clean = text => typeof text === 'string' && text.trim() && !/[\n\r]/.test(text) &&
    !/还有什么|有什么可以帮|anything else|how can I help/i.test(text);
  if (kind === 'completion') {
    let suffix = value.completion;
    if (typeof suffix === 'string' && suffix.startsWith(draft)) suffix = suffix.slice(draft.length);
    return { suggestions: [], completion: clean(suffix) && [...suffix].length <= 40 ? suffix : '' };
  }
  const suggestions = Array.isArray(value.suggestions) ? [...new Set(value.suggestions.filter(text => clean(text) && [...text.trim()].length <= 24).map(text => text.trim()))].slice(0, 3) : [];
  return { suggestions, completion: '' };
}

/** Ephemeral only: no commands, messages, memory evidence, export or stored response. */
export function createNextSuggestions(context, { timeoutMs = 5000, watchMs = 150 } = {}) {
  const pending = new Map();
  const key = (ownerId, sessionId) => `${ownerId}/${sessionId}`;
  const enabled = ownerId => accountPersonalization(context.accountState(ownerId)).nextSuggestionsEnabled !== false;
  function cancel(ownerId, sessionId = null, requestId = null, deviceId = null) {
    for (const row of pending.values()) if (row.ownerId === ownerId && (!sessionId || row.sessionId === sessionId) &&
        (!requestId || row.requestId === requestId) && (!deviceId || row.deviceId === deviceId)) row.controller.abort();
  }
  function reconcile(ownerId) {
    if (!enabled(ownerId)) { cancel(ownerId); return; }
    const account = context.accountState(ownerId);
    for (const row of pending.values()) if (row.ownerId === ownerId) {
      const session = account.sessions[row.sessionId];
      if (!session || session.deleting || session.archived || session.modelProfileId !== row.profileId ||
          Object.values(account.commands).some(command => ['session.message', 'chat.message'].includes(command.kind) &&
            ['pending', 'dispatching'].includes(command.state))) row.controller.abort();
    }
  }
  async function handle(request, response, url, ownerId, sessionId) {
    const auth = context.authenticate(request, 'commands:write');
    const account = context.accountState(ownerId), session = account.sessions[sessionId];
    if (!session || session.deleting || session.archived) throw failure('SESSION_UNAVAILABLE', 404);
    if (request.method === 'DELETE') {
      if ([...url.searchParams.keys()].some(name => name !== 'requestId') || url.searchParams.getAll('requestId').length > 1 ||
          url.searchParams.has('requestId') && !REQUEST_ID.test(url.searchParams.get('requestId'))) throw failure('INVALID_REQUEST');
      cancel(ownerId, sessionId, url.searchParams.get('requestId'), auth.deviceId);
      return context.json(response, 200, { cancelled: true });
    }
    if (url.search) throw failure('INVALID_REQUEST');
    const body = await context.readJson(request);
    exactKeys(body, ['kind', 'draft', 'requestId'], ['kind', 'requestId']);
    if (!['replies', 'completion'].includes(body.kind) || !REQUEST_ID.test(body.requestId ?? '') ||
        body.draft !== undefined && (typeof body.draft !== 'string' || [...body.draft].length > 4000) ||
        body.kind === 'completion' && !body.draft?.trim()) throw failure('INVALID_REQUEST');
    cancel(ownerId, sessionId);
    const result = empty(body.requestId);
    if (!enabled(ownerId) || typeof context.backend.modelCompletion !== 'function' || body.kind === 'replies' && body.draft?.length ||
        !context.messageModelUsable(ownerId, session)) return context.json(response, 200, result);
    const controller = new AbortController();
    const row = { ownerId, sessionId, profileId: session.modelProfileId, deviceId: auth.deviceId, requestId: body.requestId, controller };
    pending.set(key(ownerId, sessionId), row);
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    const timer = setTimeout(disconnect, timeoutMs);
    let checking = false, ticket = null, usage = null;
    const watch = setInterval(async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        context.authenticate(request, 'commands:write'); reconcile(ownerId);
        const live = await context.backend.describeSession(sessionId, ownerId);
        if (live?.running !== false || live.modelProfileId && live.modelProfileId !== row.profileId) controller.abort();
      } catch { controller.abort(); } finally { checking = false; }
    }, watchMs);
    try {
      const described = await context.backend.describeSession(sessionId, ownerId);
      if (described?.running !== false || described.modelProfileId && described.modelProfileId !== session.modelProfileId) return context.json(response, 200, result);
      const page = await context.backend.readEvents({ ownerId, sessionId, limit: 100 });
      const events = page.events ?? [];
      const terminal = events.filter(event => ['turn.started', 'turn.ended', 'user.message'].includes(event.type)).at(-1);
      if (body.kind === 'replies' && !(terminal?.type === 'turn.ended' && terminal.data?.reason === 'completed')) return context.json(response, 200, result);
      const messages = suggestionContext(events, session.forgottenSeqs);
      if (!messages.length || body.kind === 'replies' && messages.at(-1).role !== 'assistant') return context.json(response, 200, result);
      const model = (await context.backend.listModels({ ownerId })).find(model => model.id === session.modelProfileId);
      reconcile(ownerId); controller.signal.throwIfAborted();
      const instruction = body.kind === 'replies'
        ? '预测用户在这段对话之后可能想说或做的下一步。只给与当前回复直接相关且有把握的0–3条短句，每条约20个汉字，绝不超过24字，用用户口吻。不要泛泛询问，不虚构已经执行的动作。只输出JSON {"suggestions":["..."]}，没把握输出空数组。'
        : '补全用户正在输入的话。只返回自然、确定的后半句，最多40字，只补到本句结束，不换行。不重复用户已经输入的前缀，不新增任务或凭空承诺。只输出JSON {"completion":"后半句"}，没把握输出空字符串。';
      controller.signal.throwIfAborted();
      const upstream = await context.backend.modelCompletion({ ownerId, profileId: session.modelProfileId, priority: 'suggestion', signal: controller.signal,
        onStart: async () => { controller.signal.throwIfAborted(); ticket = await context.usage.begin(ownerId, { sessionId, profileId: session.modelProfileId, model, category: 'next-suggestions' }); },
        body: { model: model.model, stream: false, max_tokens: 160, temperature: 0.3,
          messages: [{ role: 'system', content: instruction }, ...messages,
            { role: 'user', content: body.kind === 'completion' ? `正在输入：${clip(body.draft, 600)}。仅返回completion的JSON。`
              : '请根据上面已经完成的回复，预测我最可能继续说的下一句话或下一步动作。仅返回suggestions的JSON。' }] } });
      if (!upstream.ok) { await upstream.body?.cancel(); return context.json(response, 200, result); }
      const value = JSON.parse(await boundedUpstreamBody(upstream, 16_384));
      usage = value.usage ?? null;
      reconcile(ownerId); controller.signal.throwIfAborted();
      Object.assign(result, parseSuggestions(value.choices?.[0]?.message?.content ?? '', body.kind, body.draft));
    } catch { /* Speculation fails silently, never retries or affects the real turn. */ }
    finally {
      clearTimeout(timer); clearInterval(watch); response.off('close', disconnect);
      if (pending.get(key(ownerId, sessionId)) === row) pending.delete(key(ownerId, sessionId));
      if (ticket) await context.usage.finish(ownerId, ticket, usage);
    }
    if (controller.signal.aborted) Object.assign(result, empty(body.requestId));
    if (!response.destroyed) return context.json(response, 200, result);
  }
  return { handle, cancel, reconcile, close: () => { for (const row of pending.values()) row.controller.abort(); } };
}
