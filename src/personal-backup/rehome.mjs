import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, writeFile, rm, open } from 'node:fs/promises';
import { zstdDecompressSync, zstdCompress } from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline, finished } from 'node:stream/promises';
const compress = promisify(zstdCompress);

async function headerOf(file, compressed) {
  const stream = createReadStream(file); let bytes = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      bytes = Buffer.concat([bytes, chunk]);
      if (compressed) {
        let decoded;
        try { decoded = zstdDecompressSync(bytes, { info: true }); }
        catch (error) { if (error.code === 'Z_BUF_ERROR') continue; throw error; }
        // DSH writes the header as its own Zstandard frame. Node decodes one
        // frame; bytesWritten is the compressed frame boundary. The remaining
        // frames must be copied verbatim rather than silently dropping them.
        return { header: JSON.parse(decoded.buffer.toString('utf8').trim()), offset: decoded.engine.bytesWritten };
      }
      const newline = bytes.indexOf(10);
      if (newline >= 0) return { header: JSON.parse(bytes.subarray(0, newline).toString('utf8')), offset: newline + 1 };
    }
    throw new Error('invalid DSH session header');
  } finally { stream.destroy(); await finished(stream).catch(() => {}); }
}

/** Relocate the native header and directory while preserving every event-frame byte. */
export async function rehomeSessions(stage, root, manifest, locate = null) {
  if (!manifest.sourceRoot || path.resolve(manifest.sourceRoot).toLowerCase() === path.resolve(root).toLowerCase()) return;
  const rows = manifest.files.filter(row => row.path.startsWith('dsh-home/sessions/') && /\.jsonl(?:\.zstd)?$/.test(row.path));
  if (!rows.length) return;
  if (!locate) {
    // Use the installed pinned DSH backend's public locator, not a second path encoder.
    const { JsonlSessionPersistence } = await import(pathToFileURL(path.join(root, 'dsh-home/profiles/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href);
    locate = (header, compressed) => JsonlSessionPersistence.prototype.locate.call({ root: path.join(stage, 'dsh-home/sessions'), compression: compressed ? 'zstd' : 'none' }, header).path;
  }
  for (const row of rows) {
    const source = path.join(stage, row.path), compressed = row.path.endsWith('.zstd');
    const { header, offset } = await headerOf(source, compressed);
    const oldRoot = path.posix.normalize(manifest.sourceRoot.replaceAll('\\', '/')).replace(/\/$/, ''), cwd = header.cwd;
    const portableCwd = typeof cwd === 'string' ? path.posix.normalize(cwd.replaceAll('\\', '/')) : null;
    if (header.type !== 'session' || !portableCwd?.toLowerCase().startsWith(oldRoot.toLowerCase() + '/')) continue;
    header.cwd = path.join(root, ...portableCwd.slice(oldRoot.length + 1).split('/'));
    const target = locate(header, compressed), temporary = `${source}.rehome.tmp`, head = Buffer.from(JSON.stringify(header) + '\n');
    try {
      await writeFile(temporary, compressed ? await compress(head) : head, { mode: 0o600 });
      await pipeline(createReadStream(source, { start: offset }), createWriteStream(temporary, { flags: 'a' }));
      const file = await open(temporary, 'r+'); try { await file.sync(); } finally { await file.close(); }
      await rename(temporary, source);
      if (path.dirname(target) !== path.dirname(source)) { await mkdir(path.dirname(path.dirname(target)), { recursive: true }); await rename(path.dirname(source), path.dirname(target)); }
    } finally { await rm(temporary, { force: true }); }
  }
}
