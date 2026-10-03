import { createHash, randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'weftmate-personal-desktop';
export const PERSONAL_DESKTOP_PROTOCOL = 'weftmate.personal-desktop.v1';
export const PERSONAL_DESKTOP_TOOL = 'personal_open_notepad';
export const PERSONAL_DOCUMENT_TOOL = 'personal_save_document';
export const PERSONAL_PROJECT_LIST_TOOL = 'personal_list_project_files';
export const PERSONAL_PROJECT_READ_TOOL = 'personal_read_project_file';
export const PERSONAL_BROWSER_OPEN_TOOL = 'personal_browser_open';
export const PERSONAL_BROWSER_FOLLOW_TOOL = 'personal_browser_follow';
export const PERSONAL_PROJECT_PROOF_PROTOCOL = 'weftmate.personal-project-proof.v1';
export const inject = ['tools'];
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_TOOL_ERRORS = new Set(['PERSONAL_TOOL_UNAVAILABLE', 'PERSONAL_TOOL_TIMEOUT',
  'PERSONAL_TOOL_CANCELLED', 'SESSION_READ_ONLY', 'TOOL_SOURCE_UNAVAILABLE',
  'TOOL_INTENT_UNCONFIRMED', 'CAPABILITY_UNAVAILABLE', 'STORAGE_UNAVAILABLE',
  'DEVICE_REVOKED', 'SESSION_REPLACED', 'SESSION_EXPIRED', 'INVALID_COMMAND',
  'REQUEST_CONFLICT', 'CAPACITY_LIMIT', 'BACKEND_UNAVAILABLE', 'SERVICE_CLOSING',
  'PROJECT_UNAVAILABLE', 'PROJECT_REVOKED', 'PROJECT_FILE_NOT_FOUND',
  'PROJECT_FILE_CHANGED', 'PROJECT_LIMIT_REACHED', 'PROJECT_MODEL_MISMATCH',
  'PROJECT_MODEL_CHANGED', 'PROJECT_READ_INVALID', 'PROJECT_SOURCE_UNVERIFIED',
  'PROJECT_ROOT_CHANGED', 'PROJECT_UNSAFE_PATH', 'PROJECT_INVALID_UTF8',
  'PROJECT_FILE_UNAVAILABLE', 'PROJECT_READER_TIMEOUT', 'PROJECT_LINE_OUT_OF_RANGE',
  'PROJECT_LINE_TOO_LONG', 'PROJECT_READER_INVALID', 'BROWSER_UNAVAILABLE',
  'BROWSER_BUSY', 'BROWSER_CANCELLED', 'BROWSER_EMPTY_PAGE', 'BROWSER_HTTP_ERROR',
  'BROWSER_LOGIN_REQUIRED', 'BROWSER_NETWORK_ERROR', 'BROWSER_NETWORK_LIMIT',
  'BROWSER_RENDERER_FAILED', 'BROWSER_TARGET_BLOCKED', 'BROWSER_URL_INVALID',
  'BROWSER_LINK_UNAVAILABLE', 'BROWSER_SOURCE_UNVERIFIED', 'BROWSER_DNS_TIMEOUT',
  'BROWSER_DOWNGRADE_BLOCKED', 'BROWSER_PAGE_CHANGED', 'BROWSER_CLEANUP_FAILED']);
const READ_TOOLS = new Set([PERSONAL_PROJECT_READ_TOOL, PERSONAL_BROWSER_OPEN_TOOL,
  PERSONAL_BROWSER_FOLLOW_TOOL]);

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
  const receiptId = users[0].data?.source?.rpcId;
  return { sessionId: session.id, turn, callId: exec.callId,
    messageHash: createHash('sha256').update(text).digest('hex'),
    ...(typeof receiptId === 'string' && SAFE_ID.test(receiptId) ? { receiptId } : {}) };
}

function projectIdentity(exec) {
  const identity = personalToolIdentity(exec);
  if (!identity.receiptId) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  return identity;
}

function safePublicUrl(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2_048 ||
      /[\x00-\x1f\x7f]/.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password &&
    parsed.hostname ? value : null;
}

function safeQuery(value) {
  return value === undefined ? '' : typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= 200 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
}

function safeSnapshotIds(value) {
  return value === undefined ? undefined : Array.isArray(value) && value.length <= 16 &&
    value.every((id) => typeof id === 'string' && SNAPSHOT_ID.test(id)) &&
    new Set(value).size === value.length ? value : null;
}

function proofRequest(frame) {
  return frame && typeof frame === 'object' && !Array.isArray(frame) &&
    Object.keys(frame).sort().join(',') === ['beforeCallId', 'id', 'protocol', 'readCallId',
      'sessionId', 'snapshotId', 'sourceReceiptId', 'turn',
      ...(frame.readTool === undefined ? [] : ['readTool']),
      ...(frame.beforeTool === undefined ? [] : ['beforeTool'])].sort().join(',') &&
    (frame.readTool === undefined || READ_TOOLS.has(frame.readTool)) &&
    (frame.beforeTool === undefined || ['personal_save_document',
      PERSONAL_BROWSER_FOLLOW_TOOL].includes(frame.beforeTool)) &&
    frame.protocol === PERSONAL_PROJECT_PROOF_PROTOCOL && typeof frame.id === 'string' &&
    /^proof-[0-9a-f-]{36}$/.test(frame.id) &&
    typeof frame.sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(frame.sessionId) &&
    Number.isSafeInteger(frame.turn) && frame.turn > 0 &&
    [frame.readCallId, frame.beforeCallId, frame.sourceReceiptId].every((id) =>
      typeof id === 'string' && SAFE_ID.test(id)) && frame.readCallId !== frame.beforeCallId &&
    typeof frame.snapshotId === 'string' && SNAPSHOT_ID.test(frame.snapshotId);
}

/** Inspect only a physically committed DSH JSONL artifact, never live session.events. */
export function verifyStoredProjectRead(content, request) {
  if (!proofRequest({ ...request, protocol: PERSONAL_PROJECT_PROOF_PROTOCOL,
    id: 'proof-00000000-0000-4000-8000-000000000000' }) ||
      typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 4_000_000) return false;
  let open = null;
  let userCount = 0;
  let readCall = 0;
  let readResult = 0;
  let saveCall = 0;
  let previousSeq = -1;
  let rows = 0;
  const readTool = request.readTool ?? PERSONAL_PROJECT_READ_TOOL;
  const beforeTool = request.beforeTool ?? PERSONAL_DOCUMENT_TOOL;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    if (++rows > 12_000) return false;
    let event;
    try { event = JSON.parse(line); } catch { return false; }
    if (event.type === 'session' || ['text-chunks', 'reasoning-chunks',
      'tool-call-chunks'].includes(event.type)) continue;
    if (!Number.isSafeInteger(event.seq) || event.seq <= previousSeq) return false;
    previousSeq = event.seq;
    if (event.type === 'turn/start') {
      if (event.data?.turn === request.turn) {
        if (open !== null || saveCall) return false;
        open = request.turn;
      }
      continue;
    }
    if (open !== request.turn) continue;
    if (event.type === 'turn/end' && event.data?.turn === request.turn) return false;
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      userCount++;
      if (event.data.source.rpcId !== request.sourceReceiptId || userCount !== 1) return false;
    }
    if (event.type === 'tool/call' && event.data?.turn === request.turn) {
      if (event.data.callId === request.readCallId) {
        if (event.data.name !== readTool || ++readCall !== 1 || saveCall) return false;
      }
      if (event.data.callId === request.beforeCallId) {
        if (event.data.name !== beforeTool || ++saveCall !== 1 ||
            readResult !== 1 || userCount !== 1) return false;
        return true;
      }
    }
    if (event.type === 'tool/result' && event.data?.turn === request.turn &&
        event.data?.message?.source?.callId === request.readCallId) {
      if (!readCall || saveCall || ++readResult !== 1 || event.data.error !== undefined ||
          event.data.message.source.kind !== 'tool') return false;
      const block = event.data.message.content?.[0];
      if (block?.type !== 'tool-result' || block.toolCallId !== request.readCallId ||
          block.isError === true || !Array.isArray(block.content) || block.content.length !== 1 ||
          block.content[0]?.type !== 'text' || typeof block.content[0].text !== 'string' ||
          block.content[0].text.length > 80_000) return false;
      let value;
      try { value = JSON.parse(block.content[0].text); } catch { return false; }
      if (value?.snapshotId !== request.snapshotId || typeof value?.text !== 'string') return false;
      if (readTool === PERSONAL_PROJECT_READ_TOOL) {
        if (typeof value.fileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.fileSha256)) return false;
      } else if (typeof value.contentSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.contentSha256) ||
          typeof value.url !== 'string' || safePublicUrl(value.url) === null) return false;
    }
  }
  return false;
}

function installProofBridge(ctx) {
  const onMessage = (frame) => {
    if (!proofRequest(frame)) return;
    const respond = (verified) => {
      if (typeof process.send === 'function' && process.connected) {
        try { process.send({ protocol: PERSONAL_PROJECT_PROOF_PROTOCOL, id: frame.id, verified }); }
        catch { /* Parent treats disconnect as unverified. */ }
      }
    };
    void (async () => {
      const persistence = ctx.get?.('sessionPersistence');
      if (typeof persistence?.readRaw !== 'function') return false;
      const deadline = Date.now() + 2_200;
      do {
        const artifact = await persistence.readRaw(frame.sessionId);
        if (artifact?.meta?.id === frame.sessionId &&
            artifact.meta.agentPreset === 'personal-remote' &&
            verifyStoredProjectRead(artifact.content, frame)) return true;
        await new Promise((resolve) => setTimeout(resolve, 60));
      } while (Date.now() < deadline);
      return false;
    })().then(respond, () => respond(false));
  };
  process.on('message', onMessage);
  return () => process.off('message', onMessage);
}

export class PersonalDesktopBridge {
  constructor(transport = process) {
    this.transport = transport;
    this.pending = new Map();
    this.closed = false;
    this.onMessage = (frame) => {
      if (frame?.protocol !== PERSONAL_DESKTOP_PROTOCOL || typeof frame.id !== 'string') return;
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.ok === true && frame.command && typeof frame.command === 'object') entry.resolve(frame.command);
      else entry.reject(refused(SAFE_TOOL_ERRORS.has(frame.error)
        ? frame.error : 'PERSONAL_TOOL_UNAVAILABLE'));
    };
    this.onDisconnect = () => this.close();
    this.transport.on('message', this.onMessage);
    this.transport.once('disconnect', this.onDisconnect);
  }

  request(payload, signal) {
    if (this.closed || typeof this.transport.send !== 'function' || this.transport.connected !== true) {
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
      const timeout = ['list_project', 'read_project', 'open_page', 'follow_link'].includes(payload.action) ||
        payload.action === 'write_document' && payload.sourceSnapshotIds?.length > 0 ? 20_000 : 12_000;
      const timer = setTimeout(() => finish(refused('PERSONAL_TOOL_TIMEOUT')), timeout);
      const abort = () => finish(refused('PERSONAL_TOOL_CANCELLED'));
      this.pending.set(id, { resolve: (value) => { signal?.removeEventListener?.('abort', abort); resolve(value); },
        reject: (error) => { signal?.removeEventListener?.('abort', abort); reject(error); }, timer, abort });
      signal?.addEventListener?.('abort', abort, { once: true });
      try {
        this.transport.send({ protocol: PERSONAL_DESKTOP_PROTOCOL, id, ...payload }, (error) => {
          if (error) finish(refused('PERSONAL_TOOL_UNAVAILABLE'));
        });
      } catch { finish(refused('PERSONAL_TOOL_UNAVAILABLE')); }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.transport.off('message', this.onMessage);
    this.transport.off('disconnect', this.onDisconnect);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(refused('PERSONAL_TOOL_UNAVAILABLE'));
    }
    this.pending.clear();
  }
}

export function apply(ctx) {
  const bridge = new PersonalDesktopBridge();
  const disposeProof = installProofBridge(ctx);
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
    parameters: { fileName: { type: 'string', required: true }, content: { type: 'string', required: true },
      sourceSnapshotIds: { type: 'array', items: { type: 'string' },
        description: 'For project or browser summaries, provide snapshot IDs returned by successful reads in this same turn.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const fileName = safeDocumentName(args?.fileName);
      if (!fileName || typeof args?.content !== 'string' || !args.content.length ||
          Buffer.byteLength(args.content, 'utf8') > 128 * 1024 || args.content.includes('\0') ||
          Buffer.from(args.content, 'utf8').toString('utf8') !== args.content) throw refused('PERSONAL_TOOL_INVALID');
      const sourceSnapshotIds = safeSnapshotIds(args?.sourceSnapshotIds);
      if (sourceSnapshotIds === null) throw refused('PERSONAL_TOOL_INVALID');
      const identity = personalToolIdentity(exec);
      return bridge.request({ action: 'write_document', ...identity, fileName,
        content: args.content, ...(sourceSnapshotIds === undefined ? {} : { sourceSnapshotIds }) }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '保存文档', kind: 'execute' }),
  }));
  const disposeList = ctx.tools.register(defineTool({
    name: PERSONAL_PROJECT_LIST_TOOL,
    description: 'List a bounded set of UTF-8 Markdown/plain-text files in the project selected by the user. Use an optional short search query. Returns opaque fileId values; never pass or request an absolute path.',
    parameters: { query: { type: 'string', description: 'Optional short filename query (up to 200 UTF-8 bytes).' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const query = safeQuery(args?.query);
      if (query === null) throw refused('PERSONAL_TOOL_INVALID');
      return bridge.request({ action: 'list_project', ...projectIdentity(exec), query }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '查找项目资料', kind: 'execute' }),
  }));
  const disposeRead = ctx.tools.register(defineTool({
    name: PERSONAL_PROJECT_READ_TOOL,
    description: 'Read one bounded page of a project file selected by opaque fileId from personal_list_project_files. Specify a 1-based startLine for later pages. Read every needed page before citing or summarizing its contents.',
    parameters: { fileId: { type: 'string', required: true },
      startLine: { type: 'integer', description: '1-based first line; omit for the first page.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (typeof args?.fileId !== 'string' || !/^file-[a-f0-9]{48}$/.test(args.fileId) ||
          (args.startLine !== undefined && (!Number.isSafeInteger(args.startLine) ||
            args.startLine < 1 || args.startLine > 1_000_000))) throw refused('PERSONAL_TOOL_INVALID');
      return bridge.request({ action: 'read_project', ...projectIdentity(exec), fileId: args.fileId,
        ...(args.startLine === undefined ? {} : { startLine: args.startLine }) }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '读取项目资料', kind: 'execute' }),
  }));
  const disposeBrowserOpen = ctx.tools.register(defineTool({
    name: PERSONAL_BROWSER_OPEN_TOOL,
    description: 'Read one public HTTP/HTTPS page that belongs to the current user browser task. The host checks the user-submitted URL, public network destination and real rendered page. Returns bounded visible text and observed link IDs. Never accepts JavaScript, cookies or browser actions.',
    parameters: { url: { type: 'string', required: true,
      description: 'Public page URL from the current user request; no local or private address.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const url = safePublicUrl(args?.url);
      if (!url) throw refused('PERSONAL_TOOL_INVALID');
      return bridge.request({ action: 'open_page', ...projectIdentity(exec), url }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '阅读公共网页', kind: 'execute' }),
  }));
  const disposeBrowserFollow = ctx.tools.register(defineTool({
    name: PERSONAL_BROWSER_FOLLOW_TOOL,
    description: 'Follow one link ID actually observed in a successful page snapshot of this same browser task. Pass only the prior snapshotId and linkId; the host resolves the URL. Never invent a link or provide a script, click target, form or download.',
    parameters: { snapshotId: { type: 'string', required: true },
      linkId: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (typeof args?.snapshotId !== 'string' || !/^source-[a-f0-9]{48}$/.test(args.snapshotId) ||
          typeof args?.linkId !== 'string' || !/^link-[a-f0-9]{40}$/.test(args.linkId)) {
        throw refused('PERSONAL_TOOL_INVALID');
      }
      return bridge.request({ action: 'follow_link', ...projectIdentity(exec),
        snapshotId: args.snapshotId, linkId: args.linkId }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '沿已读链接继续阅读', kind: 'execute' }),
  }));
  const disposeGuard = ctx.tools.guard((exec) => [PERSONAL_DESKTOP_TOOL, PERSONAL_DOCUMENT_TOOL,
    PERSONAL_PROJECT_LIST_TOOL, PERSONAL_PROJECT_READ_TOOL,
    PERSONAL_BROWSER_OPEN_TOOL, PERSONAL_BROWSER_FOLLOW_TOOL].includes(exec.name) &&
    exec.agent?.session?.header?.agentPreset !== 'personal-remote' ? 'PERSONAL_TOOL_SCOPE_DENIED' : undefined);
  ctx.effect(() => () => { disposeGuard(); disposeBrowserFollow(); disposeBrowserOpen(); disposeRead();
    disposeList(); disposeDocument(); disposeTool(); disposeProof(); bridge.close(); }, 'weftmate-personal-desktop: lifecycle');
}

export default { name, inject, apply };
