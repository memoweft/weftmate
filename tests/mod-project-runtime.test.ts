import assert from 'node:assert/strict'
import test from 'node:test'
import { link, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModProjectRuntime } from '../src/runtime/mod-projects/index.mjs'

const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))

function files({ crash = false, badValidationState = false, stopCheckpoint = false } = {}) {
  return {
    'src/logic.mjs': `export const message = input => 'hello:' + input`,
    'src/main.mjs': `import { message } from './logic.mjs'
export async function start(api) {
  const response = await api.model.call({ prompt: message('model') })
  await api.state.write({ response, started: true })
  ${crash ? "if (!api.paths.state.includes('validation')) throw new Error('business boom')" : ''}
}
export async function selfTest(api) { await api.state.write({ validation: ${badValidationState ? 'false' : 'true'} }); return { ok: true, assertions: [{ id: 'candidate-project-test', passed: true }] } }
${stopCheckpoint ? "export async function stop(api) { await api.state.write({ checkpoint: 'stopped-cleanly' }) }" : ''}
export async function handleUi(api, request) { return { action: request.action, state: await api.state.read() } }
`,
    'ui/index.html': '<main>Mod UI</main>',
  }
}

async function prepared(options: any = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-project-'))
  const events: any[] = []
  const runtime = await new ModProjectRuntime({ root, emit: event => events.push(event), assertValidation: async ({ validationRoot }) => {
    const state = JSON.parse(await readFile(join(validationRoot, 'state.json'), 'utf8'))
    return state.validation === true ? { ok: true, receipt: { scenario: 'host-state-oracle', state: 'validation=true' } } : { ok: false, message: 'host scenario did not reach validation=true' }
  }, ...options }).open()
  const project = await runtime.createProject({ name: 'Example Mod', maintainerSessionId: 'session-maintainer', files: files() })
  const candidate = await runtime.createCandidate(project.projectId)
  const validated = await runtime.validateVersion(project.projectId, candidate.versionId)
  await runtime.activateVersion(project.projectId, candidate.versionId)
  return { root, runtime, project, candidate, validated, events }
}

test('runs a multi-file ESM Mod through the parent model bridge and preserves data across reopening', async () => {
  const calls: any[] = []
  const f = await prepared({ validationModel: async call => ({ validation: call.mode }), model: async call => { calls.push(call); return { text: 'broker-result' } } })
  assert.equal(f.validated.validationReceipt.host_oracle.scenario, 'host-state-oracle')
  const run = await f.runtime.start(f.project.projectId)
  assert.equal(run.status, 'running')
  assert.equal(calls.length, 1, 'only the real execution uses the user model broker')
  assert.equal(calls.at(-1).projectId, f.project.projectId)
  assert.equal(calls.at(-1).controlRevision, run.controlRevision)
  const ui = await f.runtime.readUiAsset(f.project.projectId, 'index.html')
  assert.match(ui.bytes.toString('utf8'), /Mod UI/)
  assert.deepEqual(await f.runtime.invokeUi(f.project.projectId, { action: 'inspect' }), { action: 'inspect', state: { response: { text: 'broker-result' }, started: true } })
  await f.runtime.stop(f.project.projectId, { expectedControlRevision: run.controlRevision })
  await assert.rejects(f.runtime.resume(f.project.projectId), /explicit user start/)
  const resumed = await f.runtime.resume(f.project.projectId, { userInitiated: true })
  await f.runtime.stop(f.project.projectId, { expectedControlRevision: resumed.controlRevision })
  const reopened = await new ModProjectRuntime({ root: f.root }).open()
  assert.equal((await reopened.getProject(f.project.projectId)).desiredState, 'stopped')
  const state = JSON.parse(await readFile(join(f.root, 'projects', f.project.projectId, 'data', 'state.json'), 'utf8'))
  assert.deepEqual(state.response, { text: 'broker-result' })
})

test('validation uses isolated data, binds digest to activation, and cannot damage active data on failure', async () => {
  const f = await prepared({ validationModel: async () => 'validation', model: async () => 'ok' })
  const data = join(f.root, 'projects', f.project.projectId, 'data', 'state.json')
  await writeFile(data, JSON.stringify({ preserved: true }), 'utf8')
  await f.runtime.updateWorkspace(f.project.projectId, { files: files({ badValidationState: true }) })
  const failed = await f.runtime.createCandidate(f.project.projectId)
  await assert.rejects(f.runtime.validateVersion(f.project.projectId, failed.versionId), /host scenario did not reach validation=true/)
  assert.equal((await f.runtime.getProject(f.project.projectId)).activeVersionId, f.candidate.versionId)
  assert.deepEqual(JSON.parse(await readFile(data, 'utf8')), { preserved: true })
  await f.runtime.updateWorkspace(f.project.projectId, { files: files() })
  const changed = await f.runtime.createCandidate(f.project.projectId)
  await f.runtime.validateVersion(f.project.projectId, changed.versionId)
  await writeFile(join(f.root, 'projects', f.project.projectId, 'versions', changed.versionId, 'source', 'src', 'logic.mjs'), 'export const message = input => input + " changed"', 'utf8')
  await assert.rejects(f.runtime.activateVersion(f.project.projectId, changed.versionId), /digest no longer matches/)
})

test('behavior checks read a concrete indexed result after ordered isolated write and read actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-indexed-check-'))
  const runtime = await new ModProjectRuntime({ root, assertValidation: async () => ({ ok: true }) }).open()
  const project = await runtime.createProject({
    name: 'Indexed behavior checks',
    maintainerSessionId: 'maintainer',
    files: {
      'src/main.mjs': `export async function start(api) { await api.state.write((await api.state.read()) ?? { items: [] }) }
export async function selfTest() { return { ok: true, assertions: [{ id: 'indexed-check-self-test', passed: true }] } }
export async function handleUi(api, request) { const state = await api.state.read() ?? { items: [] }; if (request.action === 'append') { const items = [...state.items, request.payload]; await api.state.write({ ...state, items }); return { items } } if (request.action === 'list') return { items: state.items }; return { items: state.items } }
`,
      'ui/index.html': '<main>indexed behavior check</main>',
    },
  })
  const syntheticRecord = { label: 'synthetic-first-record', kind: 'test' }
  const behaviorChecks = [
    { action: 'append', steps: 1, payload: syntheticRecord, expect: { path: 'state.items.0.label', op: 'equals', value: syntheticRecord.label } },
    { action: 'list', steps: 1, expect: { path: 'result.items.0.label', op: 'equals', value: syntheticRecord.label } },
  ]
  const candidate = await runtime.createCandidate(project.projectId, { behaviorChecks })
  const validated = await runtime.validateVersion(project.projectId, candidate.versionId)
  const assertions = validated.validationReceipt.assertions.filter((assertion: any) => assertion.id.startsWith('behavior-check:'))
  assert.equal(assertions.length, 2)
  assert.equal(assertions.every((assertion: any) => assertion.passed), true)
  assert.equal(assertions[1].evidence.path, 'result.items.0.label')
  assert.equal(assertions[1].evidence.observed, syntheticRecord.label)
})

test('behavior check paths reject unsafe, ambiguous, excessive, and overlarge index segments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-indexed-check-invalid-'))
  const runtime = await new ModProjectRuntime({ root, assertValidation: async () => ({ ok: true }) }).open()
  const project = await runtime.createProject({ name: 'Invalid indexed behavior checks', maintainerSessionId: 'maintainer', files: files() })
  for (const path of ['result.items.00.label', 'result.items.01.label', 'result.items.-1.label', 'result.items.1e2.label', 'result..items', 'result.__proto__.label', 'result.prototype.label', 'result.constructor.label', 'result.items.1000000.label', 'result.a.b.c.d.e.f.g.h']) {
    await assert.rejects(runtime.createCandidate(project.projectId, { behaviorChecks: [{ action: 'inspect', steps: 1, expect: { path, op: 'equals', value: null } }] }), /bounded path assertion/, path)
  }
})

test('durable stop fences a late model response and does not revive the stopped run', async () => {
  let resolveModel: (value: unknown) => void = () => {}
  let admitted!: () => void
  const modelEntered = new Promise<void>(resolve => { admitted = resolve })
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-stop-race-'))
  let calls = 0
  const runtime = await new ModProjectRuntime({ root, validationModel: async () => 'validation', assertValidation: async ({ validationRoot }) => {
    const state = JSON.parse(await readFile(join(validationRoot, 'state.json'), 'utf8'))
    return state.validation === true ? { ok: true } : { ok: false }
  }, model: (_call: any) => {
    calls += 1
    return new Promise(resolve => { resolveModel = resolve; admitted() })
  }, stopTimeoutMs: 50 }).open()
  const project = await runtime.createProject({ name: 'Race', maintainerSessionId: 'maintainer', files: files() })
  const candidate = await runtime.createCandidate(project.projectId)
  await runtime.validateVersion(project.projectId, candidate.versionId)
  await runtime.activateVersion(project.projectId, candidate.versionId)
  const pendingStart = runtime.start(project.projectId)
  const rejectedStart = assert.rejects(pendingStart)
  await modelEntered
  const stopped = await runtime.stop(project.projectId)
  resolveModel('late')
  await rejectedStart
  await settle()
  assert.equal(stopped.status, 'stopped')
  assert.equal((await runtime.getProject(project.projectId)).desiredState, 'stopped')
  assert.equal(await readFile(join(root, 'projects', project.projectId, 'data', 'state.json'), 'utf8').catch(() => null), null)
})

test('concurrent start requests admit exactly one child run', async () => {
  let calls = 0
  const f = await prepared({ validationModel: async () => 'validation', model: async () => { calls += 1; return 'ok' } })
  const result = await Promise.allSettled([f.runtime.start(f.project.projectId), f.runtime.start(f.project.projectId)])
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(result.filter(item => item.status === 'rejected').length, 1)
  assert.equal(calls, 1, 'exactly one real child call was admitted')
  await f.runtime.stop(f.project.projectId)
})

test('selected is not actual activation, and stop hooks flush a final checkpoint before return', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-checkpoint-'))
  const runtime = await new ModProjectRuntime({ root, validationModel: async () => 'test', model: async () => 'run', assertValidation: async () => ({ ok: true }) }).open()
  const project = await runtime.createProject({ name: 'Checkpoint', maintainerSessionId: 'maintainer', files: files({ stopCheckpoint: true }) })
  const candidate = await runtime.createCandidate(project.projectId)
  await runtime.validateVersion(project.projectId, candidate.versionId)
  await runtime.activateVersion(project.projectId, candidate.versionId)
  assert.equal((await runtime.getProject(project.projectId)).health, 'selected')
  assert.equal((await runtime.store.version(project.projectId, candidate.versionId)).activation_receipt, null)
  const run = await runtime.start(project.projectId)
  await runtime.stop(project.projectId, { expectedControlRevision: run.controlRevision })
  const activeVersion: any = await runtime.store.version(project.projectId, candidate.versionId)
  assert.equal(activeVersion.activation_receipt.run_id, run.runId)
  assert.equal(activeVersion.activation_receipt.source_digest, run.source_digest)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'projects', project.projectId, 'data', 'state.json'), 'utf8')), { checkpoint: 'stopped-cleanly' })
})

test('UI root cannot escape source and binary UI assets survive import without UTF-8 rewriting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-assets-'))
  const runtime = await new ModProjectRuntime({ root, validationModel: async () => 'test', assertValidation: async () => ({ ok: true }) }).open()
  const bad = await runtime.createProject({ name: 'Bad assets', maintainerSessionId: 'maintainer', files: files(), manifest: { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', ui: { assets: '../../outside' } } })
  await assert.rejects(runtime.createCandidate(bad.projectId), /ui\.assets escapes/)
  const binary = Buffer.from([0, 255, 16, 128, 42])
  const project = await runtime.createProject({ name: 'Binary assets', maintainerSessionId: 'maintainer', files: { ...files(), 'ui/pixel.png': binary } })
  const candidate = await runtime.createCandidate(project.projectId)
  await runtime.validateVersion(project.projectId, candidate.versionId)
  await runtime.activateVersion(project.projectId, candidate.versionId)
  assert.deepEqual((await runtime.readUiAsset(project.projectId, 'pixel.png')).bytes, binary)
})

test('versioned state paths reject traversal, Windows separators, junction parents, and linked targets without touching outside JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-state-path-'))
  const outside = join(root, 'outside.json')
  const outsideText = JSON.stringify({ outside: 'unchanged' })
  await writeFile(outside, outsideText, 'utf8')
  const manifest = { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', manifestVersion: 1, capabilities: { required: ['state.read', 'state.write'] }, ui: { assets: 'ui' } }
  const stateFiles = {
    'src/main.mjs': `export async function start(api) { if (api.paths.state.includes('validation')) return; let readDenied = false; let writeDenied = false; try { await api.state.read() } catch { readDenied = true } try { await api.state.write({ changed: true }) } catch { writeDenied = true } if (!readDenied || !writeDenied) throw new Error('state guard leaked outside path') }
export async function selfTest(api) { await api.state.write({ validation: true }); return { ok: true, assertions: [{ id: 'state-path', passed: true }] } }`,
    'ui/index.html': '<main>state path</main>',
  }
  for (const state of ['data/../outside.json', 'data\\outside.json']) {
    const runtime = await new ModProjectRuntime({ root: await mkdtemp(join(tmpdir(), 'weftmate-mod-state-lexical-')), assertValidation: async () => ({ ok: true }) }).open()
    const project = await runtime.createProject({ name: 'Bad state', maintainerSessionId: 'maintainer', files: stateFiles, manifest: { ...manifest, state } })
    await assert.rejects(runtime.createCandidate(project.projectId), /state.*(escape|under)|Unsafe/i)
  }
  for (const kind of ['junction-parent', 'junction-target', 'hard-linked-target']) {
    const runtime = await new ModProjectRuntime({ root: await mkdtemp(join(tmpdir(), `weftmate-mod-state-${kind}-`)), assertValidation: async () => ({ ok: true }) }).open()
    const project = await runtime.createProject({ name: kind, maintainerSessionId: 'maintainer', files: stateFiles, manifest: kind === 'junction-parent' ? { ...manifest, state: 'data/nested/state.json' } : kind === 'junction-target' ? { ...manifest, state: 'data/state-target' } : manifest })
    const candidate = await runtime.createCandidate(project.projectId); await runtime.validateVersion(project.projectId, candidate.versionId); await runtime.activateVersion(project.projectId, candidate.versionId)
    const data = join(runtime.store.data(project.projectId))
    if (kind === 'junction-parent') { await symlink(dirname(outside), join(data, 'nested'), 'junction') }
    else if (kind === 'junction-target') { await symlink(dirname(outside), join(data, 'state-target'), 'junction') }
    else await link(outside, join(data, 'state.json'))
    await runtime.start(project.projectId, { userInitiated: true })
    await settle(30)
    assert.equal(await readFile(outside, 'utf8'), outsideText, `${kind} cannot read or write outside state JSON`)
    await runtime.stop(project.projectId, { reason: 'fixture-cleanup' })
  }
})

test('versioned capability declarations need a separate host grant and an available provider', async () => {
  const source = {
    'src/main.mjs': `export async function start(api) { if (!api.paths.state.includes('validation')) await api.model.call({ prompt: 'only-if-authorized' }); await api.state.write({ started: true }) }
export async function selfTest(api) { await api.state.write({ validation: true }); return { ok: true, assertions: [{ id: 'capability', passed: true }] } }`,
    'ui/index.html': '<main>capability</main>',
  }
  const manifest = capabilities => ({ entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', manifestVersion: 1, capabilities: { required: ['state.read', 'state.write', ...capabilities] }, ui: { assets: 'ui' } })
  const prepare = async ({ capabilities, grants, model = null }) => {
    const runtime = await new ModProjectRuntime({ root: await mkdtemp(join(tmpdir(), 'weftmate-mod-grants-')), model, assertValidation: async () => ({ ok: true }) }).open()
    const project = await runtime.createProject({ name: 'Grant check', maintainerSessionId: 'maintainer', files: source, manifest: manifest(capabilities), hostCapabilityGrants: grants })
    const candidate = await runtime.createCandidate(project.projectId); await runtime.validateVersion(project.projectId, candidate.versionId)
    return { runtime, project, candidate }
  }
  let f = await prepare({ capabilities: [], grants: ['state.read', 'state.write', 'model.call'] })
  await f.runtime.activateVersion(f.project.projectId, f.candidate.versionId)
  await assert.rejects(f.runtime.start(f.project.projectId, { userInitiated: true }), /declaration and host grant/)
  f = await prepare({ capabilities: ['model.call'], grants: ['state.read', 'state.write'] })
  await assert.rejects(f.runtime.activateVersion(f.project.projectId, f.candidate.versionId), /blocked_missing_capabilities/)
  f = await prepare({ capabilities: ['model.call'], grants: ['state.read', 'state.write', 'model.call'] })
  await assert.rejects(f.runtime.activateVersion(f.project.projectId, f.candidate.versionId), /blocked_missing_capabilities/)
  const calls: unknown[] = []
  f = await prepare({ capabilities: ['model.call'], grants: ['state.read', 'state.write', 'model.call'], model: async call => { calls.push(call); return { ok: true } } })
  await f.runtime.activateVersion(f.project.projectId, f.candidate.versionId)
  await f.runtime.start(f.project.projectId, { userInitiated: true })
  assert.equal(calls.length, 1, 'only an explicitly granted, provider-backed model bridge runs')
  await f.runtime.stop(f.project.projectId)
})

test('reopening uses the published active manifest for capability recovery and never lets a later workspace draft block an older state-only active version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mod-reopen-capabilities-'))
  const modelManifest = { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', manifestVersion: 1, capabilities: { required: ['state.read', 'state.write', 'model.call'] }, ui: { assets: 'ui' } }
  const runtime = await new ModProjectRuntime({ root, validationModel: async () => 'validation-model', model: async () => 'model-result', assertValidation: async () => ({ ok: true }) }).open()
  const project = await runtime.createProject({ name: 'Published grant revocation', maintainerSessionId: 'maintainer', files: files(), manifest: modelManifest, hostCapabilityGrants: ['state.read', 'state.write', 'model.call'] })
  const candidate = await runtime.createCandidate(project.projectId); await runtime.validateVersion(project.projectId, candidate.versionId); await runtime.activateVersion(project.projectId, candidate.versionId)
  const run = await runtime.start(project.projectId, { userInitiated: true }); await runtime.stop(project.projectId, { expectedControlRevision: run.controlRevision, reason: 'fixture-cleanup' })
  const dataPath = join(root, 'projects', project.projectId, 'data', 'state.json')
  const dataBefore = await readFile(dataPath)
  const published = await runtime.store.project(project.projectId); const sourceDigest = (await runtime.store.version(project.projectId, candidate.versionId)).source_digest
  await runtime.store.saveProject({ ...published, host_capability_grants: ['state.read', 'state.write'] })
  const reopened = await new ModProjectRuntime({ root, assertValidation: async () => ({ ok: true }) }).open()
  const blocked = await reopened.getProject(project.projectId)
  assert.equal(blocked.activeVersionId, candidate.versionId)
  assert.equal(blocked.health, 'blocked'); assert.equal(blocked.desiredState, 'stopped'); assert.equal(blocked.stopReason, 'blocked_missing_capabilities')
  assert.equal((await reopened.store.version(project.projectId, candidate.versionId)).source_digest, sourceDigest, 'recovery changes no published source or version snapshot')
  assert.deepEqual(await readFile(dataPath), dataBefore, 'recovery blocks the unavailable published version without rewriting its durable data')

  const draftRoot = await mkdtemp(join(tmpdir(), 'weftmate-mod-reopen-draft-'))
  const stateOnlyFiles = {
    'src/main.mjs': `export async function start(api) { await api.state.write((await api.state.read()) || { started: true }) }
export async function selfTest(api) { await api.state.write({ validation: true }); return { ok: true, assertions: [{ id: 'state-only', passed: true }] } }`,
    'ui/index.html': '<main>state only</main>',
  }
  const draftRuntime = await new ModProjectRuntime({ root: draftRoot, validationModel: async () => 'validation-model', assertValidation: async () => ({ ok: true }) }).open()
  const draftProject = await draftRuntime.createProject({ name: 'Unpublished capability draft', maintainerSessionId: 'maintainer', files: stateOnlyFiles, manifest: { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', manifestVersion: 1, capabilities: { required: ['state.read', 'state.write'] }, ui: { assets: 'ui' } }, hostCapabilityGrants: ['state.read', 'state.write'] })
  const active = await draftRuntime.createCandidate(draftProject.projectId); await draftRuntime.validateVersion(draftProject.projectId, active.versionId); await draftRuntime.activateVersion(draftProject.projectId, active.versionId)
  await draftRuntime.updateWorkspace(draftProject.projectId, { files: stateOnlyFiles, manifest: modelManifest })
  const reopenedDraft = await new ModProjectRuntime({ root: draftRoot, assertValidation: async () => ({ ok: true }) }).open()
  const unchanged = await reopenedDraft.getProject(draftProject.projectId)
  assert.equal(unchanged.activeVersionId, active.versionId)
  assert.notEqual(unchanged.health, 'blocked'); assert.notEqual(unchanged.stopReason, 'blocked_missing_capabilities')
})

test('a real child crash has one durable incident and requirements stay independently claimable', async () => {
  const f = await prepared({ validationModel: async () => 'validation', model: async () => 'ok' })
  await f.runtime.updateWorkspace(f.project.projectId, { files: files({ crash: true }) })
  const version = await f.runtime.createCandidate(f.project.projectId)
  await f.runtime.validateVersion(f.project.projectId, version.versionId)
  await f.runtime.activateVersion(f.project.projectId, version.versionId)
  await assert.rejects(f.runtime.start(f.project.projectId, { userInitiated: true }), /business boom/)
  await settle(50)
  const incidents = await f.runtime.listIncidents()
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].status, 'pending')
  await f.runtime.claimIncident(incidents[0].incidentId, 'dsh-maintainer')
  await f.runtime.ackIncident(incidents[0].incidentId, 'dsh-maintainer', { messageId: 'maintenance-message', sessionSequence: 12 })
  assert.equal((await f.runtime.listIncidents())[0].status, 'delivered')
  const requirement = await f.runtime.recordRequirement(f.project.projectId, { text: 'add history' })
  await f.runtime.claimRequirement(f.project.projectId, requirement.requirementId, 'dsh-maintainer')
  assert.equal((await f.runtime.listRequirements(f.project.projectId))[0].status, 'claimed')
})

test('resolution ignores caller supplied receipts and requires this runtime’s validated healthy activation', async () => {
  const f = await prepared({ validationModel: async () => 'validation', model: async () => 'ok' })
  const requirement = await f.runtime.recordRequirement(f.project.projectId, { text: 'show a durable history', origin: { kind: 'user', messageId: 'real-user-message' } })
  await f.runtime.claimRequirement(f.project.projectId, requirement.requirementId, 'dsh-maintainer')
  await assert.rejects(
    f.runtime.resolveRequirement(f.project.projectId, requirement.requirementId, 'dsh-maintainer', { versionId: f.candidate.versionId, validationReceipt: { forged: true }, activationReceipt: { forged: true } }),
    /healthy activation receipt/,
  )
  const run = await f.runtime.start(f.project.projectId)
  await f.runtime.stop(f.project.projectId, { expectedControlRevision: run.controlRevision })
  const resolved = await f.runtime.resolveRequirement(f.project.projectId, requirement.requirementId, 'dsh-maintainer', { versionId: f.candidate.versionId, validationReceipt: { forged: true }, activationReceipt: { forged: true } })
  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.validation_receipt.host_oracle.scenario, 'host-state-oracle')
  assert.equal(resolved.activation_receipt.run_id, run.runId)
  assert.deepEqual((await f.runtime.listRequirements(f.project.projectId))[0].origin, { kind: 'user', messageId: 'real-user-message' })

  await f.runtime.updateWorkspace(f.project.projectId, { files: files({ crash: true }) })
  const broken = await f.runtime.createCandidate(f.project.projectId)
  await f.runtime.validateVersion(f.project.projectId, broken.versionId)
  await f.runtime.activateVersion(f.project.projectId, broken.versionId)
  await assert.rejects(f.runtime.start(f.project.projectId, { userInitiated: true }), /business boom/)
  await settle(50)
  const incident = (await f.runtime.listIncidents())[0]
  await f.runtime.claimIncident(incident.incidentId, 'dsh-maintainer')
  await assert.rejects(
    f.runtime.resolveIncident(incident.incidentId, 'dsh-maintainer', { resolution: 'forged', versionId: broken.versionId, validationReceipt: { forged: true }, activationReceipt: { forged: true } }),
    /healthy activation receipt/,
  )
})
