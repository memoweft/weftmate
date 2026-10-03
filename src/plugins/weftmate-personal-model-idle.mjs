/** Read-only queue fence for a managed personal-host route reload. */
export const name = 'weftmate-personal-model-idle'
export const inject = ['agents']
export const PROTOCOL = 'weftmate.personal-model-idle.v1'

export function apply(ctx) {
  const receive = (frame) => {
    if (frame?.protocol !== PROTOCOL || typeof frame.id !== 'string' ||
        !/^model-idle-[a-f0-9-]{36}$/.test(frame.id)) return
    let idle = false
    try {
      const agents = ctx.agents.list()
      idle = Array.isArray(agents) && agents.every((agent) =>
        agent?.status !== 'running' && agent?.inbox?.hasPending === false)
    } catch { /* An incomplete agent view cannot prove idleness. */ }
    try { process.send?.({ protocol: PROTOCOL, id: frame.id, idle }) }
    catch { /* Parent timeout is a busy result. */ }
  }
  process.on('message', receive)
  ctx.effect(() => () => process.off('message', receive), 'weftmate-personal-model-idle: IPC lifecycle')
}

export default { name, inject, apply }
