import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import { relative, resolve, isAbsolute } from 'node:path';

/** Use the native surface replacement protocol: retained originals remain in
 * human history, but cannot enter future requests or native compaction. */
export function shadowForgottenSurface(session, sourceTexts, createMessage) {
  const events = session.events, bySeq = new Map(events.map(event => [event.seq, event]));
  const matches = value => typeof value === 'string' ? sourceTexts.some(text => text && value.includes(text))
    : Array.isArray(value) ? value.some(matches) : value && typeof value === 'object' && Object.values(value).some(matches);
  const affectedTurns = new Set(); const turns = new Map(); let turn = null;
  for (const event of events) {
    if (event.type === 'turn/start') turn = event.data.turn;
    turns.set(event.seq, turn);
    if (matches(event.data)) affectedTurns.add(turn);
    if (event.type === 'turn/end') turn = null;
  }
  // Preserve complete tool exchanges by replacing contiguous affected surface
  // spans. The native surface order, not numeric seq ranges, is authoritative.
  const nodes = [...session.surface.nodes]; const groups = []; let group = [];
  for (const seq of nodes) {
    const event = bySeq.get(seq), plugin = event?.data?.source?.plugin;
    const affected = affectedTurns.has(turns.get(seq)) || matches(event?.data) ||
      plugin === 'weftmate-personal-memory' || plugin === 'weftmate-chat-handoff' ||
      event?.surfaceOp?.op === 'replace' && plugin !== 'weftmate-memory-erasure';
    if (affected) group.push(seq);
    else if (group.length) { groups.push(group); group = []; }
  }
  if (group.length) groups.push(group);
  for (const seqs of groups) {
    const start = seqs[0], end = seqs.at(-1);
    session.append('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: seqs, shadowedTokenCount: 0 });
    session.append('user/message', createMessage({ source: { kind: 'plugin', plugin: 'weftmate-memory-erasure' },
      content: [{ type: 'text', text: '[已遗忘的上下文]' }] }),
    { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: seqs });
  }
  return groups.flat();
}

/** Erase native injected context; original source text is an explicit opt-in. */
export async function eraseSessionMemoryArtifact(persistence, sessionId, options = {}) {
  const artifact = await persistence.readRaw(sessionId)
  if (!artifact) throw Object.assign(new Error('source unavailable'), { code: 'internal' })
  let changed = false
  const lines = artifact.content.split('\n').map(line => line ? JSON.parse(line) : null);
  const turns = new Map(), affected = new Set(); let turn = null;
  for (const row of lines) {
    if (!row) continue;
    if (row.type === 'turn/start') turn = row.data.turn;
    turns.set(row, turn);
    if (turn !== null && options.sourceTexts?.some(text => text && JSON.stringify(row).includes(text))) affected.add(turn);
    if (row.type === 'turn/end') turn = null;
  }
  const clean = (value, redact = false, key = '') => {
    if (typeof value === 'string') {
      if (!options.deleteConversationSnippets) return value
      if (redact && ['text','content','delta','arguments','output','summary','rawOutput'].includes(key)) { changed = true; return ''; }
      for (const text of options.sourceTexts) if (value.includes(text)) { value = value.replaceAll(text, '[已遗忘的原话]'); changed = true }
      return value
    }
    if (Array.isArray(value)) return value.map(child => clean(child, redact, key))
    if (!value || typeof value !== 'object') return value
    if (value.type === 'todo/write' && value.data?.todos?.length) {
      changed = true;
      return { ...value, data: { ...value.data, todos: [] } };
    }
    if (Array.isArray(value.memoryUsed) && value.memoryUsed.length) {
      value = { ...value, memoryUsed: [] }; changed = true
    }
    if (value.type === 'compaction/summary') {
      changed = true;
      return { ...value, data: { ...value.data, summary: [], ...(value.data?.rawOutput ? { rawOutput: [] } : {}) } };
    }
    if (value.surfaceOp?.op === 'replace' && value.data?.source?.plugin !== 'weftmate-memory-erasure') {
      changed = true;
      return { ...value, data: { ...value.data, content: [], source: { kind: 'plugin', plugin: 'weftmate-memory-erasure' } } };
    }
    if (value.source?.kind === 'plugin' && ['weftmate-personal-memory', 'weftmate-chat-handoff'].includes(value.source.plugin)) {
      changed = true
      return { ...value, content: [], source: { ...value.source, sections: [] } }
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child, redact, key)]))
  }
  const content = lines.map(row => row ? JSON.stringify(clean(row, affected.has(turns.get(row)))) : '').join('\n')
  if (changed) {
    const location = persistence.locate(artifact.meta)
    const inside = relative(resolve(persistence.config.root), resolve(location.path))
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('memory source outside session root')
    const tmp = `${location.path}.${randomUUID()}.tmp`
    let file
    try {
      file = await open(tmp, 'wx', 0o600)
      // Native compressed logs dedicate the first frame to the header. Cold
      // listing decodes that frame alone; event frames must remain separate.
      const firstNewline = content.indexOf('\n')
      const bytes = location.path.endsWith('.zstd') ? Buffer.concat([
        zstdCompressSync(Buffer.from(content.slice(0, firstNewline + 1))),
        ...(content.length > firstNewline + 1 ? [zstdCompressSync(Buffer.from(content.slice(firstNewline + 1)))] : []),
      ]) : content
      await file.writeFile(bytes)
      await file.sync(); await file.close(); file = null
      await rename(tmp, location.path)
    } finally { await file?.close(); await rm(tmp, { force: true }) }
  }
}
