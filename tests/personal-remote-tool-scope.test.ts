import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules',
  '@deepseek-ai', name, 'lib', 'index.js')).href

test('official ToolRuntime gives the personal-remote scope only bounded desktop and project tools', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-tool-scope-'))
  try {
    const source = readFileSync(join(process.cwd(), 'src', 'plugins', 'weftmate-personal-desktop.mjs'), 'utf8')
      .replace("from '@deepseek-ai/dsh-tools'", `from '${vendor('dsh-tools')}'`)
    const staged = join(root, 'weftmate-personal-desktop.mjs')
    writeFileSync(staged, source)
    const [{ Context }, SystemPrompt, Sessions, tools, { createScope }, globalPlugin, preset] = await Promise.all([
      import(vendor('cordis')),
      import(vendor('dsh-system-prompt')),
      import(vendor('dsh-session')),
      import(vendor('dsh-tools')),
      import(vendor('dsh-scope')),
      import(pathToFileURL(staged).href),
      import(pathToFileURL(join(process.cwd(), 'src', 'plugins', 'weftmate-personal-desktop-preset.mjs')).href),
    ])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt.default, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
    await ctx.plugin(Sessions.default)
    await ctx.plugin(tools.default, { mode: 'native', maxParallelSubCalls: 1 })
    const fakeTool = (name: string) => tools.defineTool({ name, description: name,
      parameters: {}, output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: '{}' }] },
      execute: async () => ({ ok: true }) })
    for (const name of ['pwsh', 'weftmod', 'mod_sdk']) ctx.get('tools').register(fakeTool(name))
    await ctx.plugin(globalPlugin.default)
    const remoteSession = ctx.sessions.create('remote-session', { meta: { agentPreset: 'personal-remote' } })
    assert.equal(globalPlugin.safeDocumentName('会议纪要.md'), '会议纪要.md')
    assert.equal(globalPlugin.safeDocumentName('Cafe\u0301.md'), 'Café.md')
    for (const fileName of ['../secret.md', 'CON.md', 'COM1.md', 'a..b.md', 'a .md', 'a\\b.md',
      'bad\nname.md', 'notes.pdf', 'a'.repeat(161) + '.md']) {
      assert.equal(globalPlugin.safeDocumentName(fileName), null, fileName)
    }
    remoteSession.append('turn/start', { turn: 1 })
    remoteSession.append('user/message', { source: { kind: 'user' },
      content: [{ type: 'text', text: '请在这台电脑上打开记事本' }] }, { surfaceOp: 'append' })
    remoteSession.append('tool/call', { turn: 1, callId: 'call-one', name: 'personal_open_notepad' })
    assert.deepEqual(globalPlugin.personalToolIdentity({ agent: { session: remoteSession }, callId: 'call-one' }), {
      sessionId: remoteSession.id, turn: 1, callId: 'call-one',
      messageHash: createHash('sha256').update('请在这台电脑上打开记事本').digest('hex'),
    })
    const agent = { id: remoteSession.id, session: remoteSession, ctx: null,
      options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer() {}, inject() {} }
    const scoped = createScope(ctx, agent)
    agent.ctx = scoped.ctx
    await scoped.ctx.plugin(preset.default)
    assert.deepEqual(scoped.ctx.get('tools').schemas(agent).map((item: { name: string }) => item.name),
      ['personal_open_notepad', 'personal_save_document',
        'personal_list_project_files', 'personal_read_project_file',
        'personal_browser_open', 'personal_browser_follow', 'personal_browser_read_segment'])
    const preStep = (turn: number) => scoped.ctx.waterfall('agent/pre-step', {
      agent, messages: [], turn, step: turn, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    assert.equal((await preStep(1)).kind, 'enter')
    remoteSession.append('tool/call', { turn: 1, callId: 'call-two', name: 'personal_open_notepad' })
    assert.equal((await preStep(1)).kind, 'reject', 'a third model step is blocked after two same-turn Notepad calls')
    assert.equal((await preStep(2)).kind, 'enter', 'the next user turn has a fresh bound')
    remoteSession.append('tool/call', { turn: 2, callId: 'document-one', name: 'personal_save_document' })
    remoteSession.append('tool/call', { turn: 2, callId: 'document-two', name: 'personal_save_document' })
    assert.equal((await preStep(2)).kind, 'reject', 'a third model step is blocked after two document calls')
    for (const name of ['pwsh', 'weftmod', 'mod_sdk', 'run_code']) {
      const result = await ctx.get('tools').execute({ name, arguments: {}, agent,
        callId: `deny-${name.replace('_', '-')}`, signal: new AbortController().signal })
      assert.equal(result.isError, true, `${name} must not execute in the remote scope`)
    }
    const standard = { ...agent, id: 'standard', session: ctx.sessions.create('standard', { meta: { agentPreset: 'standard' } }) }
    assert.ok(ctx.get('tools').schemas(standard).some((item: { name: string }) => item.name === 'pwsh'))
    for (const name of ['personal_open_notepad', 'personal_save_document',
      'personal_list_project_files', 'personal_read_project_file',
      'personal_browser_open', 'personal_browser_follow', 'personal_browser_read_segment']) {
      const guarded = await ctx.get('tools').execute({ name,
        arguments: name === 'personal_open_notepad' ? { appId: 'notepad' } : { fileName: 'note.md', content: 'Hi' },
        agent: standard, callId: `guarded-${name}`, signal: new AbortController().signal })
      assert.equal(guarded.isError, true)
    }
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
  for (const name of ['pwsh', 'weftmod', 'mod_sdk', 'personal_open_notepad', 'personal_save_document',
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
  for (const name of ['pwsh', 'weftmod', 'mod_sdk', 'personal_open_notepad', 'personal_save_document',
    'personal_list_project_files', 'personal_read_project_file',
    'personal_browser_open', 'personal_browser_follow', 'personal_browser_read_segment']) {
    const result = await ctx.get('tools').execute({ name, arguments: {}, agent,
      callId: `deny-${name.replaceAll('_', '-')}`, signal: new AbortController().signal })
    assert.equal(result.isError, true, `${name} must not execute in a shared-account chat`)
  }
  await ctx.fiber.dispose()
})
