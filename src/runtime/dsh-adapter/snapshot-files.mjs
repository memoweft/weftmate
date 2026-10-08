import path from 'node:path';
import { readdirSync, lstatSync, mkdirSync, openSync, readSync, writeSync, closeSync } from 'node:fs';

// Synchronous bounded capture: the writer's own event loop cannot append or
// rename midway through a captured log. Ordinary mutable files are copied.
export function copySnapshotTree(root, targetRoot, { check, included = () => true, database = () => {}, relative = '' }) {
  check();
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    check();
    const rel = relative ? `${relative}/${name}` : name;
    if (!included(rel)) continue;
    const source = path.join(root, rel), target = path.join(targetRoot, rel), info = lstatSync(source);
    if (info.isSymbolicLink()) throw Object.assign(new Error('BACKUP_SYMLINK'), { code: 'BACKUP_SYMLINK' });
    if (info.isDirectory()) { copySnapshotTree(root, targetRoot, { check, included, database, relative: rel }); continue; }
    if (!info.isFile()) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    if (/\.(?:sqlite3?|db)$/.test(rel)) { database(source, target); continue; }
    const input = openSync(source, 'r'), output = openSync(target, 'wx', 0o600);
    try {
      const bytes = Buffer.allocUnsafe(256 * 1024);
      let size;
      while ((size = readSync(input, bytes)) > 0) {
        check();
        let offset = 0;
        while (offset < size) offset += writeSync(output, bytes, offset, size - offset);
      }
    } finally { closeSync(input); closeSync(output); }
  }
}
