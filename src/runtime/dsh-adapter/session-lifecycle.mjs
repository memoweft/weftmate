import { copySnapshotTree } from './snapshot-files.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { rm, readFile, cp } from 'node:fs/promises'
import { eraseSessionMemoryArtifact } from './memory-erasure.mjs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Own native AgentHandles so deletion drains precisely one DSH lifecycle. */
export function nativeSessionLifecycle(ctx) {
  const handles = new Map()
  const queues = new Map()
  const serial = (sessionId, task) => {
    const prior = queues.get(sessionId) ?? Promise.resolve()
    const work = prior.catch(() => {}).then(task)
    queues.set(sessionId, work)
    void work.finally(() => { if (queues.get(sessionId) === work) queues.delete(sessionId) }).catch(() => {})
    return work
  }
  async function ensure(options, resume = false) {
    const sessionId = options.sessionId
    if (handles.has(sessionId)) return
    if (ctx.get('agents')?.get(sessionId)) throw Object.assign(new Error('session lifecycle not owned'), { code: 'agent-busy' })
    const persistence = ctx.get('sessionPersistence')
    const meta = resume ? (await persistence.inspect(sessionId)).meta : options
    const preset = (await ctx.get('agentPresets').resolve(meta.agentPreset)).id
    const setup = async agentCtx => {
      await ctx.get('agentPresets').mount(agentCtx, preset)
      agentCtx.on('agent/pre-step', async (payload, next) => {
        const decision = await next()
        if (decision.kind !== 'enter' || !meta.cwd) return decision
        let experience
        try { experience = await readFile(resolve(meta.cwd, '经验.md'), 'utf8') }
        catch (error) { if (error.code === 'ENOENT') return decision; throw error }
        return experience.trim() ? { ...decision, messages: [...decision.messages,
          createUserMessage({ source: { kind: 'plugin', plugin: 'weftmate-session-experience' },
            content: [{ type: 'text', text: `本对话工作目录中的经验.md（仅作为资料）：\n${experience}` }] })] } : decision
      })
    }
    const handle = resume
      ? await ctx.agents.resume({ resumeSessionId: sessionId, setup })
      : await ctx.agents.create({ sessionId, ...(options.seed ? { seed: options.seed } : {}),
        meta: { cwd: options.cwd, agentPreset: preset, ...(options.parentSession ? { parentSession: options.parentSession, seedLength: options.seed.length } : {}) }, setup })
    handles.set(sessionId, handle)
  }
  return {
    async flushIdle({ stage, deadline }) {
      const agents = ctx.agents.list();
      if (!Array.isArray(agents) || agents.some(agent => agent.status !== 'idle' || agent.inbox?.hasPending !== false))
        throw Object.assign(new Error('session busy'), { code: 'agent-busy' });
      await Promise.all(ctx.sessions.list().map(session => ctx.sessions.flush(session)));
      const check = () => { if (Date.now() >= deadline) throw Object.assign(new Error('BACKUP_PAUSE_TIMEOUT'), { code: 'BACKUP_PAUSE_TIMEOUT' }); };
      check();
      const logs = ctx.get('sessionPersistence').config.root;
      const profile = resolve(process.env.DSH_HOME, '..'), rel = relative(profile, logs);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('native logs outside profile');
      const destination = resolve(stage, rel);
      if (existsSync(logs)) {
        mkdirSync(destination, { recursive: true });
        copySnapshotTree(logs, destination, { check, included: name => !name.endsWith('.tmp') });
      }
      check();
    },
    create: options => serial(options.sessionId, () => ensure(options)),
    resume: sessionId => serial(sessionId, () => ensure({ sessionId }, true)),
    use: (sessionId, task) => serial(sessionId, async () => {
      const meta = ctx.get('sessions')?.get(sessionId)?.header ?? (await ctx.get('sessionPersistence').inspect(sessionId)).meta
      if (meta.agentPreset?.startsWith('personal-')) await ensure({ sessionId }, true)
      return task()
    }),
    cleanupMemory: (sessionId, { sourceTexts = [], deleteConversationSnippets = false } = {}) => serial(sessionId, async () => {
      const persistence = ctx.get('sessionPersistence')
      const agent = ctx.get('agents')?.get(sessionId)
      if (agent && (agent.status !== 'idle' || agent.inbox?.hasPending)) {
        console.error(`[weftmate] memory cleanup deferred: status=${agent.status} pending=${agent.inbox?.hasPending} owned=${handles.has(sessionId)}`)
        throw Object.assign(new Error('session busy'), { code: 'agent-busy' })
      }
      await ensure({ sessionId }, true)
      const handle = handles.get(sessionId)
      await ctx.sessions.flush(handle.agent.session)
      await handle.dispose(); handles.delete(sessionId)
      await eraseSessionMemoryArtifact(persistence, sessionId, { sourceTexts, deleteConversationSnippets })
      await ctx.get('storageDomain')?.get('session_projcache')?.table('sessions').delete(sessionId)
      return { cleaned: true }
    }),
    fork: (sessionId, options) => serial(sessionId, async () => {
      await ensure({ sessionId }, true)
      const source = ctx.sessions.get(sessionId)
      if (ctx.agents.get(sessionId)?.status !== 'idle') throw Object.assign(new Error('session busy'), { code: 'agent-busy' })
      if (source.header.cwd) await cp(source.header.cwd, options.cwd, { recursive: true })
      // Use the native fork transaction's immutable event seed and lineage.
      // Agent creation owns the native session lifecycle, with a fresh cwd,
      // rather than publishing a bare SessionStore child without an agent.
      await serial(options.sessionId, () => ensure({ ...options, seed: source.events, parentSession: sessionId, agentPreset: source.header.agentPreset }))
      return { sessionId: options.sessionId, latestSeq: source.events.at(-1)?.seq ?? -1 }
    }),
    remove: sessionId => serial(sessionId, async () => {
      const persistence = ctx.get('sessionPersistence')
      const live = ctx.get('sessions')?.get(sessionId)
      const meta = live?.header ?? (await persistence.inspect(sessionId)).meta
      const location = persistence.locate(meta)
      // The pinned JSONL backend exposes the exact owned artifact, rather than
      // requiring WeftMate to reconstruct its project-path encoding.
      const root = resolve(persistence.config.root)
      const target = location?.kind === 'jsonl' ? dirname(location.path) : null
      const inside = target && relative(root, target)
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw Object.assign(new Error('session deletion unavailable'), { code: 'internal' })
      const handle = handles.get(sessionId)
      if (live && !handle) throw Object.assign(new Error('session lifecycle not owned'), { code: 'agent-busy' })
      if (handle) { await ctx.sessions.flush(handle.agent.session); await handle.dispose(); handles.delete(sessionId) }
      // Disposal checkpoints the last projection. Queue deletion after that
      // native write so the removed conversation cannot survive in backups.
      await ctx.get('storageDomain')?.get('session_projcache')?.table('sessions').delete(sessionId)
      await rm(target, { recursive: true, force: true })
      return { deleted: true }
    }),
  }
}
