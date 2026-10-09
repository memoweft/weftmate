import { rename, writeFile } from 'node:fs/promises';

/** Serialize asynchronous snapshots and keep only the latest waiting value. */
export function createLatestFileWriter(file) {
  let pending, running, written;
  async function drain() {
    while (pending !== undefined) {
      const text = pending;
      pending = undefined;
      if (text === written) continue;
      await writeFile(`${file}.tmp`, text, { encoding: 'utf8', mode: 0o600 });
      await rename(`${file}.tmp`, file);
      written = text;
    }
  }
  return text => {
    pending = text;
    if (!running) running = drain().finally(() => { running = undefined; });
    return running;
  };
}
