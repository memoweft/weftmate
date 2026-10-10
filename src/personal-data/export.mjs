import path from 'node:path';
import { mkdir, writeFile, rename, rm, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { included } from '../personal-backup/archive.mjs';
import { dataError } from './paths.mjs';

export const EXPORT_EXCLUDED = ['临时对话', '已遗忘的记忆与来源', '模型密钥与凭据保管库', '密码与登录会话', '云令牌与设备私钥', '浏览器登录与缓存', '其他账户', '旧备份'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');

/** A folder uses BK-1's versioned file/manifest hashes and atomic publication. */
export async function exportAccountFolder({ destination, entries, signal, progress = () => {}, validate = async () => {} }) {
  if (!path.isAbsolute(destination)) throw dataError('INVALID_REQUEST');
  const stage = path.join(path.dirname(destination), `.weftmate-export-${randomUUID()}.stage`);
  await mkdir(stage, { mode: 0o700 });
  const manifest = { format: 'weftmate-account-export', version: 1, createdAt: new Date().toISOString(), excluded: EXPORT_EXCLUDED, files: [] };
  try {
    for await (const entry of entries) {
      signal?.throwIfAborted(); await validate();
      const name = entry.name;
      if (!name || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || !included(name)) throw dataError('DATA_EXPORT_INVALID_PATH');
      const target = path.join(stage, name); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash('sha256'); let size = 0;
      const handle = await open(target, 'wx', 0o600);
      try {
        for await (const bytes of entry.chunks ?? [Buffer.from(typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2))]) {
          signal?.throwIfAborted(); await handle.writeFile(bytes); hash.update(bytes); size += bytes.length;
          progress({ category: entry.category, bytes: size, file: name });
        }
      } finally { await handle.close(); }
      manifest.files.push({ path: name, size, sha256: hash.digest('hex') });
    }
    signal?.throwIfAborted(); await validate({ publish: true });
    const text = JSON.stringify(manifest); await writeFile(path.join(stage, 'manifest.json'), text, { mode: 0o600 });
    await writeFile(path.join(stage, 'manifest.sha256'), sha256(text), { mode: 0o600 });
    signal?.throwIfAborted(); await rename(stage, destination);
    return { files: manifest.files.length, bytes: manifest.files.reduce((sum, row) => sum + row.size, 0), manifest };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
