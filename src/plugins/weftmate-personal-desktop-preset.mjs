/** The personal-remote DSH agent uses the existing native tool capabilities. */
export const name = 'weftmate-personal-desktop-preset';
export const inject = ['tools'];

const MAX_NOTEPAD_CALLS_PER_TURN = 2;
const MAX_PROJECT_LIST_CALLS_PER_TURN = 3;
const MAX_PROJECT_READ_CALLS_PER_TURN = 12;
const MAX_BROWSER_OPEN_CALLS_PER_TURN = 5;
const MAX_BROWSER_FOLLOW_CALLS_PER_TURN = 10;
const MAX_BROWSER_SEGMENT_CALLS_PER_TURN = 128;

function distinctCalls(events, turn, name) {
  if (!Array.isArray(events) || !Number.isSafeInteger(turn)) return 0;
  return new Set(events.filter((event) => event?.type === 'tool/call' &&
    event.data?.turn === turn && event.data?.name === name &&
    typeof event.data?.callId === 'string').map((event) => event.data.callId)).size;
}

export function repeatedNotepadCalls(events, turn) {
  return distinctCalls(events, turn, 'personal_open_notepad');
}

export function repeatedDocumentCalls(events, turn) {
  return distinctCalls(events, turn, 'personal_save_document');
}

export function apply(ctx) {
  // Keep native capability and authority checks. Do not freeze the assistant's tool roster.
  // These two globals belong to the privileged Mod editor and retired fixed-app path.
  const denied = new Set(['mod_sdk', 'personal_open_notepad']);
  const dispose = ctx.tools.restrict({ deny: [...denied] });
  const disposeGuard = ctx.tools.guard(exec => denied.has(exec.name) ? 'PERSONAL_TOOL_SCOPE_DENIED' : undefined);
  // Preserve the existing non-document bounds. Text saves can include retries
  // or multiple deliverables and must allow the next model step and final reply.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || payload.agent?.session?.header?.agentPreset !== 'personal-remote') return decision;
    return repeatedNotepadCalls(payload.agent.session.events, payload.turn) >= MAX_NOTEPAD_CALLS_PER_TURN ||
      distinctCalls(payload.agent.session.events, payload.turn, 'personal_list_project_files') >= MAX_PROJECT_LIST_CALLS_PER_TURN ||
      distinctCalls(payload.agent.session.events, payload.turn, 'personal_read_project_file') >= MAX_PROJECT_READ_CALLS_PER_TURN ||
      distinctCalls(payload.agent.session.events, payload.turn, 'personal_browser_open') >= MAX_BROWSER_OPEN_CALLS_PER_TURN ||
      distinctCalls(payload.agent.session.events, payload.turn, 'personal_browser_follow') >= MAX_BROWSER_FOLLOW_CALLS_PER_TURN ||
      distinctCalls(payload.agent.session.events, payload.turn, 'personal_browser_read_segment') >= MAX_BROWSER_SEGMENT_CALLS_PER_TURN
      ? { kind: 'reject' } : decision;
  });
  ctx.effect(() => () => { disposeGuard(); dispose(); }, 'weftmate-personal-desktop-preset: restricted tool roster');
}

export default { name, inject, apply };
