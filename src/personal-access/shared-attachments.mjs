import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { TEXT_ATTACHMENT_TYPES } from '../personal-sync/attachments.mjs';

export const MAX_SHARED_IMAGE_BYTES = 5 * 1024 * 1024;
// This is input material for one model turn, never the uploaded original.  The
// original remains in personal-sync's streaming attachment store (up to 1 GiB).
export const MAX_SHARED_TEXT_BYTES = 16 * 1024;
export const MAX_SHARED_MESSAGE_IMAGES = 4;
export const MAX_SHARED_MESSAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SHARED_MESSAGE_TEXT_BYTES = 16 * 1024;
const MAX_OWNER_BYTES = 256 * 1024 * 1024;
const MAX_OWNER_FILES = 1024;
const IMAGE_ID = /^attachment-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export class SharedAttachmentError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status = 400) => { throw new SharedAttachmentError(code, status); };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function validName(value) {
  return typeof value === 'string' && value.trim() === value && value.length >= 1 && value.length <= 120 &&
    !/[\\/\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..';
}
function matchesMime(type, bytes) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 &&
    bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (type === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (!TEXT_ATTACHMENT_TYPES.has(type)) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !text.includes('\u0000');
  } catch { return false; }
}
export function canonicalSharedAttachment(value) {
  const limit = IMAGE_MIME.has(value?.contentType) ? MAX_SHARED_IMAGE_BYTES
    : TEXT_ATTACHMENT_TYPES.has(value?.contentType) ? MAX_SHARED_TEXT_BYTES : 0;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'attachmentId,contentType,name,sha256,size' ||
      !IMAGE_ID.test(value.attachmentId) || !validName(value.name) || !limit ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > limit ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail('INVALID_REQUEST');
  return { attachmentId: value.attachmentId, name: value.name, contentType: value.contentType,
    size: value.size, sha256: value.sha256 };
}

export async function createSharedAttachmentStore({ root }) {
  await ensurePrivateDirectory(root);
  let queue = Promise.resolve();
  const serial = (task) => { const value = queue.then(task); queue = value.catch(() => {}); return value; };
  const pathsFor = (sessionId, requestId, attachmentId) => {
    if (!SESSION_ID.test(sessionId) || !REQUEST_ID.test(requestId) || !IMAGE_ID.test(attachmentId)) fail('INVALID_REQUEST');
    const key = sha(Buffer.from(JSON.stringify([sessionId, requestId, attachmentId]), 'utf8'));
    return { current: path.join(root, `staged-${key}.image`),
      legacy: path.join(root, `${attachmentId}.image`) };
  };
  async function readStored(file, attachmentId) {
    try {
      await ensurePrivateFile(file);
      const encoded = await readFile(file);
      if (encoded.length < 5) fail('STORAGE_UNAVAILABLE', 503);
      const headerLength = encoded.readUInt32BE(0);
      if (headerLength < 2 || headerLength > 2048 || encoded.length < 4 + headerLength) fail('STORAGE_UNAVAILABLE', 503);
      const stored = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength));
      const attachment = canonicalSharedAttachment(stored.attachment);
      const bytes = encoded.subarray(4 + headerLength);
      if (!SESSION_ID.test(stored.sessionId) || !REQUEST_ID.test(stored.requestId) ||
          attachment.attachmentId !== attachmentId || bytes.length !== attachment.size ||
          sha(bytes) !== attachment.sha256 || !matchesMime(attachment.contentType, bytes)) fail('STORAGE_UNAVAILABLE', 503);
      return { attachment, sessionId: stored.sessionId, requestId: stored.requestId, bytes };
    } catch (error) {
      if (error?.code === 'ENOENT') fail('ATTACHMENT_NOT_FOUND', 404);
      if (error instanceof SharedAttachmentError) throw error;
      fail('STORAGE_UNAVAILABLE', 503);
    }
  }
  async function get({ sessionId, requestId, attachmentId }) {
    const paths = pathsFor(sessionId, requestId, attachmentId);
    try {
      const found = await readStored(paths.current, attachmentId);
      if (found.sessionId !== sessionId || found.requestId !== requestId) fail('STORAGE_UNAVAILABLE', 503);
      return { ...found, file: paths.current };
    } catch (error) { if (error?.code !== 'ATTACHMENT_NOT_FOUND') throw error; }
    // Pre-tuple staging files belong only to the request recorded in their header.
    // Keep them readable for pending/uncertain commands without letting a new
    // request claim or overwrite their attachment UUID.
    const old = await readStored(paths.legacy, attachmentId);
    if (old.sessionId !== sessionId || old.requestId !== requestId) fail('ATTACHMENT_NOT_FOUND', 404);
    return { ...old, file: paths.legacy };
  }
  return {
    async removeSession(sessionId) {
      if (!SESSION_ID.test(sessionId)) fail('INVALID_REQUEST');
      await serial(async () => {
        for (const name of await readdir(root)) {
          if (!name.endsWith('.image')) continue;
          const file = path.join(root, name);
          const encoded = await readFile(file);
          const headerLength = encoded.readUInt32BE(0);
          const stored = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength));
          if (stored.sessionId === sessionId) await rm(file, { force: true });
        }
      });
    },
    get,
    async put({ attachmentId, sessionId, requestId, name, contentType, sha256, bytes, authorize = () => {} }) {
      if (!IMAGE_ID.test(attachmentId) || !SESSION_ID.test(sessionId) || !REQUEST_ID.test(requestId) ||
          !validName(name) || (!IMAGE_MIME.has(contentType) && !TEXT_ATTACHMENT_TYPES.has(contentType)) || !Buffer.isBuffer(bytes) ||
          bytes.length < 1 || bytes.length > (IMAGE_MIME.has(contentType) ? MAX_SHARED_IMAGE_BYTES : MAX_SHARED_TEXT_BYTES) ||
          !/^[a-f0-9]{64}$/.test(sha256) || sha(bytes) !== sha256 || !matchesMime(contentType, bytes)) fail('INVALID_REQUEST');
      const attachment = canonicalSharedAttachment({ attachmentId, name, contentType, size: bytes.length, sha256 });
      return serial(async () => {
        authorize();
        try {
          const old = await get({ sessionId, requestId, attachmentId });
          if (JSON.stringify(old.attachment) !== JSON.stringify(attachment) || !old.bytes.equals(bytes)) {
            fail('REQUEST_CONFLICT', 409);
          }
          return { attachment, duplicate: true };
        } catch (error) { if (error?.code !== 'ATTACHMENT_NOT_FOUND') throw error; }
        let count = 0; let total = 0;
        for (const item of await readdir(root, { withFileTypes: true })) {
          if (!item.name.endsWith('.image')) continue;
          const entry = await lstat(path.join(root, item.name));
          if (!entry.isFile() || entry.isSymbolicLink()) fail('STORAGE_UNAVAILABLE', 503);
          count += 1; total += entry.size;
        }
        if (count >= MAX_OWNER_FILES || total + bytes.length > MAX_OWNER_BYTES) fail('CAPACITY_LIMIT', 429);
        const header = Buffer.from(JSON.stringify({ attachment, sessionId, requestId }), 'utf8');
        const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
        const file = pathsFor(sessionId, requestId, attachmentId).current;
        const temp = `${file}.${randomUUID()}.tmp`;
        let handle;
        try {
          handle = await open(temp, 'wx', 0o600);
          await handle.writeFile(Buffer.concat([length, header, bytes]));
          await handle.sync();
          await handle.close(); handle = null;
          authorize();
          await rename(temp, file);
          return { attachment, duplicate: false };
        } finally { await handle?.close().catch(() => {}); await rm(temp, { force: true }).catch(() => {}); }
      });
    },
    async resolve({ sessionId, requestId, attachments }) {
      if (!SESSION_ID.test(sessionId) || !REQUEST_ID.test(requestId) || !Array.isArray(attachments) ||
          attachments.length < 1 || attachments.length > MAX_SHARED_MESSAGE_IMAGES) fail('INVALID_REQUEST');
      const canonical = attachments.map(canonicalSharedAttachment);
      if (new Set(canonical.map((row) => row.attachmentId)).size !== canonical.length ||
          canonical.reduce((sum, row) => sum + row.size, 0) > MAX_SHARED_MESSAGE_BYTES ||
          canonical.filter((row) => TEXT_ATTACHMENT_TYPES.has(row.contentType))
            .reduce((sum, row) => sum + row.size, 0) > MAX_SHARED_MESSAGE_TEXT_BYTES) fail('INVALID_REQUEST');
      const rows = [];
      for (const row of canonical) {
        const found = await get({ sessionId, requestId, attachmentId: row.attachmentId });
        if (JSON.stringify(found.attachment) !== JSON.stringify(row)) fail('ATTACHMENT_NOT_FOUND', 404);
        rows.push({ ...row, bytes: found.bytes });
      }
      return rows;
    },
    async release({ sessionId, requestId, attachments }) {
      for (const row of attachments ?? []) {
        try {
          const found = await get({ sessionId, requestId, attachmentId: row.attachmentId });
          await rm(found.file, { force: true });
        } catch { /* Best effort after DSH acceptance. */ }
      }
    },
  };
}
