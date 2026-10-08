/** Read-only queue fence for a managed personal-host route reload. */
export const name = 'weftmate-personal-model-idle'
export const inject = ['agents']
export const PROTOCOL = 'weftmate.personal-model-idle.v1'
export const REASONS = Object.freeze({
  idle: 'idle',
  agentRunning: 'agent_running',
  inboxPending: 'inbox_pending',
  agentStateUnknown: 'agent_state_unknown',
  agentListUnknown: 'agent_list_unknown',
})

/** Fixed SDK contract: agents.list() returns live Agent[], with status and Inbox.hasPending. */
export function modelIdleSnapshot(value, inference = false) {
  if (!Array.isArray(value)) return { idle: false, reason: REASONS.agentListUnknown }
  let pending = false
  for (const agent of value) {
    if (!agent || !['idle', 'running'].includes(agent.status) ||
        typeof agent.inbox?.hasPending !== 'boolean') {
      return { idle: false, reason: REASONS.agentStateUnknown }
    }
    if (agent.status === 'running' && !(inference && agent[Symbol.for('weftmate.memoryRecallPending')])) return { idle: false, reason: REASONS.agentRunning }
    pending ||= agent.inbox.hasPending && !(inference && agent[Symbol.for('weftmate.memoryRecallPending')])
  }
  return pending ? { idle: false, reason: REASONS.inboxPending }
    : { idle: true, reason: REASONS.idle }
}

export function apply(ctx) {
  const receive = (frame) => {
    if (frame?.protocol !== PROTOCOL || typeof frame.id !== 'string' ||
        !/^model-idle-[a-f0-9-]{36}$/.test(frame.id)) return
    let snapshot = { idle: false, reason: REASONS.agentListUnknown }
    try {
      snapshot = modelIdleSnapshot(ctx.agents.list(), frame.inference === true)
    } catch { /* An incomplete agent view cannot prove idleness. */ }
    try { process.send?.({ protocol: PROTOCOL, id: frame.id, ...snapshot }) }
    catch { /* Parent timeout is a busy result. */ }
  }
  process.on('message', receive)
  ctx.effect(() => () => process.off('message', receive), 'weftmate-personal-model-idle: IPC lifecycle')
}

export default { name, inject, apply }
