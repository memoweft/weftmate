import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, writeFile, rm, open } from 'node:fs/promises';
import { zstdCompress } from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { readNativeHeader } from './native-header.mjs';
const compress = promisify(zstdCompress);

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
    const { header, offset } = await readNativeHeader(source);
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
