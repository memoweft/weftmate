/** Compatibility bridge over 0.1.0-rc.5 (`inspect`/`readFrom`/`readRaw`/`prepare`) and 0.2.2-rc.3 (`open`/`stat`/`list`) sessionPersistence APIs. */
import { readFile } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 0xfd2fb528;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    if (offset >= buffer.length) break;
    const descriptor = buffer.readUInt8(offset++);
    if ((descriptor & 24) !== 0) break;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictFlag = descriptor & 3;
    const dictBytes = dictFlag === 3 ? 4 : dictFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerExtra = (singleSegment ? 0 : 1) + dictBytes + contentSizeBytes;
    if (buffer.length - offset < headerExtra) break;
    offset += headerExtra;
    let valid = true;
    for (;;) {
      if (buffer.length - offset < 3) { valid = false; break; }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) { valid = false; break; }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) { valid = false; break; }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (!valid) break;
    if (checksum) {
      if (buffer.length - offset < 4) break;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

function mapNotFound(error, sessionId) {
  if (error?.name === 'SessionPersistenceNotFoundError' && !error.code) error.code = 'session-not-found';
  return error ?? Object.assign(new Error(`session "${sessionId}" not found`), { code: 'session-not-found' });
}

export async function inspectSessionMeta(persistence, sessionId, signal) {
  if (typeof persistence.inspect === 'function') return persistence.inspect(sessionId, signal);
  if (typeof persistence.stat === 'function') {
    const st = await persistence.stat(sessionId, signal ? { signal } : undefined);
    if (!st) throw mapNotFound(null, sessionId);
    return { meta: st.header };
  }
  return inspectSessionLog(persistence, sessionId, signal);
}

function parseRawSessionEvents(raw, startSeq = 0) {
  const events = [];
  for (const line of raw.content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || entry.type === 'session') continue;
    if (Number.isSafeInteger(entry.seq) && entry.seq >= startSeq) events.push(entry);
  }
  return { meta: raw.meta, events };
}

export async function inspectSessionLog(persistence, sessionId, signal) {
  if (typeof persistence.inspect === 'function') return persistence.inspect(sessionId, signal);
  let handle;
  try {
    handle = await persistence.open(sessionId, 'read', signal ? { signal } : undefined);
    const read = await handle.read(0, undefined, signal ? { signal } : undefined);
    return { meta: handle.header, events: read.events };
  } catch (error) {
    if (error?.name === 'SessionPersistenceCorruptionError') {
      const raw = await readSessionRaw(persistence, sessionId).catch(() => null);
      if (raw) return parseRawSessionEvents(raw, 0);
    }
    throw mapNotFound(error, sessionId);
  } finally {
    await handle?.close();
  }
}

export async function readSessionFrom(persistence, sessionId, startSeq, signal) {
  if (typeof persistence.readFrom === 'function') return persistence.readFrom(sessionId, startSeq, signal);
  let handle;
  try {
    handle = await persistence.open(sessionId, 'read', signal ? { signal } : undefined);
    const read = await handle.read(startSeq, undefined, signal ? { signal } : undefined);
    return { meta: handle.header, events: read.events };
  } catch (error) {
    if (error?.name === 'SessionPersistenceCorruptionError') {
      const raw = await readSessionRaw(persistence, sessionId).catch(() => null);
      if (raw) return parseRawSessionEvents(raw, startSeq);
    }
    throw mapNotFound(error, sessionId);
  } finally {
    await handle?.close();
  }
}

export async function readSessionRaw(persistence, sessionId) {
  if (typeof persistence.readRaw === 'function') return persistence.readRaw(sessionId);
  const st = typeof persistence.stat === 'function' ? await persistence.stat(sessionId) : null;
  if (!st) return null;
  const file = st.location?.path ?? persistence.locate?.(st.header)?.path;
  if (!file) return null;
  let bytes;
  try { bytes = await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const content = file.endsWith('.zstd')
    ? Buffer.concat(scanZstdFrames(bytes).map(({ start, end }) => zstdDecompressSync(bytes.subarray(start, end)))).toString('utf8')
    : bytes.toString('utf8');
  return { meta: st.header, content };
}
