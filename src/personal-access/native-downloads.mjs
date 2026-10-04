import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const BUILD = /^\d+(?:\.\d+){0,2}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.dmg$/i;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_DMG_BYTES = 1024 * 1024 * 1024;

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validRelease(value) {
  return exact(value, ['version', 'build', 'bytes', 'sha256', 'architecture', 'channel',
    'notes', 'fileName']) &&
    typeof value.version === 'string' && VERSION.test(value.version) &&
    typeof value.build === 'string' && BUILD.test(value.build) &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_DMG_BYTES &&
    typeof value.sha256 === 'string' && SHA256.test(value.sha256) &&
    ['universal', 'arm64', 'x86_64'].includes(value.architecture) &&
    value.channel === 'trial' && typeof value.notes === 'string' &&
    value.notes.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.notes) &&
    typeof value.fileName === 'string' && FILE_NAME.test(value.fileName) &&
    value.fileName.endsWith(`${value.sha256}.dmg`) &&
    !value.fileName.includes('..') &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value.fileName);
}

async function regularFile(file, maxBytes) {
  const entry = await lstat(file).catch(() => null);
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > maxBytes) return null;
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return null;
  let keep = false;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino ||
        opened.size !== entry.size) return null;
    keep = true;
    return handle;
  } finally { if (!keep) await handle.close(); }
}

/** Read one operator-published macOS DMG. No directory is created at startup. */
export function createNativeDownloadPublisher(root) {
  const directory = path.join(root, 'native-downloads');

  async function published() {
    const dir = await lstat(directory).catch(() => null);
    if (!dir?.isDirectory() || dir.isSymbolicLink()) return null;
    const handle = await regularFile(path.join(directory, 'manifest.json'), MAX_MANIFEST_BYTES);
    if (!handle) return null;
    try {
      const manifest = JSON.parse(await handle.readFile('utf8'));
      return exact(manifest, ['schemaVersion', 'macos']) && manifest.schemaVersion === 1 &&
        validRelease(manifest.macos) ? manifest.macos : null;
    } catch { return null; }
    finally { await handle.close(); }
  }

  async function openVerified(expectedSha256 = null) {
    const release = await published();
    if (!release || expectedSha256 !== null && release.sha256 !== expectedSha256) return null;
    const handle = await regularFile(path.join(directory, release.fileName), MAX_DMG_BYTES);
    if (!handle) return null;
    let keep = false;
    try {
      const before = await handle.stat();
      if (before.size !== release.bytes) return null;
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
          hash.digest('hex') !== release.sha256) return null;
      keep = true;
      return { handle, release: { ...release,
        downloadUrl: `/personal/v1/downloads/native/macos/${release.sha256}` } };
    } catch { return null; }
    finally { if (!keep) await handle.close(); }
  }

  return {
    async manifest() {
      const opened = await openVerified();
      if (!opened) return { schemaVersion: 1, macos: null };
      try { return { schemaVersion: 1, macos: opened.release }; }
      finally { await opened.handle.close(); }
    },
    openMacos: openVerified,
  };
}
