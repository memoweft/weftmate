import { enterProfileWrite } from '../personal-backup/write-barrier.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';

export const MAX_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
export const MAX_DISPLAY_BYTES = 512 * 1024;
const HEADER_BYTES = 2048;
const DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const UUID = /^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// These are deliberately the only formats that a later model-input adapter may
// treat as text. Original-file storage remains format-agnostic: a mislabeled
// or legacy-encoded file must remain downloadable even when it cannot be read
// by a model.
export const TEXT_ATTACHMENT_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson',
]);
const CONTENT_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export class AttachmentError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const invalid = () => { throw new AttachmentError('INVALID_REQUEST'); };
const validUuid = (value) => typeof value === 'string' && UUID.test(value);
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validName(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value).length <= 128 && value === value.trim() &&
    !/[\\/\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..';
}
const validContentType = (value) => typeof value === 'string' && value.length >= 3 && value.length <= 127 &&
  value === value.toLowerCase() && CONTENT_TYPE.test(value);
export function canonicalAttachmentMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 5 ||
      Object.keys(value).some((key) => !['attachmentId', 'name', 'contentType', 'size', 'sha256'].includes(key)) ||
      !validUuid(value.attachmentId) || !validName(value.name) || !validContentType(value.contentType) ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_ATTACHMENT_BYTES ||
      !validHash(value.sha256)) invalid();
  return { attachmentId: value.attachmentId, name: value.name, contentType: value.contentType,
    size: value.size, sha256: value.sha256 };
}
function matchesType(type, first, last, size) {
  if (type === 'image/png') return size >= 20 &&
    first.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    last.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  if (type === 'image/jpeg') return size >= 4 && first[0] === 255 && first[1] === 216 &&
    first[2] === 255 && last.at(-2) === 255 && last.at(-1) === 217;
  if (type === 'image/webp') return size >= 16 && first.toString('ascii', 0, 4) === 'RIFF' &&
    first.toString('ascii', 8, 12) === 'WEBP' && first.readUInt32LE(4) === size - 8;
  if (type === 'image/gif') return size >= 7 && ['GIF87a', 'GIF89a'].includes(first.toString('ascii', 0, 6)) && last.at(-1) === 0x3b;
  return !IMAGE_TYPES.has(type);
}
async function writeAll(handle, bytes, position) {
  for (let done = 0; done < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done);
    if (!bytesWritten) throw new AttachmentError('STORAGE_UNAVAILABLE', 503);
    done += bytesWritten;
  }
}
async function inspect(file, attachmentId, display = false) {
  try {
    await ensurePrivateFile(file);
    const handle = await open(file, 'r');
    let stored; let offset;
    try {
      const prefix = Buffer.alloc(4);
      if ((await handle.read(prefix, 0, 4, 0)).bytesRead !== 4) throw Error('short header');
      const length = prefix.readUInt32BE();
      if (length < 2 || length > HEADER_BYTES) throw Error('bad header');
      const header = Buffer.alloc(length);
      if ((await handle.read(header, 0, length, 4)).bytesRead !== length) throw Error('short header');
      stored = JSON.parse(header.toString('utf8'));
      offset = 4 + length;
    } finally { await handle.close(); }
    const meta = display ? stored.display : canonicalAttachmentMetadata(Object.fromEntries(
      ['attachmentId', 'name', 'contentType', 'size', 'sha256'].map((key) => [key, stored[key]])));
    if (display && (!meta || meta.attachmentId !== attachmentId || meta.contentType !== 'image/jpeg' ||
        !Number.isSafeInteger(meta.size) || meta.size < 4 || meta.size > MAX_DISPLAY_BYTES || !validHash(meta.sha256))) {
      throw Error('bad display metadata');
    }
    if (meta.attachmentId !== attachmentId || !validUuid(stored.conversationId) ||
        !validUuid(stored.messageId) || (await stat(file)).size !== offset + meta.size) throw Error('bad attachment');
    const hash = createHash('sha256');
    let first = Buffer.alloc(0); let last = Buffer.alloc(0);
    for await (const chunk of createReadStream(file, { start: offset })) {
      hash.update(chunk);
      if (first.length < 16) first = Buffer.concat([first, chunk.subarray(0, 16 - first.length)]);
      last = chunk.length >= 16 ? chunk.subarray(-16) : Buffer.concat([last, chunk]).subarray(-16);
    }
    if (hash.digest('hex') !== meta.sha256 || !matchesType(meta.contentType, first, last, meta.size)) {
      throw Error('bad contents');
    }
    return { meta, file, offset, conversationId: stored.conversationId, messageId: stored.messageId };
  } catch (error) {
    if (error?.code === 'ENOENT') throw new AttachmentError('NOT_FOUND', 404);
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError('STORAGE_UNAVAILABLE', 503);
  }
}
export async function createAttachmentStore({ root }) {
  await ensurePrivateDirectory(root);
  for (const entry of await readdir(root)) {
    if (/\.(?:image|display)\.[0-9a-f-]{36}\.tmp$/i.test(entry)) await rm(path.join(root, entry), { force: true });
  }
  let queue = Promise.resolve();
  const serial = (task) => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const fileFor = (id, display = false) => {
    if (!validUuid(id)) invalid();
    return path.join(root, `${id}.${display ? 'display' : 'image'}`);
  };
  const get = (id, display = false) => inspect(fileFor(id, display), id, display);
  const requireSpace = async (additional) => {
    try {
      const disk = await statfs(root);
      if (disk.bavail * disk.bsize < additional + DISK_RESERVE_BYTES) {
        throw new AttachmentError('CAPACITY_LIMIT', 507);
      }
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      throw new AttachmentError('STORAGE_UNAVAILABLE', 503);
    }
  };
  async function put({ attachmentId, conversationId, messageId, name, contentType, sha256,
    stream, bytes, expectedSize, display = false, authorize = () => {} }) {
    if (!validUuid(conversationId) || !validUuid(messageId) || !validHash(sha256) ||
        (display ? contentType !== 'image/jpeg' : (!validName(name) || !validContentType(contentType))) ||
        (!stream && !Buffer.isBuffer(bytes))) invalid();
    const limit = display ? MAX_DISPLAY_BYTES : MAX_ATTACHMENT_BYTES;
    if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 ||
        expectedSize > limit)) invalid();
    const file = fileFor(attachmentId, display);
    const releaseWrite = await enterProfileWrite(file);
    const temp = `${file}.${randomUUID()}.tmp`;
    let handle;
    let idleTimer;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      if (stream?.destroy) {
        idleTimer = setTimeout(() => stream.destroy(new AttachmentError('UPLOAD_TIMEOUT', 408)), 120_000);
        idleTimer.unref?.();
      }
    };
    try {
      authorize();
      if (display) {
        const original = await get(attachmentId);
        if (original.conversationId !== conversationId || original.messageId !== messageId) invalid();
      }
      await requireSpace(expectedSize ?? Math.min(limit, 32 * 1024 * 1024));
      handle = await open(temp, 'wx+', 0o600);
      const prefix = Buffer.alloc(4 + HEADER_BYTES, 0x20);
      prefix.writeUInt32BE(HEADER_BYTES, 0);
      await writeAll(handle, prefix, 0);
      const hash = createHash('sha256');
      let size = 0; let first = Buffer.alloc(0); let last = Buffer.alloc(0);
      let nextSpaceCheck = 32 * 1024 * 1024;
      resetIdle();
      for await (const chunk of stream ?? [bytes]) {
        resetIdle();
        size += chunk.length;
        if (size > limit) throw new AttachmentError('BODY_TOO_LARGE', 413);
        if (size >= nextSpaceCheck) {
          await requireSpace(expectedSize === undefined ? Math.min(limit - size, 32 * 1024 * 1024)
            : Math.max(0, expectedSize - size));
          nextSpaceCheck = size + 32 * 1024 * 1024;
        }
        hash.update(chunk);
        if (first.length < 16) first = Buffer.concat([first, chunk.subarray(0, 16 - first.length)]);
        last = chunk.length >= 16 ? chunk.subarray(-16) : Buffer.concat([last, chunk]).subarray(-16);
        await writeAll(handle, chunk, 4 + HEADER_BYTES + size - chunk.length);
      }
      if (size < 1 || (expectedSize !== undefined && size !== expectedSize) ||
          hash.digest('hex') !== sha256 || !matchesType(contentType, first, last, size)) invalid();
      const meta = display ? { attachmentId, contentType, size, sha256 }
        : canonicalAttachmentMetadata({ attachmentId, name, contentType, size, sha256 });
      const header = Buffer.from(JSON.stringify(display
        ? { display: meta, conversationId, messageId }
        : { ...meta, conversationId, messageId }), 'utf8');
      if (header.length > HEADER_BYTES) invalid();
      await writeAll(handle, header, 4);
      await handle.sync();
      await handle.close(); handle = undefined;
      await ensurePrivateFile(temp);
      return await serial(async () => {
        authorize();
        if (display) {
          const original = await get(attachmentId);
          if (original.conversationId !== conversationId || original.messageId !== messageId) invalid();
        }
        try {
          const prior = await get(attachmentId, display);
          if (prior.conversationId !== conversationId || prior.messageId !== messageId ||
              JSON.stringify(prior.meta) !== JSON.stringify(meta)) throw new AttachmentError('REQUEST_CONFLICT', 409);
          return display ? { display: meta, duplicate: true } : { attachment: meta, duplicate: true };
        } catch (error) { if (error?.code !== 'NOT_FOUND') throw error; }
        authorize();
        await rename(temp, file);
        await ensurePrivateFile(file);
        if (process.platform !== 'win32') {
          const dir = await open(root, 'r');
          try { await dir.sync(); } finally { await dir.close(); }
        }
        return display ? { display: meta, duplicate: false } : { attachment: meta, duplicate: false };
      });
    } finally {
      clearTimeout(idleTimer);
      await handle?.close().catch(() => {});
      await rm(temp, { force: true }).catch(() => {}); releaseWrite();
    }
  }
  return {
    put, get,
    async removeConversation(conversationId) {
      if (!validUuid(conversationId)) invalid();
      for (const name of await readdir(root)) {
        if (!name.endsWith('.image')) continue;
        const attachmentId = name.slice(0, -'.image'.length);
        const found = await get(attachmentId);
        if (found.conversationId === conversationId) {
          await rm(found.file, { force: true });
          await rm(fileFor(attachmentId, true), { force: true });
        }
      }
    },
    async referenced({ attachment, conversationId, messageId }) {
      try {
        const found = await get(attachment.attachmentId);
        return found.conversationId === conversationId && found.messageId === messageId &&
          JSON.stringify(found.meta) === JSON.stringify(attachment);
      } catch (error) {
        if (error?.code === 'NOT_FOUND') return false;
        throw error;
      }
    },
  };
}
