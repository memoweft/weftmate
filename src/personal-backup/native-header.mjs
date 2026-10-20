import { createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { zstdDecompressSync } from 'node:zlib';

// DSH stores its JSONL header in a separate Zstandard frame. Locate that
// frame structurally: Node 24.22+ decodes concatenated frames in one call, so
// a decoder's bytesWritten no longer identifies the header boundary.
// Format: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
// DSH's equivalent scanner is internal, not part of its persistence API.
function firstFrameEnd(bytes) {
  if (bytes.length < 5) return null;
  if (bytes.readUInt32LE(0) !== 0xfd2fb528) throw new Error('invalid DSH Zstandard frame magic');
  const descriptor = bytes[4];
  if (descriptor & 0x18) throw new Error('invalid DSH Zstandard frame descriptor');
  const singleSegment = Boolean(descriptor & 0x20), sizeFlag = descriptor >>> 6, dictionaryFlag = descriptor & 3;
  const contentSizeBytes = sizeFlag ? 1 << sizeFlag : singleSegment ? 1 : 0;
  let offset = 5 + (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + contentSizeBytes;
  if (bytes.length < offset) return null;
  for (;;) {
    if (bytes.length < offset + 3) return null;
    const block = bytes.readUIntLE(offset, 3), type = (block >>> 1) & 3;
    if (type === 3) throw new Error('invalid DSH Zstandard block type');
    offset += 3 + (type === 1 ? 1 : block >>> 3);
    if (bytes.length < offset) return null;
    if (block & 1) break;
  }
  if (descriptor & 4) offset += 4;
  return bytes.length < offset ? null : offset;
}

/** Read only the native header, returning the exact byte offset of its tail. */
export async function readNativeHeader(file, { maxBytes = Infinity } = {}) {
  const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
  let bytes = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > maxBytes) throw Object.assign(new Error('BACKUP_CORRUPT'), { code: 'BACKUP_CORRUPT', status: 409 });
      if (file.endsWith('.zstd')) {
        const offset = firstFrameEnd(bytes);
        if (offset === null) continue;
        // Node still validates compression and checksums. Never decode the
        // event tail here: metadata readers must not consume or rewrite it.
        const options = Number.isFinite(maxBytes) ? { maxOutputLength: maxBytes } : undefined;
        const decoded = zstdDecompressSync(bytes.subarray(0, offset), options);
        return { header: JSON.parse(decoded.toString('utf8').trim()), offset };
      }
      const newline = bytes.indexOf(10);
      if (newline >= 0) return { header: JSON.parse(bytes.subarray(0, newline).toString('utf8')), offset: newline + 1 };
    }
    throw Object.assign(new Error('invalid DSH session header'), { code: 'BACKUP_CORRUPT', status: 409 });
  } finally { stream.destroy(); await finished(stream).catch(() => {}); }
}
