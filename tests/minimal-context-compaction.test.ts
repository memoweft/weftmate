import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeContextAwareMinimalPreset, writeWebProfile } from '../src/dsh-web-runtime.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const vendor = join(repository, 'vendor', 'dsh-runtime')
const packageUrl = (name: string) => pathToFileURL(join(vendor, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href
const vendorRequire = createRequire(join(vendor, 'package.json'))

test('generated minimal compactor automatically reduces pressure at pre-step, preserves original history, and stays in its preset scope', { timeout: 15_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-minimal-compaction-'))
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
  const [{ Context }, { default: Loader, Group }, { default: Include }, llmModule,
    { default: Sessions }, { default: TokenMeter }, { default: Commands },
    { createScope }, presetModule, { agentEvents }] = await Promise.all([
    import(packageUrl('cordis')), import(packageUrl('cordis-plugin-loader')), import(packageUrl('cordis-plugin-include')),
    import(packageUrl('dsh-llm')), import(packageUrl('dsh-session')), import(packageUrl('dsh-token-meter')),
    import(packageUrl('dsh-commands')), import(packageUrl('dsh-scope')), import(packageUrl('dsh-agent-presets')),
    import(packageUrl('dsh-agent')),
  ])
  const ctx = new Context()
  const scopes: any[] = []
  t.after(async () => {
    for (const scope of scopes.toReversed()) await scope.dispose()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  ctx.baseUrl = pathToFileURL(join(vendor, 'node_modules', '@deepseek-ai', 'dsh')).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(llmModule.default)
  await ctx.plugin(Sessions)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(Commands)

  // The changed unit is the generated, scoped compaction group. Mount that
  // exact output through the real preset Loader while excluding unrelated
  // PTY/filesystem plugins: this test must never start shells or read user data.
  const shippedRoot = join(vendor, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')
  const generatedRoot = join(root, 'generated')
  await writeContextAwareMinimalPreset(shippedRoot, generatedRoot)
  const { parseDocument, stringify } = vendorRequire('yaml')
  const generated = parseDocument(await readFile(join(generatedRoot, 'minimal', 'agent.cordis.yml'), 'utf8')).toJS()
  const compaction = generated.find((row: any) => row.id === 'compaction')
  assert.ok(compaction, 'minimal must contain its generated context lifecycle')
  const maintainerHome = join(root, 'maintainer-home')
  await writeWebProfile(maintainerHome, 'weftmate')
  const maintainer = parseDocument(await readFile(join(maintainerHome, '.agent-presets', 'mod-maintainer', 'agent.cordis.yml'), 'utf8')).toJS()
  const maintainerCompaction = maintainer.find((row: any) => row.id === 'compaction')
  assert.ok(maintainerCompaction, 'mod-maintainer must contain its generated context lifecycle')
  assert.deepEqual(maintainerCompaction.isolate, { compaction: true, toolResultPruner: true })
  assert.deepEqual(maintainerCompaction.config[0].config, {
    auto: true, thresholdRatio: 0.85, retainRatio: 0.16, maxTokens: 4096,
  })
  const contextWindow = 10_000
  const summaryCalls: any[] = []
  class FixtureAdapter extends llmModule.LlmAdapter {
    async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model, context: { contextWindow } }
    }
    async *stream(options: any) {
      assert.equal(options.purpose, 'compaction', 'the test does not ask for an ordinary model response')
      assert.equal(options.provider, 'compaction-fixture', 'the summary remains on the maintenance session provider')
      assert.equal(options.model, 'fixture-model', 'the summary remains on the maintenance session model')
      summaryCalls.push(options)
      const summary = `CHECKPOINT ${options.sessionId}: preserve the current fixture objective and continue from the retained tail.`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: summary } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['compaction-fixture'], new FixtureAdapter())

  async function agentOn(name: string, mountCompactor: boolean, composition = compaction) {
    let parent: object | undefined
    if (mountCompactor) {
      parent = { preset: name }
      const standing = createScope(ctx, parent)
      scopes.push(standing)
      const directory = join(root, 'scoped', name)
      await mkdir(directory, { recursive: true })
      const path = join(directory, 'agent.cordis.yml')
      await writeFile(path, stringify([composition]), 'utf8')
      await presetModule.mountPreset(standing.ctx, { id: name, name, path, trust: 'system' })
    }
    const session = ctx.sessions.create(`fixture-${name}`)
    const agent: any = {
      id: session.id, session, options: { provider: 'compaction-fixture', model: 'fixture-model' }, status: 'running',
      runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    }
    const scope = createScope(ctx, agent, parent ? { parent } : {})
    agent.ctx = scope.ctx
    scopes.push(scope)
    return agent
  }
  const minimal = await agentOn('minimal', true)
  const standard = await agentOn('standard', true)
  const rootAgent = await agentOn('root', false)
  const modMaintainer = await agentOn('mod-maintainer', true, maintainerCompaction)
  const minimalEngine = presetModule.serviceForAgent(ctx, minimal, 'compaction')
  const standardEngine = presetModule.serviceForAgent(ctx, standard, 'compaction')
  const modMaintainerEngine = presetModule.serviceForAgent(ctx, modMaintainer, 'compaction')
  assert.ok(minimalEngine && standardEngine && modMaintainerEngine)
  assert.notEqual(minimalEngine, standardEngine, 'the two presets own separate compaction services')
  assert.notEqual(modMaintainerEngine, standardEngine, 'mod-maintainer owns an independent compaction service')
  assert.equal(ctx.get('compaction'), undefined, 'there is no process-global fallback compactor')
  assert.equal(minimalEngine.config.auto, true)
  assert.equal(minimalEngine.config.thresholdRatio, 0.8)
  assert.equal(modMaintainerEngine.config.auto, true)
  assert.equal(modMaintainerEngine.config.thresholdRatio, 0.85)
  assert.equal(modMaintainerEngine.config.retainRatio, 0.16)
  assert.equal(modMaintainerEngine.config.maxTokens, 4096)
  assert.equal(ctx.commands.list(minimal).some((command: any) => command.name === 'compact'), true)
  assert.equal(ctx.commands.list(modMaintainer).some((command: any) => command.name === 'compact'), true)
  assert.equal(ctx.commands.list(rootAgent).some((command: any) => command.name === 'compact'), false)

  function closedTurn(agent: any, turn: number, text: string) {
    const session = agent.session
    session.append('turn/start', { turn })
    session.append('user/message', llmModule.createUserMessage({ content: [{ type: 'text', text: `ORIGINAL USER ${turn} ${text}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) session.append('request/header', { header: { config: { provider: 'compaction-fixture', model: 'fixture-model' } }, reason: 'initial' })
    session.append('assistant/message', {
      turn, step: 1,
      message: llmModule.createAssistantMessage({ content: [{ type: 'text', text: `ORIGINAL ASSISTANT ${turn} ${text}` }], source: { provider: 'compaction-fixture', model: 'fixture-model' } }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const preStep = (agent: any, turn: number) => agentEvents(ctx, agent).waterfall('agent/pre-step', {
    turn, step: 1, signal: new AbortController().signal, messages: [],
  }, async () => ({ kind: 'enter', messages: [] }))

  closedTurn(minimal, 1, 'small initial context')
  minimal.session.append('turn/start', { turn: 2 })
  assert.ok(ctx.tokenMeter.measure(minimal.session).totalTokens < contextWindow * 0.8)
  await preStep(minimal, 2)
  assert.equal(summaryCalls.length, 0, 'an ordinary small context must not be summarized')
  minimal.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

  const body = 'history detail '.repeat(800)
  for (const agent of [minimal, standard, rootAgent]) {
    const start = agent === minimal ? 3 : 1
    for (let turn = start; turn < start + 3; turn++) closedTurn(agent, turn, body)
    agent.session.append('turn/start', { turn: start + 3 })
  }
  // `/compact` is a human command, not a model tool. It succeeds below the
  // 85% automatic threshold and uses the same current session route.
  const manualBody = 'manual maintenance history '.repeat(160)
  for (let turn = 1; turn <= 3; turn++) closedTurn(modMaintainer, turn, manualBody)
  const beforeManual = ctx.tokenMeter.measure(modMaintainer.session)
  assert.ok(beforeManual.totalTokens < contextWindow * 0.85)
  const manual = await ctx.commands.execute(modMaintainer, '/compact', new AbortController().signal)
  assert.equal(manual?.result.kind, 'success')
  assert.equal(summaryCalls.length, 1, 'manual /compact invokes the maintenance summary route once')
  assert.equal(summaryCalls[0].sessionId, modMaintainer.id)
  assert.equal(summaryCalls[0].purpose, 'compaction')
  assert.ok(ctx.tokenMeter.measure(modMaintainer.session).totalTokens < beforeManual.totalTokens)
  assert.deepEqual(modMaintainer.session.events.filter((event: any) => event.type === 'command/run' || event.type === 'command/done').map((event: any) => event.type), ['command/run', 'command/done'])

  for (let turn = 4; turn <= 6; turn++) closedTurn(modMaintainer, turn, body)
  modMaintainer.session.append('turn/start', { turn: 7 })
  assert.ok(ctx.tokenMeter.measure(modMaintainer.session).totalTokens > contextWindow * 0.85)
  await preStep(modMaintainer, 7)
  assert.equal(summaryCalls.length, 2, '85% maintenance pre-step invokes exactly one automatic summary')
  assert.equal(summaryCalls[1].sessionId, modMaintainer.id)
  assert.ok(ctx.tokenMeter.measure(modMaintainer.session).totalTokens < contextWindow * 0.85)
  assert.equal(modMaintainer.session.surface.replaceGeneration, 2, 'manual and automatic compaction both replace the active maintenance surface')

  const beforeMinimal = ctx.tokenMeter.measure(minimal.session)
  assert.ok(beforeMinimal.totalTokens > contextWindow * 0.8)
  const originalEvents = minimal.session.events.map((event: any) => structuredClone(event))
  const originalSurface = [...minimal.session.surface.nodes]
  await preStep(minimal, 6)
  const afterMinimal = ctx.tokenMeter.measure(minimal.session)
  assert.equal(summaryCalls.length, 3, 'one minimal pre-step invokes exactly one summary')
  assert.equal(summaryCalls[2].sessionId, minimal.id)
  assert.ok(afterMinimal.totalTokens < contextWindow * 0.8, `pressure should fall below the default threshold: ${afterMinimal.totalTokens}`)
  assert.equal(minimal.session.surface.replaceGeneration, 1)
  assert.deepEqual(minimal.session.events.slice(0, originalEvents.length), originalEvents, 'compaction retains every original durable event')
  assert.equal(originalSurface.some((seq: number) => !minimal.session.surface.nodes.includes(seq)), true, 'the active request surface actually replaces older nodes')
  const activeText = JSON.stringify(minimal.session.deriveMessages())
  assert.match(activeText, /CHECKPOINT fixture-minimal/)
  assert.doesNotMatch(activeText, /ORIGINAL USER 1 small initial context/)
  assert.deepEqual(minimal.session.events.filter((event: any) => ['compaction/start', 'compaction/summary', 'compaction/end'].includes(event.type)).map((event: any) => event.type), ['compaction/start', 'compaction/summary', 'compaction/end'])

  // The same pressure on an agent outside either preset has no listener.
  await preStep(rootAgent, 4)
  assert.equal(summaryCalls.length, 3)
  assert.equal(rootAgent.session.surface.replaceGeneration, 0)
  // Standard's own pre-step gets its one compactor, not minimal's second one.
  await preStep(standard, 4)
  assert.equal(summaryCalls.length, 4)
  assert.equal(summaryCalls[3].sessionId, standard.id)
  assert.equal(standard.session.surface.replaceGeneration, 1)
  assert.equal(minimal.session.surface.replaceGeneration, 1)
  await preStep(minimal, 6)
  assert.equal(summaryCalls.length, 4, 'a successfully reduced minimal context is not compacted again')
})
