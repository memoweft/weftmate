/**
 * Durable, project-scoped Mod execution.  It is an isolation boundary for
 * ordinary cooperative code, not a security sandbox for hostile code.
 */
import { createHash, randomUUID } from 'node:crypto'
import { fork } from 'node:child_process'
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { safeRelative } from './store.mjs'
import { fileURLToPath } from 'node:url'
import { ModProjectStore, atomicJson, id, now, readJson } from './store.mjs'
import { validateSourceTree } from './validate.mjs'

const runner = join(dirname(fileURLToPath(import.meta.url)), 'child-runner.mjs')
const defaultManifest = { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', stateSchemaVersion: 1, ui: { assets: 'ui' } }
const terminal = new Set(['stopped', 'failed', 'interrupted', 'completed'])
const knownCapabilities = new Set(['ui.customAsset', 'ui.shared', 'memory.read', 'memory.write', 'model.call', 'state.read', 'state.write', 'dependencies.install'])
function hasManifestCapability(project, manifest, capability) {
  // Legacy manifests predate declared grants and retain their existing runtime
  // behaviour. New versioned manifests must request each bridge capability.
  if (manifest?.manifestVersion !== 1) return true
  const declared = [...(manifest.capabilities?.required ?? []), ...(manifest.capabilities?.optional ?? [])]
  return declared.includes(capability) && Array.isArray(project.host_capability_grants) && project.host_capability_grants.includes(capability)
}
function normalizeHostCapabilityGrants(value, manifest) {
  if (manifest?.manifestVersion !== 1) return []
  const grants = value ?? ['state.read', 'state.write', 'ui.customAsset']
  if (!Array.isArray(grants) || grants.some(capability => typeof capability !== 'string' || !knownCapabilities.has(capability))) throw new Error('Host capability grants must contain only known capability ids')
  return [...new Set(grants)]
}
function requiredCapabilities(manifest) { return manifest?.manifestVersion === 1 ? [...new Set(manifest.capabilities?.required ?? [])] : [] }
function runtimeCapabilityAvailability(runtime, capability, mode = 'run') {
  if (capability === 'state.read' || capability === 'state.write' || capability === 'ui.customAsset') return true
  if (capability === 'model.call') return mode === 'validate' ? typeof runtime.validationModel === 'function' : typeof runtime.model === 'function'
  return false
}
function blockedCapabilities(runtime, project, manifest = project.manifest, mode = 'run') {
  const grants = new Set(project.host_capability_grants ?? [])
  return requiredCapabilities(manifest).filter(capability => !grants.has(capability) || !runtimeCapabilityAvailability(runtime, capability, mode))
}
function blockedCapabilityError(runtime, project, manifest = project.manifest, mode = 'run') {
  const unavailable = blockedCapabilities(runtime, project, manifest, mode)
  if (!unavailable.length) return null
  const error = new Error(JSON.stringify({ code: 'blocked_missing_capabilities', required: requiredCapabilities(manifest), unavailable, scope: mode === 'validate' ? 'isolated-behavior' : 'host-runtime' }))
  error.code = 'blocked_missing_capabilities'; error.required = requiredCapabilities(manifest); error.unavailable = unavailable
  return error
}

function publicProject(project) {
  if (!project) return null
  const { project_id: projectId, maintainer_session_id: maintainerSessionId, active_version_id: activeVersionId,
    desired_state: desiredState, control_revision: controlRevision, stop_latch: stopLatch, stop_reason: stopReason, health, ...rest } = project
  return { projectId, maintainerSessionId, activeVersionId, desiredState, controlRevision, stopLatch, stopReason, health, ...rest }
}
function publicVersion(version) {
  const { version_id: versionId, project_id: projectId, source_digest: sourceDigest, validation_digest: validationDigest, validation_receipt: validationReceipt, validation_error: validationError, ...rest } = version
  return { versionId, projectId, sourceDigest, validationDigest, ...(validationReceipt === undefined ? {} : { validationReceipt }), ...(validationError === undefined ? {} : { validationError }), ...rest }
}
function publicRun(run) {
  const { run_id: runId, project_id: projectId, version_id: versionId, control_revision: controlRevision, ...rest } = run
  return { runId, projectId, versionId, controlRevision, ...rest }
}
function serial(error) { return { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null } }
function failureDigest(phase, error) { return createHash('sha256').update(`${phase}\n${error?.name ?? 'Error'}\n${error?.message ?? String(error)}\n${error?.stack ?? ''}`).digest('hex') }
function requireProject(project) { if (!project) throw new Error('Mod project not found'); return project }
const BEHAVIOR_CHECK_PATH_MAX_SEGMENTS = 8
const BEHAVIOR_CHECK_PATH_MAX_INDEX = 999_999
const behaviorCheckPathReserved = new Set(['__proto__', 'prototype', 'constructor'])
const behaviorCheckPathIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const behaviorCheckPathIndex = /^(?:0|[1-9][0-9]*)$/
function isBehaviorCheckPath(path) {
  if (typeof path !== 'string' || !path || path.length > 512) return false
  const segments = path.split('.')
  return segments.length <= BEHAVIOR_CHECK_PATH_MAX_SEGMENTS && segments.every(segment => {
    if (behaviorCheckPathReserved.has(segment)) return false
    if (behaviorCheckPathIdentifier.test(segment)) return true
    return behaviorCheckPathIndex.test(segment) && Number(segment) <= BEHAVIOR_CHECK_PATH_MAX_INDEX
  })
}
function normalizeBehaviorChecks(value) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) throw new Error('behaviorChecks must be a non-empty array of at most eight explicit checks')
  return value.map((check, index) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) throw new Error(`behaviorChecks[${index}] must be an object`)
    const action = check.action
    const steps = check.steps
    const stateField = check.stateField
    const expectedDelta = check.expectedDelta
    if (typeof action !== 'string' || !action || action.length > 128) throw new Error(`behaviorChecks[${index}].action must be a non-empty string`)
    if (!Number.isInteger(steps) || steps < 1 || steps > 32) throw new Error(`behaviorChecks[${index}].steps must be an integer from 1 to 32`)
    if (check.payload !== undefined && (!check.payload || typeof check.payload !== 'object' || Array.isArray(check.payload) || Buffer.byteLength(JSON.stringify(check.payload)) > 16 * 1024)) throw new Error(`behaviorChecks[${index}].payload must be a bounded JSON object`)
    if (check.expect !== undefined) {
      const expect = check.expect
      if (!expect || typeof expect !== 'object' || Array.isArray(expect) || !isBehaviorCheckPath(expect.path) || !['equals', 'contains'].includes(expect.op) || !Object.hasOwn(expect, 'value') || Buffer.byteLength(JSON.stringify(expect.value)) > 8 * 1024) throw new Error(`behaviorChecks[${index}].expect must be a bounded path assertion`)
      if (expect.op === 'contains' && typeof expect.value === 'string' && expect.value.length === 0) throw new Error(`behaviorChecks[${index}].expect contains cannot use an empty string`)
      return { action, steps, ...(check.payload === undefined ? {} : { payload: structuredClone(check.payload) }), expect: structuredClone(expect) }
    }
    if (typeof stateField !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(stateField)) throw new Error(`behaviorChecks[${index}].stateField must be a simple state field name`)
    if (!Number.isFinite(expectedDelta)) throw new Error(`behaviorChecks[${index}].expectedDelta must be a finite number`)
    return { action, steps, stateField, expectedDelta }
  })
}

export class ModProjectRuntime {
  constructor({ root, model = null, validationModel = null, emit = null, assertValidation = null, stopTimeoutMs = 1500, validationTimeoutMs = 5000 } = {}) {
    if (typeof root !== 'string' || !root) throw new Error('A durable Mod project root is required')
    this.store = new ModProjectStore(root)
    this.model = model
    this.validationModel = validationModel
    this.emit = emit
    this.assertValidation = assertValidation
    this.stopTimeoutMs = stopTimeoutMs
    this.validationTimeoutMs = validationTimeoutMs
    this.active = new Map()
    this.operations = new Map()
    this.failureOps = new Map()
  }

  async open() {
    await this.store.initialize()
    for (const projectId of await this.store.projectIds()) {
      const project = await this.store.project(projectId)
      if (!project) continue
      let changed = false
      for (const run of await this.store.runs(projectId)) {
        if (!terminal.has(run.status)) {
          await this.store.saveRun(projectId, { ...run, status: 'interrupted', health: 'needs-review', ended_at: now(), error: { message: 'Host restarted; the Mod was not replayed because its effects may be unknown.' } })
          changed = true
        }
      }
      // A workspace manifest may be an un-published draft.  Recovery must
      // judge only the active snapshot that could otherwise be restarted.
      const activeVersion = project.active_version_id ? await this.store.version(projectId, project.active_version_id) : null
      const blocked = activeVersion ? blockedCapabilityError(this, project, activeVersion.manifest) : null
      if (blocked) {
        await this.store.saveProject({ ...project, desired_state: 'stopped', stop_reason: 'blocked_missing_capabilities', health: 'blocked', updated_at: now() })
        continue
      }
      if (changed) await this.store.saveProject({ ...project, desired_state: 'stopped', stop_reason: 'host-restarted', health: 'needs-review', updated_at: now() })
    }
    return this
  }

  async createProject({ name, maintainerSessionId, files, manifest = defaultManifest, hostCapabilityGrants = undefined, maintenancePreset = undefined, maintenanceBinding = undefined, maintenanceChannelVersion = undefined }) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('A project name is required')
    if (typeof maintainerSessionId !== 'string' || !maintainerSessionId) throw new Error('A maintainerSessionId is required')
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Project files are required')
    if (maintenancePreset !== undefined && (typeof maintenancePreset !== 'string' || !maintenancePreset)) throw new Error('Host maintenance preset must be a non-empty string when provided')
    if (maintenanceBinding !== undefined && (typeof maintenanceBinding !== 'string' || !maintenanceBinding)) throw new Error('Host maintenance binding must be a non-empty string when provided')
    if (maintenanceChannelVersion !== undefined && (!Number.isSafeInteger(maintenanceChannelVersion) || maintenanceChannelVersion < 1)) throw new Error('Host maintenance channel version must be a positive safe integer when provided')
    if ((maintenancePreset === undefined) !== (maintenanceBinding === undefined)) throw new Error('Host maintenance preset and binding must be supplied together')
    const projectId = `mod-${randomUUID()}`
    const project = {
      project_id: projectId, name: name.trim(), maintainer_session_id: maintainerSessionId,
      active_version_id: null, desired_state: 'stopped', control_revision: 0, stop_latch: false, stop_reason: null, health: 'idle',
      created_at: now(), updated_at: now(), manifest: { ...defaultManifest, ...manifest },
      ...(maintenancePreset === undefined ? {} : { maintenance_preset: maintenancePreset, maintenance_binding: maintenanceBinding, maintenance_channel_version: maintenanceChannelVersion }),
      // This field is host-owned.  Source and manifest editing may request a
      // capability, but can never mint a runtime grant for it.
      host_capability_grants: normalizeHostCapabilityGrants(hostCapabilityGrants, manifest), workspace_revision: 1,
    }
    await this.store.createProject(project)
    await this.store.writeWorkspace(projectId, files)
    return publicProject(project)
  }

  async getProject(projectId) { return publicProject(requireProject(await this.store.project(projectId))) }
  async listProjects() { return (await Promise.all((await this.store.projectIds()).map(projectId => this.getProject(projectId)))).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }
  async listVersions(projectId) { requireProject(await this.store.project(projectId)); return (await this.store.versions(projectId)).map(publicVersion) }
  async workspacePath(projectId) { requireProject(await this.store.project(projectId)); return this.store.workspace(projectId) }
  async updateWorkspace(projectId, { files, manifest } = {}) {
    const project = requireProject(await this.store.project(projectId))
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Workspace files are required')
    const updated = { ...project, manifest: manifest ? { ...defaultManifest, ...manifest } : project.manifest, workspace_revision: project.workspace_revision + 1, updated_at: now() }
    await this.store.writeWorkspace(projectId, files)
    await this.store.saveProject(updated)
    return publicProject(updated)
  }
  async updateManifest(projectId, manifest, { expectedManifestSha256 = null } = {}) {
    const project = requireProject(await this.store.project(projectId))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifest must be an object')
    const current = JSON.stringify(project.manifest)
    const hash = createHash('sha256').update(current).digest('hex')
    if (typeof expectedManifestSha256 !== 'string' || expectedManifestSha256 !== hash) throw new Error('Manifest update rejected because its hash changed; read it again before editing')
    const forbidden = ['hostCapabilityGrants', 'host_capability_grants', 'grants', 'maintainerSessionId', 'maintainer_session_id', 'root', 'projectId', 'project_id']
    if (forbidden.some(key => Object.hasOwn(manifest, key))) throw new Error('Manifest cannot modify host grants, maintainer binding, project root, or project identity')
    const allowed = new Set(['entry', 'state', 'validate', 'stateSchemaVersion', 'manifestVersion', 'capabilities', 'ui', 'behaviorChecks'])
    if (Object.keys(manifest).some(key => !allowed.has(key))) throw new Error('Manifest contains a field that is not supported by the Mod SDK')
    const nextManifest = { ...defaultManifest, ...structuredClone(manifest) }
    if (project.manifest?.manifestVersion === 1 && nextManifest.manifestVersion !== 1) throw new Error('A versioned Mod manifest cannot be downgraded to the legacy capability mode')
    await validateSourceTree(this.store.workspace(projectId), nextManifest)
    const updated = { ...project, manifest: nextManifest, workspace_revision: project.workspace_revision + 1, updated_at: now() }
    await this.store.saveProject(updated)
    return publicProject(updated)
  }
  async createCandidate(projectId, { behaviorChecks = undefined } = {}) {
    const project = requireProject(await this.store.project(projectId))
    const checks = normalizeBehaviorChecks(behaviorChecks === undefined ? project.manifest?.behaviorChecks : behaviorChecks)
    const manifest = { ...project.manifest, ...(checks ? { behaviorChecks: checks } : {}) }
    if (!checks) delete manifest.behaviorChecks
    const version = { version_id: `version-${randomUUID()}`, project_id: projectId, status: 'candidate', manifest, source_digest: null, validation_digest: null, created_at: now(), validated_at: null }
    await this.store.snapshot(projectId, version)
    const inspected = await validateSourceTree(this.store.source(projectId, version.version_id), version.manifest)
    version.source_digest = inspected.digest
    await this.store.saveVersion(projectId, version)
    return publicVersion(version)
  }
  async importProject(directory, { name, maintainerSessionId, manifest = defaultManifest } = {}) {
    if (typeof directory !== 'string' || !directory) throw new Error('An import directory is required')
    const root = resolve(directory)
    const rootInfo = await lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Import directory must be an ordinary directory')
    const files = {}
    let count = 0; let bytes = 0
    const excluded = new Set(['.git', 'node_modules', 'build', 'runtime', 'data', '.env', '.npmrc', 'credentials', 'secrets'])
    async function walk(folder) {
      for (const item of await readdir(folder, { withFileTypes: true })) {
        if (excluded.has(item.name.toLowerCase())) continue
        const path = join(folder, item.name); const info = await lstat(path)
        if (info.isSymbolicLink()) throw new Error(`Import contains a symbolic link or reparse point: ${item.name}`)
        if (info.isDirectory()) await walk(path)
        else if (info.isFile()) {
          if (++count > 500 || info.size > 1024 * 1024 || (bytes += info.size) > 10 * 1024 * 1024) throw new Error('Import exceeds Mod project file limits')
          const name = relative(root, path).replaceAll('\\', '/')
          files[name] = await readFile(path)
        } else throw new Error(`Import contains a non-ordinary file: ${item.name}`)
      }
    }
    await walk(root)
    return this.createProject({ name: name ?? root.split(/[\\/]/).at(-1), maintainerSessionId, files, manifest })
  }
  async validateVersion(projectId, versionId) {
    const project = requireProject(await this.store.project(projectId))
    let version = await this.store.version(projectId, versionId)
    if (!version) throw new Error('Mod version not found')
    const source = this.store.source(projectId, versionId)
    let inspected
    try { inspected = await validateSourceTree(source, version.manifest) } catch (error) {
      version = { ...version, status: 'validation_failed', validation_error: serial(error), validation_digest: null, validated_at: now() }
      await this.store.saveVersion(projectId, version)
      throw error
    }
    const validationRoot = join(this.store.projectRoot(projectId), 'validation', versionId, randomUUID())
    await mkdir(validationRoot, { recursive: true })
    try {
      const activeReceipt = await this.#execute(project, { ...version, source_digest: inspected.digest }, { mode: 'validate', stateRoot: validationRoot, timeoutMs: this.validationTimeoutMs })
      await this.#assertValidation(project, version, activeReceipt, validationRoot)
      const after = await validateSourceTree(source, version.manifest)
      if (after.digest !== inspected.digest) throw new Error('Version source changed while it was being validated')
      version = { ...version, status: 'validated', source_digest: after.digest, validation_digest: after.digest, validation_receipt: activeReceipt, validated_at: now(), validation_error: null }
      await this.store.saveVersion(projectId, version)
      return publicVersion(version)
    } catch (error) {
      version = { ...version, status: 'validation_failed', source_digest: inspected.digest, validation_digest: null, validation_error: serial(error), validated_at: now() }
      await this.store.saveVersion(projectId, version)
      throw error
    }
  }
  async activateVersion(projectId, versionId) { return this.#exclusive(projectId, () => this.#activateVersion(projectId, versionId)) }
  async assertRunnableCapabilities(projectId, versionId) {
    const project = requireProject(await this.store.project(projectId)); const version = await this.store.version(projectId, versionId)
    if (!version) throw new Error('Mod version not found')
    const blocked = blockedCapabilityError(this, project, version.manifest)
    if (blocked) throw blocked
    return { required: requiredCapabilities(version?.manifest), unavailable: [] }
  }
  async #activateVersion(projectId, versionId) {
    let project = requireProject(await this.store.project(projectId))
    const version = await this.store.version(projectId, versionId)
    const blocked = blockedCapabilityError(this, project, version?.manifest)
    if (blocked) throw blocked
    if (!version || !['validated', 'selected', 'active'].includes(version.status) || !version.validation_receipt?.assertions?.length || !version.validation_receipt?.host_oracle) throw new Error('Only a version with a host-validated selfTest receipt may be activated')
    const inspected = await validateSourceTree(this.store.source(projectId, versionId), version.manifest)
    if (inspected.digest !== version.validation_digest || inspected.digest !== version.source_digest) throw new Error('Validated source digest no longer matches; validate the version again')
    const previous = project.active_version_id ? await this.store.version(projectId, project.active_version_id) : null
    if (this.active.has(projectId)) throw new Error('Stop the current Mod run before activating a different version')
    if (previous && previous.manifest?.stateSchemaVersion !== version.manifest?.stateSchemaVersion) throw new Error('State schema migration is not implemented; candidate must retain the active stateSchemaVersion')
    project = { ...project, active_version_id: versionId, manifest: version.manifest, health: 'selected', updated_at: now() }
    await this.store.saveProject(project)
    await this.store.saveVersion(projectId, { ...version, status: 'selected', selected_at: now(), activation_receipt: null })
    return publicProject(project)
  }

  async start(projectId, options = {}) { return this.#exclusive(projectId, () => this.#start(projectId, options)) }
  async #start(projectId, { versionId = null, userInitiated = false } = {}) {
    let project = requireProject(await this.store.project(projectId))
    const selected = versionId ?? project.active_version_id
    if (project.stop_latch === true && userInitiated !== true) throw new Error('This Mod remains stopped by the user; only an explicit user start may clear the stop latch')
    if (!selected || selected !== project.active_version_id) throw new Error('Start requires the project active version')
    const version = await this.store.version(projectId, selected)
    const blocked = blockedCapabilityError(this, project, version?.manifest)
    if (blocked) {
      await this.store.saveProject({ ...project, desired_state: 'stopped', stop_reason: 'blocked_missing_capabilities', health: 'blocked', updated_at: now() })
      throw blocked
    }
    if (!version || version.validation_digest !== version.source_digest) throw new Error('The active Mod version has not been validated')
    const inspected = await validateSourceTree(this.store.source(projectId, selected), version.manifest)
    if (inspected.digest !== version.validation_digest) throw new Error('Validated source digest no longer matches; validate and activate again')
    const previous = this.active.get(projectId)
    if (previous) throw new Error('The Mod project is already running')
    const controlRevision = project.control_revision + 1
    project = { ...project, desired_state: 'running', control_revision: controlRevision, stop_latch: false, stop_reason: null, health: 'starting', updated_at: now() }
    await this.store.saveProject(project)
    const run = { run_id: `run-${randomUUID()}`, project_id: projectId, version_id: selected, source_digest: version.source_digest, status: 'starting', health: 'starting', control_revision: controlRevision, started_at: now(), ended_at: null, error: null }
    await this.store.saveRun(projectId, run)
    const active = await this.#spawn(project, version, run, { mode: 'run', stateRoot: this.store.data(projectId) })
    this.active.set(projectId, active)
    try {
      await active.started
      const stored = await this.store.run(projectId, run.run_id)
      if (stored?.status === 'starting') await this.store.saveRun(projectId, { ...stored, status: 'running', health: 'healthy' })
      await this.store.saveVersion(projectId, { ...version, status: 'active', activated_at: now(), activation_receipt: { project_id: projectId, version_id: selected, source_digest: version.source_digest, run_id: run.run_id, control_revision: controlRevision, health: 'healthy', created_at: now() } })
      const current = await this.store.project(projectId)
      if (current?.control_revision === controlRevision && current.desired_state === 'running') await this.store.saveProject({ ...current, health: 'healthy', updated_at: now() })
      return publicRun(await this.store.run(projectId, run.run_id))
    } catch (error) {
      await this.#fail(project, version, run, 'start', error)
      throw error
    }
  }
  // Stop is intentionally not queued behind start: it is the synchronous
  // admission barrier for a start that is currently waiting on a model call.
  async stop(projectId, options = {}) { return this.#stop(projectId, options) }
  async #stop(projectId, { runId = null, expectedControlRevision = null, reason = 'user-stop' } = {}) {
    let project = requireProject(await this.store.project(projectId))
    const active = this.active.get(projectId)
    const currentRunId = active?.run.run_id ?? runId
    if (runId && active && runId !== active.run.run_id) throw new Error('The supplied runId is not the current run')
    if (expectedControlRevision !== null && expectedControlRevision !== project.control_revision) throw new Error('The supplied control revision is stale')
    // Durable intent is written before signalling the child.  All later
    // child/model messages carry the old control revision and are discarded.
    if (active) active.accepting = false
    project = { ...project, desired_state: 'stopped', control_revision: project.control_revision + 1, stop_latch: reason === 'user-stop' || project.stop_latch === true, stop_reason: reason, health: 'stopping', updated_at: now() }
    await this.store.saveProject(project)
    if (!currentRunId) return publicProject({ ...project, health: 'stopped' })
    const run = await this.store.run(projectId, currentRunId)
    if (run && !terminal.has(run.status)) await this.store.saveRun(projectId, { ...run, status: 'stopping', health: 'stopping' })
    if (active) await this.#stopActive(active, 'user-stop')
    const latest = await this.store.run(projectId, currentRunId)
    if (latest && !terminal.has(latest.status)) await this.store.saveRun(projectId, { ...latest, status: 'stopped', health: 'stopped', ended_at: now() })
    const latestProject = await this.store.project(projectId)
    if (latestProject?.desired_state === 'stopped') await this.store.saveProject({ ...latestProject, health: latest?.status === 'interrupted' ? 'needs-review' : 'stopped', updated_at: now() })
    return publicRun(await this.store.run(projectId, currentRunId))
  }
  async restart(projectId, { userInitiated = false } = {}) { await this.stop(projectId); return this.start(projectId, { userInitiated }) }
  async resume(projectId, { userInitiated = false } = {}) { return this.start(projectId, { userInitiated }) }
  async inspectRun(projectId) {
    const project = requireProject(await this.store.project(projectId))
    const runs = await this.store.runs(projectId)
    const version = project.active_version_id ? await this.store.version(projectId, project.active_version_id) : null
    return { project: publicProject(project), run: runs[0] ? publicRun(runs[0]) : null, runs: runs.map(publicRun), activation: version?.activation_receipt ?? null }
  }
  async recordRequirement(projectId, { text, sessionId = null, origin = null, notify = true } = {}) {
    const project = requireProject(await this.store.project(projectId))
    if (typeof text !== 'string' || !text.trim()) throw new Error('Requirement text is required')
    const requirement = { requirement_id: `requirement-${randomUUID()}`, project_id: projectId, text: text.trim(), session_id: sessionId ?? project.maintainer_session_id, origin: origin && typeof origin === 'object' ? structuredClone(origin) : null, version_id: project.active_version_id, created_at: now(), status: 'open' }
    await this.store.saveRequirement(projectId, requirement)
    if (notify) await this.#emit({ type: 'mod.requirement', projectId, versionId: project.active_version_id, payload: requirement })
    return { requirementId: requirement.requirement_id, projectId, text: requirement.text, sessionId: requirement.session_id, versionId: requirement.version_id, status: requirement.status }
  }
  async listRequirements(projectId, { status = null } = {}) {
    requireProject(await this.store.project(projectId))
    const root = this.store.requirementsRoot(projectId)
    const names = (await readdir(root).catch(() => [])).filter(name => name.endsWith('.json'))
    const values = await Promise.all(names.map(name => readJson(join(root, name))))
    return values.filter(Boolean).filter(item => !status || item.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(item => ({ ...item, requirementId: item.requirement_id, projectId: item.project_id, sessionId: item.session_id, versionId: item.version_id }))
  }
  async claimRequirement(projectId, requirementId, consumerId) { return this.#transitionRequirement(projectId, requirementId, consumerId, 'claimed') }
  async resolveRequirement(projectId, requirementId, consumerId, { versionId } = {}) {
    const receipts = await this.#storedResolutionReceipts(projectId, versionId)
    return this.#transitionRequirement(projectId, requirementId, consumerId, 'resolved', { version_id: versionId, ...receipts })
  }
  async describeUi(projectId) {
    const project = requireProject(await this.store.project(projectId))
    const version = project.active_version_id ? await this.store.version(projectId, project.active_version_id) : null
    return { project: publicProject(project), version: version ? publicVersion(version) : null, assetsRoot: version?.manifest?.ui?.assets ?? null, running: this.active.has(projectId) }
  }
  async readUiAsset(projectId, assetPath, { versionId = null } = {}) {
    const project = requireProject(await this.store.project(projectId)); const selected = versionId ?? project.active_version_id
    if (!selected) throw new Error('No Mod version is active')
    const version = await this.store.version(projectId, selected); const root = version?.manifest?.ui?.assets
    if (!version || typeof root !== 'string') throw new Error('This Mod has no declared UI asset directory')
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(assetPath) || assetPath.includes('..') || assetPath.startsWith('/')) throw new Error('Unsafe UI asset path')
    const allowed = safeRelative(this.store.source(projectId, selected), root)
    const asset = safeRelative(allowed, assetPath)
    if (relative(allowed, asset).startsWith('..')) throw new Error('UI asset escapes its declared directory')
    const info = await lstat(asset); if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('UI asset is not an allowed ordinary file')
    return { path: assetPath, bytes: await readFile(asset), mimeType: mime(assetPath) }
  }
  async invokeUi(projectId, request) {
    const active = this.active.get(projectId)
    if (!active || !active.accepting) throw new Error('Start the Mod before invoking its business UI handler')
    if (Buffer.byteLength(JSON.stringify(request ?? {})) > 64 * 1024) throw new Error('UI request exceeds the Mod limit')
    const requestId = `ui-${randomUUID()}`
    return await new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => { active.invocations.delete(requestId); rejectResult(new Error('Mod UI handler timed out')) }, 5000)
      active.invocations.set(requestId, { resolve: value => { clearTimeout(timer); resolveResult(value) }, reject: error => { clearTimeout(timer); rejectResult(error) } })
      active.child.send({ type: 'invoke', requestId, request })
    })
  }
  async listIncidents({ status = null } = {}) { return (await this.store.incidents()).filter(item => !status || item.status === status).map(item => ({ ...item, incidentId: item.incident_id, projectId: item.project_id, versionId: item.version_id, runId: item.run_id, maintainerSessionId: item.maintainer_session_id })) }
  async claimIncident(incidentId, consumerId, { leaseMs = 5 * 60_000 } = {}) { return this.#transitionIncident(incidentId, consumerId, 'claimed', { leaseMs }) }
  async ackIncident(incidentId, consumerId, { messageId, sessionSequence } = {}) {
    if (typeof messageId !== 'string' || !messageId || !Number.isSafeInteger(sessionSequence)) throw new Error('Ack requires the durable maintenance messageId and flushed sessionSequence')
    return this.#transitionIncident(incidentId, consumerId, 'delivered', { messageId, sessionSequence })
  }
  async resolveIncident(incidentId, consumerId, { resolution, versionId } = {}) {
    if (typeof resolution !== 'string' || !resolution) throw new Error('Resolving an incident requires a resolution note')
    const incident = await this.store.incident(incidentId)
    if (!incident) throw new Error('Incident not found')
    const receipts = await this.#storedResolutionReceipts(incident.project_id, versionId)
    return this.#transitionIncident(incidentId, consumerId, 'resolved', { resolution, ...receipts })
  }

  /** Resolution evidence is never accepted from an Agent/UI request. It must
   * be the runtime's own immutable validation record plus a real healthy-run
   * activation receipt for the exact version being claimed. */
  async #storedResolutionReceipts(projectId, versionId) {
    if (typeof versionId !== 'string' || !versionId) throw new Error('Resolving requires a stored versionId')
    const version = await this.store.version(projectId, versionId)
    if (!version || version.project_id !== projectId || version.validation_digest !== version.source_digest
      || !version.validation_receipt?.host_oracle || !Array.isArray(version.validation_receipt.assertions) || version.validation_receipt.assertions.length === 0) {
      throw new Error('Resolving requires this runtime’s host-validated candidate receipt')
    }
    const activation = version.activation_receipt
    if (!activation || activation.project_id !== projectId || activation.version_id !== versionId
      || activation.source_digest !== version.source_digest || activation.health !== 'healthy' || typeof activation.run_id !== 'string') {
      throw new Error('Resolving requires this runtime’s healthy activation receipt')
    }
    return { validation_receipt: structuredClone(version.validation_receipt), activation_receipt: structuredClone(activation) }
  }

  async #transitionIncident(incidentId, consumerId, status, receipt = {}) {
    if (typeof consumerId !== 'string' || !consumerId) throw new Error('A consumerId is required')
    const incident = await this.store.incident(incidentId)
    if (!incident) throw new Error('Incident not found')
    if (incident.status === 'resolved') return incident
    const leaseExpired = incident.lease_expires_at && Date.parse(incident.lease_expires_at) <= Date.now()
    if (incident.claimed_by && incident.claimed_by !== consumerId && !leaseExpired) throw new Error('Incident is claimed by another consumer')
    if (status !== 'claimed' && incident.claimed_by !== consumerId) throw new Error('Incident must be claimed by this consumer before acknowledgement or resolution')
    const leaseExpiresAt = status === 'claimed' ? new Date(Date.now() + Math.max(1_000, Math.min(receipt.leaseMs ?? 300_000, 3_600_000))).toISOString() : incident.lease_expires_at
    const changed = { ...incident, status, claimed_by: consumerId, updated_at: now(), lease_expires_at: leaseExpiresAt, delivery: status === 'delivered' ? { message_id: receipt.messageId, session_sequence: receipt.sessionSequence } : incident.delivery, resolution: status === 'resolved' ? { text: receipt.resolution, validation_receipt: receipt.validationReceipt, activation_receipt: receipt.activationReceipt } : incident.resolution, delivered_at: status === 'delivered' ? now() : incident.delivered_at, resolved_at: status === 'resolved' ? now() : incident.resolved_at }
    await this.store.saveIncident(changed)
    return changed
  }
  async #transitionRequirement(projectId, requirementId, consumerId, status, receipt = {}) {
    if (typeof consumerId !== 'string' || !consumerId) throw new Error('A consumerId is required')
    const file = join(this.store.requirementsRoot(projectId), `${id(requirementId, 'requirement id')}.json`)
    const requirement = await readJson(file); if (!requirement) throw new Error('Requirement not found')
    if (requirement.status === 'resolved') return requirement
    if (requirement.claimed_by && requirement.claimed_by !== consumerId) throw new Error('Requirement is claimed by another consumer')
    const updated = { ...requirement, ...receipt, status, claimed_by: consumerId, updated_at: now(), resolved_at: status === 'resolved' ? now() : requirement.resolved_at }
    await atomicJson(file, updated)
    return updated
  }
  async #exclusive(projectId, operation) {
    const prior = this.operations.get(projectId) ?? Promise.resolve()
    let release
    const barrier = new Promise(resolve => { release = resolve })
    const queued = prior.catch(() => {}).then(() => barrier)
    this.operations.set(projectId, queued)
    await prior.catch(() => {})
    try { return await operation() } finally {
      release()
      if (this.operations.get(projectId) === queued) this.operations.delete(projectId)
    }
  }

  async #execute(project, version, options) {
    const run = { run_id: `validation-${randomUUID()}`, project_id: project.project_id, version_id: version.version_id, control_revision: project.control_revision, status: 'validating' }
    const active = await this.#spawn(project, version, run, options)
    try { const receipt = await active.validated; return receipt } finally { await this.#stopActive(active, 'validation-finished', true) }
  }
  async #spawn(project, version, run, { mode, stateRoot }) {
    await mkdir(stateRoot, { recursive: true })
    const source = this.store.source(project.project_id, version.version_id)
    const child = fork(runner, [join(source, version.manifest.entry), stateRoot, mode, JSON.stringify(version.manifest.behaviorChecks ?? null)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH ?? '', NODE_OPTIONS: '' }, execArgv: ['--permission', `--allow-fs-read=${source}`, `--allow-fs-read=${runner}`] })
    let resolveStarted, rejectStarted, resolveValidated, rejectValidated
    let resolveExited
    const active = { child, project, version, run, stateRoot, closed: false, accepting: true, invocations: new Map(), stateQueue: Promise.resolve(), abort: new AbortController(),
      started: new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject }),
      validated: new Promise((resolve, reject) => { resolveValidated = resolve; rejectValidated = reject }),
      exited: new Promise(resolve => { resolveExited = resolve }),
    }
    active.resolveExited = resolveExited
    active.started.catch(() => {})
    active.validated.catch(() => {})
    active.resolveStarted = resolveStarted; active.rejectStarted = rejectStarted; active.resolveValidated = resolveValidated; active.rejectValidated = rejectValidated
    child.on('message', message => void this.#childMessage(active, message))
    child.on('exit', (code, signal) => void this.#childExit(active, code, signal))
    if (mode === 'validate') {
      active.timeout = setTimeout(() => { void this.#stopActive(active, 'validation-timeout'); active.rejectValidated(new Error('Mod validation timed out')) }, this.validationTimeoutMs)
    }
    return active
  }
  async #childMessage(active, message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'started') { active.resolveStarted(); return }
    if (message.type === 'validated') { clearTimeout(active.timeout); active.resolveValidated(message.receipt); return }
    if (message.type === 'invokeResult') { const call = active.invocations.get(message.requestId); if (call) { active.invocations.delete(message.requestId); message.error ? call.reject(Object.assign(new Error(message.error.message), message.error)) : call.resolve(message.value) }; return }
    if (message.type === 'error') {
      const error = Object.assign(new Error(message.error?.message ?? 'Mod child failed'), message.error ?? {})
      if (active.run.status === 'validating') { active.rejectValidated(error); return }
      active.rejectStarted(error)
      await this.#fail(active.project, active.version, active.run, message.phase ?? 'child', error)
      return
    }
    if (message.type === 'stopped') return
    if (message.type !== 'request') return
    const allowed = await this.#admitted(active)
    const checkpoint = active.stopping === true && message.method === 'state.write'
    if (!allowed && !checkpoint) { this.#respond(active, message.requestId, null, { message: 'This Mod run is no longer active' }); return }
    try {
      let value
      if (message.method === 'state.read') {
        if (!hasManifestCapability(active.project, active.version.manifest, 'state.read')) throw new Error('Manifest declaration and host grant are both required for state.read')
        value = await this.#stateRead(active.stateRoot, active.version.manifest)
      }
      else if (message.method === 'state.write') {
        if (!hasManifestCapability(active.project, active.version.manifest, 'state.write')) throw new Error('Manifest declaration and host grant are both required for state.write')
        value = await this.#queuedStateWrite(active, message.args?.value, checkpoint)
      }
      else if (message.method === 'model.call') {
        if (!hasManifestCapability(active.project, active.version.manifest, 'model.call')) throw new Error('Manifest declaration and host grant are both required for model.call')
        const broker = active.run.status === 'validating' ? this.validationModel : this.model
        if (typeof broker !== 'function') throw new Error(active.run.status === 'validating' ? 'Candidate validation has no isolated validationModel broker' : 'The host did not provide a model broker')
        if (Buffer.byteLength(JSON.stringify(message.args?.input ?? null)) > 128 * 1024) throw new Error('Model request exceeds the Mod limit')
        value = await broker({ projectId: active.project.project_id, versionId: active.version.version_id, runId: active.run.run_id, controlRevision: active.run.control_revision, mode: active.run.status === 'validating' ? 'validation' : 'run', signal: active.abort.signal, input: message.args?.input })
      } else if (message.method === 'emit') {
        // Candidate activity is isolated validation evidence, never a user
        // event that can wake the maintenance conversation.
        value = active.run.status === 'validating' ? { accepted: false, validation: true } : await this.#emit({ type: 'mod.event', projectId: active.project.project_id, versionId: active.version.version_id, runId: active.run.run_id, payload: { name: message.args?.name, payload: message.args?.payload } })
      } else throw new Error(`Unsupported Mod bridge method: ${message.method}`)
      if (!checkpoint && !await this.#admitted(active)) throw new Error('Model or bridge result arrived after this Mod run stopped')
      this.#respond(active, message.requestId, value)
    } catch (error) { this.#respond(active, message.requestId, null, serial(error)) }
  }
  #respond(active, requestId, value, error = null) { if (active.child.connected) active.child.send({ type: 'response', requestId, value, error }) }
  async #admitted(active) {
    if (!active.accepting) return false
    if (active.run.status === 'validating') return true
    return this.active.get(active.project.project_id) === active && (await this.store.project(active.project.project_id))?.control_revision === active.run.control_revision
  }
  async #queuedStateWrite(active, value, checkpoint = false) {
    const operation = active.stateQueue.then(async () => {
      if (!checkpoint && !await this.#admitted(active)) throw new Error('The Mod run is no longer allowed to update state')
      return this.#stateWrite(active.stateRoot, active.version.manifest, value)
    })
    active.stateQueue = operation.catch(() => {})
    return operation
  }
  async #childExit(active, code, signal) {
    clearTimeout(active.timeout)
    if (active.closed) return
    active.closed = true
    active.resolveExited({ code, signal })
    if (this.active.get(active.project.project_id) === active) this.active.delete(active.project.project_id)
    // A child may be stopped while `start(api)` is awaiting a model bridge.
    // Do not leave the public start promise pending forever in that case.
    active.rejectStarted(new Error(`Mod child exited before reporting healthy (${code ?? signal ?? 'unknown'})`))
    if (active.run.status === 'validating') {
      if (code !== 0) active.rejectValidated(new Error(`Mod validation child exited (${code ?? signal ?? 'unknown'})`))
      return
    }
    const run = await this.store.run(active.project.project_id, active.run.run_id)
    if (!run || terminal.has(run.status)) return
    const project = await this.store.project(active.project.project_id)
    if (project?.desired_state === 'stopped') {
      await this.store.saveRun(active.project.project_id, active.forced
        ? { ...run, status: 'interrupted', health: 'needs-review', ended_at: now(), error: { message: 'Stop timed out; final checkpoint may be unknown.' } }
        : { ...run, status: 'stopped', health: 'stopped', ended_at: now() })
      return
    }
    const error = new Error(`Mod child exited unexpectedly (${code ?? signal ?? 'unknown'})`)
    await this.#fail(active.project, active.version, active.run, 'exit', error)
  }
  async #stopActive(active, reason, immediate = false) {
    if (active.closed) return
    active.closing = true
    active.accepting = false
    active.stopping = true
    active.abort.abort(new Error(`Mod run stopped: ${reason}`))
    if (active.child.connected) active.child.send({ type: 'stop', reason })
    const deadline = immediate ? 0 : this.stopTimeoutMs
    await Promise.race([active.exited, new Promise(resolve => setTimeout(resolve, deadline))])
    if (!active.closed) { active.forced = true; active.child.kill('SIGKILL') }
    await active.exited
    await active.stateQueue
  }
  async #fail(project, version, run, phase, error) {
    const key = `${project.project_id}:${run.run_id}`
    const prior = this.failureOps.get(key)
    if (prior) return prior
    const operation = this.#failOnce(project, version, run, phase, error).finally(() => this.failureOps.delete(key))
    this.failureOps.set(key, operation)
    return operation
  }
  async #failOnce(project, version, run, phase, error) {
    const current = await this.store.run(project.project_id, run.run_id)
    if (current && terminal.has(current.status)) return
    const stopIntent = await this.store.project(project.project_id)
    if (stopIntent?.desired_state === 'stopped' && stopIntent.control_revision !== run.control_revision) return
    const finalRun = { ...(current ?? run), status: 'failed', health: 'failed', ended_at: now(), error: serial(error) }
    await this.store.saveRun(project.project_id, finalRun)
    const currentProject = await this.store.project(project.project_id)
    if (currentProject?.control_revision === run.control_revision) await this.store.saveProject({ ...currentProject, desired_state: 'stopped', stop_reason: 'failed', health: 'failed', updated_at: now() })
    const fingerprint = failureDigest(phase, error)
    const existing = (await this.store.incidents()).find(item => item.project_id === project.project_id && item.version_id === version.version_id && item.run_id === run.run_id && item.phase === phase && item.fingerprint === fingerprint)
    if (!existing) {
      const incident = { incident_id: `incident-${randomUUID()}`, project_id: project.project_id, version_id: version.version_id, run_id: run.run_id, phase, fingerprint, maintainer_session_id: project.maintainer_session_id, status: 'pending', error: serial(error), created_at: now(), updated_at: now() }
      await this.store.saveIncident(incident)
      await this.#emit({ type: 'mod.incident', projectId: project.project_id, versionId: version.version_id, runId: run.run_id, payload: incident })
    }
  }
  async #stateRead(stateRoot, manifest) {
    const file = await this.#stateFile(stateRoot, manifest)
    return await readJson(file)
  }
  async #stateWrite(stateRoot, manifest, value) {
    const file = await this.#stateFile(stateRoot, manifest, { createParents: true })
    await atomicJson(file, value ?? null)
    return { written: true }
  }
  async #stateFile(stateRoot, manifest, { createParents = false } = {}) {
    const declared = manifest?.state ?? defaultManifest.state
    if (typeof declared !== 'string' || !declared.startsWith('data/')) throw new Error('Invalid state path')
    const relativeState = declared.slice('data/'.length)
    let file
    try { file = safeRelative(stateRoot, relativeState) } catch { throw new Error('Invalid state path') }
    const root = resolve(stateRoot)
    const ordinaryDirectory = async path => {
      if (createParents) await mkdir(path, { recursive: true })
      const info = await lstat(path).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
      if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new Error('Mod state path contains a symbolic link, reparse point, or non-directory parent')
    }
    await ordinaryDirectory(root)
    let cursor = root
    for (const segment of relativeState.split('/').slice(0, -1)) { cursor = join(cursor, segment); await ordinaryDirectory(cursor) }
    const target = await lstat(file).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
    if (target && (!target.isFile() || target.isSymbolicLink() || target.nlink > 1)) throw new Error('Mod state path must be an ordinary non-hard-linked file')
    return file
  }
  async #assertValidation(project, version, receipt, validationRoot) {
    if (!receipt || receipt.ok !== true || !Array.isArray(receipt.assertions) || receipt.assertions.length === 0) throw new Error('selfTest did not produce project-test evidence')
    if (typeof this.assertValidation !== 'function') throw new Error('Candidate validation requires a host-provided assertValidation oracle')
    // The candidate's own tests are retained as project-test evidence.  Only
    // this parent-owned callback may elevate the version to validated.
    const result = await this.assertValidation({ projectId: project.project_id, versionId: version.version_id, receipt, validationRoot })
    if (result?.ok !== true) throw new Error(result?.message ?? 'Host validation oracle rejected the candidate')
    receipt.host_oracle = result.receipt ?? { checked_at: now() }
  }
  async #emit(event) { if (typeof this.emit === 'function') return this.emit(event); return { accepted: false } }
}

function mime(path) {
  const extension = path.split('.').at(-1).toLowerCase()
  return ({ js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[extension] ?? 'application/octet-stream'
}

export const modManifest = Object.freeze({ ...defaultManifest })
