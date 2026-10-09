import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import { relative, resolve, isAbsolute } from 'node:path';

/** Erase native injected context; original source text is an explicit opt-in. */
export async function eraseSessionMemoryArtifact(persistence, sessionId, options = {}) {
  const artifact = await persistence.readRaw(sessionId)
  if (!artifact) throw Object.assign(new Error('source unavailable'), { code: 'internal' })
  let changed = false
  const clean = value => {
    if (typeof value === 'string') {
      if (!options.deleteConversationSnippets) return value
      for (const text of options.sourceTexts) if (value.includes(text)) { value = value.replaceAll(text, '[已遗忘的原话]'); changed = true }
      return value
    }
    if (Array.isArray(value)) return value.map(clean)
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value.memoryUsed) && value.memoryUsed.length) {
      value = { ...value, memoryUsed: [] }; changed = true
    }
    if (value.source?.kind === 'plugin' && value.source.plugin === 'weftmate-personal-memory') {
      changed = true
      return { ...value, content: [], source: { ...value.source, sections: [] } }
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child)]))
  }
  const content = artifact.content.split('\n').map(line => line ? JSON.stringify(clean(JSON.parse(line))) : '').join('\n')
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
