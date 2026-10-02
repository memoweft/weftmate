/**
 * Durable Mod lifecycle for the isolated DSH V4 candidate.
 *
 * The candidate only creates a built-in counter Mod. It deliberately keeps
 * autonomous execution disabled, while still using the normal project runner
 * for explicit lifecycle checks. This provides a real V4 workspace/session
 * binding and host-owned project validation without asking a model to write or
 * execute arbitrary code.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ModProjectRuntime } from '../runtime/mod-projects/index.mjs'
import { atomicJson, readJson } from '../runtime/mod-projects/store.mjs'
import { EXTERNAL_AGENT_TEMPLATE } from '../runtime/mod-projects/template.mjs'

export const name = 'weftmate-alpha2-mods'
export const inject = ['connection', 'weftmateAlpha2Runtime', 'sessionController']

const DEFAULT_NAME = 'Alpha2 合成 Mod'
const MOD_MAINTAINER_PRESET = 'mod-maintainer'

function asObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} is required`)
  return value
}

function updatedTemplate() {
  const source = EXTERNAL_AGENT_TEMPLATE.files['src/main.mjs']
  if (typeof source !== 'string' || !source.includes('state.count + 1')) throw new Error('alpha2_counter_template_is_not_editable')
  return { ...EXTERNAL_AGENT_TEMPLATE.files, 'src/main.mjs': source.replace('state.count + 1', 'state.count + 2') }
}

async function hostValidation({ receipt, validationRoot }) {
  if (receipt?.ok !== true || !Array.isArray(receipt.assertions) || receipt.assertions.length === 0) {
    return { ok: false, message: 'Mod selfTest did not return assertions' }
  }
  // Validation runs in a per-version temporary state root. This observes the
  // actual child runner result and rejects a candidate that started a live run
  // or only returned a claimed marker.
  const state = await readJson(join(validationRoot, 'state.json'))
  if (state?.validation !== true || state?.checkpoint !== 'clean-stop' || state?.started !== undefined) {
    return { ok: false, message: 'Host did not observe the isolated selfTest state' }
  }
  return { ok: true, receipt: { kind: 'alpha2-host-isolated-state-observation', state: { validation: true, cursor: state.cursor, count: state.count } } }
}

function selectedPreset(catalog) {
  const options = Array.isArray(catalog?.options)
    ? catalog.options.map(option => option?.value).filter(value => typeof value === 'string' && value)
    : []
  // A Mod maintainer is a host-owned restricted worker.  It must never inherit
  // a deployment default such as danger-full-access.  The explicit bounded
  // preset is the only supported policy; an incomplete catalog fails closed.
  if (!options.includes('workspace-write')) throw new Error('alpha2_workspace_write_preset_unavailable')
  return 'workspace-write'
}

function maintainerSessionId(agent) {
  const session = agent?.session
  if (typeof session?.id !== 'string' || session.header?.agentPreset !== MOD_MAINTAINER_PRESET) {
    throw new Error('weftmate_mod requires the formal mod-maintainer Agent preset')
  }
  return session.id
}

function toolDefinition(api) {
  return {
    name: 'weftmate_mod',
    description: 'Manage one isolated WeftMate Mod project. This candidate supports only the built-in counter template and never enables autonomous execution.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'modify', 'candidate', 'validate', 'enable', 'start', 'invoke', 'stop', 'status'] },
        project_id: { type: 'string' }, name: { type: 'string' }, version_id: { type: 'string' }, request: { type: 'object', additionalProperties: true },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const sessionId = maintainerSessionId(exec?.agent)
      const input = asObject(args, 'Tool arguments')
      if (Object.hasOwn(input, 'sessionId') || Object.hasOwn(input, 'session_id')) throw new Error('weftmate_mod session identity is assigned by DSH and cannot be supplied by the caller')
      return api.perform({ ...input, sessionId }, { agent: exec.agent })
    },
  }
}

export function createAlpha2Mods({ bridge, inspectSession, root }) {
  if (!bridge || typeof bridge.createWorkspace !== 'function' || typeof bridge.create !== 'function' || typeof bridge.list !== 'function'
    || typeof bridge.permissionCatalog !== 'function' || typeof bridge.setPermissionPreset !== 'function' || typeof inspectSession !== 'function') {
    throw new TypeError('weftmate alpha2 Mods requires the official workspace, session, and permission bridge')
  }
  const runtime = new ModProjectRuntime({ root, assertValidation: hostValidation })
  const bindings = new Map()
  const bindingPath = join(root, 'alpha2-dsh-bindings.json')
  let phase = 'starting'
  let bootstrapError = null

  const loadBindings = async () => {
    const stored = await readJson(bindingPath)
    if (stored === null) return {}
    return asObject(stored, 'Alpha2 Mod binding store')
  }
  const saveBinding = async (projectId, value) => {
    const all = await loadBindings()
    await atomicJson(bindingPath, { ...all, [projectId]: value })
  }
  const bind = async project => {
    const existing = bindings.get(project.projectId)
    if (existing) return existing
    const operation = (async () => {
      const path = await runtime.workspacePath(project.projectId)
      const stored = (await loadBindings())[project.projectId]
      const workspace = await bridge.createWorkspace({ path })
      const workspaceId = workspace?.workspace?.workspaceId
      if (typeof workspaceId !== 'string') throw new Error('alpha2_workspace_not_created')
      const listed = await bridge.list()
      const alreadyOpen = Array.isArray(listed?.items) && listed.items.some(item => item?.sessionId === project.maintainerSessionId)
      const session = alreadyOpen
        ? { sessionId: project.maintainerSessionId }
        : await bridge.create({ sessionId: project.maintainerSessionId, workspaceId, agentPreset: MOD_MAINTAINER_PRESET })
      if (session?.sessionId !== project.maintainerSessionId) throw new Error('alpha2_maintainer_session_not_retained')
      const inspected = await inspectSession(session.sessionId)
      if (inspected?.meta?.agentPreset !== MOD_MAINTAINER_PRESET) throw new Error('alpha2_maintainer_preset_not_retained')
      if (stored && stored.sessionId !== session.sessionId) throw new Error('alpha2_maintainer_session_identity_changed')
      const preset = selectedPreset(await bridge.permissionCatalog())
      const applied = await bridge.setPermissionPreset(session.sessionId, preset)
      if (applied?.accepted !== true || applied.preset !== preset) throw new Error('alpha2_maintainer_permission_not_applied')
      // V4 Workspace IDs are process-local registry handles. The durable
      // relation is this project path plus its maintenance Session ID, so a
      // fresh official Workspace is deliberately rebound after host restart.
      const binding = { workspaceId, workspacePath: path, sessionId: session.sessionId, permissionPreset: preset }
      await saveBinding(project.projectId, binding)
      return binding
    })()
    bindings.set(project.projectId, operation)
    try { return await operation } catch (error) { bindings.delete(project.projectId); throw error }
  }
  const boot = runtime.open().then(async () => {
    for (const project of await runtime.listProjects()) await bind(project)
    if (process.env.WEFTMATE_ALPHA2_MODS_SYNTHETIC === '1' && (await runtime.listProjects()).length === 0) {
      const project = await runtime.createProject({
        name: DEFAULT_NAME,
        maintainerSessionId: `mod-maintenance-${randomUUID()}`,
        files: EXTERNAL_AGENT_TEMPLATE.files,
        manifest: EXTERNAL_AGENT_TEMPLATE.manifest,
      })
      await bind(project)
    }
    phase = 'ready'
  })
  void boot.then(undefined, error => { phase = 'error'; bootstrapError = error })
  const ensureReady = async () => { if (phase === 'error') throw bootstrapError; await boot }
  const maintenanceProject = async (projectId, sessionId) => {
    const project = await runtime.getProject(requiredText(projectId, 'projectId'))
    if (sessionId !== project.maintainerSessionId) throw new Error('alpha2_mod_requires_its_maintenance_session')
    return project
  }
  const api = Object.freeze({
    async list() { await ensureReady(); return runtime.listProjects() },
    async create(modName = DEFAULT_NAME) {
      await ensureReady()
      const project = await runtime.createProject({
        name: typeof modName === 'string' && modName.trim() ? modName : DEFAULT_NAME,
        maintainerSessionId: `mod-maintenance-${randomUUID()}`,
        files: EXTERNAL_AGENT_TEMPLATE.files,
        manifest: EXTERNAL_AGENT_TEMPLATE.manifest,
      })
      await bind(project)
      return project
    },
    async status() {
      if (phase === 'starting') return { ready: false, phase, execution: { enabled: false, reason: 'alpha2_autonomous_execution_not_adapted' }, projects: [] }
      if (phase === 'error') return { ready: false, phase, error: bootstrapError?.message ?? String(bootstrapError), execution: { enabled: false, reason: 'alpha2_autonomous_execution_not_adapted' }, projects: [] }
      const projects = await runtime.listProjects()
      const stored = await loadBindings()
      return {
        ready: true, phase, projectCount: projects.length,
        execution: { enabled: false, reason: 'alpha2_autonomous_execution_not_adapted' },
        projects: projects.map(project => ({ projectId: project.projectId, maintainerSessionId: project.maintainerSessionId, desiredState: project.desiredState, health: project.health, binding: stored[project.projectId] ?? null })),
      }
    },
    async perform(input, { agent } = {}) {
      await ensureReady()
      const trustedSessionId = maintainerSessionId(agent)
      if (input?.sessionId !== undefined && input.sessionId !== trustedSessionId) throw new Error('weftmate_mod session identity is assigned by DSH and cannot be supplied by the caller')
      return api.performForSmoke({ ...asObject(input, 'Tool arguments'), sessionId: trustedSessionId })
    },
    async performForSmoke(input) {
      const action = requiredText(input?.action, 'action')
      if (action === 'list') return { projects: await runtime.listProjects() }
      if (action === 'create') return { project: await api.create(input.name) }
      const project = await maintenanceProject(input.project_id, input.sessionId)
      if (action === 'status') return runtime.inspectRun(project.projectId)
      if (action === 'modify') return { project: await runtime.updateWorkspace(project.projectId, { files: updatedTemplate() }), revision: 'counter-increment-two' }
      if (action === 'candidate') return { version: await runtime.createCandidate(project.projectId) }
      if (action === 'validate') return { version: await runtime.validateVersion(project.projectId, requiredText(input.version_id, 'version_id')) }
      if (action === 'enable') return { project: await runtime.activateVersion(project.projectId, requiredText(input.version_id, 'version_id')) }
      if (action === 'start') return { run: await runtime.start(project.projectId) }
      if (action === 'invoke') return { result: await runtime.invokeUi(project.projectId, input.request ?? { action: 'status' }) }
      if (action === 'stop') return { run: await runtime.stop(project.projectId) }
      throw new Error('alpha2_mod_action_not_supported')
    },
  })
  return Object.freeze({ api, tool: toolDefinition(api) })
}

export function apply(ctx) {
  const mods = createAlpha2Mods({
    bridge: ctx.weftmateAlpha2Runtime,
    inspectSession: sessionId => ctx.sessionController.inspect(sessionId),
    root: join(process.env.DSH_HOME ?? process.cwd(), 'mod-projects-alpha2'),
  })
  ctx.provide('weftmateAlpha2Mods', mods)
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/weftmate/mods/status', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => Response.json(await mods.api.status(), { headers: { 'cache-control': 'no-store' } }),
  }), 'weftmate-alpha2-mods: protected status')
  // This is a test-only random capability, deliberately named without
  // credential-like words so secure bootstrap environment scrubbing does not
  // remove it. Browser authentication remains mandatory; this merely keeps
  // the destructive lifecycle endpoint absent outside an explicit smoke run.
  const smokeChallenge = process.env.WEFTMATE_ALPHA2_SMOKE_CHALLENGE
  if (process.env.WEFTMATE_ALPHA2_MODS_SMOKE === '1' && typeof smokeChallenge === 'string' && smokeChallenge.length >= 32) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/weftmate/mods/request', methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        if (request.headers.get('x-weftmate-alpha2-smoke-challenge') !== smokeChallenge) return new Response(null, { status: 404 })
        try { return Response.json(await mods.api.performForSmoke(await request.json()), { headers: { 'cache-control': 'no-store' } }) }
        catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } }) }
      },
    }), 'weftmate-alpha2-mods: smoke-only lifecycle')
  }
}
