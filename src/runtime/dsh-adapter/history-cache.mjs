import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Rebuildable public-history projection, never a native log decoder. Native
 * persistence owns decoding/recovery; this cache supports bounded SQL ranges. */
export function createHistoryCache({ file, source, readNative }) {
  let db, queue = Promise.resolve(), closed = false;
  const epochs = new Map();
  const serial = fn => { const work = queue.then(fn); queue = work.catch(() => {}); return work; };
  async function database() {
    if (db) return db;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    db = new DatabaseSync(file);
    await chmod(file, 0o600);
    db.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS segments (id TEXT PRIMARY KEY, revision TEXT NOT NULL, stable INTEGER NOT NULL, tail INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS events (session TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session,seq)) WITHOUT ROWID;');
    return db;
  }
  function page(db, id, meta, { afterSeq, beforeSeq, limit = 50, includeThinking = false }) {
    const forward = afterSeq !== undefined;
    const rows = forward ? db.prepare('SELECT body FROM events WHERE session=? AND seq>? ORDER BY seq LIMIT ?').all(id, afterSeq, limit + 1)
      : db.prepare('SELECT body FROM events WHERE session=? AND seq<? ORDER BY seq DESC LIMIT ?').all(id, beforeSeq ?? Number.MAX_SAFE_INTEGER, limit + 1);
    let bytes = 0; const events = [];
    for (const row of rows) {
      if (events.length === limit || bytes + Buffer.byteLength(row.body) > 900000) break;
      bytes += Buffer.byteLength(row.body); const event = JSON.parse(row.body); if (!includeThinking && event.data?.modelThinking) { const {modelThinking, ...data} = event.data; event.data = data; } events.push(event);
    }
    const more = rows.length > events.length;
    if (!forward) events.reverse();
    return { events, nextSeq: forward ? more ? events.at(-1)?.seq ?? afterSeq : Math.max(afterSeq, meta.stable) : meta.stable,
      nextBeforeSeq: events[0]?.seq ?? null, hasMore: forward && more, hasOlder: !forward && more, latestSeq: meta.tail };
  }
  return {
    read(id, options, project) {
      const epoch = epochs.get(id) ?? 0;
      return serial(async () => {
        if (closed) throw new Error('history cache closed');
        const native = await source(id), before = native ? {...native,revision:native.revision + ':thinking-v1'} : null, sql = await database();
        let meta = sql.prepare('SELECT * FROM segments WHERE id=?').get(id);
        if (!before) { sql.prepare('DELETE FROM events WHERE session=?').run(id); sql.prepare('DELETE FROM segments WHERE id=?').run(id); return null; }
        if (meta?.revision !== before.revision) {
          const entries = before.events ?? await readNative(id);
          const incremental = Boolean(before.events && meta && meta.tail < entries.length && meta.stable <= meta.tail);
          let after = incremental ? meta.stable : -1, stable = after, tail = entries.at(-1)?.seq ?? -1;
          // Projection is synchronous over immutable native objects; insertion
          // and the revision publish are one transaction, without async gaps.
          sql.exec('BEGIN');
          try {
            if (!incremental) sql.prepare('DELETE FROM events WHERE session=?').run(id);
            const insert = sql.prepare('INSERT OR REPLACE INTO events(session,seq,body) VALUES (?,?,?)');
            while (true) {
              const projected = project(entries, { afterSeq: after, limit: 200, includeThinking: true });
              for (const event of projected.events) insert.run(id, event.seq, JSON.stringify(event));
              stable = projected.nextSeq; tail = projected.latestSeq;
              if (!projected.hasMore) break;
              if (stable <= after) throw new Error('history projection did not advance');
              after = stable;
            }
            if ((epochs.get(id) ?? 0) !== epoch) throw new Error('history cache invalidated');
            sql.prepare('INSERT OR REPLACE INTO segments(id,revision,stable,tail) VALUES (?,?,?,?)').run(id, before.revision, stable, tail);
            sql.exec('COMMIT');
          } catch (error) { sql.exec('ROLLBACK'); throw error; }
          meta = { stable, tail };
        }
        if ((epochs.get(id) ?? 0) !== epoch) throw new Error('history cache invalidated');
        return page(sql, id, meta, options);
      });
    },
    invalidate(id) {
      epochs.set(id, (epochs.get(id) ?? 0) + 1);
      return serial(async () => {
        if (closed) return;
        const sql = await database();
        sql.exec('BEGIN');
        try { sql.prepare('DELETE FROM events WHERE session=?').run(id); sql.prepare('DELETE FROM segments WHERE id=?').run(id); sql.exec('COMMIT'); }
        catch (error) { sql.exec('ROLLBACK'); throw error; }
        // Erasure also removes freed pages and transient journal payloads.
        sql.exec('VACUUM');
      });
    },
    async close() { await queue; closed = true; db?.close(); db = null; },
  };
}
