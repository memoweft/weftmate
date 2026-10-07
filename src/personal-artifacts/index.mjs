import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';

export const MAX_ARTIFACT_BYTES = 128 * 1024;
const FILE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*\.[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Content is always verified UTF-8 text; the suffix never implies a binary format. */
export function artifactContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  const type = extension === '.csv' ? 'text/csv'
    : extension === '.tsv' ? 'text/tab-separated-values' : 'text/plain';
  return `${type}; charset=utf-8`;
}

export function validArtifactFileName(fileName) {
  if (typeof fileName !== 'string' || !FILE_NAME.test(fileName) ||
      fileName.normalize('NFC') !== fileName || Buffer.byteLength(fileName, 'utf8') > 160 ||
      fileName.includes('..') || fileName !== fileName.trim() ||
      /[\p{Cc}\p{Cf}]/u.test(fileName)) return false;
  const stem = fileName.slice(0, fileName.lastIndexOf('.'));
  return !/[ .]$/.test(stem) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem);
}

export function canonicalArtifact(fileName, content) {
  if (!validArtifactFileName(fileName) ||
      typeof content !== 'string' || content.includes('\0')) {
    throw Object.assign(new Error('INVALID_COMMAND'), { code: 'INVALID_COMMAND' });
  }
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length < 1 || bytes.length > MAX_ARTIFACT_BYTES || bytes.toString('utf8') !== content) {
    throw Object.assign(new Error('INVALID_COMMAND'), { code: 'INVALID_COMMAND' });
  }
  return { fileName, contentType: artifactContentType(fileName), bytes, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function createPersonalArtifactStore(root) {
  const fileFor = (ownerId, taskId, artifactId) => {
    if (![ownerId, taskId, artifactId].every((value) => typeof value === 'string' && ID.test(value))) {
      throw Object.assign(new Error('INVALID_COMMAND'), { code: 'INVALID_COMMAND' });
    }
    return path.join(root, ownerId, taskId, `${artifactId}.artifact`);
  };
  const inspect = async (ownerId, taskId, artifactId, expected) => {
    const file = fileFor(ownerId, taskId, artifactId);
    await lstat(file);
    await ensurePrivateFile(file);
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== expected.size || stat.size > MAX_ARTIFACT_BYTES) {
        throw Object.assign(new Error('ARTIFACT_UNVERIFIED'), { code: 'ARTIFACT_UNVERIFIED' });
      }
      const bytes = await handle.readFile();
      if (bytes.length !== expected.size ||
          createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
        throw Object.assign(new Error('ARTIFACT_UNVERIFIED'), { code: 'ARTIFACT_UNVERIFIED' });
      }
      return bytes;
    } finally { await handle.close(); }
  };
  return {
    inspect,
    async write(ownerId, taskId, artifactId, artifact) {
      const file = fileFor(ownerId, taskId, artifactId);
      await ensurePrivateDirectory(root);
      await ensurePrivateDirectory(path.dirname(path.dirname(file)));
      await ensurePrivateDirectory(path.dirname(file));
      const tmp = `${file}.${randomUUID()}.tmp`;
      let handle;
      try {
        // This path belongs to a durable, unique command. Never replace a prior result.
        try { await ensurePrivateFile(file); throw Object.assign(new Error('ARTIFACT_EXISTS'), { code: 'ARTIFACT_EXISTS' }); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
        handle = await open(tmp, 'wx', 0o600);
        await handle.writeFile(artifact.bytes);
        await handle.sync();
        await handle.close(); handle = undefined;
        await ensurePrivateFile(tmp);
        await ensurePrivateDirectory(path.dirname(file));
        await rename(tmp, file);
        await ensurePrivateFile(file);
        await inspect(ownerId, taskId, artifactId, artifact);
      } finally {
        await handle?.close().catch(() => {});
        await rm(tmp, { force: true }).catch(() => {});
      }
    },
  };
}
