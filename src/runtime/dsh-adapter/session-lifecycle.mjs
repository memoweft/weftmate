import { copySnapshotTree } from './snapshot-files.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { rm, readFile, cp } from 'node:fs/promises'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Own native AgentHandles so deletion drains precisely one DSH lifecycle. */
export function nativeSessionLifecycle(ctx) {
  const handles = new Map()
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
    create: options => ensure(options),
    resume: sessionId => ensure({ sessionId }, true),
    async fork(sessionId, options) {
      await ensure({ sessionId }, true)
      const source = ctx.sessions.get(sessionId)
      if (ctx.agents.get(sessionId)?.status !== 'idle') throw Object.assign(new Error('session busy'), { code: 'agent-busy' })
      if (source.header.cwd) await cp(source.header.cwd, options.cwd, { recursive: true })
      // Use the native fork transaction's immutable event seed and lineage.
      // Agent creation owns the native session lifecycle, with a fresh cwd,
      // rather than publishing a bare SessionStore child without an agent.
      await ensure({ ...options, seed: source.events, parentSession: sessionId, agentPreset: source.header.agentPreset })
      return { sessionId: options.sessionId, latestSeq: source.events.at(-1)?.seq ?? -1 }
    },
    async remove(sessionId) {
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
      await rm(target, { recursive: true, force: true })
      return { deleted: true }
    },
  }
}
