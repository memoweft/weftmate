/** Agent-authored scripts and execution receipts. User data, never source assets. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('Invalid script or run identifier')
  return value
}
async function json(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function atomic(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

export class WeftModStore {
  constructor(root) { this.root = root }
  async initialize() {
    await mkdir(join(this.root, 'scripts'), { recursive: true })
    await mkdir(join(this.root, 'runs'), { recursive: true })
    await mkdir(join(this.root, 'devices'), { recursive: true })
    // An application restart never replays an effect-bearing script implicitly.
    for (const run of await this.runs()) {
      if (run.status === 'running' || run.status === 'stopping') {
        await this.updateRun(run.run_id, { status: 'interrupted', ended_at: new Date().toISOString(), error: 'Application restarted. Inspect the current state before continuing.' })
      }
    }
  }
  async scripts(query = '') {
    const names = await readdir(join(this.root, 'scripts')).catch(() => [])
    const values = await Promise.all(names.filter(n => n.endsWith('.json')).map(n => json(join(this.root, 'scripts', n))))
    const words = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    const ranked = values.filter(Boolean).map(({ code, ...metadata }) => {
      const parameterNames = [...new Set([
        ...Object.keys(metadata.parameters?.properties ?? metadata.parameters ?? {}).filter(name => !['type', 'required', 'description'].includes(name)),
        ...Array.from(code.matchAll(/\bparams(?:\?\.|\.)([A-Za-z_$][\w$]*)/g), match => match[1]),
        ...Array.from(code.matchAll(/\bparams\[['"]([^'"]+)['"]\]/g), match => match[1]),
      ])]
      const haystack = `${metadata.script_id} ${metadata.description} ${metadata.applicability}`.toLocaleLowerCase()
      const successfulRuns = Number.isSafeInteger(metadata.successful_runs) ? metadata.successful_runs : 0
      const verifiedRuns = Number.isSafeInteger(metadata.verified_runs) ? metadata.verified_runs : 0
      // Assets written before verification receipts existed remain runnable and
      // discoverable.  They are deliberately not represented as newly verified
      // candidates until a current run produces terminal evidence.
      const reuseStatus = verifiedRuns > 0 ? 'verified' : successfulRuns > 0 ? 'legacy_unverified' : 'unverified'
      return {
        ...metadata,
        successful_runs: successfulRuns,
        verified_runs: verifiedRuns,
        reusable: verifiedRuns > 0,
        reuse_status: reuseStatus,
        parameter_names: parameterNames,
        match_score: words.reduce((score, word) => score + Number(haystack.includes(word)), 0),
      }
    }).sort((a, b) => b.match_score - a.match_score || b.parameter_names.length - a.parameter_names.length || b.successful_runs - a.successful_runs || b.updated_at.localeCompare(a.updated_at))
    // The agent supplies semantic matching. Never turn an unfamiliar phrase
    // or language into a false claim that the persistent library is empty.
    return ranked
  }
  async script(id) { return json(join(this.root, 'scripts', `${identifier(id)}.json`)) }
  async deviceOwner(id) { return json(join(this.root, 'devices', `${identifier(id)}.json`)) }
  async deviceOwners() {
    const names = await readdir(join(this.root, 'devices')).catch(() => [])
    return (await Promise.all(names.filter(n => n.endsWith('.json')).map(n => json(join(this.root, 'devices', n))))).filter(Boolean)
  }
  async saveDeviceOwner(id, owner) {
    const previous = await this.deviceOwner(id)
    await atomic(join(this.root, 'devices', `${identifier(id)}.json`), { ...previous, run_id: id, session_id: owner })
  }
  async save({ script_id, code, description = '', parameters = {}, applicability = '' }) {
    identifier(script_id)
    if (typeof code !== 'string' || !code.trim()) throw new Error('Script code must not be empty')
    const previous = await this.script(script_id)
    const hash = createHash('sha256').update(code).digest('hex')
    const sameCode = previous?.sha256 === hash
    const value = {
      script_id, code, description, parameters, applicability, sha256: hash,
      revision: sameCode ? previous.revision : (previous?.revision ?? 0) + 1,
      // New saves use the linked-observation contract.  Pre-contract assets
      // are never migrated on read/run, so their historical execution
      // behavior and checksums stay intact until an agent explicitly saves a
      // new asset or revision.
      verification_required: previous?.verification_required === true || /\btools\.weftmod\b/.test(code),
      verification_contract_version: 1,
      successful_runs: sameCode ? previous.successful_runs : 0,
      verified_runs: sameCode ? (previous.verified_runs ?? 0) : 0,
      last_verified_run: sameCode ? (previous.last_verified_run ?? null) : null,
      updated_at: new Date().toISOString(), last_run: sameCode ? previous.last_run : null,
    }
    await atomic(join(this.root, 'scripts', `${script_id}.json`), value)
    return value
  }
  async newRun(value) {
    const run = { ...value, run_id: `wm-${randomUUID()}`, started_at: new Date().toISOString(), status: 'running', tool_calls: 0, steps: [] }
    await atomic(join(this.root, 'runs', `${run.run_id}.json`), run)
    return run
  }
  async run(id) { return json(join(this.root, 'runs', `${identifier(id)}.json`)) }
  async updateRun(id, patch) {
    const run = await this.run(id)
    if (!run) throw new Error('Script run not found')
    const value = { ...run, ...patch }
    await atomic(join(this.root, 'runs', `${identifier(id)}.json`), value)
    return value
  }
  async runs(sessionId) {
    const names = await readdir(join(this.root, 'runs')).catch(() => [])
    const values = await Promise.all(names.filter(n => n.endsWith('.json')).map(n => json(join(this.root, 'runs', n))))
    return values.filter(Boolean).filter(r => !sessionId || r.session_id === sessionId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
  }
  async recordSuccess(script, runId, { terminalVerified = false } = {}) {
    const current = await this.script(script.script_id)
    if (!current || current.sha256 !== script.sha256) return
    await atomic(join(this.root, 'scripts', `${identifier(script.script_id)}.json`), {
      ...current,
      successful_runs: (current.successful_runs ?? 0) + 1,
      verified_runs: (current.verified_runs ?? 0) + Number(terminalVerified),
      last_run: runId,
      last_verified_run: terminalVerified ? runId : (current.last_verified_run ?? null),
    })
  }
  async recordPendingScript(runId, pending) {
    const current = await this.deviceOwner(runId)
    if (!current) throw new Error('Device run not found')
    await atomic(join(this.root, 'devices', `${identifier(runId)}.json`), {
      ...current,
      pending_script: pending,
    })
  }
  async bindPendingScript(sessionId, script) {
    const candidates = (await this.deviceOwners())
      .filter(device => device.session_id === sessionId && ['captured', 'bound', 'script_failed', 'verification_required'].includes(device.pending_script?.status))
      .sort((a, b) => (b.pending_script?.captured_at ?? '').localeCompare(a.pending_script?.captured_at ?? ''))
    const device = candidates[0]
    if (!device) return null
    const pending = {
      ...device.pending_script,
      status: 'bound',
      script_id: script.script_id,
      script_revision: script.revision,
      script_sha256: script.sha256,
      bound_at: new Date().toISOString(),
    }
    await atomic(join(this.root, 'devices', `${identifier(device.run_id)}.json`), { ...device, pending_script: pending })
    const currentScript = await this.script(script.script_id)
    if (currentScript && currentScript.sha256 === script.sha256 && currentScript.verification_required !== true) {
      await atomic(join(this.root, 'scripts', `${identifier(script.script_id)}.json`), { ...currentScript, verification_required: true, verification_contract_version: 1 })
    }
    return pending
  }
  async verifyPendingScript(sessionId, script, verification) {
    const candidates = (await this.deviceOwners())
      .filter(device => device.session_id === sessionId && device.pending_script?.status === 'bound'
        && device.pending_script.script_id === script.script_id
        && device.pending_script.script_sha256 === script.sha256)
      .sort((a, b) => (b.pending_script?.bound_at ?? '').localeCompare(a.pending_script?.bound_at ?? ''))
    const device = candidates[0]
    if (!device) return null
    const pending = {
      ...device.pending_script,
      status: verification.terminal_verified ? 'verified' : 'verification_required',
      verification,
      verified_at: verification.terminal_verified ? new Date().toISOString() : null,
      resolved_elapsed_ms: verification.terminal_verified && Number.isFinite(device.pending_script?.origin?.turn_started_at)
        ? Date.now() - device.pending_script.origin.turn_started_at : null,
    }
    await atomic(join(this.root, 'devices', `${identifier(device.run_id)}.json`), { ...device, pending_script: pending })
    return pending
  }
  async recordPendingScriptRun(sessionId, script, run) {
    const candidates = (await this.deviceOwners())
      .filter(device => device.session_id === sessionId && device.pending_script?.status === 'bound'
        && device.pending_script.script_id === script.script_id
        && device.pending_script.script_sha256 === script.sha256)
      .sort((a, b) => (b.pending_script?.bound_at ?? '').localeCompare(a.pending_script?.bound_at ?? ''))
    const device = candidates[0]
    if (!device) return null
    const pending = {
      ...device.pending_script,
      status: run.status === 'unverified' ? 'verification_required' : 'script_failed',
      last_script_run_id: run.run_id,
      last_script_status: run.status,
      last_script_error: run.error?.message ?? null,
      last_script_finished_at: run.ended_at ?? new Date().toISOString(),
    }
    await atomic(join(this.root, 'devices', `${identifier(device.run_id)}.json`), { ...device, pending_script: pending })
    return pending
  }
  async suspendPendingOnUserInput(sessionId, origin) {
    const devices = (await this.deviceOwners()).filter(device => device.session_id === sessionId
      && ['captured', 'bound', 'script_failed', 'verification_required'].includes(device.pending_script?.status)
      && device.pending_script?.origin?.message_id !== origin.message_id)
    await Promise.all(devices.map(device => atomic(join(this.root, 'devices', `${identifier(device.run_id)}.json`), {
      ...device,
      pending_script: { ...device.pending_script, status: 'suspended_by_user_input', suspended_at: new Date().toISOString(), superseded_by: origin },
    })))
  }
  async nextPendingContinuation(sessionId, origin) {
    const candidates = (await this.deviceOwners())
      .filter(device => device.session_id === sessionId
        && ['captured', 'bound', 'script_failed', 'verification_required'].includes(device.pending_script?.status)
        && device.pending_script?.origin?.turn === origin.turn
        && device.pending_script?.origin?.message_id === origin.message_id)
      .sort((a, b) => (a.pending_script?.captured_at ?? '').localeCompare(b.pending_script?.captured_at ?? ''))
    const device = candidates[0]
    if (!device) return null
    const attempts = device.pending_script.continuation_attempts ?? 0
    const pending = attempts >= 3
      ? { ...device.pending_script, status: 'unresolved', unresolved_at: new Date().toISOString(), unresolved_reason: 'The same Agent reached the three continuation limit without a verified script run.' }
      : { ...device.pending_script, continuation_attempts: attempts + 1, last_continuation_at: new Date().toISOString() }
    await atomic(join(this.root, 'devices', `${identifier(device.run_id)}.json`), { ...device, pending_script: pending })
    return { ...pending, exhausted: attempts >= 3 }
  }
  async suspendPendingForControl(runId, control) {
    const device = await this.deviceOwner(runId)
    if (!device?.pending_script || !['pause', 'cancel'].includes(control)) return null
    const pending = { ...device.pending_script, status: 'suspended_by_control', suspended_at: new Date().toISOString(), suspended_by: control }
    await atomic(join(this.root, 'devices', `${identifier(runId)}.json`), { ...device, pending_script: pending })
    return pending
  }
  async suspendPendingForScriptControl(sessionId, scriptId, control) {
    const devices = (await this.deviceOwners()).filter(device => device.session_id === sessionId
      && device.pending_script?.script_id === scriptId
      && ['bound', 'script_failed', 'verification_required'].includes(device.pending_script?.status))
    await Promise.all(devices.map(device => atomic(join(this.root, 'devices', `${identifier(device.run_id)}.json`), {
      ...device,
      pending_script: { ...device.pending_script, status: 'suspended_by_control', suspended_at: new Date().toISOString(), suspended_by: control },
    })))
  }
  async pendingForScript(sessionId, script, sourceDeviceRunId = null, originTurn = null) {
    const candidates = (await this.deviceOwners())
      .filter(device => device.session_id === sessionId && ['bound', 'script_failed', 'verification_required'].includes(device.pending_script?.status)
        && device.pending_script?.script_id === script.script_id
        && device.pending_script?.script_sha256 === script.sha256
        && (!sourceDeviceRunId || device.run_id === sourceDeviceRunId)
        && (!originTurn || device.pending_script?.origin?.turn === originTurn))
      .sort((a, b) => (b.pending_script?.bound_at ?? '').localeCompare(a.pending_script?.bound_at ?? ''))
    if (!sourceDeviceRunId && candidates.length > 1) return { ambiguous: true }
    return candidates[0] ?? null
  }
}
