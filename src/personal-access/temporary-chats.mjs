import { failure } from './common.mjs';

export const retentionDays = [1, 7, 30, null];
export const hasPrivateContent = session => session?.temporary === true || session?.hasTemporaryContent === true || session?.memoryMode === 'off';
export function memorySettings(session = {}) {
  return { temporary: session.temporary === true, hasTemporaryContent: hasPrivateContent(session), memoryMode: session.memoryMode ?? 'on',
    recallEnabled: session.recallEnabled !== false, autoDeleteDays: session.autoDeleteDays ?? (session.autoDeleteDays === null ? null : 30),
    expiresAt: session.expiresAt ?? null };
}
export function validateMemorySettings(value) {
  if (value.temporary !== undefined && typeof value.temporary !== 'boolean' ||
      value.memoryMode !== undefined && !['on', 'off'].includes(value.memoryMode) ||
      value.recallEnabled !== undefined && typeof value.recallEnabled !== 'boolean' ||
      value.autoDeleteDays !== undefined && !retentionDays.includes(value.autoDeleteDays)) throw failure('INVALID_REQUEST');
}
export function initialMemorySettings(value, now) {
  validateMemorySettings(value);
  if (!value.temporary) return {};
  const days = value.autoDeleteDays === undefined ? 30 : value.autoDeleteDays;
  return { temporary: true, hasTemporaryContent: true, memoryMode: 'off', recallEnabled: value.recallEnabled !== false,
    autoDeleteDays: days, expiresAt: days === null ? null : new Date(now + days * 86400000).toISOString() };
}

/** Freeze before the first model step; retries and turn-end use the same durable policy. */
export function createTemporaryChats(context) {
  let timer, flight;
  async function sweep() {
    if (flight) return flight;
    flight = (async () => {
      for (const [ownerId, account] of Object.entries(context.rootState.accounts)) {
        for (const [sessionId, session] of Object.entries(account.sessions)) {
          if (!session.expiresAt || Date.parse(session.expiresAt) > context.timestamp()) continue;
          try { await context.sessionOperations.deleteSession(ownerId, sessionId); }
          catch (error) { if (!['SESSION_BUSY', 'BACKEND_UNAVAILABLE', 'BACKEND_TIMEOUT', 'SESSION_UNAVAILABLE'].includes(error.code)) throw error; }
        }
      }
    })().finally(() => { flight = null; });
    return flight;
  }
  return {
    async policy(ownerId, sessionId, turn) {
      if (!Number.isSafeInteger(turn) || turn < 0) throw failure('INVALID_REQUEST');
      return context.serial(async () => {
        const session = context.accountState(ownerId).sessions[sessionId];
        if (!session || session.deleting) throw failure('SESSION_UNAVAILABLE', 404);
        if (session.memoryTurns?.[turn]) return structuredClone(session.memoryTurns[turn]);
        const policy = { ingest: session.memoryMode !== 'off', recall: session.recallEnabled !== false,
          resetContext: session.memoryMode !== 'off' && hasPrivateContent(session) };
        if (policy.resetContext) {
          const previous = Object.entries(session.memoryTurns ?? {}).map(([id, value]) => ({ turn: Number(id), ...value }));
          const lastPrivate = Math.max(-1, ...previous.filter(row => !row.ingest).map(row => row.turn));
          policy.contextStartTurn = Math.min(turn, ...previous.filter(row => row.ingest && row.turn > lastPrivate).map(row => row.turn));
        }
        await context.mutate(ownerId, next => {
          const row = next.sessions[sessionId]; row.memoryTurns ??= {}; row.memoryTurns[turn] = policy;
          if (!policy.ingest) row.hasTemporaryContent = true;
        });
        return policy;
      });
    },
    sweep,
    start() { timer = setInterval(() => { void sweep().catch(() => {}); }, 60_000); timer.unref?.(); void sweep().catch(() => {}); },
    async close() { clearInterval(timer); await flight; },
  };
}
