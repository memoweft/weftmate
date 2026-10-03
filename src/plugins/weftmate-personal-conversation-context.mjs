import { createHash, randomUUID } from 'node:crypto';

export const name = 'weftmate-personal-conversation-context';
export const inject = [];
export const PROTOCOL = 'weftmate.personal-conversation-context.v1';
const RECEIPT = /^[A-Za-z0-9._:-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;

function textOf(message) {
  if (!Array.isArray(message?.content)) return null;
  const parts = message.content.filter((part) => part?.type === 'text' && typeof part.text === 'string');
  if (message.content.some((part) => part?.type !== 'text' && part?.type !== 'image')) return null;
  return parts.map((part) => part.text).join('\n');
}

function alreadyInjected(session, messages) {
  const source = (entry) => entry?.data?.source ?? entry?.data?.message?.source;
  return messages.some((message) => message?.source?.kind === 'plugin' && message.source.plugin === name) ||
    session.events?.some((entry) => entry.type === 'user/message' &&
      source(entry)?.kind === 'plugin' && source(entry).plugin === name) === true;
}

class ContextBridge {
  constructor() {
    this.pending = new Map();
    this.closed = false;
    this.onMessage = (frame) => {
      if (frame?.protocol !== PROTOCOL || typeof frame.id !== 'string') return;
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener?.('abort', entry.abort);
      if (frame.ok === true && frame.result && typeof frame.result === 'object' &&
          !Array.isArray(frame.result)) entry.resolve(frame.result);
      else entry.reject(new Error('CONVERSATION_CONTEXT_UNAVAILABLE'));
    };
    this.onDisconnect = () => this.close();
    process.on('message', this.onMessage);
    process.once('disconnect', this.onDisconnect);
  }

  request(payload, signal) {
    if (this.closed || signal?.aborted || typeof process.send !== 'function' || !process.connected)
      return Promise.reject(new Error('CONVERSATION_CONTEXT_UNAVAILABLE'));
    const id = `context-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const abort = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        reject(new Error('CONVERSATION_CONTEXT_UNAVAILABLE'));
      };
      const timer = setTimeout(abort, 3_000);
      this.pending.set(id, { resolve, reject, timer, signal, abort });
      signal?.addEventListener?.('abort', abort, { once: true });
      try { process.send({ protocol: PROTOCOL, id, ...payload }, (error) => { if (error) abort(); }); }
      catch { abort(); }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    process.off('message', this.onMessage);
    process.off('disconnect', this.onDisconnect);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener?.('abort', entry.abort);
      entry.reject(new Error('CONVERSATION_CONTEXT_UNAVAILABLE'));
    }
    this.pending.clear();
  }
}

export function contextIdentity(payload) {
  const session = payload?.agent?.session;
  if (!['personal-shared-chat', 'personal-remote'].includes(session?.header?.agentPreset) ||
      typeof session.id !== 'string' || !Array.isArray(payload?.messages) ||
      !Number.isSafeInteger(payload.turn) || payload.turn < 1 || payload.step !== 1) return null;
  const users = payload.messages.filter((message) => message?.source?.kind === 'user');
  if (users.length !== 1) return null;
  const user = users[0];
  const receiptId = user.source.rpcId;
  const content = textOf(user);
  if (typeof receiptId !== 'string' || !RECEIPT.test(receiptId) ||
      typeof user.id !== 'string' || !RECEIPT.test(user.id) ||
      typeof content !== 'string' || (!content.trim() &&
        !user.content.some((part) => part?.type === 'image')) ||
      Buffer.byteLength(content, 'utf8') > 16_384) return null;
  return { sessionId: session.id, turn: payload.turn, step: 1, receiptId,
    messageHash: createHash('sha256').update(content, 'utf8').digest('hex') };
}

export function apply(ctx) {
  const bridge = new ContextBridge();
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const session = payload?.agent?.session;
    const applicable = ['personal-shared-chat', 'personal-remote'].includes(session?.header?.agentPreset) &&
      payload?.step === 1 && Array.isArray(payload.messages) &&
      payload.messages.some((message) => message?.source?.kind === 'user');
    if (!applicable || alreadyInjected(session, decision.messages)) return decision;
    const identity = contextIdentity(payload);
    if (!identity) throw new Error('CONVERSATION_CONTEXT_UNAVAILABLE');
    const result = await bridge.request(identity, payload.signal);
    if (result?.state === 'none') return decision;
    if (result?.state !== 'ready' || typeof result.contextText !== 'string' ||
        !result.contextText.trim() || Buffer.byteLength(result.contextText, 'utf8') > 16_384 ||
        typeof result.contextHash !== 'string' || !HASH.test(result.contextHash) ||
        createHash('sha256').update(result.contextText, 'utf8').digest('hex') !== result.contextHash ||
        !Number.isSafeInteger(result.throughSeq) || result.throughSeq < 0)
      throw new Error('CONVERSATION_CONTEXT_UNAVAILABLE');
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm/message');
    const context = createUserMessage({
      content: [{ type: 'text', text: result.contextText }],
      source: { kind: 'plugin', plugin: name },
    });
    return { ...decision, messages: [...decision.messages, context] };
  }, { prepend: true });
  ctx.effect(() => () => bridge.close(), 'weftmate-personal-conversation-context: IPC lifecycle');
}

export default { name, inject, apply };
