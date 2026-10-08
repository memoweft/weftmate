import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { rm, readFile } from 'node:fs/promises'
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
      : await ctx.agents.create({ sessionId, meta: { cwd: options.cwd, agentPreset: preset }, setup })
    handles.set(sessionId, handle)
  }
  return {
    create: options => ensure(options),
    resume: sessionId => ensure({ sessionId }, true),
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
