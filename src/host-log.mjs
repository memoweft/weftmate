import { mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// Structured metadata only. Unknown fields and all raw messages/errors are discarded.
const fields = new Set(['mode', 'version', 'pid', 'headless', 'memoryEnabled', 'localModelConfigured',
  'profileId', 'sessionId', 'priority', 'phase', 'ahead', 'durationMs', 'status', 'code', 'source', 'configured']);
export function createHostLog(root, { now = () => new Date(), maxBytes = 2 * 1024 * 1024, retentionDays = 7 } = {}) {
  const directory = join(root, 'logs'); mkdirSync(directory, { recursive: true });
  function write(event, data = {}) {
    try {
      const date = now(), day = date.toISOString().slice(0, 10);
      const files = readdirSync(directory).filter(name => /^host-\d{4}-\d\d-\d\d(?:-\d+)?\.jsonl$/.test(name));
      const cutoff = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - (retentionDays - 1) * 86400000).toISOString().slice(0, 10);
      for (const name of files) if (name.slice(5, 15) < cutoff) unlinkSync(join(directory, name));
      const metadata = Object.fromEntries(Object.entries(data).filter(([key, value]) => fields.has(key) &&
        (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ||
          typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value))));
      const row = JSON.stringify({ at: date.toISOString(), event: /^[a-z][a-z0-9._-]{0,80}$/.test(event) ? event : 'host.event', ...metadata }) + '\n';
      let index = 0, file;
      do { file = join(directory, `host-${day}${index ? `-${index}` : ''}.jsonl`); index++; }
      while ((() => { try { return statSync(file).size + Buffer.byteLength(row) > maxBytes; } catch { return false; } })());
      appendFileSync(file, row, { mode: 0o600 });
    } catch { /* A full/unavailable disk must not crash the host. */ }
  }
  return { directory, write };
}
