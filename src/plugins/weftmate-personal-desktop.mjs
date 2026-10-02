import { createHash, randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'weftmate-personal-desktop';
export const PERSONAL_DESKTOP_PROTOCOL = 'weftmate.personal-desktop.v1';
export const PERSONAL_DESKTOP_TOOL = 'personal_open_notepad';
export const PERSONAL_DOCUMENT_TOOL = 'personal_save_document';
export const inject = ['tools'];

function refused(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function safeDocumentName(value) {
  if (typeof value !== 'string') return null;
  const fileName = value.normalize('NFC');
  if (!fileName || Buffer.byteLength(fileName, 'utf8') > 160 || fileName.includes('..') ||
      !/^[\p{L}\p{N}][\p{L}\p{N} _.-]*\.(?:md|txt)$/u.test(fileName)) return null;
  const stem = fileName.slice(0, fileName.lastIndexOf('.'));
  if (/[ .]$/.test(stem) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(stem)) return null;
  return fileName;
}

/** Identity comes from durable DSH events, never from model-provided arguments. */
export function personalToolIdentity(exec) {
  const session = exec?.agent?.session;
  if (session?.header?.agentPreset !== 'personal-remote' || typeof session.id !== 'string' ||
      !Array.isArray(session.events) || typeof exec.callId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,160}$/.test(exec.callId)) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const events = session.events;
  const callIndex = events.findLastIndex((event) => event?.type === 'tool/call' && event.data?.callId === exec.callId);
  if (callIndex < 0) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const turn = events[callIndex]?.data?.turn;
  if (!Number.isSafeInteger(turn) || turn < 0) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const startIndex = events.findLastIndex((event, index) => index < callIndex &&
    event?.type === 'turn/start' && event.data?.turn === turn);
  if (startIndex < 0) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const users = events.slice(startIndex + 1, callIndex).filter((event) =>
    event?.type === 'user/message' && event.data?.source?.kind === 'user');
  if (users.length !== 1) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const parts = users[0].data?.content;
  if (!Array.isArray(parts) || !parts.length || parts.some((part) => part?.type !== 'text' || typeof part.text !== 'string')) {
    throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  }
  const text = parts.map((part) => part.text).join('');
  if (!text.trim() || text.length > 8_192) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  return { sessionId: session.id, turn, callId: exec.callId,
    messageHash: createHash('sha256').update(text).digest('hex') };
}

class PersonalDesktopBridge {
  constructor() {
    this.pending = new Map();
    this.closed = false;
    this.onMessage = (frame) => {
      if (frame?.protocol !== PERSONAL_DESKTOP_PROTOCOL || typeof frame.id !== 'string') return;
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.ok === true && frame.command && typeof frame.command === 'object') entry.resolve(frame.command);
      else entry.reject(refused(typeof frame.error === 'string' && /^[A-Z_]{2,48}$/.test(frame.error)
        ? frame.error : 'PERSONAL_TOOL_UNAVAILABLE'));
    };
    this.onDisconnect = () => this.close();
    process.on('message', this.onMessage);
    process.once('disconnect', this.onDisconnect);
  }

  request(payload, signal) {
    if (this.closed || typeof process.send !== 'function' || process.connected !== true) {
      return Promise.reject(refused('PERSONAL_TOOL_UNAVAILABLE'));
    }
    if (signal?.aborted) return Promise.reject(refused('PERSONAL_TOOL_CANCELLED'));
    const id = `personal-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        signal?.removeEventListener?.('abort', entry.abort);
        reject(error);
      };
      const timer = setTimeout(() => finish(refused('PERSONAL_TOOL_TIMEOUT')), 12_000);
      const abort = () => finish(refused('PERSONAL_TOOL_CANCELLED'));
      this.pending.set(id, { resolve: (value) => { signal?.removeEventListener?.('abort', abort); resolve(value); },
        reject: (error) => { signal?.removeEventListener?.('abort', abort); reject(error); }, timer, abort });
      signal?.addEventListener?.('abort', abort, { once: true });
      try {
        process.send({ protocol: PERSONAL_DESKTOP_PROTOCOL, id, ...payload }, (error) => {
          if (error) finish(refused('PERSONAL_TOOL_UNAVAILABLE'));
        });
      } catch { finish(refused('PERSONAL_TOOL_UNAVAILABLE')); }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    process.off('message', this.onMessage);
    process.off('disconnect', this.onDisconnect);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(refused('PERSONAL_TOOL_UNAVAILABLE'));
    }
    this.pending.clear();
  }
}

export function apply(ctx) {
  const bridge = new PersonalDesktopBridge();
  const disposeTool = ctx.tools.register(defineTool({
    name: PERSONAL_DESKTOP_TOOL,
    description: 'Only when the latest user explicitly asks to open Notepad on their computer. Opens the fixed Notepad app and returns a durable command state; never accepts a path or shell command.',
    parameters: { appId: { type: 'string', required: true, enum: ['notepad'] } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (args?.appId !== 'notepad') throw refused('PERSONAL_TOOL_INVALID');
      const identity = personalToolIdentity(exec);
      return bridge.request({ ...identity, appId: 'notepad' }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '打开记事本', kind: 'execute' }),
  }));
  const disposeDocument = ctx.tools.register(defineTool({
    name: PERSONAL_DOCUMENT_TOOL,
    description: 'Save one Markdown or plain-text document requested by the current user. Give a simple Chinese or English filename ending in .md or .txt and the complete document text. The host chooses the storage path and verifies the saved file.',
    parameters: { fileName: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const fileName = safeDocumentName(args?.fileName);
      if (!fileName || typeof args?.content !== 'string' || !args.content.length ||
          Buffer.byteLength(args.content, 'utf8') > 128 * 1024 || args.content.includes('\0') ||
          Buffer.from(args.content, 'utf8').toString('utf8') !== args.content) throw refused('PERSONAL_TOOL_INVALID');
      const identity = personalToolIdentity(exec);
      return bridge.request({ action: 'write_document', ...identity, fileName,
        content: args.content }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '保存文档', kind: 'execute' }),
  }));
  const disposeGuard = ctx.tools.guard((exec) => [PERSONAL_DESKTOP_TOOL, PERSONAL_DOCUMENT_TOOL].includes(exec.name) &&
    exec.agent?.session?.header?.agentPreset !== 'personal-remote' ? 'PERSONAL_TOOL_SCOPE_DENIED' : undefined);
  ctx.effect(() => () => { disposeGuard(); disposeDocument(); disposeTool(); bridge.close(); }, 'weftmate-personal-desktop: lifecycle');
}

export default { name, inject, apply };
