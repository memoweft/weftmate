import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import preset from '../src/plugins/weftmate-personal-desktop-preset.mjs'

const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules',
  '@deepseek-ai', name, 'lib', 'index.js')).href

test('official rc.5 agent loop persists a blocked turn after two repeated restricted calls', { timeout: 10_000 }, async () => {
  const [{ Context }, llm, { default: Sessions }, { default: SystemPrompt }, tools,
    { default: AgentRegistry }, { default: AgentLoop }] = await Promise.all([
    import(vendor('cordis')), import(vendor('dsh-llm')), import(vendor('dsh-session')),
    import(vendor('dsh-system-prompt')), import(vendor('dsh-tools')),
    import(vendor('dsh-agent')), import(vendor('dsh-agent-loop')),
  ])
  const ctx = new Context()
  let modelCalls = 0, toolCalls = 0
  try {
    await ctx.plugin(llm.default)
    await ctx.plugin(Sessions)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(tools.default)
    await ctx.plugin(AgentRegistry)
    ctx.tools.register(tools.defineTool({ name: 'personal_open_notepad', description: 'Synthetic Notepad receipt',
      parameters: { appId: { type: 'string', required: true, enum: ['notepad'] } },
      output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: '{"accepted":true}' }] },
      execute: async () => { toolCalls++; return { accepted: true } },
    }))
    ctx.tools.register(tools.defineTool({ name: 'personal_save_document', description: 'Synthetic document receipt',
      parameters: { fileName: { type: 'string', required: true }, content: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: '{"accepted":true}' }] },
      execute: async () => { throw new Error('the document tool is not invoked by this fixture') },
    }))
    class SyntheticAdapter extends llm.LlmAdapter {
      async *stream() {
        modelCalls++
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call-${modelCalls}`,
          name: 'personal_open_notepad', arguments: '{"appId":"notepad"}' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['synthetic-loop'], new SyntheticAdapter())
    await ctx.plugin(AgentLoop, { agents: [] })
    const handle = await ctx.agentLoop.createAgent(ctx, { sessionId: 'synthetic-remote-session',
      meta: { agentPreset: 'personal-remote' }, agentOptions: { provider: 'synthetic-loop', model: 'fixture' },
      setup: async (agentCtx: any) => { await agentCtx.plugin(preset) } })
    try {
      const agent = handle.agent
      agent.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'synthetic unrelated desktop goal' }],
        source: { kind: 'user' } }))
      await agent.whenIdle()
      const events = agent.session.events
      const ended = events.filter((event: any) => event.type === 'turn/end')
      assert.equal(ended.length, 1)
      assert.equal(ended[0].data.reason.kind, 'blocked')
      assert.equal(modelCalls, 2, 'the third model step never starts')
      assert.equal(toolCalls, 2, 'the narrow fixture tool executes only twice')
    } finally { await handle.dispose() }
  } finally { await ctx.fiber.dispose() }
})
