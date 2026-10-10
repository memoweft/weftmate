import { parentPort, workerData } from 'node:worker_threads';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

// Disk traversal runs outside the host event loop; cancellation terminates it.
try {
  const categories = Object.fromEntries(workerData.categories.map(id => [id, { bytes: 0, files: 0 }]));
  for (const source of workerData.sources) {
    if (source.bytes !== undefined) { categories[source.category].bytes += source.bytes; continue; }
    const pending = [source.path], root = path.resolve(source.path);
    while (pending.length) {
      const file = pending.pop(); let info;
      try { info = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const relative = path.relative(root, realpathSync(file));
      if (info.isSymbolicLink() || relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('unsafe account path'), { code: 'DATA_PATH_OUTSIDE_ACCOUNT' });
      if (info.isDirectory()) for (const name of readdirSync(file)) pending.push(path.join(file, name));
      else if (info.isFile()) { const category = file.endsWith('.display') ? 'cache' : file.endsWith('.tmp') ? 'temporary' : source.category; categories[category].bytes += info.size; categories[category].files++; }
    }
  }
  parentPort.postMessage({ categories });
} catch (error) { parentPort.postMessage({ error: { code: error.code || 'STORAGE_UNAVAILABLE' } }); }
