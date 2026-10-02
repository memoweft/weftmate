import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const repository = fileURLToPath(new URL('../', import.meta.url))
const vendor = name => pathToFileURL(join(repository, 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-host-'))
  const [{ Context, Service }, { default: SystemPrompt }, { default: Sessions }, toolsModule] = await Promise.all([
    import(vendor('cordis')), import(vendor('dsh-system-prompt')), import(vendor('dsh-session')), import(vendor('dsh-tools')),
  ])
  const staged = join(root, 'weftmate-mod-projects.mjs')
  const original = join(repository, 'src', 'plugins', 'weftmate-mod-projects.mjs')
  await mkdir(join(root, 'weftmate-client'), { recursive: true })
  await cp(join(repository, 'src', 'plugins', 'weftmate-client', 'mod-state.mjs'), join(root, 'weftmate-client', 'mod-state.mjs'))
  await cp(join(repository, 'src', 'plugins', 'weftmate-client', 'mod-window'), join(root, 'weftmate-client', 'mod-window'), { recursive: true })
  const source = (await readFile(original, 'utf8')).replace(/from '([^']+)'/g, (whole, module) => {
    const target = module.startsWith('@deepseek-ai/') ? vendor(module.slice('@deepseek-ai/'.length))
      : module.startsWith('.') ? pathToFileURL(resolve(dirname(original), module)).href : null
    return target ? `from ${JSON.stringify(target)}` : whole
  })
  await writeFile(staged, source, 'utf8')
  const plugin = await import(pathToFileURL(staged).href)
  const ctx = new Context()
  const handlers = []
  class FixtureWebServer extends Service { constructor(ctx) { super(ctx, 'webServer') } register(route) { handlers.push(route); return () => {} } }
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(Sessions)
  await ctx.plugin(toolsModule.default, { mode: 'native', maxParallelSubCalls: 1 })
  await ctx.plugin(FixtureWebServer)
  const apiCreates = [], workspaceCreates = [], workspaces = new Map()
  let workspaceSequence = 0
  const apiProxy = { sessions: { create: async ({ payload }) => {
    apiCreates.push(payload)
    const workspace = workspaces.get(payload.workspaceId)
    assert.ok(workspace, 'maintenance session must be bound to a formally created workspace')
    if (!ctx.sessions.get(payload.sessionId)) ctx.sessions.create(payload.sessionId, { cwd: workspace.path })
    return { result: { ok: true, value: { sessionId: payload.sessionId } } }
  } }, workspace: { create: async ({ payload }) => {
    workspaceCreates.push(payload)
    const existing = [...workspaces.values()].find(workspace => workspace.path === payload.path)
    const workspace = existing ?? { workspaceId: `workspace-${++workspaceSequence}`, path: payload.path }
    workspaces.set(workspace.workspaceId, workspace)
    return { result: { ok: true, value: { workspace, created: !existing } } }
  } } }
  const service = plugin.registerModProjects(ctx, { root, apiProxy, clientBridgePath: join(repository, 'src', 'plugins', 'weftmate-client', 'mod-projects-client.js'), validationModel: async () => ({ keyless: true }), assertValidation: async ({ validationRoot }) => JSON.parse(await readFile(join(validationRoot, 'state.json'), 'utf8')).validation === true ? { ok: true, receipt: { kind: 'fixture-independent-plan' } } : { ok: false, message: 'fixture plan failed' }, modelBroker: async input => ({ from: 'fixture', aborted: input.signal.aborted }), ...overrides })
  await service.ready
  const ownerSession = ctx.sessions.create('mod-owner', { cwd: root })
  const otherSession = ctx.sessions.create('mod-other', { cwd: root })
  const agentFor = session => ({ id: session.id, session, ctx, options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer() {}, inject() {} })
  const owner = agentFor(ownerSession); const other = agentFor(otherSession)
  let sequence = 0
  const execute = (arguments_, agent = owner) => ctx.tools.execute({ name: 'mod_project', arguments: arguments_, agent, callId: `mod-host-${++sequence}`, signal: new AbortController().signal })
  const call = async (arguments_, agent = owner) => { const result = await execute(arguments_, agent); assert.equal(result.isError, false, JSON.stringify(result)); return result.value }
  t.after(async () => {
    for (const project of await service.runtime.listProjects()) await service.runtime.stop(project.projectId, { reason: 'fixture-cleanup' }).catch(() => {})
    await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  return { root, ctx, plugin, service, apiCreates, workspaceCreates, handlers, owner, other, execute, call }
}

const files = {
  'src/main.mjs': `export async function start(api) { await api.state.write({ running: true }) }
export async function selfTest(api) { await api.state.write({ validation: true }); return { ok: true, assertions: [{ id: 'host-fixture', passed: true }] } }
export async function handleUi(api, request) { return { action: request.action, payload: request.payload, state: await api.state.read() } }`,
  'ui/index.html': '<link rel="stylesheet" href="./style.css"><main>fixture Mod</main><script src="./app.js"></script><img src="./pixel.png">',
  'ui/app.js': 'window.fixtureMod = true',
  'ui/style.css': 'main { color: rgb(1, 2, 3); }',
  'ui/pixel.png': Buffer.from([137, 80, 78, 71]),
}
const toolFiles = Object.fromEntries(Object.entries(files).filter(([, value]) => typeof value === 'string'))

function counterFiles(increment = 1, { valid = true } = {}) {
  return {
    'src/main.mjs': `export async function start(api) { const state = await api.state.read() || { count: 0 }; await api.state.write({ ...state, running: true }) }
export async function selfTest(api) { const state = await api.state.read() || { count: 0 }; await api.state.write({ ...state, validation: ${valid} }); return { ok: true, assertions: [{ id: 'candidate-project-test', passed: true }] } }
export async function handleUi(api, request) { const state = await api.state.read() || { count: 0 }; if (request.action === 'increment') { const next = { ...state, count: state.count + ${increment} }; await api.state.write(next); return next } return state }`,
    'ui/index.html': `<main><button id="increment">加 ${increment}</button></main>`,
  }
}

async function runningCounter(f, increment = 1) {
  // Test fixtures use the trusted runtime seam directly.  Product create only
  // makes a generic skeleton; it must not accept a caller-supplied business
  // implementation and pretend an internal maintenance model wrote it.
  const maintenanceSessionId = `fixture-maintainer-${increment}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let project = await f.service.runtime.createProject({ name: 'Counter Mod', maintainerSessionId: maintenanceSessionId, files: counterFiles(increment) })
  project = await f.service.service.stampModMaintainer(project.projectId)
  await f.service.service.ensureMaintenanceWorkspace(project)
  await f.service.service.own(project.projectId, f.owner.id)
  const created = { project, maintenanceSessionId }
  const candidate = await f.service.runtime.createCandidate(project.projectId)
  await f.service.runtime.validateVersion(project.projectId, candidate.versionId)
  await f.service.runtime.activateVersion(project.projectId, candidate.versionId)
  await f.service.runtime.start(project.projectId, { userInitiated: true })
  return { created, project }
}

function agentFor(session) { return { id: session.id, session, ctx: null, options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer() {}, inject() {} } }
async function preStep(ctx, agent, messages, kind = 'enter') {
  return ctx.waterfall('agent/pre-step', { agent, messages, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind, messages }))
}

test('official Context/Session/ToolRuntime creates a preset-bound skeleton and keeps projects owner-scoped', async t => {
  const f = await fixture(t)
  const createResult = await f.execute({ action: 'create', name: 'Host fixture' })
  assert.equal(createResult.isError, false, JSON.stringify(createResult))
  assert.equal(createResult.concludesTurn, true, 'the real vendor ToolRuntime receives the formal owner-turn conclusion')
  const createdValue = createResult.value
  const project = createdValue.project
  assert.equal(f.apiCreates.length, 1)
  assert.equal(f.apiCreates[0].sessionId, createdValue.maintenanceSessionId)
  assert.equal(f.workspaceCreates.length, 1)
  assert.equal(f.workspaceCreates[0].path, await f.service.runtime.workspacePath(project.projectId))
  assert.deepEqual(Object.keys(f.apiCreates[0]).sort(), ['agentPreset', 'sessionId', 'workspaceId'], 'formal DSH session creation attaches the maintenance workspace and preset before first prompt')
  assert.equal(f.apiCreates[0].agentPreset, 'mod-maintainer')
  assert.equal(project.maintenance_preset, 'mod-maintainer')
  assert.equal(f.service.service.pauseOwnerGoal(f.owner), false, 'the actual Cordis plugin context uses optional ctx.get("goals") and does not trip the guarded ctx.goals property when no GoalService is mounted')
  assert.equal(createdValue.creation.delegated, true)
  assert.equal(createdValue.creation.ownerAction, 'end_turn')
  assert.match(createdValue.creation.ownerMessage, /内部维护会话/)
  f.service.service.creationTurns.add(f.owner.id)
  assert.match(f.service.service.creationTurnGuard({ agent: f.owner, name: 'write', arguments: {} }), /final result.*end this turn/i)
  f.service.service.releaseCreationTurn(f.owner.id)
  assert.equal((await f.call({ action: 'list' })).length, 1)
  assert.deepEqual(await f.call({ action: 'list' }, f.other), [], 'ordinary conversations cannot enumerate another owner’s project')
  const rejected = await f.execute({ action: 'status', project_id: project.projectId }, f.other)
  assert.equal(rejected.isError, true)
  assert.equal(f.owner.session.deriveMessages().some(message => message.source?.plugin === 'weftmate-mod-projects'), false, 'normal chat receives no Mod prompt/context injection')
})

test('formal ToolRuntime candidate output is lossless and one call creates exactly one candidate', async t => {
  const f = await fixture(t)
  const created = await f.call({ action: 'create', name: 'Candidate output' })
  const project = created.project
  const before = (await f.service.runtime.listVersions(project.projectId)).length
  const result = await f.execute({ action: 'candidate', project_id: project.projectId })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), result.value)
  assert.equal(Object.hasOwn(result.value, 'validationReceipt'), false)
  assert.equal(Object.hasOwn(result.value, 'validationError'), false)
  assert.equal((await f.service.runtime.listVersions(project.projectId)).length, before + 1)
})

test('official vendor Context and ToolRuntime hide and deny broad tools before a mod-maintainer first prompt', async t => {
  const f = await fixture(t)
  const createdRaw = await f.call({ action: 'create', name: 'Scoped SDK' })
  const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId)
  assert.ok(maintenance)
  const [{ createScope }, development] = await Promise.all([
    import(vendor('dsh-scope')),
    import(pathToFileURL(join(repository, 'src', 'plugins', 'weftmate-mod-development.mjs')).href),
  ])
  const agent = { id: maintenance.id, session: maintenance, ctx: null, options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer() {}, inject() {} }
  const scoped = createScope(f.ctx, agent)
  agent.ctx = scoped.ctx
  await scoped.ctx.plugin(development.default)
  const scopedSchemas = scoped.ctx.get('tools').schemas(agent).map(schema => schema.name).sort()
  assert.deepEqual(scopedSchemas, ['mod_sdk'], 'formal preset scope has only the server-bound SDK before prompt assembly')
  const sdkSchema = scoped.ctx.get('tools').schemas(agent).find(schema => schema.name === 'mod_sdk')
  const checksSchema = sdkSchema.parameters.properties.behavior_checks
  assert.equal(checksSchema.type, 'array', 'the real vendor schema exposes behavior_checks as an array, not unconstrained JSON')
  assert.equal(checksSchema.items.oneOf.length, 2)
  assert.deepEqual(checksSchema.items.oneOf.map(branch => branch.required).sort((a, b) => a.join().localeCompare(b.join())), [['action', 'steps', 'expect'], ['action', 'steps', 'stateField', 'expectedDelta']])
  const valueSchema = checksSchema.items.oneOf[1].properties.expect.properties.value
  assert.deepEqual(valueSchema.oneOf.map(branch => branch.type), ['number', 'string', 'boolean', 'null', 'array', 'object'], 'the real vendor schema exposes scalar alternatives before structured JSON values')
  assert.ok(valueSchema.oneOf.every(branch => typeof branch.type === 'string'), 'expect.value has no unconstrained {} schema branch')
  assert.equal(valueSchema.oneOf[5].additionalProperties, true, 'object values remain legal JSON without turning the whole union into an untyped branch')
  const wrappedChecks = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'check', behavior_checks: { checks: [] } }, agent, callId: 'sdk-check-wrapper-rejected', signal: new AbortController().signal })
  assert.equal(wrappedChecks.isError, true, 'the actual vendor ToolRuntime rejects the recurring {checks:[...]} wrapper before SDK execution')
  const sdk = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'describe' }, agent, callId: 'sdk-describe', signal: new AbortController().signal })
  assert.equal(sdk.isError, false, JSON.stringify(sdk)); assert.equal(sdk.value.version, 1)
  assert.deepEqual(sdk.value.behaviorChecks.arrayLengthExample[0], { action: 'list', steps: 1, payload: { query: 'example' }, expect: { path: 'result.items.length', op: 'equals', value: 1 } })
  assert.deepEqual(sdk.value.behaviorChecks.writeThenReadItemExample, [{ action: 'append', steps: 1, payload: { value: 'example' }, expect: { path: 'state.entries.0.value', op: 'equals', value: 'example' } }, { action: 'list', steps: 1, expect: { path: 'result.entries.0.value', op: 'equals', value: 'example' } }], 'describe exposes a generic write-then-read concrete item example through the real ToolRuntime')
  assert.match(sdk.value.behaviorChecks.rules, /business operation passed to handleUi/, 'describe tells the real maintenance tool that action is an operation, not a function name')
  assert.match(sdk.value.behaviorChecks.rules, /submitted order against one candidate-only state/, 'describe states the check isolation and ordering semantics')
  assert.match(sdk.value.correction, /do not weaken the check/, 'describe forbids turning a failed requested behavior into an easier passing check')
  assert.equal(sdk.value.manifestExamples.update.action, 'manifest_update')
  assert.match(sdk.value.manifestExamples.update.expected_sha256, /manifest_read/)
  const broad = await f.ctx.tools.execute({ name: 'mod_project', arguments: { action: 'list' }, agent, callId: 'sdk-broad-denial', signal: new AbortController().signal })
  assert.equal(broad.isError, true, 'restricted scope must also refuse direct execution')
  const normalSchemas = f.ctx.get('tools').schemas().map(schema => schema.name)
  assert.ok(normalSchemas.includes('mod_project'), 'normal chat retains the existing broad tool')
})

test('a user-selected formal mod-maintainer session safely initializes and restores exactly one bound Mod without reattaching its existing DSH session', async t => {
  const f = await fixture(t)
  const manual = f.ctx.sessions.create('manual-maintainer', { meta: { cwd: f.root, agentPreset: 'mod-maintainer' } })
  manual.append('user/message', { id: 'manual-create-goal', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '做一个记录习惯的小 Mod' }] }, { surfaceOp: 'append' })
  const [{ createScope }, development] = await Promise.all([
    import(vendor('dsh-scope')),
    import(pathToFileURL(join(repository, 'src', 'plugins', 'weftmate-mod-development.mjs')).href),
  ])
  const agent = agentFor(manual); const scoped = createScope(f.ctx, agent); agent.ctx = scoped.ctx
  await scoped.ctx.plugin(development.default)
  assert.deepEqual(scoped.ctx.get('tools').schemas(agent).map(schema => schema.name), ['mod_sdk'], 'the selected preset still exposes no broad project-management tool')
  const normalSdk = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: 'forbidden' }, agent: f.owner, callId: 'ordinary-sdk-create', signal: new AbortController().signal })
  assert.equal(normalSdk.isError, true, 'ordinary chat cannot use the maintenance initializer')
  const describe = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'describe' }, agent, callId: 'manual-sdk-describe', signal: new AbortController().signal })
  assert.equal(describe.isError, false, JSON.stringify(describe)); assert.equal(describe.value.initialization.state, 'unbound')
  const prematureList = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'list' }, agent, callId: 'manual-sdk-list-before-create', signal: new AbortController().signal })
  assert.equal(prematureList.isError, true); assert.match(prematureList.error.message, /mod_sdk create/)
  const created = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '习惯记录' }, agent, callId: 'manual-sdk-create', signal: new AbortController().signal })
  assert.equal(created.isError, false, JSON.stringify(created)); assert.equal(created.value.created, true)
  const project = created.value.project
  assert.equal(project.maintainerSessionId, manual.id)
  assert.equal(project.maintenance_preset, 'mod-maintainer')
  assert.equal(project.maintenance_binding, 'current-session-preset')
  assert.equal(f.apiCreates.length, 0, 'the host never recreates or changes the already-selected DSH session')
  assert.equal(f.workspaceCreates.length, 0, 'the SDK resolves the durable project workspace itself')
  const pollutedCreate = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '不得传入宿主字段', project_id: project.projectId }, agent, callId: 'manual-sdk-create-polluted', signal: new AbortController().signal })
  assert.equal(pollutedCreate.isError, true, 'the initializer accepts no caller-supplied project identity')
  assert.equal((await f.service.runtime.listRequirements(project.projectId))[0].origin.messageId, 'manual-create-goal', 'the current user request becomes the first bound requirement without a self-followup')
  const files = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'list' }, agent, callId: 'manual-sdk-list', signal: new AbortController().signal })
  assert.equal(files.isError, false, JSON.stringify(files)); assert.equal(files.value.project.maintenancePreset, 'mod-maintainer')
  const repeat = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '不得换绑' }, agent, callId: 'manual-sdk-repeat', signal: new AbortController().signal })
  assert.equal(repeat.isError, false, JSON.stringify(repeat)); assert.equal(repeat.value.created, false); assert.equal(repeat.value.project.projectId, project.projectId)
  assert.equal((await f.service.runtime.listProjects()).length, 1, 'repeated initialization cannot create a second project or change the binding')
  f.service.service.modMaintainers.clear(); f.service.service.maintenanceBindings.clear()
  await f.service.service.open()
  assert.equal(f.service.service.isModMaintainerSession(manual.id), true, 'the durable project restores its maintenance binding')
  assert.deepEqual(await f.service.service.ensureMaintenanceWorkspace(await f.service.runtime.getProject(project.projectId)), { workspaceId: null, workspaceCreated: false, attached: false, binding: 'current-session-preset' }, 'recovery preserves the existing session cwd and does not attach it again')
  assert.equal(f.apiCreates.length, 0)
})

test('a failed manual initializer resumes its already-marked project instead of creating a second project or rebinding a legacy one', async t => {
  const f = await fixture(t)
  const manual = f.ctx.sessions.create('manual-resume', { meta: { cwd: f.root, agentPreset: 'mod-maintainer' } })
  const agent = agentFor(manual); agent.ctx = f.ctx
  const own = f.service.service.own.bind(f.service.service); let failOnce = true
  f.service.service.own = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('simulated owner-map interruption') }
    return own(...args)
  }
  const first = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '可恢复 Mod' }, agent, callId: 'manual-interrupted-create', signal: new AbortController().signal })
  assert.equal(first.isError, true)
  const interrupted = (await f.service.runtime.listProjects()).find(project => project.maintainerSessionId === manual.id)
  assert.ok(interrupted); assert.equal(interrupted.maintenance_binding, 'current-session-preset'); assert.equal(interrupted.maintenance_preset, 'mod-maintainer')
  f.service.service.modMaintainers.clear(); f.service.service.maintenanceBindings.clear()
  await f.service.service.open()
  const resumed = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '不得新建第二个' }, agent, callId: 'manual-resume-create', signal: new AbortController().signal })
  assert.equal(resumed.isError, false, JSON.stringify(resumed)); assert.equal(resumed.value.created, false); assert.equal(resumed.value.project.projectId, interrupted.projectId)
  assert.equal((await f.service.runtime.listProjects()).filter(project => project.maintainerSessionId === manual.id).length, 1)
})

test('a manual initializer resumes its recorded first requirement after a restart boundary before it marks creation ready', async t => {
  const f = await fixture(t)
  const manual = f.ctx.sessions.create('manual-requirement-resume', { meta: { cwd: f.root, agentPreset: 'mod-maintainer' } })
  manual.append('user/message', { id: 'manual-resume-goal', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '做一个可以保存心情的 Mod' }] }, { surfaceOp: 'append' })
  const agent = agentFor(manual); agent.ctx = f.ctx
  const update = f.service.service.update.bind(f.service.service); let failOnce = true
  f.service.service.update = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('simulated update receipt interruption') }
    return update(...args)
  }
  const first = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '心情记录' }, agent, callId: 'manual-requirement-interrupted-create', signal: new AbortController().signal })
  assert.equal(first.isError, true)
  const interrupted = (await f.service.runtime.listProjects()).find(project => project.maintainerSessionId === manual.id)
  assert.ok(interrupted); assert.notEqual(interrupted.creation_status, 'ready')
  assert.equal((await f.service.runtime.listRequirements(interrupted.projectId)).length, 1)
  f.service.service.modMaintainers.clear(); f.service.service.maintenanceBindings.clear()
  await f.service.service.open()
  const resumed = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'create', name: '不得重复需求' }, agent, callId: 'manual-requirement-resume-create', signal: new AbortController().signal })
  assert.equal(resumed.isError, false, JSON.stringify(resumed)); assert.equal(resumed.value.project.creation_status, 'ready')
  const requirements = await f.service.runtime.listRequirements(interrupted.projectId)
  assert.equal(requirements.length, 1); assert.equal(requirements[0].origin.messageId, 'manual-resume-goal')
})

test('detail derives controls and validation facts from the active version and actual run without granting lifecycle authority', async t => {
  const f = await fixture(t)
  f.owner.session.append('user/message', { id: 'detail-goal', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '创建一个小工具' }] }, { surfaceOp: 'append' })
  const createdRaw = await f.call({ action: 'create', name: 'Detail states' }); const created = createdRaw.value ?? createdRaw
  const before = await f.service.service.detail(created.project.projectId, f.owner.id)
  assert.deepEqual(before.controls, { canStart: false, canStop: false, canInvoke: false, startBlockedReason: 'NO_ACTIVE_VERSION', publishing: false })
  assert.deepEqual(before.validation, { isolatedBehaviorChecks: 'not-run', behaviorCheckCount: 0, scenarioValidated: null, userAcceptance: 'not-tracked-by-mod-runtime' })
  const { project } = await runningCounter(f)
  const running = await f.service.service.detail(project.projectId, f.owner.id)
  assert.equal(running.controls.canStart, false)
  assert.equal(running.controls.startBlockedReason, 'ALREADY_RUNNING')
  assert.equal(running.controls.canStop, true)
  assert.equal(running.controls.canInvoke, true)
  assert.equal(running.validation.isolatedBehaviorChecks, 'not-run')
  assert.equal(running.validation.behaviorCheckCount, 0)
  assert.equal(running.validation.scenarioValidated, null)
  await f.service.runtime.stop(project.projectId)
  const stopped = await f.service.service.detail(project.projectId, f.owner.id)
  assert.deepEqual(stopped.controls, { canStart: true, canStop: false, canInvoke: false, startBlockedReason: null, publishing: false })
  await f.service.service.update(project.projectId, { status: 'running' })
  const durablyPublishing = await f.service.service.detail(project.projectId, f.owner.id)
  assert.deepEqual(durablyPublishing.controls, { canStart: false, canStop: false, canInvoke: false, startBlockedReason: 'PUBLISH_IN_PROGRESS', publishing: true })
  await f.service.service.update(project.projectId, { status: 'ready' })
  const activeProject = await f.service.runtime.getProject(project.projectId)
  const active = await f.service.runtime.store.version(project.projectId, activeProject.activeVersionId)
  await f.service.runtime.store.saveVersion(project.projectId, { ...active, validation_receipt: { ...active.validation_receipt, assertions: [...active.validation_receipt.assertions, { id: 'behavior-check:inspect:result.ready', passed: true, evidence: { kind: 'isolated-handleUi-json' } }] } })
  const passed = await f.service.service.detail(project.projectId, f.owner.id)
  assert.equal(passed.validation.isolatedBehaviorChecks, 'passed')
  assert.equal(passed.validation.behaviorCheckCount, 1)
  await f.service.runtime.store.saveVersion(project.projectId, { ...active, validation_receipt: { ...active.validation_receipt, assertions: [...active.validation_receipt.assertions, { id: 'behavior-check:inspect:result.ready', passed: false, evidence: { kind: 'isolated-handleUi-json' } }] } })
  const failed = await f.service.service.detail(project.projectId, f.owner.id)
  assert.equal(failed.validation.isolatedBehaviorChecks, 'failed')
  assert.equal(failed.validation.behaviorCheckCount, 1)
  await f.service.runtime.store.saveVersion(project.projectId, { ...active, validation_receipt: null })
  const unknown = await f.service.service.detail(project.projectId, f.owner.id)
  assert.deepEqual(unknown.validation, { isolatedBehaviorChecks: 'unknown', behaviorCheckCount: 0, scenarioValidated: null, userAcceptance: 'not-tracked-by-mod-runtime' })
  const agentStart = await f.execute({ action: 'start', project_id: project.projectId })
  assert.equal(agentStart.isError, true, 'detail.controls does not bypass the existing explicit-user start requirement')
})

test('official scoped tools.restrict disposer hides creation-turn tools and restores the next turn schema', async t => {
  const f = await fixture(t)
  const [{ createScope }] = await Promise.all([import(vendor('dsh-scope'))])
  const session = f.ctx.sessions.create('creation-turn-owner', { cwd: f.root })
  const agent = { id: session.id, session, ctx: null, options: {}, status: 'running', inbox: {}, cancel() {}, whenIdle: async () => {}, send() {}, followup() {}, steer() {}, inject() {} }
  const scoped = createScope(f.ctx, agent); agent.ctx = scoped.ctx
  const before = scoped.ctx.get('tools').schemas(agent).map(schema => schema.name).sort()
  assert.ok(before.includes('mod_project')); assert.ok(before.includes('mod_sdk'))
  const dispose = scoped.ctx.get('tools').restrict({ allow: ['mod_project'] })
  assert.deepEqual(scoped.ctx.get('tools').schemas(agent).map(schema => schema.name), ['mod_project'])
  dispose()
  assert.deepEqual(scoped.ctx.get('tools').schemas(agent).map(schema => schema.name).sort(), before)
})

test('create carries the real owner message into one maintenance requirement and reports generating, not business completion', async t => {
  const f = await fixture(t)
  const followed = []
  f.service.service.options.resolveAgent = id => ({ followup: message => followed.push({ id, message }) })
  f.owner.session.append('user/message', { id: 'owner-create-goal', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '创建本地收藏，保存标题、链接和备注' }] }, { surfaceOp: 'append' })
  const createdRaw = await f.call({ action: 'create', name: '本地收藏' })
  const created = createdRaw.value ?? createdRaw
  assert.equal(created.creation.state, 'generating')
  assert.equal(created.creation.businessVersionId, null)
  assert.equal(created.creation.delegated, true)
  assert.equal(created.creation.ownerAction, 'end_turn')
  assert.match(created.creation.ownerMessage, /不要写源码.*轮询/)
  const requirements = await f.service.runtime.listRequirements(created.project.projectId)
  assert.equal(requirements.length, 1)
  assert.equal(requirements[0].text, '创建本地收藏，保存标题、链接和备注')
  assert.deepEqual(requirements[0].origin, { kind: 'user', messageId: 'owner-create-goal', sourceSessionId: f.owner.id })
  assert.ok(followed.length >= 1)
  assert.equal(followed[0].id, created.maintenanceSessionId)
  assert.equal(followed[0].message.id, `mod-requirement-${created.creation.requirementId}`, 'formal followup receives the plugin-origin requirement')
})

test('failed preset provisioning is owner-idempotent, structured, and does not block later service recovery', async t => {
  const f = await fixture(t)
  const original = f.service.service.ensureMaintenanceWorkspace.bind(f.service.service)
  f.service.service.ensureMaintenanceWorkspace = async () => { throw new Error('agent-presets: preset "mod-maintainer" not found (available: standard)') }
  f.service.service.pauseOwnerGoal = () => true
  f.owner.session.append('user/message', { id: 'same-failed-create', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '创建资料收藏' }] }, { surfaceOp: 'append' })
  const firstResult = await f.execute({ action: 'create', name: 'Fails safely' }); assert.equal(firstResult.isError, false, JSON.stringify(firstResult)); assert.equal(firstResult.concludesTurn, true, 'a structured factory failure also ends the owner turn')
  const first = firstResult.value
  assert.equal(first.creation.state, 'needs_host_maintenance'); assert.equal(first.creation.code, 'MOD_MAINTAINER_PRESET_UNAVAILABLE')
  assert.equal(first.creation.ownerAction, 'report_failure_and_end_turn')
  assert.equal(first.creation.ownerGoalPaused, true)
  assert.match(first.creation.ownerMessage, /宿主已暂停当前目标.*内部维护当前不可用.*创建失败/)
  assert.equal(Object.hasOwn(first, 'workspacePath'), false, 'failure never exposes a raw workspace path')
  const secondRaw = await f.call({ action: 'create', name: 'Fails safely' }); const second = secondRaw.value ?? secondRaw
  assert.equal(second.project.projectId, first.project.projectId, 'retrying one owner message never leaves a second orphan project')
  assert.equal((await f.service.runtime.listProjects()).length, 1)
  f.service.service.ensureMaintenanceWorkspace = original
  await f.service.service.restoreMaintenanceWorkspaces()
  assert.equal((await f.service.runtime.getProject(first.project.projectId)).creation_status, 'needs_host_maintenance', 'the earlier failure remains inspectable and never blocks host recovery')
})

test('server-bound SDK rejects path escape, links, stale writes, and broad create/import while preserving source hashes', async t => {
  const f = await fixture(t)
  const createdRaw = await f.call({ action: 'create', name: 'SDK files' })
  const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId)
  const agent = agentFor(maintenance)
  const callSdk = async arguments_ => {
    const result = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `sdk-${Math.random()}`, signal: new AbortController().signal })
    assert.equal(result.isError, false, JSON.stringify(result)); return result.value
  }
  const main = await callSdk({ action: 'read', path: 'src/main.mjs' })
  const write = await callSdk({ action: 'write', path: 'src/feature.mjs', content: 'export const favorite = true\n' })
  const feature = await callSdk({ action: 'read', path: 'src/feature.mjs' })
  await callSdk({ action: 'write', path: 'src/feature.mjs', content: 'export const favorite = "receipt"\n' })
  await assert.rejects(callSdk({ action: 'write', path: 'ui/index.html', content: '<main>unread</main>' }), /first call read/)
  await writeFile(join(await f.service.runtime.workspacePath(created.project.projectId), 'src', 'feature.mjs'), 'export const favorite = "other writer"\n', 'utf8')
  await assert.rejects(callSdk({ action: 'write', path: 'src/feature.mjs', content: 'export const favorite = "rejected"\n' }), /hash changed/)
  await assert.rejects(callSdk({ action: 'write', path: 'src/feature.mjs', content: 'export const favorite = "still rejected"\n', expected_sha256: feature.sha256 }), /hash changed/)
  const refreshed = await callSdk({ action: 'read', path: 'src/feature.mjs' })
  await callSdk({ action: 'write', path: 'src/feature.mjs', content: 'export const favorite = "recovered"\n' })
  await assert.rejects(callSdk({ action: 'write', path: 'src/feature.mjs', content: 'export const favorite = false\n', expected_sha256: '0'.repeat(64) }), /hash changed/)
  const afterRejected = await callSdk({ action: 'read', path: 'src/feature.mjs' })
  assert.notEqual(afterRejected.sha256, write.sha256); assert.notEqual(afterRejected.sha256, refreshed.sha256)
  for (const path of ['../outside.mjs', 'C:/outside.mjs', 'src\\outside.mjs', '/outside.mjs']) await assert.rejects(callSdk({ action: 'read', path }), /path|Unsafe/i)
  const workspace = await f.service.runtime.workspacePath(created.project.projectId)
  const { link, symlink } = await import('node:fs/promises')
  await link(join(workspace, 'src', 'feature.mjs'), join(workspace, 'src', 'hard.mjs'))
  await assert.rejects(callSdk({ action: 'list' }), /hard-linked/i)
  await rm(join(workspace, 'src', 'hard.mjs'))
  await symlink(join(workspace, 'src'), join(workspace, 'linked-dir'), 'junction')
  await assert.rejects(callSdk({ action: 'list' }), /symbolic link|reparse/i)
  await rm(join(workspace, 'linked-dir'), { recursive: true })
  const broad = await f.ctx.tools.execute({ name: 'mod_project', arguments: { action: 'import', directory: workspace }, agent, callId: 'sdk-import-denied', signal: new AbortController().signal })
  assert.equal(broad.isError, true)
  assert.equal((await callSdk({ action: 'read', path: 'src/main.mjs' })).sha256, main.sha256, 'rejected paths and links leave unrelated source unchanged')
})

test('generic creation can publish a first locally stored favourite through SDK check and complete', async t => {
  const f = await fixture(t)
  f.owner.session.append('user/message', { id: 'favorite-goal', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '收藏一个链接' }] }, { surfaceOp: 'append' })
  const createdRaw = await f.call({ action: 'create', name: '收藏' })
  const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId); const agent = agentFor(maintenance)
  const sdk = async arguments_ => { const value = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `favorite-${Math.random()}`, signal: new AbortController().signal }); assert.equal(value.isError, false, JSON.stringify(value)); return value.value }
  const source = await sdk({ action: 'read', path: 'src/main.mjs' })
  const implementation = `export async function start(api) { await api.state.write((await api.state.read()) || { items: [] }) }
export async function selfTest(api) { await api.state.write({ items: [], validation: true }); return { ok: true, assertions: [{ id: 'favorite-self-test', passed: true }] } }
export async function handleUi(api, request) { const state = await api.state.read() || { items: [] }; if (request.action === 'save') { const items = [...state.items, request.payload]; const next = { ...state, items }; await api.state.write(next); return { items } } return state }
`
  await sdk({ action: 'write', path: 'src/main.mjs', content: implementation, expected_sha256: source.sha256 })
  const check = [{ action: 'save', steps: 1, payload: { title: '示例', url: 'https://example.test', note: '本地备注' }, expect: { path: 'state.items.length', op: 'equals', value: 1 } }]
  await sdk({ action: 'check', behavior_checks: check })
  const completedFirstPass = await sdk({ action: 'complete' })
  await f.service.service.waitForOwnerDeliveryIdle()
  const replayedCompletion = await sdk({ action: 'complete' })
  assert.deepEqual(
    {
      status: replayedCompletion.status,
      requirementId: replayedCompletion.requirementId,
      candidateVersionId: replayedCompletion.candidateVersionId,
      completedAt: replayedCompletion.completedAt,
      completionScope: replayedCompletion.completionScope,
      messageId: replayedCompletion.ownerNotification.messageId,
      outcome: replayedCompletion.ownerNotification.outcome,
      attempts: replayedCompletion.ownerNotification.attempts,
      notificationState: replayedCompletion.ownerNotification.state,
    },
    {
      status: completedFirstPass.status,
      requirementId: completedFirstPass.requirementId,
      candidateVersionId: completedFirstPass.candidateVersionId,
      completedAt: completedFirstPass.completedAt,
      completionScope: completedFirstPass.completionScope,
      messageId: completedFirstPass.ownerNotification.messageId,
      outcome: completedFirstPass.ownerNotification.outcome,
      attempts: 0,
      notificationState: 'pending_offline',
    },
    'a lost complete response reuses the immutable publish receipt while reporting the independently advanced owner outbox',
  )
  const execution = await f.service.runtime.inspectRun(created.project.projectId)
  assert.equal(execution.run.status, 'running')
  assert.deepEqual(await f.service.runtime.invokeUi(created.project.projectId, { action: 'save', payload: { title: '第二条', url: 'https://two.test', note: '仍本地' } }), { items: [{ title: '第二条', url: 'https://two.test', note: '仍本地' }] })
  const secondSource = await sdk({ action: 'read', path: 'src/main.mjs' })
  const revised = `export async function start(api) { await api.state.write((await api.state.read()) || { items: [] }) }
export async function selfTest(api) { await api.state.write({ items: [{ title: '验证资料', url: 'https://verify.test', note: '隔离验证', tags: ['验证'] }], validation: true }); return { ok: true, assertions: [{ id: 'favorite-tags-search-self-test', passed: true }] } }
export async function handleUi(api, request) { const state = await api.state.read() || { items: [] }; if (request.action === 'save') { const items = [...state.items, request.payload]; const next = { ...state, items }; await api.state.write(next); return { items } } if (request.action === 'tag') { const items = state.items.map(item => item.url === request.payload.url ? { ...item, tags: [...new Set([...(item.tags || []), request.payload.tag])] } : item); await api.state.write({ ...state, items }); return { items } } if (request.action === 'search') return { items: state.items.filter(item => [item.title, item.url, item.note, ...(item.tags || [])].join(' ').includes(request.payload.query)) }; return state }
`
  await sdk({ action: 'write', path: 'src/main.mjs', content: revised, expected_sha256: secondSource.sha256 })
  const change = await f.service.runtime.recordRequirement(created.project.projectId, { text: '给收藏增加标签和搜索，保留旧资料', sessionId: created.maintenanceSessionId, origin: { kind: 'user', messageId: 'favorite-tags-search' } })
  await sdk({ action: 'complete', behavior_checks: [{ action: 'search', steps: 1, payload: { query: '验证' }, expect: { path: 'result.items.length', op: 'equals', value: 1 } }] })
  assert.equal((await f.service.runtime.listRequirements(created.project.projectId)).find(item => item.requirementId === change.requirementId).status, 'resolved')
  await f.service.runtime.invokeUi(created.project.projectId, { action: 'tag', payload: { url: 'https://two.test', tag: '重要' } })
  assert.deepEqual(await f.service.runtime.invokeUi(created.project.projectId, { action: 'search', payload: { query: '重要' } }), { items: [{ title: '第二条', url: 'https://two.test', note: '仍本地', tags: ['重要'] }] }, 'the second SDK pass keeps the first pass data while adding tags and search')
  await f.service.runtime.stop(created.project.projectId)
})

test('SDK exposes versioned manifest edits but cannot self-grant host capability access', async t => {
  const f = await fixture(t)
  const createdRaw = await f.call({ action: 'create', name: 'Manifest SDK' }); const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId); const agent = agentFor(maintenance)
  const sdk = async arguments_ => { const result = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `manifest-${Math.random()}`, signal: new AbortController().signal }); assert.equal(result.isError, false, JSON.stringify(result)); return result.value }
  await assert.rejects(sdk({ action: 'manifest_update', manifest: { manifestVersion: 1 } }), /manifest_read first/)
  const before = await sdk({ action: 'manifest_read' })
  assert.equal(before.manifest.manifestVersion, 1)
  assert.deepEqual(before.manifest.capabilities.required, ['state.read', 'state.write', 'ui.customAsset'])
  const requestModel = { ...before.manifest, capabilities: { required: [...before.manifest.capabilities.required, 'model.call'] } }
  await sdk({ action: 'manifest_update', manifest: requestModel })
  const status = await sdk({ action: 'status' })
  assert.equal(status.capabilityStatus['model.call'], 'declared-not-host-granted')
  const current = await sdk({ action: 'manifest_read' })
  const externalManifest = { ...current.manifest, capabilities: { required: [...current.manifest.capabilities.required, 'model.call'] } }
  await f.service.runtime.updateManifest(created.project.projectId, externalManifest, { expectedManifestSha256: current.sha256 })
  await assert.rejects(sdk({ action: 'manifest_update', manifest: current.manifest }), /hash changed/)
  await assert.rejects(sdk({ action: 'manifest_update', manifest: current.manifest, expected_sha256: current.sha256 }), /hash changed/)
  const refreshed = await sdk({ action: 'manifest_read' })
  await assert.rejects(sdk({ action: 'manifest_update', manifest: { ...refreshed.manifest, grants: ['model.call'] }, expected_sha256: refreshed.sha256 }), /cannot modify host grants/)
  await assert.rejects(sdk({ action: 'manifest_update', manifest: { ...refreshed.manifest, manifestVersion: 0 }, expected_sha256: refreshed.sha256 }), /cannot be downgraded/)
})

test('real ToolRuntime behavior-check failures disclose payload shape without replaying payload values, while a passing receipt states its isolated capability boundary', async t => {
  const f = await fixture(t)
  const createdRaw = await f.call({ action: 'create', name: 'Behavior receipt boundary' }); const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId); assert.ok(maintenance); const agent = agentFor(maintenance)
  const executeSdk = arguments_ => f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `behavior-boundary-${Math.random()}`, signal: new AbortController().signal })
  const sdk = async arguments_ => { const result = await executeSdk(arguments_); assert.equal(result.isError, false, JSON.stringify(result)); return result.value }
  const source = await sdk({ action: 'read', path: 'src/main.mjs' })
  const implementation = `export async function start(api) { await api.state.write((await api.state.read()) || { ok: true }) }
export async function selfTest(api) { await api.state.write({ validation: true }); return { ok: true, assertions: [{ id: 'behavior-boundary', passed: true }] } }
export async function handleUi(api, request) { if (request.action === 'reject') throw new Error('controlled business rejection'); if (request.action === 'inspect') return { ok: true }; return { ok: false } }
`
  await sdk({ action: 'write', path: 'src/main.mjs', content: implementation, expected_sha256: source.sha256 })
  const manifest = await sdk({ action: 'manifest_read' })
  await sdk({ action: 'manifest_update', manifest: { ...manifest.manifest, manifestVersion: 1, capabilities: { required: ['state.read', 'state.write', 'model.call'] } }, expected_sha256: manifest.sha256 })
  const raw = await f.service.runtime.store.project(created.project.projectId)
  await f.service.runtime.store.saveProject({ ...raw, host_capability_grants: ['state.read', 'state.write', 'ui.customAsset'] })
  await f.service.runtime.recordRequirement(created.project.projectId, { text: 'exercise receipt boundary', sessionId: maintenance.id, origin: { kind: 'user', messageId: 'behavior-receipt-boundary' } })

  for (const [label, check, expected] of [
    ['without-payload', { action: 'reject', steps: 1, expect: { path: 'result.ok', op: 'equals', value: true } }, { payloadProvided: false, payloadTopLevelKeys: [] }],
    ['with-payload', { action: 'reject', steps: 1, payload: { rounds: 3, private: 'secret' }, expect: { path: 'result.ok', op: 'equals', value: true } }, { payloadProvided: true, payloadTopLevelKeys: ['rounds', 'private'] }],
  ] as const) {
    const result = await executeSdk({ action: 'check', behavior_checks: [check] })
    assert.equal(result.isError, true, label)
    const detail = JSON.parse(result.error.message)
    assert.deepEqual(detail.attemptedChecks, [{ index: 0, action: 'reject', assertionPath: 'result.ok', ...expected }])
    assert.doesNotMatch(JSON.stringify(detail), /secret/, `${label} failure must not echo a payload value`)
  }
  const receipt = await sdk({ action: 'check', behavior_checks: [{ action: 'inspect', steps: 1, expect: { path: 'result.ok', op: 'equals', value: true } }] })
  assert.equal(receipt.capabilityFacts.scope, 'isolated-behavior-only')
  assert.equal(receipt.capabilityFacts.capabilityStatus['model.call'], 'declared-not-host-granted')
})

test('a checked SDK candidate is invalidated by workspace or manifest changes and never covers a new requirement', async t => {
  const f = await fixture(t)
  f.owner.session.append('user/message', { id: 'receipt-goal', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '实现一个通用计数动作' }] }, { surfaceOp: 'append' })
  const createdRaw = await f.call({ action: 'create', name: 'Receipt SDK' }); const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId); const agent = agentFor(maintenance)
  const sdk = async arguments_ => { const result = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `receipt-${Math.random()}`, signal: new AbortController().signal }); assert.equal(result.isError, false, JSON.stringify(result)); return result.value }
  const source = await sdk({ action: 'read', path: 'src/main.mjs' })
  const implementation = `export async function start(api) { await api.state.write((await api.state.read()) || { count: 0, items: [] }) }
export async function selfTest(api) { await api.state.write({ count: 0, items: [], validation: true }); return { ok: true, assertions: [{ id: 'receipt-self-test', passed: true }] } }
export async function handleUi(api, request) { const state = await api.state.read() || { count: 0, items: [] }; if (request.action === 'increment') { const next = { ...state, count: state.count + 1 }; await api.state.write(next); return next } if (request.action === 'append') { const next = { ...state, items: [...state.items, request.payload] }; await api.state.write(next); return { items: next.items } } if (request.action === 'reject') throw new Error('business action rejected at C:\\\\private\\\\source.mjs') ; return state }
`
  await sdk({ action: 'write', path: 'src/main.mjs', content: implementation, expected_sha256: source.sha256 })
  await f.service.runtime.recordRequirement(created.project.projectId, { text: '当前较新的需求', sessionId: created.maintenanceSessionId, origin: { kind: 'user', messageId: 'current-requirement' } })
  const invalidArrayCheck = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'check', behavior_checks: [{ action: 'append', steps: 1, payload: { id: 'array-value' }, stateField: 'items', expectedDelta: 1 }] }, agent, callId: 'receipt-array-check-failure', signal: new AbortController().signal })
  assert.equal(invalidArrayCheck.isError, true, 'the real ToolRuntime keeps a failed behavior check as an error')
  const invalidArrayDetail = JSON.parse(invalidArrayCheck.error.message)
  assert.equal(invalidArrayDetail.code, 'MOD_SDK_BEHAVIOR_CHECK_FAILED')
  assert.equal(invalidArrayDetail.failures[0].index, 0)
  assert.equal(invalidArrayDetail.failures[0].action, 'append')
  assert.equal(invalidArrayDetail.failures[0].assertionPath, 'state.items')
  assert.equal(invalidArrayDetail.failures[0].expected, 1)
  assert.equal(invalidArrayDetail.failures[0].observed, 0, 'the failed numeric form exposes the real numeric coercion result instead of a generic error')
  const check = [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 2 }]
  await sdk({ action: 'check', behavior_checks: check })
  const failedExplicitComplete = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'complete', behavior_checks: [{ action: 'append', steps: 1, payload: { id: 'explicit-failure' }, stateField: 'items', expectedDelta: 1 }] }, agent, callId: 'receipt-explicit-complete-failure', signal: new AbortController().signal })
  assert.equal(failedExplicitComplete.isError, true, 'an explicit complete with a failed new check remains an error')
  await assert.rejects(sdk({ action: 'complete' }), /requires a successful check/, 'a failed explicit complete cannot leave an earlier SDK check reusable')
  const failedLaterCheck = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'check', behavior_checks: [{ action: 'append', steps: 1, payload: { id: 'stricter-array-check' }, stateField: 'items', expectedDelta: 1 }] }, agent, callId: 'receipt-later-check-failure', signal: new AbortController().signal })
  assert.equal(failedLaterCheck.isError, true)
  assert.equal(JSON.parse(failedLaterCheck.error.message).code, 'MOD_SDK_BEHAVIOR_CHECK_FAILED')
  await assert.rejects(sdk({ action: 'complete' }), /requires a successful check/, 'a failed later check invalidates an earlier successful receipt')
  const rejectedBusinessAction = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: { action: 'check', behavior_checks: [{ action: 'reject', steps: 1, expect: { path: 'result.ok', op: 'equals', value: true } }] }, agent, callId: 'receipt-business-error', signal: new AbortController().signal })
  assert.equal(rejectedBusinessAction.isError, true)
  const rejectedBusinessDetail = JSON.parse(rejectedBusinessAction.error.message)
  assert.equal(rejectedBusinessDetail.failures[0].action, 'reject')
  assert.equal(rejectedBusinessDetail.failures[0].businessError, 'business action rejected at <path>')
  assert.doesNotMatch(JSON.stringify(rejectedBusinessDetail), /private\\source\.mjs|stack/i, 'the SDK failure evidence does not expose paths or a stack')
  await sdk({ action: 'check', behavior_checks: check })
  const unchanged = await sdk({ action: 'read', path: 'src/main.mjs' })
  await sdk({ action: 'write', path: 'src/main.mjs', content: implementation, expected_sha256: unchanged.sha256 })
  await assert.rejects(sdk({ action: 'complete' }), /Source or manifest changed after check/)
  await sdk({ action: 'check', behavior_checks: check })
  const manifest = await sdk({ action: 'manifest_read' })
  await sdk({ action: 'manifest_update', manifest: manifest.manifest, expected_sha256: manifest.sha256 })
  await assert.rejects(sdk({ action: 'complete' }), /Source or manifest changed after check/)
  await sdk({ action: 'check', behavior_checks: check })
  await f.service.runtime.recordRequirement(created.project.projectId, { text: '新的独立需求', sessionId: created.maintenanceSessionId, origin: { kind: 'user', messageId: 'new-requirement' } })
  await assert.rejects(sdk({ action: 'complete' }), /different pending requirement/)
  assert.equal((await f.service.runtime.listRequirements(created.project.projectId)).filter(item => item.status !== 'resolved').length, 3, 'a previous check cannot resolve a newly recorded requirement or an older backlog')
})

test('an SDK check followed by a user stop cannot clear the stop latch during no-argument complete', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  const maintenance = f.ctx.sessions.get(project.maintainerSessionId); assert.ok(maintenance); const agent = agentFor(maintenance)
  const sdk = async arguments_ => { const result = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `sdk-stop-${Math.random()}`, signal: new AbortController().signal }); assert.equal(result.isError, false, JSON.stringify(result)); return result.value }
  await f.service.runtime.recordRequirement(project.projectId, { text: '保留当前计数动作', sessionId: maintenance.id, origin: { kind: 'user', messageId: 'sdk-stop-check' } })
  await sdk({ action: 'check', behavior_checks: [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 1 }] })
  await f.service.runtime.stop(project.projectId, { reason: 'user-stop' })
  await assert.rejects(sdk({ action: 'complete' }), /User stop or another control change/)
  const after = await f.service.runtime.getProject(project.projectId)
  assert.equal(after.stopLatch, true); assert.equal(after.desiredState, 'stopped')
})

test('same-origin UI path may explicitly start, but an Agent cannot clear stopLatch; assets/invoke are frame-bound', async t => {
  const f = await fixture(t)
  const server = createServer(f.plugin.createModProjectsHandler(f.service.service))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const bridge = await fetch(`${origin}/weftmate/mods/bridge.mjs`)
  assert.equal(bridge.status, 200); assert.match(bridge.headers.get('content-type') ?? '', /^text\/javascript/); assert.match(await bridge.text(), /createModFrameBridge/)
  assert.equal((await fetch(`${origin}/weftmate/mods/bridge.mjs`, { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
  const stateModule = await fetch(`${origin}/weftmate/mods/state.mjs`)
  assert.equal(stateModule.status, 200); assert.match(await stateModule.text(), /deriveModState/)
  assert.equal((await fetch(`${origin}/weftmate/mods/state.mjs`, { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
  const wrapper = await fetch(`${origin}/weftmate/mods/window.html`)
  assert.equal(wrapper.status, 200); assert.match(await wrapper.text(), /sandbox="allow-scripts"/)
  assert.equal((await fetch(`${origin}/weftmate/mods/window.css`)).headers.get('content-security-policy')?.includes("connect-src 'none'"), true)
  const request = async (value, requestOrigin = origin) => {
    const response = await fetch(`${origin}/weftmate/mods/request`, { method: 'POST', headers: { Origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(value) })
    return { status: response.status, body: await response.json() }
  }
  const create = await request({ session_id: f.owner.id, action: 'create-template', name: 'HTTP fixture' })
  assert.equal(create.status, 200, JSON.stringify(create.body)); const project = create.body.project
  await f.service.runtime.updateWorkspace(project.projectId, { files })
  let versionId
  for (const [action, extra] of [['candidate', {}], ['validate', null], ['select', null]]) {
    const payload = { session_id: f.owner.id, action, project_id: project.projectId, ...(extra ?? {}) }
    if (action !== 'candidate') payload.version_id = versionId
    const result = await request(payload); assert.equal(result.status, 200, JSON.stringify(result.body)); if (action === 'candidate') versionId = result.body.versionId
  }
  const afterCandidate = await request({ session_id: f.owner.id, action: 'detail', project_id: project.projectId })
  assert.equal(afterCandidate.status, 200); assert.equal(afterCandidate.body.versions.length, 1, 'detail publishes the newly created immutable version without UI inference')
  assert.equal(afterCandidate.body.versions[0].versionId, versionId)
  const foreign = await request({ session_id: f.owner.id, action: 'status', project_id: project.projectId }, 'https://foreign.invalid')
  assert.equal(foreign.status, 403)
  const started = await request({ session_id: f.owner.id, action: 'start', project_id: project.projectId, user_initiated: true })
  assert.equal(started.status, 200, JSON.stringify(started.body))
  const detail = await request({ session_id: f.owner.id, action: 'detail', project_id: project.projectId })
  assert.equal(detail.status, 200); assert.ok(detail.body.ui.frameToken)
  const leased = f.service.service.frames.get(detail.body.ui.frameToken)
  assert.ok(leased); leased.expiresAt = Date.now() + 60_000
  assert.throws(() => f.service.service.verifyFrame(project.projectId, f.owner.id, detail.body.ui.frameToken, 'wrong-version'), /active version/)
  const renewed = await fetch(`${origin}/weftmate/mods/window/snapshot?project_id=${encodeURIComponent(project.projectId)}&session_id=${encodeURIComponent(f.owner.id)}`, { headers: { Origin: origin } })
  assert.equal(renewed.status, 200)
  assert.equal((await renewed.json()).ui.frameToken, detail.body.ui.frameToken, 'an active same-version view extends its capability instead of reloading its iframe')
  assert.ok(leased.expiresAt > Date.now() + 9 * 60_000)
  assert.equal((await fetch(`${origin}/weftmate/mods/window/snapshot?project_id=${encodeURIComponent(project.projectId)}&session_id=${encodeURIComponent(f.owner.id)}`, { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
  const asset = await fetch(`${origin}${detail.body.ui.assetUrl}`); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/)
  const assetBase = detail.body.ui.assetUrl.replace(/index\.html$/, '')
  assert.equal((await fetch(`${origin}${assetBase}app.js`)).status, 200, 'relative script inherits frame capability path')
  assert.equal((await fetch(`${origin}${assetBase}style.css`)).status, 200, 'relative CSS inherits frame capability path')
  assert.deepEqual(Buffer.from(await (await fetch(`${origin}${assetBase}pixel.png`)).arrayBuffer()), Buffer.from([137, 80, 78, 71]))
  const invoke = await request({ session_id: f.owner.id, action: 'invoke', project_id: project.projectId, frame_token: detail.body.ui.frameToken, request: { action: 'increment', payload: { n: 1 } } })
  assert.deepEqual(invoke.body.payload, { n: 1 })
  const wrongSession = await request({ session_id: f.other.id, action: 'invoke', project_id: project.projectId, frame_token: detail.body.ui.frameToken, request: { action: 'increment', payload: {} } })
  assert.equal(wrongSession.status, 400)
  leased.expiresAt = Date.now() - 1
  const expiredRenewal = await fetch(`${origin}/weftmate/mods/window/snapshot?project_id=${encodeURIComponent(project.projectId)}&session_id=${encodeURIComponent(f.owner.id)}&frame_token=${encodeURIComponent(detail.body.ui.frameToken)}`, { headers: { Origin: origin } })
  assert.equal(expiredRenewal.status, 400, 'an expired open-window lease disconnects, rather than silently rotating its iframe token')
  assert.throws(() => f.service.service.verifyFrame(project.projectId, f.owner.id, detail.body.ui.frameToken), /expired/)
  await request({ session_id: f.owner.id, action: 'stop', project_id: project.projectId })
  const agentStart = await f.execute({ action: 'start', project_id: project.projectId })
  assert.equal(agentStart.isError, true); assert.match(JSON.stringify(agentStart), /explicit user start/)
})

test('production broker uses maintenance session route, forwards AbortSignal, and never reads maintenance history', async t => {
  const f = await fixture(t)
  const maintenance = f.ctx.sessions.create('maint-route', { cwd: f.root })
  const agent = { session: maintenance, options: { provider: 'fixture-provider', model: 'fixture-model' } }
  const calls = []
  const controller = new AbortController(); controller.abort(new Error('cancel fixture'))
  const stream = async function* (input) { calls.push(input); yield { type: 'text-delta', index: 0, text: 'brokered' }; yield { type: 'finish', reason: { kind: 'stop' } } }
  const value = await f.plugin.dshModelBroker({ sessions: f.ctx.sessions, agents: new Map([['maint-route', agent]]), llm: { stream } }, {}, { maintenanceSessionId: 'maint-route', projectId: 'mod-a', versionId: 'version-a', runId: 'run-a', input: { prompt: 'only this input' }, signal: controller.signal })
  assert.deepEqual(value, { text: 'brokered' }); assert.equal(calls[0].provider, 'fixture-provider'); assert.equal(calls[0].model, 'fixture-model'); assert.equal(calls[0].signal, controller.signal); assert.equal(calls[0].messages.length, 1)
})

test('offline incident remains pending, then resumes once with a stable maintenance message id after flush', async t => {
  const f = await fixture(t)
  const project = await f.service.runtime.createProject({ name: 'Offline incident', maintainerSessionId: 'maint-offline', files })
  await f.service.service.own(project.projectId, f.owner.id)
  await f.service.runtime.store.saveIncident({ incident_id: 'incident-offline', project_id: project.projectId, version_id: 'version-none', run_id: 'run-none', phase: 'fixture', fingerprint: 'offline', maintainer_session_id: 'maint-offline', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  await f.service.service.deliverIncidents()
  assert.equal((await f.service.runtime.listIncidents())[0].status, 'pending', 'offline delivery cannot become delivered')
  const maintenance = f.ctx.sessions.create('maint-offline', { cwd: await f.service.runtime.workspacePath(project.projectId) })
  let flushed = 0
  f.service.service.options.flushSession = async (_id, session) => { assert.equal(session, maintenance); flushed += 1 }
  await f.service.service.deliverIncidents(); await f.service.service.deliverIncidents()
  const stored = (await f.service.runtime.listIncidents())[0]
  assert.equal(stored.status, 'delivered'); assert.equal(stored.delivery.message_id, 'mod-incident-incident-offline'); assert.equal(flushed, 1)
  assert.equal(maintenance.events.filter(event => event.data?.id === 'mod-incident-incident-offline').length, 1, 'recovery does not duplicate the durable inbox message')
})

test('a recorded requirement is durably relayed to the associated maintenance session', async t => {
  const f = await fixture(t)
  const createdRaw = await f.call({ action: 'create', name: 'Requirement relay' })
  const created = createdRaw.value ?? createdRaw
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId)
  assert.ok(maintenance)
  let flushed = 0
  f.service.service.options.flushSession = async (id, session) => { assert.equal(id, created.maintenanceSessionId); assert.equal(session, maintenance); flushed += 1 }
  const server = createServer(f.plugin.createModProjectsHandler(f.service.service)); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address(); assert.ok(address && typeof address === 'object'); const origin = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${origin}/weftmate/mods/request`, { method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: f.owner.id, action: 'requirement', project_id: created.project.projectId, text: 'Keep an audit trail', message_id: 'actual-user-message' }) })
  assert.equal(response.status, 200)
  await new Promise(resolve => setTimeout(resolve, 50))
  const message = maintenance.events.map(event => event.data).find(value => value?.id?.startsWith('mod-requirement-'))
  assert.ok(message); assert.equal(message.source.kind, 'plugin'); assert.equal(flushed, 1)
})

test('complete_update executes the requested +2 behavior, preserves live count, resolves once, and is idempotent', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  for (let count = 1; count <= 3; count++) assert.equal((await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })).count, count)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: '每次加 2，按钮写加 2，旧计数保留', sessionId: f.owner.id, origin: { kind: 'user', messageId: 'change-to-two' } })
  const check = [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 4 }]
  const completed = await f.service.service.completeUpdate(project.projectId, requirement.requirementId, check)
  assert.equal(completed.status, 'completed')
  assert.equal(f.service.service.ownerDeliveryClosed, false)
  assert.equal(completed.completionScope, 'candidate-published')
  assert.equal((await f.service.runtime.inspectRun(project.projectId)).run.status, 'running')
  assert.equal((await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })).count, 5, 'new real button action adds two without resetting count')
  assert.match((await f.service.runtime.readUiAsset(project.projectId, 'index.html')).bytes.toString('utf8'), /加 2/)
  assert.equal((await f.service.runtime.listRequirements(project.projectId))[0].status, 'resolved')
  assert.equal((await f.service.service.detail(project.projectId, f.owner.id)).update.completionScope, 'candidate-published')
  const versionsBeforeRetry = (await f.service.runtime.listVersions(project.projectId)).length
  await f.service.service.waitForOwnerDeliveryIdle()
  assert.equal(f.service.service.ownerDeliveryTimer, null, 'waiting for the scheduled cycle observes its timer firing')
  const repeated = await f.service.service.completeUpdate(project.projectId, requirement.requirementId, check)
  assert.deepEqual(
    {
      status: repeated.status,
      requirementId: repeated.requirementId,
      candidateVersionId: repeated.candidateVersionId,
      completedAt: repeated.completedAt,
      completionScope: repeated.completionScope,
      messageId: repeated.ownerNotification.messageId,
      outcome: repeated.ownerNotification.outcome,
      attempts: repeated.ownerNotification.attempts,
      notificationState: repeated.ownerNotification.state,
    },
    {
      status: completed.status,
      requirementId: completed.requirementId,
      candidateVersionId: completed.candidateVersionId,
      completedAt: completed.completedAt,
      completionScope: completed.completionScope,
      messageId: completed.ownerNotification.messageId,
      outcome: completed.ownerNotification.outcome,
      attempts: 0,
      notificationState: 'pending_offline',
    },
    'the immutable publish receipt is reused while its independent outbox truthfully advances to offline-pending',
  )
  assert.equal((await f.service.runtime.listVersions(project.projectId)).length, versionsBeforeRetry, 'a repeated completion does not create another candidate')
  await f.service.runtime.stop(project.projectId)
})

test('maintenance outcome is durably appended once to the original owner conversation and does not claim user acceptance', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: '每次加 2', origin: { kind: 'user', messageId: 'owner-outcome' } })
  let flushed = 0
  f.service.service.options.resolveAgent = id => id === f.owner.id ? { followup: async message => { f.owner.session.append('user/message', message, { surfaceOp: 'append' }); flushed += 1 } } : null
  const outcome = await f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 2 }])
  assert.equal(outcome.ownerNotification.state, 'pending')
  await f.service.service.waitForOwnerDeliveryIdle()
  const delivered = await f.service.service.update(project.projectId)
  assert.equal(delivered.ownerNotification.state, 'delivered')
  const notifications = f.owner.session.events.map(event => event.data).filter(message => message?.id === delivered.ownerNotification.messageId)
  assert.equal(notifications.length, 1); assert.match(notifications[0].content[0].text, /不是用户验收/); assert.ok(flushed >= 1)
  await f.service.service.deliverOwnerOutcomes()
  assert.equal(f.owner.session.events.map(event => event.data).filter(message => message?.id === delivered.ownerNotification.messageId).length, 1, 'restart/retry scans retain the stable notification id')
  await f.service.runtime.stop(project.projectId)
})

test('a same-session maintainer completion suppresses followup durably', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  const raw = await f.service.runtime.store.project(project.projectId)
  await f.service.runtime.store.saveProject({ ...raw, maintainer_session_id: f.owner.id })
  await f.service.service.own(project.projectId, f.owner.id)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: '每次加 2', origin: { kind: 'user', messageId: 'same-session' }, notify: false })
  let followups = 0
  f.service.service.options.resolveAgent = id => id === f.owner.id ? { followup: async () => { followups += 1 } } : null
  await f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 2 }])
  await f.service.service.waitForOwnerDeliveryIdle()
  assert.equal((await f.service.service.update(project.projectId)).ownerNotification.state, 'suppressed_by_same_session')
  assert.equal(followups, 0)
  await f.service.service.deliverOwnerOutcomes()
  assert.equal(followups, 0, 'a later delivery scan retains the durable suppression')
  await f.service.runtime.stop(project.projectId)
})

test('offline owner outcome ignores unrelated agents and delivers once when the owner agent is created', async t => {
  let ownerAgent = null
  const f = await fixture(t, { resolveAgent: id => id === 'mod-owner' ? ownerAgent : null })
  const { project } = await runningCounter(f)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'later owner delivery', origin: { kind: 'user', messageId: 'later-owner' } })
  await f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 2 }])
  await f.service.service.waitForOwnerDeliveryIdle()
  const offline = await f.service.service.update(project.projectId)
  assert.equal(offline.ownerNotification.state, 'pending_offline')
  assert.equal(offline.ownerNotification.attempts, 0, 'offline availability is not a failed delivery attempt')

  for (let index = 0; index < 25; index++) {
    const unrelatedSession = { id: `unrelated-${index}`, events: [] }
    await f.ctx.parallel('agent/created', { agent: { id: unrelatedSession.id, session: unrelatedSession } })
  }
  const afterUnrelated = await f.service.service.update(project.projectId)
  assert.equal(afterUnrelated.ownerNotification.state, 'pending_offline')
  assert.equal(afterUnrelated.ownerNotification.attempts, 0)
  assert.equal(afterUnrelated.ownerNotification.updatedAt, offline.ownerNotification.updatedAt, 'unrelated agent creation does not consume or rewrite the owner outbox')

  let followups = 0
  ownerAgent = {
    id: f.owner.id,
    session: f.owner.session,
    async followup(message) {
      followups += 1
      f.owner.session.append('user/message', message, { surfaceOp: 'append' })
    },
  }
  await f.ctx.parallel('agent/created', { agent: ownerAgent })
  const delivered = await f.service.service.update(project.projectId)
  assert.equal(delivered.ownerNotification.state, 'delivered')
  assert.equal(followups, 1)
  await f.ctx.parallel('agent/created', { agent: ownerAgent })
  assert.equal(followups, 1, 'stable message id and delivered state prevent duplicate followup')
  await f.service.runtime.stop(project.projectId)
})

test('owner delivery backs off before retry, stops after three actual errors, and never rolls back the published Mod', async t => {
  let now = Date.parse('2026-09-23T00:00:00Z')
  const timers = []
  const setOwnerDeliveryTimer = (callback, delay) => {
    const timer = { callback, dueAt: now + delay, cleared: false, unref() {} }
    timers.push(timer)
    return timer
  }
  const clearOwnerDeliveryTimer = timer => { timer.cleared = true }
  let followups = 0
  const f = await fixture(t, {
    ownerDeliveryNow: () => now,
    ownerDeliveryRetryBaseMs: 100,
    setOwnerDeliveryTimer,
    clearOwnerDeliveryTimer,
    resolveAgent: id => id === 'mod-owner' ? { followup: async () => { followups += 1; throw new Error(`delivery-${followups}`) } } : null,
  })
  const runDue = async () => {
    const due = timers.filter(timer => !timer.cleared && timer.dueAt <= now)
    for (const timer of due) { timer.cleared = true; timer.callback() }
    await Promise.all(due.map(() => f.service.service.ownerDeliveryChain.catch(() => {})))
  }
  const { project } = await runningCounter(f)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'bounded delivery failure', origin: { kind: 'user', messageId: 'delivery-failure' } })
  const completed = await f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 2 }])
  assert.equal(completed.status, 'completed')
  await f.service.service.waitForOwnerDeliveryIdle()
  let update = await f.service.service.update(project.projectId)
  assert.equal(update.ownerNotification.state, 'pending_retry')
  assert.equal(update.ownerNotification.attempts, 1)
  assert.equal(followups, 1)
  const firstDue = Date.parse(update.ownerNotification.nextAttemptAt)
  await f.service.service.deliverOwnerOutcomes()
  assert.equal(followups, 1, 'an eager scan cannot bypass nextAttemptAt')
  now = firstDue - 1
  await runDue()
  assert.equal(followups, 1)
  now = firstDue
  await runDue()
  update = await f.service.service.update(project.projectId)
  assert.equal(update.ownerNotification.attempts, 2)
  assert.equal(followups, 2)
  const secondDue = Date.parse(update.ownerNotification.nextAttemptAt)
  now = secondDue
  await runDue()
  update = await f.service.service.update(project.projectId)
  assert.equal(update.ownerNotification.state, 'delivery_exhausted')
  assert.equal(update.ownerNotification.attempts, 3)
  assert.equal(update.ownerNotification.nextAttemptAt, null)
  assert.equal(followups, 3)
  await f.service.service.deliverOwnerOutcomes()
  assert.equal(followups, 3)
  const execution = await f.service.runtime.inspectRun(project.projectId)
  assert.equal(execution.run.status, 'running', 'notification errors do not roll back the published version')
  assert.equal(execution.project.activeVersionId, completed.candidateVersionId)
  await f.service.runtime.stop(project.projectId)
})

test('Cordis effect disposal clears a scheduled owner delivery timer', async t => {
  const timers = []
  const cleared = []
  const f = await fixture(t, {
    setOwnerDeliveryTimer(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer },
    clearOwnerDeliveryTimer(timer) { cleared.push(timer) },
  })
  f.service.service.scheduleOwnerDelivery(5_000)
  assert.equal(timers.length, 1)
  await f.ctx.fiber.dispose()
  assert.deepEqual(cleared, timers)
  assert.equal(f.service.service.ownerDeliveryTimer, null)
})

test('an invalid candidate fails the update while the old healthy run keeps serving its current behavior', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2, { valid: false }) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'bad candidate', origin: { kind: 'user', messageId: 'invalid-candidate' } })
  await assert.rejects(f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 4 }]), /fixture plan failed/)
  const execution = await f.service.runtime.inspectRun(project.projectId)
  assert.equal(execution.run.status, 'running')
  assert.equal((await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })).count, 2, 'the old +1 version remains live')
  assert.equal((await f.service.runtime.getProject(project.projectId)).activeVersionId, execution.run.versionId)
  await f.service.runtime.stop(project.projectId)
})

test('a passing SDK check cannot false-ready a model-required candidate or pause the healthy old run before host grants are checked', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })
  const before = await f.service.runtime.inspectRun(project.projectId)
  const dataPath = join(f.root, 'projects', project.projectId, 'data', 'state.json')
  const dataBefore = await readFile(dataPath)
  const maintenance = f.ctx.sessions.get(project.maintainerSessionId); assert.ok(maintenance); const agent = agentFor(maintenance)
  const sdk = async arguments_ => { const result = await f.ctx.tools.execute({ name: 'mod_sdk', arguments: arguments_, agent, callId: `blocked-complete-${Math.random()}`, signal: new AbortController().signal }); assert.equal(result.isError, false, JSON.stringify(result)); return result.value }
  const manifest = await sdk({ action: 'manifest_read' })
  await sdk({ action: 'manifest_update', manifest: { ...manifest.manifest, manifestVersion: 1, capabilities: { required: ['state.read', 'state.write', 'model.call'] } }, expected_sha256: manifest.sha256 })
  const raw = await f.service.runtime.store.project(project.projectId)
  await f.service.runtime.store.saveProject({ ...raw, host_capability_grants: ['state.read', 'state.write', 'ui.customAsset'] })
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  await f.service.runtime.recordRequirement(project.projectId, { text: 'candidate must gracefully work without the optional model result', sessionId: maintenance.id, origin: { kind: 'user', messageId: 'blocked-complete' } })
  const checked = await sdk({ action: 'check', behavior_checks: [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 2 }] })
  assert.equal(checked.capabilityFacts.capabilityStatus['model.call'], 'declared-not-host-granted')
  const stop = f.service.runtime.stop.bind(f.service.runtime); let stops = 0
  f.service.runtime.stop = async (...args) => { stops += 1; return stop(...args) }
  await assert.rejects(sdk({ action: 'complete' }), /blocked_missing_capabilities/)
  const after = await f.service.runtime.inspectRun(project.projectId)
  assert.equal(stops, 0, 'the host rejects before it stops the healthy old run')
  assert.equal(after.run.runId, before.run.runId)
  assert.equal(after.project.activeVersionId, before.project.activeVersionId)
  assert.deepEqual(await readFile(dataPath), dataBefore)
})

test('a new start that writes partial state then fails restores the checkpointed old version and state', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })
  const broken = {
    'src/main.mjs': `export async function start(api) { if (api.paths.state.includes('validation')) return; await api.state.write({ count: 999, corrupted: true }); throw new Error('new start failed after live state write') }
export async function selfTest(api) { await api.state.write({ count: 0, validation: true }); return { ok: true, assertions: [{ id: 'candidate-project-test', passed: true }] } }
export async function handleUi(api, request) { const state = await api.state.read() || { count: 0 }; if (request.action === 'increment') { const next = { ...state, count: state.count + 1 }; await api.state.write(next); return next } return state }`,
    'ui/index.html': '<main>broken</main>',
  }
  await f.service.runtime.updateWorkspace(project.projectId, { files: broken })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'publish broken candidate', origin: { kind: 'user', messageId: 'rollback-start-failure' } })
  await assert.rejects(f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 1, stateField: 'count', expectedDelta: 1 }]), /new start failed/)
  const execution = await f.service.runtime.inspectRun(project.projectId)
  assert.equal(execution.run.status, 'running')
  assert.ok(execution.runs.some(run => run.status === 'failed' && run.versionId !== execution.run.versionId), 'the candidate reached a real live start, wrote state, and produced a failed run before rollback')
  assert.equal((await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })).count, 2, 'old behavior resumed from checkpointed count=1 rather than partial new state')
  await f.service.runtime.stop(project.projectId)
})

test('only a maintenance session captures a real user message during an entering vendor pre-step and injects one current-turn guide', async t => {
  const f = await fixture(t)
  const { created, project } = await runningCounter(f)
  const userMessage = { id: 'maintainer-real-message', source: { kind: 'user' }, content: [{ type: 'text', text: '每次加 2，按钮写加 2，旧计数保留' }] }
  const ownerDecision = await preStep(f.ctx, f.owner, [userMessage])
  assert.deepEqual(ownerDecision.messages, [userMessage], 'the owner’s normal conversation is unaffected')
  assert.equal((await f.service.runtime.listRequirements(project.projectId)).length, 0)
  const maintenance = f.ctx.sessions.get(created.maintenanceSessionId)
  assert.ok(maintenance)
  let followups = 0
  f.service.service.options.resolveAgent = () => ({ followup() { followups += 1 } })
  const maintenanceAgent = agentFor(maintenance)
  const ignored = await preStep(f.ctx, maintenanceAgent, [userMessage], 'skip')
  assert.deepEqual(ignored.messages, [userMessage])
  assert.equal((await f.service.runtime.listRequirements(project.projectId)).length, 0, 'non-enter decisions do not capture or guide')
  const decision = await preStep(f.ctx, maintenanceAgent, [userMessage])
  assert.equal(decision.messages[0], userMessage)
  const guide = decision.messages.find(message => message.source?.plugin === 'weftmate-mod-projects')
  assert.ok(guide, 'the DSH waterfall receives the guide in the same real pre-step')
  const requirement = (await f.service.runtime.listRequirements(project.projectId))[0]
  assert.deepEqual(requirement.origin, { kind: 'user', messageId: 'maintainer-real-message' })
  assert.equal(followups, 0, 'a real maintenance message is handled in this turn and does not enqueue a second AgentLoop turn')
  maintenance.append('user/message', guide, { surfaceOp: 'append' })
  const replay = await preStep(f.ctx, maintenanceAgent, [userMessage])
  assert.equal(replay.messages.filter(message => message.source?.plugin === 'weftmate-mod-projects').length, 0, 'message id and current guide are both idempotent')
  await f.service.runtime.stop(project.projectId)
})

test('a user stop while rollback data restoration is suspended keeps stopLatch and never restarts the old version', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.invokeUi(project.projectId, { action: 'increment' })
  const oldVersionId = (await f.service.runtime.inspectRun(project.projectId)).run.versionId
  const broken = {
    'src/main.mjs': `export async function start(api) { if (api.paths.state.includes('validation')) return; await api.state.write({ count: 999, corrupted: true }); throw new Error('new start failed after live state write') }
export async function selfTest(api) { await api.state.write({ count: 0, validation: true }); return { ok: true, assertions: [{ id: 'candidate-project-test', passed: true }] } }
export async function handleUi(api, request) { return await api.state.read() }`,
    'ui/index.html': '<main>broken</main>',
  }
  await f.service.runtime.updateWorkspace(project.projectId, { files: broken })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'rollback race', origin: { kind: 'user', messageId: 'rollback-stop-race' } })
  const restore = f.service.runtime.store.restoreData.bind(f.service.runtime.store)
  let entered!: () => void; let release!: () => void
  const enteredRestore = new Promise<void>(resolve => { entered = resolve }); const releaseRestore = new Promise<void>(resolve => { release = resolve })
  f.service.runtime.store.restoreData = async (...args) => { entered(); await releaseRestore; return restore(...args) }
  const updating = f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'inspect', steps: 1, expect: { path: 'result.count', op: 'equals', value: 0 } }])
  await enteredRestore
  await f.service.runtime.stop(project.projectId, { reason: 'user-stop' })
  release()
  await assert.rejects(updating, /new start failed/)
  const after = await f.service.runtime.getProject(project.projectId)
  const execution = await f.service.runtime.inspectRun(project.projectId)
  assert.equal(after.desiredState, 'stopped'); assert.equal(after.stopLatch, true); assert.notEqual(after.activeVersionId, oldVersionId, 'the user-stopped candidate is never silently replaced by a restarted old version')
  assert.equal(execution.run.status, 'failed', 'the failed candidate is recorded; rollback does not revive an old run after a user stop')
  assert.ok(execution.runs.some(run => run.status === 'failed' && run.versionId !== oldVersionId))
})

test('a user stop racing the automatic restart remains stopped and cannot be overwritten by complete_update', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'update then stop', origin: { kind: 'user', messageId: 'stop-wins' } })
  const start = f.service.runtime.start.bind(f.service.runtime)
  let raced = false
  f.service.runtime.start = async (...args) => {
    if (!raced && args[0] === project.projectId) { raced = true; await f.service.runtime.stop(project.projectId, { reason: 'user-stop' }) }
    return start(...args)
  }
  await assert.rejects(f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 4 }]), /explicit user start/)
  const after = await f.service.runtime.getProject(project.projectId)
  assert.equal(after.desiredState, 'stopped'); assert.equal(after.stopLatch, true); assert.equal((await f.service.runtime.inspectRun(project.projectId)).run.status, 'stopped')
})

test('a cancelled maintenance turn after validation cannot switch away from the running version', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  const oldVersionId = (await f.service.runtime.inspectRun(project.projectId)).run.versionId
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const requirement = await f.service.runtime.recordRequirement(project.projectId, { text: 'cancel before publish', origin: { kind: 'user', messageId: 'turn-cancel' } })
  const controller = new AbortController()
  const validate = f.service.runtime.validateVersion.bind(f.service.runtime)
  f.service.runtime.validateVersion = async (...args) => { const value = await validate(...args); controller.abort(new Error('maintenance turn cancelled')); return value }
  await assert.rejects(f.service.service.completeUpdate(project.projectId, requirement.requirementId, [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 4 }], { signal: controller.signal }), /maintenance turn cancelled/)
  const execution = await f.service.runtime.inspectRun(project.projectId)
  assert.equal(execution.run.status, 'running'); assert.equal(execution.run.versionId, oldVersionId)
  await f.service.runtime.stop(project.projectId)
})

test('two complete_update calls for one project serialize their activation work and leave the final version running', async t => {
  const f = await fixture(t)
  const { project } = await runningCounter(f)
  await f.service.runtime.updateWorkspace(project.projectId, { files: counterFiles(2) })
  const first = await f.service.runtime.recordRequirement(project.projectId, { text: 'first update', origin: { kind: 'user', messageId: 'serial-one' } })
  const second = await f.service.runtime.recordRequirement(project.projectId, { text: 'second update', origin: { kind: 'user', messageId: 'serial-two' } })
  const createCandidate = f.service.runtime.createCandidate.bind(f.service.runtime)
  let inCandidate = 0, maxConcurrentCandidates = 0
  f.service.runtime.createCandidate = async (...args) => {
    inCandidate += 1; maxConcurrentCandidates = Math.max(maxConcurrentCandidates, inCandidate)
    await new Promise(resolve => setTimeout(resolve, 20))
    try { return await createCandidate(...args) } finally { inCandidate -= 1 }
  }
  const check = [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 4 }]
  const results = await Promise.all([f.service.service.completeUpdate(project.projectId, first.requirementId, check), f.service.service.completeUpdate(project.projectId, second.requirementId, check)])
  assert.deepEqual(results.map(result => result.status), ['completed', 'completed'])
  assert.equal(maxConcurrentCandidates, 1, 'candidate/activation sections for a project never overlap')
  assert.equal((await f.service.runtime.inspectRun(project.projectId)).run.status, 'running')
  assert.deepEqual((await f.service.runtime.listRequirements(project.projectId)).map(item => item.status).sort(), ['resolved', 'resolved'])
  await f.service.runtime.stop(project.projectId)
})
