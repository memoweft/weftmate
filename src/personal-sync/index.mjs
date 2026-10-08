import { enterProfileWrite } from '../personal-backup/write-barrier.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { canonicalAttachmentMetadata } from './attachments.mjs';

const VERSION = 1;
const MAX_EVENTS = 20_000;
const MAX_BATCH = 50;
const MAX_BATCH_BYTES = 256 * 1024;
const MAX_STORE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT = 16_384;
const UUID = /^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const RFC3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,128}$/;
const HOST_PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class PersonalSyncError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const invalid = () => { throw new PersonalSyncError('INVALID_REQUEST'); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) {
  if (!object(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function optionalExact(value, required, optional) {
  if (!object(value) || required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}
function text(value, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) ||
      Array.from(value).length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid();
  return value;
}
function when(value) {
  if (typeof value !== 'string' || !RFC3339.test(value)) invalid();
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) invalid();
  return time.toISOString();
}

function canonicalOriginalModel(value) {
  optionalExact(value, ['modelId', 'displayName', 'routeFingerprint'], ['hostProfileId']);
  if (typeof value.modelId !== 'string' || !MODEL_ID.test(value.modelId) ||
      typeof value.displayName !== 'string' || !value.displayName.trim() ||
      Array.from(value.displayName).length > 100 || /[\u0000-\u001f\u007f]/.test(value.displayName) ||
      value.routeFingerprint !== null &&
        (typeof value.routeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.routeFingerprint)) ||
      value.hostProfileId !== undefined &&
        (typeof value.hostProfileId !== 'string' || !HOST_PROFILE_ID.test(value.hostProfileId))) invalid();
  return { modelId: value.modelId, displayName: value.displayName,
    routeFingerprint: value.routeFingerprint,
    ...(value.hostProfileId === undefined ? {} : { hostProfileId: value.hostProfileId }) };
}

export function canonicalSyncEvent(input) {
  exact(input, ['eventId', 'conversationId', 'clientSeq', 'kind', 'occurredAt', 'payload']);
  const eventId = uuid(input.eventId), conversationId = uuid(input.conversationId);
  if (!Number.isSafeInteger(input.clientSeq) || input.clientSeq < 1) invalid();
  const occurredAt = when(input.occurredAt);
  let payload;
  switch (input.kind) {
    case 'conversation.created':
      exact(input.payload, ['title']);
      payload = { title: text(input.payload.title, 256) };
      break;
    case 'message.created':
      optionalExact(input.payload, ['messageId', 'role', 'text'], ['attachments']);
      if (!['user', 'assistant'].includes(input.payload.role)) invalid();
      if (input.payload.attachments !== undefined &&
          (!Array.isArray(input.payload.attachments) || input.payload.attachments.length < 1 ||
            input.payload.attachments.length > 8)) invalid();
      const attachments = input.payload.attachments?.map(canonicalAttachmentMetadata);
      if (attachments && new Set(attachments.map((item) => item.attachmentId)).size !== attachments.length) invalid();
      payload = { messageId: uuid(input.payload.messageId), role: input.payload.role,
        text: text(input.payload.text, MAX_TEXT, !!attachments),
        ...(attachments ? { attachments } : {}) };
      break;
    case 'turn.finished':
      optionalExact(input.payload, ['turnId', 'status'], ['errorCode', 'originalModel']);
      if (!['completed', 'cancelled', 'failed', 'interrupted'].includes(input.payload.status) ||
          (input.payload.errorCode !== undefined &&
            (typeof input.payload.errorCode !== 'string' || !ERROR_CODE.test(input.payload.errorCode)))) invalid();
      payload = { turnId: uuid(input.payload.turnId), status: input.payload.status,
        ...(input.payload.errorCode === undefined ? {} : { errorCode: input.payload.errorCode }),
        ...(input.payload.originalModel === undefined ? {} : {
          originalModel: canonicalOriginalModel(input.payload.originalModel) }) };
      break;
    case 'tool.receipt':
      exact(input.payload, ['toolCallId', 'toolName', 'status', 'summary']);
      if (typeof input.payload.toolName !== 'string' || !TOOL_NAME.test(input.payload.toolName) ||
          !['dispatched', 'observed', 'failed', 'uncertain'].includes(input.payload.status)) invalid();
      payload = { toolCallId: uuid(input.payload.toolCallId), toolName: input.payload.toolName,
        status: input.payload.status, summary: text(input.payload.summary, 1024, true) };
      break;
    default: invalid();
  }
  return { eventId, conversationId, clientSeq: input.clientSeq,
    kind: input.kind, occurredAt, payload };
}

function digest(event) { return createHash('sha256').update(JSON.stringify(event)).digest('hex'); }

function validateStore(store, ownerId) {
  if (!object(store) || store.version !== VERSION || store.ownerId !== ownerId ||
      !Number.isSafeInteger(store.lastSeq) || store.lastSeq < 0 ||
      !Array.isArray(store.events) || store.events.length > MAX_EVENTS ||
      store.lastSeq !== store.events.length ||
      Buffer.byteLength(JSON.stringify(store), 'utf8') > MAX_STORE_BYTES) {
    throw new PersonalSyncError('SYNC_STORE_CORRUPT', 500);
  }
  const ids = new Set(), perDevice = new Map();
  for (let index = 0; index < store.events.length; index++) {
    const row = store.events[index];
    try {
      optionalExact(row, ['seq', 'sourceDeviceId', 'digest', 'eventId', 'conversationId', 'clientSeq', 'kind', 'occurredAt', 'payload'], []);
      if (row.seq !== index + 1 || typeof row.sourceDeviceId !== 'string' || !DEVICE_ID.test(row.sourceDeviceId) ||
          typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest) ||
          ids.has(row.eventId)) throw new Error('invalid sync row');
      const event = canonicalSyncEvent(Object.fromEntries(
        ['eventId', 'conversationId', 'clientSeq', 'kind', 'occurredAt', 'payload'].map((key) => [key, row[key]])));
      const deviceSequences = perDevice.get(row.sourceDeviceId) ?? new Set();
      if (JSON.stringify(event) !== JSON.stringify(Object.fromEntries(
        ['eventId', 'conversationId', 'clientSeq', 'kind', 'occurredAt', 'payload'].map((key) => [key, row[key]]))) ||
          row.digest !== digest(event) || deviceSequences.has(event.clientSeq)) {
        throw new Error('invalid sync row');
      }
      ids.add(row.eventId);
      deviceSequences.add(event.clientSeq);
      perDevice.set(row.sourceDeviceId, deviceSequences);
    } catch { throw new PersonalSyncError('SYNC_STORE_CORRUPT', 500); }
  }
}

async function atomicWrite(file, value, shouldCommit) {
  const releaseWrite = await enterProfileWrite(file);
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await ensurePrivateFile(temp);
    for (let attempt = 0; ; attempt++) {
      if (!shouldCommit()) throw new PersonalSyncError('SERVICE_CLOSING', 503);
      try { await rename(temp, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    await ensurePrivateFile(file);
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    releaseWrite();
  }
}

export async function createPersonalSyncStore({ root, ownerId }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof ownerId !== 'string' ||
      !DEVICE_ID.test(ownerId)) invalid();
  await ensurePrivateDirectory(root);
  const file = path.join(root, 'events.json');
  let state;
  try {
    await ensurePrivateFile(file);
    state = JSON.parse(await readFile(file, 'utf8'));
    validateStore(state, ownerId);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new PersonalSyncError('SYNC_STORE_CORRUPT', 500);
    state = { version: VERSION, ownerId, lastSeq: 0, events: [] };
    await atomicWrite(file, state, () => true);
  }
  let queue = Promise.resolve(), closed = false, storageFault = false;
  const serial = (task) => {
    const result = queue.then(() => { if (closed) throw new PersonalSyncError('SERVICE_CLOSING', 503); return task(); });
    queue = result.catch(() => {});
    return result;
  };
  return {
    async append({ events, sourceDeviceId, authorize = () => {}, validateAttachment = async () => true }) {
      if (!Array.isArray(events) || events.length < 1 || events.length > MAX_BATCH ||
          typeof sourceDeviceId !== 'string' || !DEVICE_ID.test(sourceDeviceId) ||
          typeof authorize !== 'function' || typeof validateAttachment !== 'function' ||
          Buffer.byteLength(JSON.stringify({ events }), 'utf8') > MAX_BATCH_BYTES) invalid();
      const canonical = events.map(canonicalSyncEvent);
      return serial(async () => {
        authorize();
        if (storageFault) throw new PersonalSyncError('STORAGE_UNAVAILABLE', 503);
        const next = structuredClone(state);
        const byId = new Map(next.events.map((row) => [row.eventId, row]));
        const usedClientSeq = new Map();
        for (const row of next.events) {
          const used = usedClientSeq.get(row.sourceDeviceId) ?? new Set();
          used.add(row.clientSeq);
          usedClientSeq.set(row.sourceDeviceId, used);
        }
        const accepted = [];
        for (const event of canonical) {
          const hash = digest(event);
          const prior = byId.get(event.eventId);
          if (prior) {
            if (prior.digest !== hash) throw new PersonalSyncError('REQUEST_CONFLICT', 409);
            accepted.push({ eventId: event.eventId, seq: prior.seq, duplicate: true });
            continue;
          }
          const used = usedClientSeq.get(sourceDeviceId) ?? new Set();
          if (used.has(event.clientSeq)) {
            throw new PersonalSyncError('REQUEST_CONFLICT', 409);
          }
          if (next.events.length >= MAX_EVENTS) throw new PersonalSyncError('CAPACITY_LIMIT', 429);
          for (const attachment of event.payload.attachments ?? []) {
            if (!await validateAttachment({ attachment, conversationId: event.conversationId,
              messageId: event.payload.messageId })) throw new PersonalSyncError('ATTACHMENT_NOT_FOUND', 400);
          }
          const row = { seq: ++next.lastSeq, sourceDeviceId, digest: hash, ...event };
          next.events.push(row);
          byId.set(event.eventId, row);
          used.add(event.clientSeq);
          usedClientSeq.set(sourceDeviceId, used);
          accepted.push({ eventId: event.eventId, seq: row.seq, duplicate: false });
        }
        if (next.lastSeq !== state.lastSeq) {
          authorize();
          if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_STORE_BYTES) {
            throw new PersonalSyncError('CAPACITY_LIMIT', 429);
          }
          try { await atomicWrite(file, next, () => { authorize(); return !closed; }); }
          catch (error) {
            if (!['SERVICE_CLOSING', 'UNAUTHORIZED', 'FORBIDDEN'].includes(error?.code)) storageFault = true;
            throw error;
          }
          state = next;
        }
        return { accepted, lastSeq: state.lastSeq };
      });
    },
    page({ afterSeq = 0, limit = 100 } = {}) {
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > state.lastSeq ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 200) invalid();
      const events = state.events.slice(afterSeq, afterSeq + limit).map(({ digest: _digest, ...row }) => row);
      const nextSeq = events.at(-1)?.seq ?? afterSeq;
      return { events, nextSeq, hasMore: nextSeq < state.lastSeq };
    },
    conversationSnapshot(conversationId) {
      uuid(conversationId);
      const events = state.events.filter((row) => row.conversationId === conversationId)
        .map(({ digest: _digest, ...row }) => structuredClone(row));
      const created = events.filter((row) => row.kind === 'conversation.created');
      const devices = new Map();
      for (const row of events) {
        const progress = devices.get(row.sourceDeviceId) ?? { userSeq: 0, terminalSeq: 0 };
        if (row.kind === 'message.created' && row.payload.role === 'user') {
          progress.userSeq = Math.max(progress.userSeq, row.clientSeq);
        }
        if (row.kind === 'turn.finished') {
          progress.terminalSeq = Math.max(progress.terminalSeq, row.clientSeq);
        }
        devices.set(row.sourceDeviceId, progress);
      }
      return { conversationId, events, latestSeq: events.at(-1)?.seq ?? 0,
        createdCount: created.length,
        title: created.length === 1 ? created[0].payload.title : null,
        unfinished: [...devices.values()].some((item) => item.userSeq > item.terminalSeq) };
    },
    references(attachmentId, conversationId, messageId) {
      return state.events.some((event) => event.kind === 'message.created' &&
        event.conversationId === conversationId && event.payload.messageId === messageId &&
        event.payload.attachments?.some((item) => item.attachmentId === attachmentId));
    },
    close() { closed = true; return queue; },
  };
}
