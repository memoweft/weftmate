/** The personal-remote DSH agent inherits only its two bounded host tools. */
export const name = 'weftmate-personal-desktop-preset';
export const inject = ['tools'];

const MAX_NOTEPAD_CALLS_PER_TURN = 2;
const MAX_DOCUMENT_CALLS_PER_TURN = 2;

export function repeatedNotepadCalls(events, turn) {
  if (!Array.isArray(events) || !Number.isSafeInteger(turn)) return 0;
  return new Set(events.filter((event) => event?.type === 'tool/call' &&
    event.data?.turn === turn && event.data?.name === 'personal_open_notepad' &&
    typeof event.data?.callId === 'string').map((event) => event.data.callId)).size;
}

export function repeatedDocumentCalls(events, turn) {
  if (!Array.isArray(events) || !Number.isSafeInteger(turn)) return 0;
  return new Set(events.filter((event) => event?.type === 'tool/call' &&
    event.data?.turn === turn && event.data?.name === 'personal_save_document' &&
    typeof event.data?.callId === 'string').map((event) => event.data.callId)).size;
}

export function apply(ctx) {
  const dispose = ctx.tools.restrict({ allow: ['personal_open_notepad', 'personal_save_document'] });
  // The official loop records a blocked turn/end when pre-step rejects. A
  // repeated receipt is not progress on the user's goal; stop before another
  // model/tool step, while leaving every prior command and its outcome intact.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || payload.agent?.session?.header?.agentPreset !== 'personal-remote') return decision;
    return repeatedNotepadCalls(payload.agent.session.events, payload.turn) >= MAX_NOTEPAD_CALLS_PER_TURN ||
      repeatedDocumentCalls(payload.agent.session.events, payload.turn) >= MAX_DOCUMENT_CALLS_PER_TURN
      ? { kind: 'reject' } : decision;
  });
  ctx.effect(() => () => dispose(), 'weftmate-personal-desktop-preset: restricted tool roster');
}

export default { name, inject, apply };
