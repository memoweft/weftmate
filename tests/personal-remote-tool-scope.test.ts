import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { stagePersonalPlugins } from './support/personal-plugins.ts'

const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules',
  '@deepseek-ai', name, 'lib', 'index.js')).href

async function assertInitialFilePolicy() {
  const root = mkdtempSync(join(tmpdir(), 'personal-policy-'))
  try {
    const { initializePersonalFilePolicy } = await import(stagePersonalPlugins(root).plugin)
    const { effectiveSandboxMode } = await import(vendor('dsh-sandbox-policy'))
    const policy = { overrideOf: (session: any) => effectiveSandboxMode(session.events) }
    const agent = (preset: string, origin?: string) => ({ session: {
      header: { agentPreset: preset, origin }, events: [] as any[],
      append(type: string, data: any) { this.events.push({ type, data }) },
    } })
    for (const origin of [undefined, 'subagent']) {
      const personal = agent('personal-remote', origin)
      personal.session.append('sandbox/mode', { mode: 'workspace-write' })
      personal.session.append('approval/policy', { policy: 'ask' })
      personal.session.append('turn/start', { turn: 1 })
      initializePersonalFilePolicy(personal, policy)
      assert.equal(effectiveSandboxMode(personal.session.events), 'danger-full-access')
      assert.equal(personal.session.events.filter(event => event.type === 'approval/policy').at(-1).data.policy, 'ask')
      const count = personal.session.events.length
      initializePersonalFilePolicy(personal, policy)
      assert.equal(personal.session.events.length, count)
      personal.session.append('sandbox/mode', { mode: 'workspace-write' })
      initializePersonalFilePolicy(personal, policy)
      assert.equal(effectiveSandboxMode(personal.session.events), 'workspace-write')
    }
    const restricted = agent('personal-remote')
    restricted.session.append('sandbox/mode', { mode: 'read-only' })
    initializePersonalFilePolicy(restricted, policy)
    assert.equal(effectiveSandboxMode(restricted.session.events), 'read-only')
    const standard = agent('standard')
    initializePersonalFilePolicy(standard, policy)
    assert.deepEqual(standard.session.events, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('official ToolRuntime gives the original personal-remote scope general tools while denying forged execution identity', async () => {
  await assertInitialFilePolicy()
  const root = mkdtempSync(join(tmpdir(), 'personal-tool-scope-'))
  try {
    const staged = stagePersonalPlugins(root)
    const [{ Context }, SystemPrompt, Sessions, tools, { createScope }, globalPlugin, preset] = await Promise.all([
      import(vendor('cordis')),
      import(vendor('dsh-system-prompt')),
      import(vendor('dsh-session')),
      import(vendor('dsh-tools')),
      import(vendor('dsh-scope')),
      import(staged.plugin),
      import(staged.preset),
    ])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt.default, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
    await ctx.plugin(Sessions.default)
    await ctx.plugin(tools.default, { mode: 'native', maxParallelSubCalls: 1 })
    await ctx.plugin((await import(vendor('dsh-web'))).default)
    const fakeTool = (name: string) => tools.defineTool({ name, description: name,
      parameters: {}, output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: '{}' }] },
      execute: async () => ({ ok: true }) })
    for (const name of ['pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_list', 'job_kill',
      'weftmod', 'weftmod_script', 'get_goal', 'create_goal', 'update_goal', 'ask_user_question', 'future_native_capability', 'mod_sdk']) ctx.get('tools').register(fakeTool(name))
    await ctx.plugin(globalPlugin.default)
    const remoteSession = ctx.sessions.create('remote-session', { meta: { agentPreset: 'personal-remote' } })
    remoteSession.append('turn/start', { turn: 1 })
    remoteSession.append('user/message', { source: { kind: 'user', rpcId: 'fixture-receipt' },
      content: [{ type: 'text', text: 'Create a report.' }] }, { surfaceOp: 'append' })
    const agent = { id: remoteSession.id, session: remoteSession, ctx: null,
      options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer() {}, inject() {} }
    const scoped = createScope(ctx, agent)
    agent.ctx = scoped.ctx
    await scoped.ctx.plugin(preset.default)
    const names = scoped.ctx.get('tools').schemas(agent).map((item: { name: string }) => item.name)
    assert.deepEqual(names, ['pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_list', 'job_kill',
      'weftmod', 'weftmod_script', 'get_goal', 'create_goal', 'update_goal', 'ask_user_question', 'future_native_capability', 'browser'])
    for (const name of ['personal_open_notepad', 'personal_save_document', 'personal_list_project_files',
      'personal_read_project_file', 'personal_browser_open', 'personal_browser_follow', 'personal_browser_read_segment']) {
      assert.equal(names.includes(name), false)
    }
    const rawSchema = ctx.get('tools').schemas(agent).find((item: any) => item.name === 'pwsh')
    const assembled = await scoped.ctx.waterfall('system-prompt/assemble', { tools: [rawSchema] }, {},
      async () => ({ tools: [rawSchema] }))
    assert.equal(assembled.tools[0].description, 'Run a PowerShell command in this conversation or an explicit workdir.')
    assert.equal(rawSchema.description, 'pwsh', 'the native registry and other presets keep their descriptions')
    for (let i = 0; i < 150; i++) remoteSession.append('tool/call', { turn: 1, callId: `call-${i}`, name: 'read' })
    const decision = await scoped.ctx.waterfall('agent/pre-step', {
      agent, messages: [], turn: 1, step: 151, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    assert.equal(decision.kind, 'enter', 'native calls never trigger a personal turn quota')
    for (const name of ['pwsh', 'weftmod', 'mod_sdk', 'run_code']) {
      const result = await ctx.get('tools').execute({ name, arguments: {}, agent,
        callId: `deny-${name.replace('_', '-')}`, signal: new AbortController().signal })
      assert.equal(result.isError, true, `${name} cannot execute with a forged or missing source in the remote scope`)
    }
    const standard = { ...agent, id: 'standard', session: ctx.sessions.create('standard', { meta: { agentPreset: 'standard' } }) }
    assert.ok(ctx.get('tools').schemas(standard).some((item: { name: string }) => item.name === 'pwsh'))
    assert.equal(ctx.get('tools').schemas(standard).some((item: { name: string }) => item.name === 'browser'), false)
    await ctx.fiber.dispose()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('official ToolRuntime gives a shared-account chat no inherited host tools', async () => {
  const [{ Context }, SystemPrompt, Sessions, tools, { createScope }, preset] = await Promise.all([
    import(vendor('cordis')),
    import(vendor('dsh-system-prompt')),
    import(vendor('dsh-session')),
    import(vendor('dsh-tools')),
    import(vendor('dsh-scope')),
    import(pathToFileURL(join(process.cwd(), 'src', 'plugins', 'weftmate-personal-shared-chat-preset.mjs')).href),
  ])
  const ctx = new Context()
  await ctx.plugin(SystemPrompt.default, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(Sessions.default)
  await ctx.plugin(tools.default, { mode: 'native', maxParallelSubCalls: 1 })
  const fakeTool = (name: string) => tools.defineTool({ name, description: name,
    parameters: {}, output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: '{}' }] },
    execute: async () => ({ ok: true }) })
  for (const name of ['pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_list', 'job_kill',
    'weftmod', 'weftmod_script', 'mod_sdk', 'personal_open_notepad', 'personal_save_document',
    'personal_list_project_files', 'personal_read_project_file',
    'personal_browser_open', 'personal_browser_follow', 'personal_browser_read_segment']) {
    ctx.get('tools').register(fakeTool(name))
  }
  const session = ctx.sessions.create('friend-session', { meta: { agentPreset: 'personal-shared-chat' } })
  const agent = { id: session.id, session, ctx: null,
    options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {},
    send() {}, followup() {}, steer() {}, inject() {} }
  const scoped = createScope(ctx, agent)
  agent.ctx = scoped.ctx
  await scoped.ctx.plugin(preset.default)
  assert.deepEqual(scoped.ctx.get('tools').schemas(agent).map((item: { name: string }) => item.name), [])
  for (const name of ['pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_list', 'job_kill',
    'weftmod', 'weftmod_script', 'mod_sdk', 'personal_open_notepad', 'personal_save_document',
    'personal_list_project_files', 'personal_read_project_file',
    'personal_browser_open', 'personal_browser_follow', 'personal_browser_read_segment']) {
    const result = await ctx.get('tools').execute({ name, arguments: {}, agent,
      callId: `deny-${name.replaceAll('_', '-')}`, signal: new AbortController().signal })
    assert.equal(result.isError, true, `${name} must not execute in a shared-account chat`)
  }
  await ctx.fiber.dispose()
})
