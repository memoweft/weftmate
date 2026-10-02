import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const vendorUrl = (name: string) => pathToFileURL(join(repository, 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMuoAAAAASUVORK5CYII='

/** Only rewrite module locations in an isolated copy; the real plugin body,
 * tool definitions, service, registry and worker runtime remain unchanged. */
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'weftmod-plugin-integration-'))
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
  const [{ Context, Service }, { default: SystemPrompt }, { default: Sessions, Session }, toolsModule,
    { default: CodeRuntime }, { createUserMessage }] = await Promise.all([
    import(vendorUrl('cordis')), import(vendorUrl('dsh-system-prompt')), import(vendorUrl('dsh-session')),
    import(vendorUrl('dsh-tools')), import(vendorUrl('dsh-code-runtime-worker-thread')), import(vendorUrl('dsh-llm')),
  ])
  const stagedHost = join(root, 'weftmate-aigame-host.mjs')
  const stagedPlugin = join(root, 'weftmate-weftmod.mjs')
  for (const [name, target] of [['weftmate-aigame-host.mjs', stagedHost], ['weftmate-weftmod.mjs', stagedPlugin]]) {
    const original = join(repository, 'src', 'plugins', name)
    const text = (await readFile(original, 'utf8')).replace(/from '([^']+)'/g, (whole, module) => {
      const url = module.startsWith('@deepseek-ai/') ? vendorUrl(module.slice('@deepseek-ai/'.length))
        : module === './weftmate-aigame-host.mjs' ? pathToFileURL(stagedHost).href
          : module.startsWith('.') ? pathToFileURL(resolve(dirname(original), module)).href : null
      return url ? `from ${JSON.stringify(url)}` : whole
    })
    await writeFile(target, text, 'utf8')
  }
  const plugin = await import(pathToFileURL(stagedPlugin).href)
  const ctx = new Context()
  const savedImages: any[] = []
  class FixtureAttachments extends Service {
    constructor(serviceCtx: any) { super(serviceCtx, 'attachments') }
    async saveImage(input: any) {
      assert.equal(input.mediaType, 'image/png')
      assert.deepEqual(input.data, Buffer.from(ONE_PIXEL_PNG, 'base64'))
      const image = { attachmentId: `fixture-image-${savedImages.length + 1}`, mediaType: input.mediaType, bytes: input.data.length, width: 1, height: 1, name: input.name }
      savedImages.push(image)
      return image
    }
  }
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(Sessions)
  await ctx.plugin(toolsModule.default, { mode: 'native', maxParallelSubCalls: 1 })
  await ctx.plugin(CodeRuntime, { computeMs: 5000, maxWallMs: 15000, maxOutputBytes: 1024 * 1024, maxOldGenerationSizeMb: 128 })
  await ctx.plugin(FixtureAttachments)
  const phoneCalls: any[] = []
  const desktopCalls: any[] = []
  const approvals: any[] = []
  const transport: any = {
    deviceProfiles: async () => ({ items: [{ device_profile_id: 'test-phone', is_default: true, state: 'ready' }] }),
    createDeviceRun: async (input: any) => { phoneCalls.push({ action: 'begin', input }); return { run_id: input.run_id, device_profile_id: input.device_profile_id, status: 'running' } },
    observeDeviceRun: async (run_id: string, input: any) => {
      phoneCalls.push({ action: 'observe', run_id, input })
      return { run_id, observation_id: `observation-${phoneCalls.filter(entry => entry.action === 'observe').length}`, ui: { title: 'Fixture phone', text: ['one', 'two'] }, ...(input.include_screenshot ? { screenshot: { mime_type: 'image/png', base64: ONE_PIXEL_PNG, width: 1, height: 1 } } : {}) }
    },
    actDeviceRun: async (run_id: string, input: any) => { phoneCalls.push({ action: 'act', run_id, input }); return { run_id, actions: input.actions, applied: input.actions.length, accepted: true, outcome: 'accepted', results: [] } },
    controlDeviceRun: async (run_id: string, action: string) => { phoneCalls.push({ action: 'control', run_id, control: action }); return { run_id, status: action === 'complete' ? 'completed' : action } },
    deviceRun: async (run_id: string) => ({ run_id, status: 'running' }),
  }
  let getService: any
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    await ctx.plugin({ name: 'weftmod-integration-fixture', inject: ['tools'], apply(hostCtx: any) {
      getService = plugin.registerWeftMod(hostCtx, {
        transport,
        identity: (exec: any) => ({ dsh_session_id: exec.agent.session.id, dsh_turn_id: 1, tool_call_id: exec.callId, root_call_id: exec.rootCallId }),
        approve: async (exec: any, kind: string) => { approvals.push({ session_id: exec.agent.session.id, kind }); return 'allowed-once' },
      })
    } })
    assert.ok(getService?.(), 'runtime dependency injection must register WeftMod')
    await getService().ready
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  const service = getService()
  service.desktop = async (input: any, { signal }: any) => {
    signal.throwIfAborted()
    desktopCalls.push(input)
    return input.action === 'screenshot'
      ? { ok: true, mime_type: 'image/png', base64: ONE_PIXEL_PNG, width: 1, height: 1, capture_method: 'fixture' }
      : { ok: true, action: input.action, echoed: input.text ?? null }
  }
  t.after(async () => {
    await service.close()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const steered: any[] = []
  const agentFor = (id: string) => {
    const session = ctx.sessions.create(id, { meta: { cwd: root } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    return { id, session, ctx, options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer(message: any) { steered.push({ id, message }) }, inject() {} }
  }
  const agent = agentFor('fixture-owner')
  const otherAgent = agentFor('fixture-other')
  let sequence = 0
  const execute = async (name: string, args: any, options: any = {}) => ctx.tools.execute({
    name, arguments: args, agent: options.agent ?? agent, callId: `fixture-call-${++sequence}`,
    signal: options.signal ?? new AbortController().signal,
  })
  const call = async (name: string, args: any, options?: any) => {
    const result = await execute(name, args, options)
    assert.equal(result.isError, false, JSON.stringify(result))
    return result
  }
  const preStep = async (stepAgent = agent, messages: any[] = [], step = 1) => ctx.waterfall('agent/pre-step', {
    agent: stepAgent, messages, turn: 1, step, signal: new AbortController().signal,
  }, async () => ({ kind: 'enter', messages }))
  return { ctx, plugin, service, agent, otherAgent, execute, call, phoneCalls, desktopCalls, savedImages, approvals, toolsModule, preStep, Session, createUserMessage, steered }
}

const isToolGuide = (message: any) => message.source?.kind === 'plugin' && message.source.plugin === 'weftmod'
  && message.source.sections?.some((section: any) => section.name === 'weftmod-tools')
const isReuseCatalog = (message: any) => message.source?.sections?.some((section: any) => section.name === 'weftmod-reuse')

test('40 real pre-steps retain one guide while preserving all user messages', async t => {
  const f = await fixture(t)
  for (let step = 1; step <= 40; step++) {
    const input = f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `Continue step ${step}` }] })
    const decision = await f.preStep(f.agent, [input], step)
    assert.equal(decision.messages.length, step === 1 ? 2 : 1)
    assert.equal(decision.messages[0], input)
    for (const message of decision.messages) f.agent.session.append('user/message', message, { surfaceOp: 'append' })
    assert.equal(f.agent.session.deriveMessages().filter(isToolGuide).length, 1)
  }
  const messages = f.agent.session.deriveMessages()
  assert.equal(messages.length, 41, '40 user messages plus one guide, not 40 copies of the guide')
  assert.equal(messages.filter((message: any) => message.source.kind === 'user').length, 40)
})

test('pending decision and restored session guides deduplicate, while another session gets its own guide', async t => {
  const f = await fixture(t)
  const initial = await f.preStep()
  const guide = initial.messages.find(isToolGuide)
  assert.ok(guide)
  const pending = await f.preStep(f.agent, [guide])
  assert.deepEqual(pending.messages, [guide], 'a guide awaiting append in this decision must not be duplicated')
  f.agent.session.append('user/message', guide, { surfaceOp: 'append' })
  const replay = JSON.parse(JSON.stringify({ header: f.agent.session.header, events: f.agent.session.events }))
  const restored = f.Session.fromRestore(f.agent.id, replay.events, replay.header)
  assert.notEqual(restored, f.agent.session)
  const restoredAgent = { ...f.agent, session: restored }
  assert.deepEqual((await f.preStep(restoredAgent)).messages, [], 'restoring the durable log requires no process-local deduplication cache')
  assert.equal((await f.preStep(f.otherAgent)).messages.filter(isToolGuide).length, 1)
})

test('compaction removes the active guide and the next pre-step restores exactly one copy', async t => {
  const f = await fixture(t)
  const guide = (await f.preStep()).messages.find(isToolGuide)
  const event = f.agent.session.append('user/message', guide, { surfaceOp: 'append' })
  const summary = f.createUserMessage({ source: { kind: 'plugin', plugin: 'fixture-compaction' }, content: [{ type: 'text', text: 'Earlier progress summarized.' }] })
  f.agent.session.append('user/message', summary, {
    surfaceOp: { op: 'replace', start: event.seq, end: event.seq }, sourceEventSeqs: [event.seq],
  })
  assert.equal(f.agent.session.deriveMessages().filter(isToolGuide).length, 0)
  assert.ok(f.agent.session.events.some((stored: any) => stored.data.id === guide.id), 'compaction leaves the historical event, which must not suppress the current guide')
  const next = await f.preStep()
  assert.equal(next.messages.filter(isToolGuide).length, 1)
  f.agent.session.append('user/message', next.messages[0], { surfaceOp: 'append' })
  assert.deepEqual((await f.preStep()).messages, [])
})

test('outdated guide or identical text from another plugin cannot suppress the current WeftMod guide', async t => {
  const f = await fixture(t)
  const guide = (await f.preStep()).messages.find(isToolGuide)
  const outdatedText = `${guide.content[0].text}\nAn outdated guide instruction.`
  const outdated = f.createUserMessage({ source: { ...guide.source, sections: [{ name: 'weftmod-tools', text: outdatedText }] }, content: [{ type: 'text', text: outdatedText }] })
  const otherPlugin = f.createUserMessage({ source: { ...guide.source, plugin: 'another-plugin' }, content: guide.content })
  for (const message of [outdated, otherPlugin]) f.agent.session.append('user/message', message, { surfaceOp: 'append' })
  const decision = await f.preStep()
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].content[0].text, guide.content[0].text)
  f.agent.session.append('user/message', decision.messages[0], { surfaceOp: 'append' })
  assert.deepEqual((await f.preStep()).messages, [])
})

test('new user goals retrieve candidates once per real message, including repeated wording after a save', async t => {
  const f = await fixture(t)
  await f.call('weftmod_script', { action: 'save', script_id: 'legacy-report', description: 'Read a phone screen and write a report', applicability: 'Current screen reporting', code: 'return 1;' })
  await f.call('weftmod_script', { action: 'run', script_id: 'legacy-report' })
  const firstInput = f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Read this phone screen and make a report' }] })
  const first = await f.preStep(f.agent, [firstInput])
  const catalog = first.messages.find(isReuseCatalog)
  assert.ok(catalog)
  assert.match(catalog.content[0].text, /legacy-report/)
  for (const message of first.messages) f.agent.session.append('user/message', message, { surfaceOp: 'append' })
  assert.equal((await f.preStep(f.agent, [])).messages.filter(isReuseCatalog).length, 0, 'later steps for one message do not duplicate catalog metadata')
  const repeatedInput = f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Read this phone screen and make a report' }] })
  const repeated = await f.preStep(f.agent, [repeatedInput], 2)
  assert.equal(repeated.messages.filter(isReuseCatalog).length, 1, 'a new real user message with identical text searches the current catalog again')
})

test('turn-stopping steers an unverified pending workflow at most three times and new user input suspends it', async t => {
  const f = await fixture(t)
  const { agentEvents } = await import(vendorUrl('dsh-agent'))
  const origin = { turn: 1, message_id: 'goal-message' }
  f.service.captureTarget(f.agent.id, 'Open Settings and enter Developer options', null, origin)
  await f.service.store.saveDeviceOwner('pending-device', f.agent.id)
  await f.service.store.recordPendingScript('pending-device', { evidence_id: 'pending-1', status: 'verification_required', captured_at: new Date().toISOString(), target: 'Open Settings and enter Developer options', origin, actions: [{ action: 'tap' }], last_observation: { observation_id: 'last' }, completion_receipt: { status: 'completed' } })
  for (let attempt = 0; attempt < 3; attempt++) await agentEvents(f.ctx, f.agent).serial('agent/turn-stopping', { turn: 1, signal: new AbortController().signal })
  assert.equal(f.steered.length, 3)
  await agentEvents(f.ctx, f.agent).serial('agent/turn-stopping', { turn: 1, signal: new AbortController().signal })
  assert.equal(f.steered.length, 3)
  assert.equal((await f.service.store.deviceOwner('pending-device')).pending_script.status, 'unresolved')

  await f.service.store.recordPendingScript('pending-device', { evidence_id: 'pending-2', status: 'captured', captured_at: new Date().toISOString(), target: 'Old goal', origin: { turn: 2, message_id: 'old-message' }, actions: [{ action: 'tap' }], last_observation: { observation_id: 'last' }, completion_receipt: { status: 'completed' } })
  const replacement = f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'A new task replaces the old goal' }] })
  await f.preStep(f.agent, [replacement], 2)
  assert.equal((await f.service.store.deviceOwner('pending-device')).pending_script.status, 'suspended_by_user_input')
})

test('WeftMod definitions and native image output execute through the fixed vendor ToolRuntime', async t => {
  const f = await fixture(t)
  const schemas = f.ctx.tools.schemas(f.agent)
  assert.deepEqual(schemas.map((entry: any) => entry.name).sort(), ['weftmod', 'weftmod_script'])
  for (const name of ['weftmod', 'weftmod_script']) {
    const definition = f.ctx.tools.get(name, f.agent)
    assert.ok(definition?.output?.schema)
    assert.deepEqual(f.toolsModule.validateJsonSchemaValue(definition.parameters, { action: name === 'weftmod' ? 'devices' : 'help' }, 'arguments'), [])
  }
  const deviceSchema = f.ctx.tools.get('weftmod', f.agent).parameters
  const actionProperties = deviceSchema.properties.actions.items.properties
  assert.match(actionProperties.keycode.description, /KEYCODE_BACK/)
  assert.match(actionProperties.package.description, /com\.android\.settings/)
  assert.match(actionProperties.component.description, /\.ClassName/)
  assert.match(actionProperties.component.description, /only after discovery.*otherwise send package only/i)
  assert.deepEqual(deviceSchema.properties.ui_tree_format.enum, ['compact', 'xml'])
  assert.match(deviceSchema.properties.ui_tree_format.description, /nested saved scripts default to xml/)
  const invalid = await f.execute('weftmod', { action: 'invented_action' })
  assert.equal(invalid.isError, true)
  assert.equal(f.desktopCalls.length, 0)
  const screenshot = await f.call('weftmod', { action: 'desktop', desktop: { action: 'screenshot', window_id: 'fixture-window' } })
  assert.equal(screenshot.value.base64, undefined)
  assert.deepEqual(screenshot.value.image, f.savedImages[0])
  assert.equal(screenshot.content.filter((entry: any) => entry.type === 'image').length, 1)
  assert.equal(screenshot.additionalContexts?.length ?? 0, 0, 'native images belong in the tool result without a duplicate context')
  const help = await f.call('weftmod_script', { action: 'help' })
  assert.equal(help.value.tools.some((entry: any) => entry.name === 'weftmod'), true)
  assert.equal(help.value.tools.some((entry: any) => entry.name === 'weftmod_script'), false)
})

test('top-level observe defaults to compact while legacy nested scripts retain XML unless explicit', async t => {
  const f = await fixture(t)
  const phone = await f.call('weftmod', { action: 'begin' })
  await f.call('weftmod', { action: 'observe', run_id: phone.value.run_id })
  assert.deepEqual(f.phoneCalls.at(-1), {
    action: 'observe', run_id: phone.value.run_id,
    input: { include_screenshot: false, ui_tree_format: 'compact' },
  })

  const legacyCode = "const phone=await tools.weftmod({action:'begin'}); return await tools.weftmod({action:'observe',run_id:phone.run_id});"
  const saved = await f.call('weftmod_script', { action: 'save', script_id: 'legacy-ui-xml', code: legacyCode })
  const sha256 = saved.value.sha256
  await f.call('weftmod_script', { action: 'run', script_id: 'legacy-ui-xml' })
  const legacyObserve = f.phoneCalls.filter((entry: any) => entry.action === 'observe').at(-1)
  assert.deepEqual(legacyObserve.input, { include_screenshot: false, ui_tree_format: 'xml' })
  assert.equal((await f.call('weftmod_script', { action: 'read', script_id: 'legacy-ui-xml' })).value.sha256, sha256)

  await f.call('weftmod_script', { action: 'save', script_id: 'compact-ui', code: "const phone=await tools.weftmod({action:'begin'}); return await tools.weftmod({action:'observe',run_id:phone.run_id,ui_tree_format:'compact'});" })
  await f.call('weftmod_script', { action: 'run', script_id: 'compact-ui' })
  assert.equal(f.phoneCalls.filter((entry: any) => entry.action === 'observe').at(-1).input.ui_tree_format, 'compact')
})

test('saved scripts use real nested ToolRuntime calls, canonical values, image context, and second-run reuse', async t => {
  const f = await fixture(t)
  const settled: any[] = []
  f.ctx.on('tools/result', (exec: any, result: any) => settled.push({ exec, result }))
  const code = `
const phone = await tools.weftmod({action:'begin'});
const observation = await tools.weftmod({action:'observe',run_id:phone.run_id,include_screenshot:true});
await tools.weftmod({action:'act',run_id:phone.run_id,actions:[{action:'text',text:params.text}]});
const desktop = await tools.weftmod({action:'desktop',desktop:{action:'screenshot',window_id:'fixture-window'}});
const final = await tools.weftmod({action:'observe',run_id:phone.run_id,ui_tree_format:'compact'});
await tools.weftmod({action:'control',run_id:phone.run_id,control:'complete'});
return {title:observation.ui.title, text:params.text, phone_image:observation.image.attachmentId, desktop_image:desktop.image.attachmentId, verification:{matched:true,observation_id:final.observation_id,target:'Fixture phone'}};
`
  const saved = await f.call('weftmod_script', { action: 'save', script_id: 'cross-device', description: 'Phone to desktop fixture', code })
  assert.equal(saved.value.revision, 1)
  const input = { text: '中文 $(literal) "quotes"' }
  const first = await f.call('weftmod_script', { action: 'run', script_id: 'cross-device', params: input })
  assert.equal(first.value.status, 'succeeded', JSON.stringify(first.value))
  assert.equal(first.value.tool_calls, 6)
  assert.equal(first.value.reused, false)
  assert.deepEqual(first.value.result, { title: 'Fixture phone', text: input.text, phone_image: 'fixture-image-1', desktop_image: 'fixture-image-2', verification: { matched: true, observation_id: 'observation-2', target: 'Fixture phone' } })
  assert.equal(first.additionalContexts?.length, 2)
  for (const context of first.additionalContexts) {
    assert.equal(context.source.kind, 'plugin')
    assert.equal(context.source.plugin, 'weftmod')
    assert.equal(context.content.filter((entry: any) => entry.type === 'image').length, 1)
    assert.equal(JSON.stringify(context).includes(ONE_PIXEL_PNG), false)
  }
  const nested = settled.filter(item => item.exec.name === 'weftmod' && item.exec.parent !== undefined)
  assert.equal(nested.length, 6)
  assert.equal(nested.every(item => item.exec.agent === f.agent), true)
  assert.equal(nested.every(item => item.exec.rootCallId === nested[0].exec.rootCallId), true)
  assert.equal(f.phoneCalls.find((entry: any) => entry.action === 'act').input.actions[0].text, input.text)
  const nestedRunId = f.phoneCalls.find((entry: any) => entry.action === 'begin').input.run_id
  assert.equal((await f.service.store.deviceOwner(nestedRunId)).pending_script, undefined, 'a successful nested script complete is not a new direct pending workflow')
  const next = await f.call('weftmod_script', { action: 'run', script_id: 'cross-device', params: { text: 'second parameter' } })
  assert.equal(next.value.status, 'succeeded')
  assert.equal(next.value.reused, true)
  assert.equal(next.value.result.text, 'second parameter')
  assert.equal(next.value.script_revision, first.value.script_revision)
  const asset = await f.call('weftmod_script', { action: 'read', script_id: 'cross-device' })
  assert.equal(asset.value.successful_runs, 2)
  assert.deepEqual(f.approvals.map((entry: any) => entry.kind), ['script'], 'ordinary nested actions reuse the current turn approval')
})

test('after a failed script, the same conversation can top-level resume its device and capture a repair pending workflow', async t => {
  const f = await fixture(t)
  const { agentEvents } = await import(vendorUrl('dsh-agent'))
  const origin = { turn: 1, message_id: 'repair-goal' }
  f.service.captureTarget(f.agent.id, 'Open Settings and enter Developer options', null, origin)
  await f.call('weftmod_script', {
    action: 'save', script_id: 'fails-after-begin',
    code: "const phone=await tools.weftmod({action:'begin'}); await tools.weftmod({action:'observe',run_id:phone.run_id}); throw new Error('screen changed');",
  })
  const failed = await f.call('weftmod_script', { action: 'run', script_id: 'fails-after-begin' })
  assert.equal(failed.value.status, 'failed')
  const runId = f.phoneCalls.find((entry: any) => entry.action === 'begin').input.run_id
  const denied = await f.execute('weftmod', { action: 'control', run_id: runId, control: 'resume' }, { agent: f.otherAgent })
  assert.equal(denied.isError, true, 'resuming a failed script device does not relax cross-conversation ownership')
  await f.call('weftmod', { action: 'inspect', run_id: runId })
  await f.call('weftmod', { action: 'control', run_id: runId, control: 'resume' })
  await f.call('weftmod', { action: 'act', run_id: runId, actions: [{ action: 'open_app', package: 'com.android.settings' }] })
  await f.call('weftmod', { action: 'observe', run_id: runId })
  const completed = await f.call('weftmod', { action: 'control', run_id: runId, control: 'complete' })
  assert.equal(completed.value.pending_script.status, 'captured')
  assert.equal((await f.service.store.deviceOwner(runId)).pending_script.status, 'captured')
  await agentEvents(f.ctx, f.agent).serial('agent/turn-stopping', { turn: 1, signal: new AbortController().signal })
  assert.equal(f.steered.length, 1, 'the top-level repair completion re-enters the same-agent pending continuation')
})

test('script help exposes exact registered output schemas and scripts consume their typed structure', async t => {
  const f = await fixture(t)
  f.ctx.tools.register(f.toolsModule.defineTool({
    name: 'fixture_shell', description: 'A typed shell result used only by this fixture.',
    parameters: { command: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          stdout: { type: 'object', required: true, additionalProperties: false, properties: { text: { type: 'string', required: true }, truncated: { type: 'boolean', required: true } } },
          exitCode: { type: 'integer', required: true },
        },
      },
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async () => ({ stdout: { text: 'first line\nsecond line', truncated: false }, exitCode: 0 }),
  }))
  const help = await f.call('weftmod_script', { action: 'help', tool_names: ['fixture_shell'] })
  assert.equal(help.value.tools.length, 1)
  const described = help.value.tools[0]
  assert.equal(described.name, 'fixture_shell')
  assert.deepEqual(described.output, f.ctx.tools.get('fixture_shell', f.agent).output.schema)
  assert.equal(described.output.properties.stdout.type, 'object')
  assert.equal(described.output.properties.stdout.properties.text.type, 'string')
  await f.call('weftmod_script', { action: 'save', script_id: 'typed-shell', code: "const result=await tools.fixture_shell({command:'fixture'}); if(result.exitCode!==0) throw new Error('failed'); return result.stdout.text.split('\\n');" })
  const executed = await f.call('weftmod_script', { action: 'run', script_id: 'typed-shell' })
  assert.equal(executed.value.status, 'succeeded', JSON.stringify(executed.value))
  assert.deepEqual(executed.value.result, ['first line', 'second line'])
})

test('a rejected desktop action fails its script and cannot create a successful reusable receipt', async t => {
  const f = await fixture(t)
  f.service.desktop = async () => ({ ok: false, error: { code: 'DESKTOP_CONTROL_NOT_FOUND', message: 'The target control disappeared.' } })
  await f.call('weftmod_script', { action: 'save', script_id: 'failed-desktop', code: "return await tools.weftmod({action:'desktop',desktop:{action:'invoke',window_id:'fixture-window',selector:{name:'missing'}}});" })
  const executed = await f.call('weftmod_script', { action: 'run', script_id: 'failed-desktop' })
  assert.equal(executed.value.status, 'failed', JSON.stringify(executed.value))
  assert.match(JSON.stringify(executed.value.error), /DESKTOP_CONTROL_NOT_FOUND|target control disappeared/)
  const script = await f.call('weftmod_script', { action: 'read', script_id: 'failed-desktop' })
  assert.equal(script.value.successful_runs, 0)
})

test('same-origin panel control stops a running script and rejects other-session or cross-origin control', { timeout: 20_000 }, async t => {
  const f = await fixture(t)
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  let wasAborted = false
  let bindingSettled = false
  f.service.desktop = async (_input: any, { signal }: any) => {
    entered()
    try {
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) { wasAborted = true; reject(signal.reason); return }
        signal.addEventListener('abort', () => { wasAborted = true; reject(signal.reason) }, { once: true })
      })
    } finally { bindingSettled = true }
  }
  await f.call('weftmod_script', { action: 'save', script_id: 'controllable', code: "return await tools.weftmod({action:'desktop',desktop:{action:'inspect',window_id:'fixture-window'}});" })
  const pending = f.call('weftmod_script', { action: 'run', script_id: 'controllable' })
  await started
  const run = (await f.service.store.runs(f.agent.id))[0]
  const server = createServer(f.plugin.createWeftModPanelHandler({ service: f.service, sessions: f.ctx.sessions }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const panel = async (id: string) => {
    const response = await fetch(`${origin}/weftmate/weftmod/panel.json?session_id=${encodeURIComponent(id)}`)
    return { status: response.status, body: await response.json() as any }
  }
  const control = async (session_id: string, requestOrigin: string) => {
    const response = await fetch(`${origin}/weftmate/weftmod/control.json`, {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, run_id: run.run_id, action: 'cancel' }),
    })
    return { status: response.status, body: await response.json() as any }
  }
  assert.equal((await panel(f.agent.id)).body.runs[0].status, 'running')
  assert.deepEqual((await panel(f.otherAgent.id)).body.runs, [])
  assert.equal((await panel('missing-conversation')).status, 404)
  assert.equal((await control(f.agent.id, 'https://foreign.invalid')).status, 403)
  assert.equal((await control(f.otherAgent.id, origin)).status, 400)
  assert.equal(wasAborted, false, 'rejected controls must not stop another conversation')
  assert.equal((await control(f.agent.id, origin)).status, 200)
  const finished = await pending
  assert.equal(wasAborted, true)
  assert.equal(bindingSettled, true, 'script outcome must wait for its in-flight tool to settle')
  assert.equal(finished.value.status, 'cancelled')
  assert.equal((await panel(f.agent.id)).body.runs[0].status, 'cancelled')
})
