import { projectReplyEvidence } from '../personal-reply-evidence/index.mjs'

export const name = 'weftmate-personal-reply-evidence'
export const inject = ['agents']
export const PROTOCOL = 'weftmate.personal-reply-evidence.v1'
const ID = /^reply-evidence-[0-9a-f-]{36}$/
const SESSION = /^[A-Za-z0-9_-]{1,128}$/
const RECEIPT = /^[A-Za-z0-9._:-]{1,160}$/
const unknown = () => projectReplyEvidence('', { receiptId: 'unconfirmed' })
const SAVE_REPLY_HINT = '已实际保存并核验这份文件。请继续完成用户尚未完成的要求；如果已全部完成，请用一到两句简短确认成果与已读来源，然后结束本回合。不要重复保存同一文件。'

export async function savedDocumentReplyHint(ctx, payload, decision, messageFactory = null) {
  if (decision?.kind !== 'enter' || payload?.step < 2 ||
      payload?.agent?.session?.header?.agentPreset !== 'personal-remote') return decision
  const session = payload.agent.session
  const events = session.events
  if (!Array.isArray(events) || typeof session.id !== 'string') return decision
  const start = events.findLastIndex((event) => event?.type === 'turn/start' &&
    event.data?.turn === payload.turn)
  if (start < 0) return decision
  const users = events.slice(start + 1).filter((event) => event?.type === 'user/message' &&
    event.data?.source?.kind === 'user')
  if (users.length !== 1 || typeof users[0].data.source.rpcId !== 'string' ||
      !RECEIPT.test(users[0].data.source.rpcId) ||
      events.slice(start + 1).some((event) => event?.type === 'user/message' &&
        event.data?.source?.kind === 'plugin' && event.data.source.plugin === name)) return decision
  let deadlineTimer
  let artifact
  try {
    const persistence = ctx.get?.('sessionPersistence') ?? ctx.sessionPersistence
    if (typeof persistence?.readRaw !== 'function') return decision
    artifact = await Promise.race([
      persistence.readRaw(session.id, payload.signal).catch(() => null),
      new Promise((resolve) => { deadlineTimer = setTimeout(() => resolve(null), 1_500) }),
    ])
  } finally { clearTimeout(deadlineTimer) }
  if (artifact?.meta?.id !== session.id || artifact.meta.agentPreset !== 'personal-remote' ||
      typeof artifact.content !== 'string') return decision
  const evidence = projectReplyEvidence(artifact.content,
    { receiptId: users[0].data.source.rpcId, live: false })
  if (!evidence.toolSaveObserved || evidence.turn !== payload.turn ||
      evidence.status !== 'unconfirmed') return decision
  const factory = messageFactory ?? (await import('@deepseek-ai/dsh-llm/message')).createUserMessage
  const reminder = factory({ content: [{ type: 'text', text: SAVE_REPLY_HINT }],
    source: { kind: 'plugin', plugin: name } })
  return { ...decision, messages: [...decision.messages, reminder] }
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async (payload, next) => savedDocumentReplyHint(ctx, payload, await next()),
    { prepend: true })
  const receive = (frame) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
        Object.keys(frame).sort().join(',') !== 'id,protocol,receiptId,sessionId' ||
        frame.protocol !== PROTOCOL || typeof frame.id !== 'string' || !ID.test(frame.id) ||
        typeof frame.sessionId !== 'string' || !SESSION.test(frame.sessionId) ||
        typeof frame.receiptId !== 'string' || !RECEIPT.test(frame.receiptId)) return
    void Promise.resolve().then(async () => {
      const persistence = ctx.get?.('sessionPersistence') ?? ctx.sessionPersistence
      if (typeof persistence?.readRaw !== 'function') return unknown()
      const artifact = await persistence.readRaw(frame.sessionId)
      if (artifact?.meta?.id !== frame.sessionId ||
          !['personal-remote', 'personal-shared-chat'].includes(artifact.meta.agentPreset) ||
          typeof artifact.content !== 'string') return unknown()
      const agent = ctx.agents.get(frame.sessionId)
      const live = agent?.id === frame.sessionId && agent.status === 'running' &&
        agent.session?.header?.agentPreset === artifact.meta.agentPreset
      return projectReplyEvidence(artifact.content, { receiptId: frame.receiptId, live })
    }).then((result) => {
      try { process.send?.({ protocol: PROTOCOL, id: frame.id, result }) }
      catch { /* Parent timeout is unconfirmed. */ }
    }, () => {
      try { process.send?.({ protocol: PROTOCOL, id: frame.id, result: unknown() }) }
      catch { /* Parent timeout is unconfirmed. */ }
    })
  }
  process.on('message', receive)
  ctx.effect(() => () => process.off('message', receive), 'weftmate-personal-reply-evidence: IPC lifecycle')
}

export default { name, inject, apply }
