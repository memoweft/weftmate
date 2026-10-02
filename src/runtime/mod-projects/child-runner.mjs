import { pathToFileURL } from 'node:url'

const [entryPath, stateRoot, mode, rawBehaviorChecks] = process.argv.slice(2)
const behaviorChecks = rawBehaviorChecks ? JSON.parse(rawBehaviorChecks) : null
let nextRequest = 0
const pending = new Map()
let lifecycle = null
let stopping = false

function send(message, callback) { process.send?.(message, callback) }
function request(method, args) {
  const requestId = `request-${++nextRequest}`
  send({ type: 'request', requestId, method, args })
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }))
}
const api = Object.freeze({
  state: Object.freeze({ read: () => request('state.read'), write: value => request('state.write', { value }) }),
  model: Object.freeze({ call: input => request('model.call', { input }) }),
  emit: (name, payload) => request('emit', { name, payload }),
  paths: Object.freeze({ state: stateRoot }),
})
function atPath(value, path) { return path.split('.').reduce((current, key) => current === null || current === undefined ? undefined : current[key], value) }

async function stop(reason = 'stop') {
  if (stopping) return
  stopping = true
  try { if (typeof lifecycle?.stop === 'function') await lifecycle.stop(api) } catch (error) { send({ type: 'error', phase: 'stop', error: serialize(error) }) }
  send({ type: 'stopped', reason })
  process.exit(0)
}
process.on('message', message => {
  if (message?.type === 'response') {
    const call = pending.get(message.requestId)
    if (!call) return
    pending.delete(message.requestId)
    message.error ? call.reject(Object.assign(new Error(message.error.message), message.error)) : call.resolve(message.value)
  }
  if (message?.type === 'invoke') {
    void Promise.resolve().then(async () => {
      if (typeof lifecycle?.handleUi !== 'function') throw new Error('This Mod does not export handleUi(api, request)')
      return lifecycle.handleUi(api, message.request)
    }).then(value => send({ type: 'invokeResult', requestId: message.requestId, value }), error => send({ type: 'invokeResult', requestId: message.requestId, error: serialize(error) }))
  }
  if (message?.type === 'stop') void stop(message.reason)
})
process.on('uncaughtException', error => { send({ type: 'error', phase: 'uncaughtException', error: serialize(error) }); process.exit(1) })
process.on('unhandledRejection', error => { send({ type: 'error', phase: 'unhandledRejection', error: serialize(error) }); process.exit(1) })

try {
  lifecycle = await import(pathToFileURL(entryPath).href)
  if (typeof lifecycle.start !== 'function') throw new Error('The Mod entry must export async start(api)')
  await lifecycle.start(api)
  if (mode === 'validate') {
    if (typeof lifecycle.selfTest !== 'function') throw new Error('The Mod entry must export async selfTest(api) for candidate validation')
    const receipt = await lifecycle.selfTest(api)
    if (!receipt || receipt.ok !== true || !Array.isArray(receipt.assertions) || receipt.assertions.length === 0) throw new Error('selfTest must return {ok:true, assertions:[...]} with at least one assertion')
    // A business check is host-configured by the maintenance turn.  It runs
    // the actual handler against isolated state; candidates cannot satisfy it
    // by only returning a self-reported assertion.
    if (behaviorChecks?.length) {
      if (typeof lifecycle.handleUi !== 'function') throw new Error('behaviorChecks require handleUi(api, request)')
      for (const check of behaviorChecks) {
        const before = await api.state.read() ?? {}
        let last = null
        for (let step = 0; step < check.steps; step++) last = await lifecycle.handleUi(api, { action: check.action, ...(check.payload === undefined ? {} : { payload: check.payload }) })
        const after = await api.state.read() ?? {}
        if (check.expect) {
          const observed = atPath({ state: after, result: last }, check.expect.path)
          const passed = check.expect.op === 'equals' ? JSON.stringify(observed) === JSON.stringify(check.expect.value) : Array.isArray(observed) && observed.some(value => JSON.stringify(value) === JSON.stringify(check.expect.value))
          receipt.assertions.push({ id: `behavior-check:${check.action}:${check.expect.path}`, passed, evidence: { kind: 'isolated-handleUi-json', action: check.action, payload: check.payload ?? null, path: check.expect.path, op: check.expect.op, expected: check.expect.value, observed } })
          continue
        }
        // Do not coerce arrays such as items into numbers: [] and [1] have
        // surprising Number() values and would let an array check masquerade
        // as a counter delta. Array and structured results use expect instead.
        const beforeValue = before[check.stateField]
        const afterValue = after[check.stateField]
        const delta = afterValue - beforeValue
        receipt.assertions.push({ id: `behavior-check:${check.action}:${check.stateField}`, passed: typeof beforeValue === 'number' && typeof afterValue === 'number' && Number.isFinite(beforeValue) && Number.isFinite(afterValue) && delta === check.expectedDelta, evidence: { kind: 'isolated-handleUi', action: check.action, steps: check.steps, stateField: check.stateField, expectedDelta: check.expectedDelta, before: beforeValue, after: afterValue, delta, lastResult: last } })
      }
    }
    if (typeof lifecycle.stop === 'function') await lifecycle.stop(api)
    send({ type: 'validated', receipt }, () => process.exit(0))
  } else {
    send({ type: 'started' })
  }
} catch (error) {
  send({ type: 'error', phase: 'start', error: serialize(error) }, () => process.exit(1))
}

function serialize(error) { return { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null } }
