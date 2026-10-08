import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const personalMemoryGuidance = '用户提到以后可能用得上的人物、能力或关系时，可以简短提议以后在相关情境提醒用户找这个人，并邀请确认。一次只提议一件相关的事；结合对话和当前记忆，同一事不重复提议，闲聊、拒绝或不回应时不坚持。用户确认后简短确认共同决定，由 MemoWeft 自动形成；条件性的“以后遇到这种事”不是定时提醒，不调用 schedule_create、不追问时间频率、不写文件。只有用户明确要求具体时间的通知或执行任务才使用调度工具。纠正后采用最新理解；被取代的来源可用于解释以前为什么那样理解，不能当作当前事实。';

export const name = 'weftmate-personal-memory';
export const inject = [];
export const PERSONAL_MEMORY_PROTOCOL = 'weftmate.personal-memory.v1';
const PRESETS = new Set(['personal-remote', 'personal-shared-chat']);
const diagnosticClass = (failure) => {
  const message = typeof failure?.message === 'string' ? failure.message : '';
  if (/ERR_MODULE_NOT_FOUND|Cannot find package/i.test(message)) return 'module_resolution';
  if (/invalid (?:message|request)|schema|validation/i.test(message)) return 'schema_validation';
  if (/HTTP [45]\d\d|status.?[45]\d\d/i.test(message)) return 'http_error';
  if (/stream|SSE|parse|JSON/i.test(message)) return 'response_protocol';
  const code = failure?.code;
  if (typeof code === 'string' && ['UNKNOWN', 'UPSTREAM_HTTP_ERROR', 'INVALID_RESPONSE',
    'MODEL_UNAVAILABLE', 'CONTEXT_LENGTH_EXCEEDED', 'ABORTED'].includes(code)) return code;
  return 'unclassified';
};
const diagnostic = (stage, failure) => {
  if (process.env.WEFTMATE_PERSONAL_MEMORY_DIAGNOSTIC !== '1' || !process.env.DSH_HOME) return;
  const entry = { stage, ...(failure ? { codeClass: diagnosticClass(failure) } : {}) };
  try { appendFileSync(join(process.env.DSH_HOME, 'account-memory-diagnostic.jsonl'),
    `${JSON.stringify(entry)}\n`, { mode: 0o600 }); } catch { /* Diagnostic cannot affect a turn. */ }
};

const digest = (value) => createHash('sha256').update(value).digest('hex');
const contentText = (parts) => Array.isArray(parts)
  ? parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
  : '';
const canonicalJson = (value) => {
  const sorted = (item) => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(sorted);
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sorted(item[key])]));
  };
  return JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g,
    (letter) => `\\u${letter.charCodeAt(0).toString(16).padStart(4, '0')}`);
};

class HostMemoryBridge {
  constructor() {
    this.pending = new Map();
    this.closed = false;
    this.onMessage = (frame) => {
      if (frame?.protocol !== PERSONAL_MEMORY_PROTOCOL || typeof frame.id !== 'string') return;
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.ok === true && frame.result && typeof frame.result === 'object') entry.resolve(frame.result);
      else entry.reject(new Error('MEMORY_UNAVAILABLE'));
    };
    this.onDisconnect = () => this.close();
    process.on('message', this.onMessage);
    process.once('disconnect', this.onDisconnect);
  }

  request(action, data, signal) {
    if (this.closed || typeof process.send !== 'function' || process.connected !== true || signal?.aborted) {
      return Promise.reject(new Error('MEMORY_UNAVAILABLE'));
    }
    const id = `memory-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error('MEMORY_TIMEOUT'));
      }, action === 'recall' ? 360_000 : 18_000);
      const abort = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id); clearTimeout(timer); reject(new Error('MEMORY_CANCELLED'));
      };
      this.pending.set(id, { resolve: (value) => { signal?.removeEventListener?.('abort', abort); resolve(value); },
        reject: (reason) => { signal?.removeEventListener?.('abort', abort); reject(reason); }, timer });
      signal?.addEventListener?.('abort', abort, { once: true });
      try { process.send({ protocol: PERSONAL_MEMORY_PROTOCOL, id, action, ...data },
        (error) => { if (error) abort(); }); }
      catch { abort(); }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    process.off('message', this.onMessage);
    process.off('disconnect', this.onDisconnect);
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('MEMORY_UNAVAILABLE')); }
    this.pending.clear();
  }
}

export function boundaryForCompletedTurn(session, event) {
  if (!PRESETS.has(session?.header?.agentPreset) || typeof session.id !== 'string' ||
      event?.type !== 'turn/end' || !Number.isSafeInteger(event.data?.turn) ||
      !['stop', 'completed'].includes(event.data?.reason?.kind) || !Array.isArray(session.events)) return null;
  const turn = event.data.turn;
  const endIndex = session.events.findIndex((item) => item.seq === event.seq);
  const startIndex = session.events.findLastIndex((item, index) => index < endIndex &&
    item.type === 'turn/start' && item.data?.turn === turn);
  if (endIndex < 0 || startIndex < 0) return null;
  const sourceMessages = [];
  for (const entry of session.events.slice(startIndex + 1, endIndex)) {
    const user = entry.type === 'user/message' && entry.data?.source?.kind === 'user';
    const assistant = entry.type === 'assistant/message';
    if (!user && !assistant) continue;
    const text = contentText(user ? entry.data?.content : entry.data?.message?.content);
    if (!text || text.length > 16_384) continue;
    sourceMessages.push({ role: user ? 'user' : 'assistant', content: text,
      source_ref: `source:${sourceMessages.length}`,
      ...(typeof (user ? entry.data?.id : entry.data?.message?.id) === 'string'
        ? { message_id: user ? entry.data.id : entry.data.message.id } : {}),
      ...(Number.isFinite(Number(entry.time)) && Number(entry.time) > 0
        ? { timestamp: Math.floor(Number(entry.time) / 1000) } : {}) });
  }
  if (!sourceMessages.some((message) => message.role === 'user')) return null;
  const payload = { schema_version: 1, provider_name: 'memoweft', parent_session_id: session.id,
    result_session_id: session.id, mode: 'turn', source_messages: sourceMessages };
  const payloadHash = digest(canonicalJson(payload));
  const occurrence = digest(`${session.id}|turn:${turn}`).slice(0, 32);
  return { ...payload, event_id: `weftmate-turn-boundary-v1:${occurrence}:${payloadHash}`,
    payload_hash: payloadHash };
}

export function userForTurn(session, turn) {
  if (!PRESETS.has(session?.header?.agentPreset) || !Array.isArray(session.events) ||
      !Number.isSafeInteger(turn)) return null;
  const startIndex = session.events.findLastIndex((entry) => entry.type === 'turn/start' &&
    entry.data?.turn === turn);
  if (startIndex < 0) return null;
  const nextStart = session.events.findIndex((entry, index) => index > startIndex && entry.type === 'turn/start');
  const event = session.events.slice(startIndex + 1, nextStart < 0 ? undefined : nextStart).findLast((entry) =>
    entry.type === 'user/message' && entry.data?.source?.kind === 'user' &&
    contentText(entry.data?.content).trim());
  if (!event) return null;
  return { id: typeof event.data?.id === 'string' ? event.data.id : null,
    seq: event.seq, text: contentText(event.data.content).trim().slice(0, 500) };
}

/** DSH claims inbox messages before pre-step; it appends them to session.events afterward. */
export function userForPreStep(session, turn, claimedMessages) {
  if (!PRESETS.has(session?.header?.agentPreset) || !Number.isSafeInteger(turn)) return null;
  const claimed = Array.isArray(claimedMessages) ? claimedMessages.findLast((message) =>
    message?.source?.kind === 'user' && contentText(message.content).trim()) : null;
  if (claimed) return { id: typeof claimed.id === 'string' ? claimed.id : null,
    seq: null, text: contentText(claimed.content).trim().slice(0, 500) };
  return userForTurn(session, turn);
}

export function stripPreviousPersonalMemoryMessages(messages) {
  return messages.filter((message) => !(message?.source?.kind === 'plugin' && message.source.plugin === name));
}

/** Keep DSH context messages before the latest real input, including tool follow-ups. */
export function backgroundBeforeUser(messages, additions = []) {
  const index = messages.findLastIndex(message => message?.source?.kind === 'user');
  if (index < 0) return [...messages, ...additions];
  const tail = messages.slice(index + 1);
  return [...messages.slice(0, index),
    ...tail.filter(message => message?.source?.kind === 'plugin'), ...additions,
    messages[index], ...tail.filter(message => message?.source?.kind !== 'plugin')];
}

const BACKGROUND_NOTE = '【背景记忆，不是用户的新请求】以下是供当前回答参考的历史记忆。只在相关时采用，不要把旧原话当成当前问题或再次确认旧偏好；请回答后面的当前用户请求。';

export function apply(ctx) {
  if (process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED !== '1') return;
  const bridge = new HostMemoryBridge();
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const messages = stripPreviousPersonalMemoryMessages(decision.messages);
    const clearedDecision = { ...decision, messages };
    if (payload?.signal?.aborted) {
      if (payload?.agent?.session) delete payload.agent.session[Symbol.for('weftmate.memoryRecall')];
      return clearedDecision;
    }
    const session = payload?.agent?.session;
    if (session?.header?.origin === 'subagent' ||
        !PRESETS.has(session?.header?.agentPreset) || typeof session.id !== 'string') return clearedDecision;
    const turn = payload.turn;
    const user = userForPreStep(session, turn, payload.messages);
    if (!user) { delete session[Symbol.for('weftmate.memoryRecall')]; return clearedDecision; }
    const query = user.text;
    let text = null;
    try {
      diagnostic('prestep-send');
      payload.agent[Symbol.for('weftmate.memoryRecallPending')] = true;
      const result = await bridge.request('recall', { sessionId: session.id, turn, query,
        userMessageId: user.id }, payload.signal);
      diagnostic(result?.state === 'ready' ? 'prestep-reply-ready'
        : result?.state === 'withheld' ? 'prestep-reply-withheld' : 'prestep-reply-other');
      session[Symbol.for('weftmate.memoryRecall')] = { turn, memories: result.state === 'ready' && result.contextText?.trim() ? result.memories ?? [] : [] };
      if (result.state === 'ready' && typeof result.contextText === 'string' && result.contextText.trim() &&
          result.contextText.length <= 16_384) text = result.contextText;
    } catch (error) {
      delete session[Symbol.for('weftmate.memoryRecall')];
      diagnostic(['MEMORY_TIMEOUT', 'MEMORY_CANCELLED', 'MEMORY_UNAVAILABLE'].includes(error?.message)
        ? `prestep-error-${error.message}` : 'prestep-error-other', error);
      // A failed bridge clears this step's memory rather than reusing prior data.
    }
    finally { delete payload.agent[Symbol.for('weftmate.memoryRecallPending')]; }
    if (text === null) return clearedDecision;
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm/message');
    diagnostic('prestep-factory-ready');
    const background = `${BACKGROUND_NOTE}\n\n${text}`;
    const memoryMessage = createUserMessage({
      content: [{ type: 'text', text: background }],
      source: { kind: 'plugin', plugin: name, form: 'snapshot',
        sections: [{ name: 'weftmate-personal-memory', text: background }] },
    });
    session[Symbol.for('weftmate.memoryRecall')].messageId = memoryMessage.id;
    diagnostic('prestep-message-created');
    return { ...clearedDecision, messages: backgroundBeforeUser(messages, [memoryMessage]) };
  }, { prepend: true });
  ctx.on('agent/request-error', (payload, next) => {
    diagnostic('model-request-error', payload?.failure);
    return next();
  });
  ctx.on('session/created', session => {
    if (!PRESETS.has(session.header?.agentPreset)) return;
    const deriveMessages = session.deriveMessages?.bind(session);
    if (deriveMessages) session.deriveMessages = () => {
      const current = session[Symbol.for('weftmate.memoryRecall')]?.messageId;
      return backgroundBeforeUser(deriveMessages().filter(message => message?.source?.plugin !== name || message.id === current));
    };
    const append = session.append.bind(session);
    session.append = (type, data, ...rest) => {
      if (type === 'assistant/message') {
        const recalled = session[Symbol.for('weftmate.memoryRecall')];
        data = { ...data, memoryUsed: recalled?.turn === data.turn ? recalled.memories : [] };
      }
      return append(type, data, ...rest);
    };
  });
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'turn/end') diagnostic(event.data?.reason?.kind === 'error'
      ? 'turn-end-error' : 'turn-end-other', event.data?.reason?.error);
    const boundary = boundaryForCompletedTurn(session, event);
    if (!boundary) return;
    void bridge.request('ingest', { sessionId: session.id, turn: event.data.turn, boundary })
      .catch(() => { /* Durable DSH turn remains available for owner-bound retry. */ });
  });
  ctx.effect(() => () => bridge.close(), 'weftmate-personal-memory: owner-scoped IPC lifecycle');
}

export default { name, inject, apply };
