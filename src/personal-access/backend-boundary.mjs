import { validTime } from './common.mjs';
import { ID } from './constants.mjs';
import { readSourceEvents } from './source-history.mjs';

export const isRemoteSession = described => described?.agentPreset === 'personal-remote';
export const isSharedSession = described => described?.agentPreset === 'personal-shared-chat';
export const isPersonalSession = described => isRemoteSession(described) || isSharedSession(described);

export async function readTaskStopEvidence(context, account, source, stop, targets, observe) {
  const native = new Map();
  if (typeof context.backend.getTaskStopState === 'function') {
    await Promise.all(targets.filter(target => target.receiptId && target.ack !== 'queue_removed' &&
      account.commands[target.commandId]?.state === 'accepted_by_dsh').map(async target => {
      try {
        const result = await observe(() => context.backend.getTaskStopState({ sessionId: source.sessionId,
          receiptId: target.receiptId, turn: account.commands[target.commandId]?.dshTurn,
          stopRequestedAt: stop.at, ownerId: account.ownerId }));
        if (['ended', 'cancelled', 'not_running'].includes(result?.status) && validTime(result.observedAt)) {
          native.set(target.receiptId, result);
        }
      } catch { /* Unavailable native state cannot confirm a stop. */ }
    }));
  }
  const needsHistory = targets.some((target) => target.receiptId && target.ack !== 'queue_removed' && !native.has(target.receiptId));
  const turns = new Map();
  const receiptTurns = new Map();
  let historyComplete = !needsHistory;
  let invalidHistory = false;
  if (needsHistory) {
  let described;
  try { described = await observe(() => context.backend.describeSession(source.sessionId, account.ownerId)); }
  catch { return { unavailable: true }; }
  if (described?.sessionId !== source.sessionId || !isRemoteSession(described)) {
    return { unavailable: true };
  }
  let openTurn = null;
  try {
    const scoped = await Promise.all(targets.filter(target => target.receiptId && target.ack !== 'queue_removed')
      .map(target => readSourceEvents(context, { sessionId: source.sessionId, ownerId: account.ownerId,
        receiptId: target.receiptId, turn: account.commands[target.commandId]?.dshTurn }, observe)));
    const bySeq = new Map();
    for (const range of scoped) for (const event of range.events) bySeq.set(event.seq, event);
    const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      for (const event of events) {
        if (event.type === 'turn.started') {
          const turn = event.data?.turn;
          if (!Number.isSafeInteger(turn) || turn < 0 || openTurn !== null || turns.has(turn)) {
            invalidHistory = true; break;
          }
          openTurn = turn;
          turns.set(turn, { receipts: new Set(), users: new Set(), unknownUser: false, startedAt: event.at, ended: false });
        } else if (['user.message', 'input.claimed', 'task.started'].includes(event.type)) {
          if (openTurn === null) { invalidHistory = true; break; }
          if (event.type === 'task.started' && event.data?.turn !== openTurn) { invalidHistory = true; break; }
          const record = turns.get(openTurn);
          const receipts = event.type === 'input.claimed' ? event.data?.receipts ?? [null] : [event.data?.receiptId];
          for (const receiptId of receipts) {
            // Older lifecycle projections omit receipts; they add no binding evidence.
            if (event.type === 'task.started' && receiptId === undefined) continue;
            if (typeof receiptId !== 'string' || !ID.test(receiptId)) {
              record.unknownUser = true; continue;
            }
            record.receipts.add(receiptId);
            const duplicateUser = event.type === 'user.message' && record.users.has(receiptId);
            if (duplicateUser || receiptTurns.has(receiptId) && receiptTurns.get(receiptId) !== openTurn) receiptTurns.set(receiptId, null);
            else receiptTurns.set(receiptId, openTurn);
            if (event.type === 'user.message') record.users.add(receiptId);
          }
        } else if (event.type === 'turn.ended') {
          const turn = event.data?.turn;
          if (openTurn !== null && turn === openTurn) {
            const record = turns.get(turn);
            record.ended = true;
            record.reason = event.data?.reason;
            record.endedAt = event.at;
            openTurn = null;
          }
        }
      }
    historyComplete = true;
  } catch { /* Incomplete history is not proof of a closed turn. */ }
  }
  return { native, turns, receiptTurns, historyComplete, invalidHistory };
}
