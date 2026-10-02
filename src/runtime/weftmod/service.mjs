import { randomUUID } from 'node:crypto'
import { WeftModStore } from './store.mjs'

const sessionId = exec => exec.agent?.session?.id ?? exec.agent?.session?.header?.id
const textOf = result => result.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || result.error?.message || 'Tool call failed'

function runtimeEvidence(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(runtimeEvidence)
  // Screenshots are already owned by the attachment store when needed.  The
  // reusable-workflow receipt only needs observable state, never image bytes.
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'base64' && key !== 'image')
    .map(([key, child]) => key === 'ui_tree' && child?.format === 'xml'
      ? [key, { format: 'xml', status: child.status ?? null, fallback_reason: child.fallback_reason ?? null }]
      : [key, runtimeEvidence(child)]))
}

function terminalVerification(result, evidence, sourceDevice) {
  const proof = result?.value?.verification
  if (!proof || proof.matched !== true || typeof proof.observation_id !== 'string') return { terminal_verified: false, reason: 'Script result did not return verification.matched with a final observation_id.' }
  const observation = evidence.observations.get(proof.observation_id)
  if (!observation) return { terminal_verified: false, reason: 'Returned verification observation_id was not produced by this script run.' }
  const lastEffect = evidence.effects.get(observation.run_id)
  if (lastEffect && observation.sequence <= lastEffect.sequence) return { terminal_verified: false, reason: 'The claimed final observation was not fresh after the script action.' }
  if (!evidence.completed || evidence.completed.run_id !== observation.run_id || evidence.completed.sequence <= observation.sequence) return { terminal_verified: false, reason: 'The device was not completed after the claimed final observation.' }
  if (sourceDevice) {
    const begun = evidence.begins.get(observation.run_id)
    if (!begun) return { terminal_verified: false, reason: 'The script did not create its own fresh device run.' }
    if (sourceDevice.pending_script.device_profile_id && begun.device_profile_id && sourceDevice.pending_script.device_profile_id !== begun.device_profile_id) return { terminal_verified: false, reason: 'The script used a different device profile from the captured direct task.' }
    if (observation.ui_tree_format !== 'compact') return { terminal_verified: false, reason: 'The pending workflow must use an explicit compact final observation.' }
  }
  return { terminal_verified: true, observation_id: proof.observation_id, target: typeof proof.target === 'string' ? proof.target : null }
}

// Android's input command accepts the KEYCODE_* spellings.  Conversation
// agents naturally use the shorter names, so normalize only the documented
// safe aliases at the host boundary.  Unknown values still reach the backend's
// allow-list and produce a corrective receipt instead of being guessed.
const KEYCODE_ALIASES = new Map([
  ['APP_SWITCH', 'KEYCODE_APP_SWITCH'],
  ['BACK', 'KEYCODE_BACK'],
  ['DEL', 'KEYCODE_DEL'],
  ['DPAD_CENTER', 'KEYCODE_DPAD_CENTER'],
  ['DPAD_DOWN', 'KEYCODE_DPAD_DOWN'],
  ['DPAD_LEFT', 'KEYCODE_DPAD_LEFT'],
  ['DPAD_RIGHT', 'KEYCODE_DPAD_RIGHT'],
  ['DPAD_UP', 'KEYCODE_DPAD_UP'],
  ['ENTER', 'KEYCODE_ENTER'],
  ['HOME', 'KEYCODE_HOME'],
  ['TAB', 'KEYCODE_TAB'],
])

function canonicalDeviceAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)
    || action.action !== 'keyevent' || typeof action.keycode !== 'string') return action
  const keycode = action.keycode.trim().toUpperCase()
  const canonical = KEYCODE_ALIASES.get(keycode) ?? keycode
  return canonical === action.keycode ? action : { ...action, keycode: canonical }
}

function failedDeviceActionError(result, { runId, commandId, requestedActions, sentActions }) {
  const failed = Array.isArray(result.results)
    ? result.results.find(item => item && item.accepted === false) ?? null
    : null
  const index = Number.isInteger(failed?.index) ? failed.index : null
  const requested = index === null ? null : requestedActions[index] ?? null
  const sent = index === null ? null : sentActions[index] ?? null
  const outcome = result.outcome ?? failed?.outcome ?? 'failed'
  const rejected = outcome === 'rejected'
  const isKeyevent = requested?.action === 'keyevent' || sent?.action === 'keyevent'
  const isOpenApp = requested?.action === 'open_app' || sent?.action === 'open_app'
  const correction = !rejected ? null : isKeyevent
    ? 'For keyevent, use KEYCODE_BACK, KEYCODE_HOME, KEYCODE_ENTER, KEYCODE_DEL, KEYCODE_TAB, KEYCODE_APP_SWITCH, or KEYCODE_DPAD_*. BACK and HOME are accepted aliases and are normalized before sending.'
    : isOpenApp
      ? 'For open_app, provide package. component is optional and may be .ClassName or package/.ClassName; it must belong to package.'
      : 'Correct the failed action using the weftmod tool schema.'
  const nextStep = rejected
    ? `Call weftmod({action:'observe',run_id:'${runId}',include_screenshot:false}) before another act. Do not blindly resend command_id '${commandId}'; after observing, send a corrected action with a new command_id if needed.`
    : `This action may already have taken effect. Call weftmod({action:'observe',run_id:'${runId}',include_screenshot:false}) before another act. Do not resend command_id '${commandId}' or send a replacement action until the observation shows whether the intended state is already present.`
  return Object.assign(new Error(JSON.stringify({
    run_id: runId,
    command_id: commandId,
    accepted: false,
    outcome,
    requires_observation: result.requires_observation === true,
    failed_action_index: index,
    requested_action: requested,
    sent_action: sent,
    backend_detail: failed?.detail ?? null,
    correction,
    next_step: nextStep,
  })), { code: rejected ? 'WEFTMOD_DEVICE_ACTION_REJECTED' : outcome === 'uncertain' ? 'WEFTMOD_DEVICE_ACTION_UNCERTAIN' : 'WEFTMOD_DEVICE_ACTION_FAILED' })
}

export class WeftModService {
  constructor({ root, ctx, transport, identity, approve, image, desktop }) {
    Object.assign(this, { ctx, transport, identity, approve, image, desktop })
    this.store = new WeftModStore(root)
    this.active = new Map()
    this.deviceOwners = new Map()
    this.currentDevices = new Map()
    this.directDeviceEvidence = new Map()
    this.currentTargets = new Map()
    this.ready = this.store.initialize().then(async () => {
      const owners = await this.store.deviceOwners()
      for (const saved of owners) this.deviceOwners.set(saved.run_id, saved.session_id)
      // Also cover a host-only restart while the device service stays alive.
      await Promise.allSettled(owners.map(saved => this.transport.controlDeviceRun(saved.run_id, 'pause')))
    })
  }
  captureTarget(owner, target, workspace = null, origin = null) {
    if (!owner || typeof target !== 'string' || !target.trim()) return
    this.currentTargets.set(owner, { target: target.trim(), workspace, origin, captured_at: new Date().toISOString() })
  }
  async suspendPendingOnUserInput(owner, origin) {
    if (owner && origin?.message_id) await this.store.suspendPendingOnUserInput(owner, origin)
  }
  async continuation(owner, origin, signal) {
    await this.ready
    if (signal?.aborted || !owner || !origin?.message_id) return null
    return this.store.nextPendingContinuation(owner, origin)
  }
  async reuseCandidates(query) {
    await this.ready
    return (await this.store.scripts(query)).filter(script => script.successful_runs > 0).slice(0, 3).map(({ script_id, description, applicability, parameter_names, successful_runs, verified_runs, reusable, reuse_status, revision, sha256, match_score }) => ({
      script_id, description, applicability, parameter_names, successful_runs, verified_runs, reusable, reuse_status, revision, sha256, match_score,
    }))
  }
  isActiveScriptDevice(runId) {
    for (const state of this.active.values()) if (state.devices.has(runId)) return true
    return false
  }
  beginTopLevelEvidence(runId, result) {
    // A nested script owns its run only while it remains active.  Once it has
    // settled, the same conversation may deliberately resume that paused run
    // at top level to observe and repair it.  That handoff is a new direct
    // workflow, not a retroactive script completion.
    if (this.isActiveScriptDevice(runId)) return
    this.directDeviceEvidence.set(runId, {
      actions: [], last_observation: null,
      device_profile_id: result?.device_profile_id ?? null,
    })
  }
  async device(args, exec) {
    await this.ready
    exec.signal?.throwIfAborted()
    if (args.action === 'devices') {
      let phones, error
      try { phones = (await this.transport.deviceProfiles(exec.signal)).items } catch (e) { phones = []; error = e.message }
      return { desktop: { platform: process.platform, available: process.platform === 'win32' }, phones, ...(error ? { phone_error: error } : {}) }
    }
    if (args.action === 'desktop') {
      await this.approve(exec, `desktop:${args.desktop?.action}`)
      const input = { ...args.desktop }
      if (input.action === 'open' && !input.working_directory && exec.agent?.session?.header?.cwd) input.working_directory = exec.agent.session.header.cwd
      const result = await this.desktop(input, { signal: exec.signal })
      if (result.ok === false) throw Object.assign(new Error(`${result.error?.code ?? 'DESKTOP_FAILED'}: ${result.error?.message ?? 'Desktop operation failed'}`), { code: result.error?.code })
      return this.image(result, exec)
    }
    if (args.action === 'begin') {
      const authorization = await this.approve(exec, 'device')
      let profile = args.device_profile_id
      if (!profile || profile === 'default') {
        const profiles = (await this.transport.deviceProfiles(exec.signal)).items
        profile = profiles.find(p => p.is_default)?.device_profile_id
        if (!profile) throw new Error('No default phone. Use devices and choose a device_profile_id, or select a default in settings.')
      }
      const connectionKey = `${sessionId(exec)}:${profile}`
      const currentId = this.currentDevices.get(connectionKey)
      if (!args.run_id && currentId) {
        const current = await this.transport.deviceRun(currentId, exec.signal).catch(() => null)
        if (current?.status === 'active') return { ...current, reused_connection: true }
        this.currentDevices.delete(connectionKey)
      }
      const id = args.run_id ?? `device-${randomUUID()}`
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error('Invalid device run identifier')
      const existing = await this.store.deviceOwner(id)
      if (existing && existing.session_id !== sessionId(exec)) throw new Error('This device run belongs to another conversation')
      this.deviceOwners.set(id, sessionId(exec))
      // Keep the execution handle discoverable after a process restart.
      await this.store.saveDeviceOwner(id, sessionId(exec))
      try {
        // Settle creation before cancellation so a late accepted create cannot orphan a lease.
        const result = await this.transport.createDeviceRun({ run_id: id, device_profile_id: profile, origin: this.identity(exec), authorization_mode: authorization })
        exec.signal?.throwIfAborted()
        this.currentDevices.set(connectionKey, id)
        if (exec.parent === undefined) this.directDeviceEvidence.set(id, { actions: [], last_observation: null, device_profile_id: result.device_profile_id ?? profile })
        return result
      } catch (error) {
        await this.transport.controlDeviceRun(id, 'pause').catch(() => {})
        throw error
      }
    }
    await this.assertDeviceOwner(args.run_id, sessionId(exec))
    if (args.action === 'observe') {
      // Nested ToolRuntime calls carry parent: exec.token.  Their XML default
      // protects existing saved scripts that read ui_tree.xml; top-level
      // conversation calls receive compact observations by default.
      const uiTreeFormat = args.ui_tree_format ?? (exec.parent === undefined ? 'compact' : 'xml')
      const observation = await this.transport.observeDeviceRun(args.run_id, {
        include_screenshot: args.include_screenshot === true,
        ui_tree_format: uiTreeFormat,
      }, exec.signal)
      if (exec.parent === undefined && this.directDeviceEvidence.has(args.run_id)) this.directDeviceEvidence.get(args.run_id).last_observation = runtimeEvidence(observation)
      return this.image(observation, exec)
    }
    if (args.action === 'act') {
      if (!Array.isArray(args.actions) || !args.actions.length) throw new Error('actions must contain one or more device actions')
      let stopping
      const commandId = args.command_id ?? `command-${randomUUID()}`
      const actions = args.actions.map(canonicalDeviceAction)
      // Any dispatched action, including an uncertain/rejected one, can have
      // changed the UI.  A prior observation is never terminal evidence after it.
      if (exec.parent === undefined && this.directDeviceEvidence.has(args.run_id)) this.directDeviceEvidence.get(args.run_id).last_observation = null
      const stop = () => { stopping = this.transport.controlDeviceRun(args.run_id, 'pause').catch(() => {}) }
      exec.signal?.addEventListener('abort', stop, { once: true })
      try {
        const result = await this.transport.actDeviceRun(args.run_id, {
          command_id: commandId, actions,
        }, exec.signal)
        if (!result.accepted) throw failedDeviceActionError(result, {
          runId: args.run_id, commandId, requestedActions: args.actions, sentActions: actions,
        })
        if (exec.parent === undefined && this.directDeviceEvidence.has(args.run_id)) this.directDeviceEvidence.get(args.run_id).actions.push({
          command_id: commandId,
          actions: runtimeEvidence(actions),
          receipt: runtimeEvidence(result),
          completed_at: new Date().toISOString(),
        })
        return result
      } catch (error) {
        if (['AI_GAME_TIMEOUT', 'AI_GAME_UNAVAILABLE', 'AI_GAME_CALL_ABORTED'].includes(error.code)) {
          let pauseConfirmed = false
          await this.transport.controlDeviceRun(args.run_id, 'pause').then(() => { pauseConfirmed = true }).catch(() => {})
          throw new Error(JSON.stringify({ run_id: args.run_id, command_id: commandId, accepted: false, outcome: 'uncertain', requires_observation: true, pause_confirmed: pauseConfirmed, error: error.message }))
        }
        throw error
      } finally {
        exec.signal?.removeEventListener('abort', stop)
        if (stopping) await stopping
      }
    }
    if (args.action === 'inspect') return this.transport.deviceRun(args.run_id, exec.signal)
    if (args.action === 'control') {
      const result = await this.transport.controlDeviceRun(args.run_id, args.control, exec.signal)
      let pendingScript = null
      if (args.control === 'complete' && result.status === 'completed' && exec.parent === undefined) {
        const evidence = this.directDeviceEvidence.get(args.run_id)
        if (evidence?.actions.length && evidence.last_observation) {
          const pending = {
            evidence_id: `device-evidence-${randomUUID()}`,
            status: 'captured',
            captured_at: new Date().toISOString(),
            target: this.currentTargets.get(sessionId(exec))?.target ?? null,
            workspace: this.currentTargets.get(sessionId(exec))?.workspace ?? null,
            origin: this.currentTargets.get(sessionId(exec))?.origin ?? null,
            device_profile_id: evidence.device_profile_id ?? null,
            actions: evidence.actions,
            last_observation: evidence.last_observation,
            completion_receipt: runtimeEvidence(result),
          }
          await this.store.recordPendingScript(args.run_id, pending)
          pendingScript = {
            evidence_id: pending.evidence_id,
            status: pending.status,
            target: pending.target,
            workflow_requirement: 'Save a complete reusable workflow: observe each new start state, locate current nodes/bounds, navigate to the target when needed, and use the zero-action assert/complete path only when the target is already visible. Do not hard-code this run_id, an old observation_id, or old coordinates.',
          }
        }
        this.directDeviceEvidence.delete(args.run_id)
      }
      if (args.control !== 'resume') for (const [key, id] of this.currentDevices) if (id === args.run_id) this.currentDevices.delete(key)
      if (args.control === 'pause' || args.control === 'cancel') await this.store.suspendPendingForControl(args.run_id, args.control)
      if (args.control === 'resume') {
        if (result.device_profile_id) this.currentDevices.set(`${sessionId(exec)}:${result.device_profile_id}`, args.run_id)
        if (exec.parent === undefined) this.beginTopLevelEvidence(args.run_id, result)
      }
      return pendingScript ? { ...result, pending_script: pendingScript } : result
    }
    throw new Error('Unknown WeftMod device operation')
  }
  async assertDeviceOwner(runId, owner) {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error('A valid device run_id is required')
    if (!this.deviceOwners.has(runId)) {
      const saved = await this.store.deviceOwner(runId)
      if (!saved) throw new Error('Device run not found; begin a new device operation')
      this.deviceOwners.set(runId, saved.session_id)
    }
    if (!owner || this.deviceOwners.get(runId) !== owner) throw new Error('This device run belongs to another conversation')
  }
  async script(args, exec) {
    await this.ready
    const owner = sessionId(exec)
    if (!owner) throw new Error('WeftMod requires a conversation')
    if (args.action === 'list') {
      const scripts = await this.store.scripts(args.query ?? '')
      return { scripts, matching: !args.query ? 'catalog' : scripts.some(s => s.match_score > 0) ? 'keyword_ranked' : 'catalog_fallback', note: 'Choose by meaning and applicability. A keyword miss does not mean no reusable script exists.' }
    }
    if (args.action === 'read') {
      if (!args.script_id) throw new Error('read requires script_id from the list or save result')
      const script = await this.store.script(args.script_id)
      if (!script) throw new Error('Script not found')
      return script
    }
    if (args.action === 'save') {
      const { code, ...metadata } = await this.store.save({ ...args, script_id: args.script_id || `script-${randomUUID()}` })
      const pending = await this.store.bindPendingScript(owner, metadata)
      return { ...metadata, ...(pending ? { pending_script: { evidence_id: pending.evidence_id, status: pending.status, target: pending.target } } : {}) }
    }
    if (args.action === 'help') return {
      language: 'JavaScript async function body; top-level await and return. Input parameters are available as params.',
      workspace: exec.agent?.session?.header?.cwd ?? null,
      available_tools: this.ctx.tools.schemas(exec.agent).filter(t => !['run_code', 'weftmod_script'].includes(t.name)).map(t => t.name),
      tools: this.ctx.tools.schemas(exec.agent).filter(t => (args.tool_names ?? ['weftmod', 'pwsh', 'read', 'write']).includes(t.name))
        .map(t => ({ ...t, output: this.ctx.tools.get?.(t.name, exec.agent)?.output?.schema ?? null })),
      device_return_shapes: {
        note: 'Documentation shapes only, not device observations. Failed actions throw; inspect their error before retrying.',
        begin: '{run_id:string,status:string,device_profile_id:string,requires_observation:boolean}',
        observe: '{run_id:string,observation_id:string,captured_at:string,ui_tree:{format:"compact",nodes:array,total:number,returned:number,truncated:boolean,status:string}|{format:"xml",xml:string|null,status:string,fallback_reason?:string},device_state:object,screenshot:null|{width:number,height:number,mime_type:string},image?:attachmentReference}',
        act: '{run_id:string,command_id:string,accepted:boolean,outcome:string,completed_count:number,results:array,requires_observation:boolean,replayed:boolean}',
        desktop_windows: '{ok:true,windows:[{window_id:string,title:string,process_id:number,bounds:object}]}',
        desktop_inspect: '{ok:true,window_id:string,controls:[{element_id:string,automation_id:string,name:string,control_type:string,bounds:object,value?:string}],truncated:boolean}',
        desktop_open: '{ok:true,action:"open",path:string,process_id:number|null}',
        script_terminal_verification: 'For a pending phone workflow, begin a fresh run on the same profile, observe with explicit ui_tree_format:"compact", assert the required node/target (throw a repair error if absent), then after every act observe compact again. Return {verification:{matched:true,observation_id:string,target:string}} using that fresh final observation and call successful weftmod control complete for the same device afterwards. A return value alone never makes a script reusable.',
      },
      example: 'const d = await tools.weftmod({action:"begin"}); const state = await tools.weftmod({action:"observe",run_id:d.run_id,include_screenshot:false}); await tools.weftmod({action:"control",run_id:d.run_id,control:"complete"}); return state;',
    }
    if (args.action === 'history') return { runs: (await this.store.runs(owner)).slice(0, 30) }
    if (args.action === 'inspect') return this.ownedRun(args.run_id, owner)
    if (args.action === 'control') return this.control(args.run_id, args.control, owner)
    if (args.action !== 'run') throw new Error('Unknown script operation')
    if (!args.script_id && !args.code) throw new Error('run requires script_id from save/list, or code to run and save a new script')
    const script = args.code
      ? await this.store.save({ ...args, script_id: args.script_id || `script-${randomUUID()}` })
      : await this.store.script(args.script_id)
    if (!script) throw new Error('Script not found. Use list to find its script_id, or provide code.')
    if (args.code) await this.store.bindPendingScript(owner, script)
    const originTurn = this.identity(exec)?.dsh_turn_id ?? null
    const sourceDevice = await this.store.pendingForScript(owner, script, args.source_device_run_id, originTurn)
    if (sourceDevice?.ambiguous) throw new Error('More than one pending direct task uses this script. Provide source_device_run_id from the pending receipt before running it.')
    await this.approve(exec, 'script')
    const controller = new AbortController()
    const signal = exec.signal ? AbortSignal.any([exec.signal, controller.signal]) : controller.signal
    const reuseAttempted = (script.verified_runs ?? 0) > 0 || (script.verification_contract_version === undefined && (script.successful_runs ?? 0) > 0)
    const run = await this.store.newRun({ session_id: owner, script_id: script.script_id, script_revision: script.revision, sha256: script.sha256, params: args.params ?? {}, source_device_run_id: sourceDevice?.run_id ?? null, reused: false, reuse_attempted: reuseAttempted })
    const state = { controller, run, signal, devices: new Set(), inFlight: new Set(), queue: Promise.resolve(), stop: null }
    this.active.set(run.run_id, state)
    const persist = patch => {
      state.queue = state.queue.then(async () => {
        Object.assign(run, patch)
        await this.store.updateRun(run.run_id, run)
      })
      return state.queue
    }
    let sequence = 0
    const verificationEvidence = { observations: new Map(), effects: new Map(), begins: new Map(), completed: null, last_observation: null }
    const functions = Object.create(null)
    for (const tool of this.ctx.tools.schemas(exec.agent)) {
      if (['run_code', 'weftmod_script'].includes(tool.name)) continue
      functions[tool.name] = args => {
        const perform = async () => {
          signal.throwIfAborted()
          const number = ++sequence
          const started = Date.now()
          if (tool.name === 'weftmod' && args.run_id) {
            await this.assertDeviceOwner(args.run_id, owner)
            state.devices.add(args.run_id)
          }
          if (tool.name === 'weftmod' && args.action === 'act') verificationEvidence.effects.set(args.run_id, { sequence: number })
          await persist({ tool_calls: sequence, current_action: tool.name })
          const result = await this.ctx.tools.execute({
            callId: `${exec.callId}:script:${number}`, rootCallId: exec.rootCallId, parent: exec.token,
            name: tool.name, arguments: args, agent: exec.agent, signal,
          })
          for (const context of result.additionalContexts ?? []) exec.deferContext(context)
          if (result.concludesTurn) exec.concludeTurn?.()
          if (tool.name === 'weftmod' && args.action === 'begin' && result.value?.run_id) {
            state.devices.add(result.value.run_id)
            verificationEvidence.begins.set(result.value.run_id, { sequence: number, device_profile_id: result.value.device_profile_id ?? null })
          }
          if (tool.name === 'weftmod' && args.action === 'control' && ['complete', 'cancel'].includes(args.control)) state.devices.delete(args.run_id)
          if (tool.name === 'weftmod' && args.action === 'observe' && typeof result.value?.observation_id === 'string') {
            const observation = { sequence: number, run_id: args.run_id, ui_tree_format: args.ui_tree_format ?? null, value: runtimeEvidence(result.value) }
            verificationEvidence.observations.set(result.value.observation_id, observation)
            verificationEvidence.last_observation = observation
          }
          if (tool.name === 'weftmod' && args.action === 'control' && args.control === 'complete' && result.isError !== true) {
            verificationEvidence.completed = { sequence: number, run_id: args.run_id, receipt: runtimeEvidence(result.value) }
          }
          const step = { number, tool: tool.name, operation: args.action ?? null, elapsed_ms: Date.now() - started, succeeded: !result.isError }
          if (result.isError) step.error = textOf(result)
          run.steps.push(step)
          await persist({ steps: run.steps.slice(), current_action: null })
          if (result.isError) throw new Error(textOf(result))
          return result.value ?? null
        }
        const pending = perform()
        state.inFlight.add(pending)
        pending.then(() => state.inFlight.delete(pending), () => state.inFlight.delete(pending))
        return pending
      }
    }
    let result
    try {
      result = await this.ctx.codeRuntime.run({
        program: `const params = ${JSON.stringify(args.params ?? {})};\n${script.code}`,
        bindings: [{ global: 'tools', functions, errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' } }], signal,
      })
    } catch (error) { result = { logs: [], error: { kind: 'exception', message: error.message } } }
    finally {
      controller.abort()
      await Promise.allSettled([...state.inFlight])
      await state.queue
      // Release physical device ownership even if a script throws or is stopped.
      await Promise.allSettled([...state.devices].map(id => this.transport.controlDeviceRun(id, state.stop === 'cancel' ? 'cancel' : 'pause')))
      this.active.delete(run.run_id)
    }
    const executionStatus = state.stop === 'pause' ? 'paused' : state.stop === 'cancel' || exec.signal?.aborted ? 'cancelled' : result.error ? 'failed' : 'succeeded'
    const verification = executionStatus === 'succeeded'
      ? terminalVerification(result, verificationEvidence, sourceDevice)
      : { terminal_verified: false, reason: `Script status is ${executionStatus}.` }
    // Existing non-device worker snippets keep their historical success
    // semantics.  A pending workflow, or a script already verified once, must
    // produce fresh terminal evidence on every run before it counts again.
    const requiresTerminalVerification = Boolean(sourceDevice) || script.verification_required === true || (script.verified_runs ?? 0) > 0
    const status = executionStatus === 'succeeded' && requiresTerminalVerification && !verification.terminal_verified ? 'unverified' : executionStatus
    const repairContext = status === 'succeeded' ? null : {
      observation_id: verificationEvidence.last_observation?.value?.observation_id ?? null,
      ui_tree_format: verificationEvidence.last_observation?.ui_tree_format ?? null,
      observation: verificationEvidence.last_observation?.value ?? null,
      failure_code: result.error?.kind ?? null,
      next_step: 'Begin a fresh device run, observe the current visible state, and repair the script from that observation. Do not resend an uncertain action.',
    }
    const finished = await this.store.updateRun(run.run_id, {
      status, ended_at: new Date().toISOString(), elapsed_ms: Date.now() - Date.parse(run.started_at), current_action: null,
      logs: result.logs, result: result.value ?? null, error: result.error ?? null, verification, repair_context: repairContext,
    })
    const reused = status === 'succeeded' && reuseAttempted
    const completed = await this.store.updateRun(finished.run_id, { reused, reuse_attempted: reuseAttempted })
    if (status === 'succeeded') await this.store.recordSuccess(script, run.run_id, { terminalVerified: verification.terminal_verified })
    if (status === 'succeeded' && verification.terminal_verified) await this.store.verifyPendingScript(owner, script, verification)
    else await this.store.recordPendingScriptRun(owner, script, finished)
    return { ...completed, note: verification.terminal_verified
      ? 'The script run has terminal observation evidence. Verify the requested overall result before reporting the user goal complete.'
      : script.verification_required === true || sourceDevice
        ? 'This execution is not reusable yet. Return verification.matched:true with the final observation_id after inspecting the terminal state, then complete the device run.'
        : 'Legacy execution completed without linked terminal-verification metadata. It remains compatible, but do not claim a newly verified reusable workflow from this receipt.' }
  }
  async ownedRun(id, owner) {
    const run = await this.store.run(id)
    if (!run || run.session_id !== owner) throw new Error('Script run not found in this conversation')
    return run
  }
  async control(id, action, owner) {
    const run = await this.ownedRun(id, owner)
    if (!['pause', 'cancel'].includes(action)) throw new Error('Use pause or cancel; to continue, inspect current state and call the existing script with appropriate parameters')
    const active = this.active.get(id)
    if (active) {
      active.stop = action
      active.controller.abort()
      await Promise.allSettled([...active.devices].map(device => this.transport.controlDeviceRun(device, action)))
      await this.store.suspendPendingForScriptControl(owner, run.script_id, action)
      return { ...run, status: 'stopping' }
    }
    if (action === 'cancel' && ['paused', 'interrupted'].includes(run.status)) {
      await this.store.suspendPendingForScriptControl(owner, run.script_id, action)
      return this.store.updateRun(id, { status: 'cancelled' })
    }
    return run
  }
  async close() {
    for (const active of this.active.values()) { active.stop = 'pause'; active.controller.abort() }
    await Promise.allSettled([...this.deviceOwners.keys()].map(id => this.transport.controlDeviceRun(id, 'pause')))
  }
}
