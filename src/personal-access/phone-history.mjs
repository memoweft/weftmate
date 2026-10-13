import { createHash } from 'node:crypto';
import { failure } from './common.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const phoneTurnKey = turn => hash(`phone-turn-v1:${turn.id}`);
export const phoneTurnDigest = turn => hash(JSON.stringify({id:turn.id,conversationId:turn.conversationId,timestamp:turn.timestamp,
  messages:turn.messages.map(m=>({role:m.role,text:m.text}))}));
export function phoneConversation(turn, deviceName) {
  const at = new Date(turn.timestamp).toISOString();
  return { app: 'phone', id: turn.conversationId, turnId: turn.id, deviceName, at, until: at,
    title: turn.messages[0].text.slice(0, 80), fingerprint: phoneTurnKey(turn),memoryRefs:turn.memoryRefs??[],dependencyComplete:turn.dependencyComplete===true,
    characters: turn.messages.reduce((n, m) => n + m.text.length, 0),
    messages: turn.messages.map(m => ({ role: m.role, content: m.text, at })) };
}

/** Account-owned read-only history. All existing list/search/event/side-chat
 * paths use the same backend projection; there is no executable phone agent. */
export function createPhoneHistory(context, native) {
  const rows = ownerId => context.accountState(ownerId).phoneHistory ?? {};
  const find = (ownerId, sessionId) => ownerId ? Object.values(rows(ownerId)).find(c => c.sessionId === sessionId) : null;
  function events(c) {
    return c.turns.flatMap(turn => turn.messages.map((m, index) => ({ seq: turn.sequence + index,
      eventId:`event-${hash(`${context.rootState.hostId}/${c.sessionId}/${turn.sequence+index}`)}`,
      at: new Date(turn.timestamp).toISOString(), type: `${m.role}.message`,
      data: { text: m.text, phoneTurnId: turn.id, phoneSource: true,
        phoneEventId:`event-${hash(`${context.rootState.hostId}/${c.sessionId}/${turn.sequence+index}`)}` } })));
  }
  function description(c) { return { sessionId: c.sessionId, title: c.title, agentPreset: 'phone-history',
    running: false, phoneHistory: true, readOnly: true, deviceName: c.deviceName }; }
  const overrides = {
    async describeSession(sessionId, ownerId) { const c = find(ownerId, sessionId); return c ? description(c) : native.describeSession(sessionId, ownerId); },
    async describeSessions(ids, ownerId) {
      const ordinary = ids.filter(id => !find(ownerId, id));
      const result = native.describeSessions ? await native.describeSessions(ordinary, ownerId)
        : await Promise.all(ordinary.map(id => native.describeSession(id, ownerId)));
      return [...result.filter(Boolean), ...ids.map(id => find(ownerId, id)).filter(Boolean).map(description)];
    },
    async readEvents(input) {
      const c = find(input.ownerId, input.sessionId); if (!c) return native.readEvents(input);
      const all = events(c), size = input.limit ?? 100;
      let selected = all.filter(e => (input.afterSeq === undefined || e.seq > input.afterSeq) && (input.beforeSeq === undefined || e.seq < input.beforeSeq));
      const forward = input.afterSeq !== undefined;
      selected = forward ? selected.slice(0, size) : selected.slice(-size);
      return { events: selected, nextSeq: selected.at(-1)?.seq ?? input.afterSeq ?? -1,
        nextBeforeSeq: selected[0]?.seq ?? 0, latestSeq: all.at(-1)?.seq ?? -1,
        hasMore: forward && all.some(e => e.seq > (selected.at(-1)?.seq ?? input.afterSeq)),
        hasOlder: all.some(e => e.seq < (selected[0]?.seq ?? 0)) };
    },
    async readEventDetail(input){const c=find(input.ownerId,input.sessionId);if(!c)return native.readEventDetail?.(input);
      const event=events(c).find(e=>e.seq===input.seq);if(!event)throw failure('SOURCE_UNAVAILABLE',404);
      return {seq:event.seq,type:event.type,text:event.data.text};},
    async renameSession(input) { const c = find(input.ownerId, input.sessionId); return c ? { title: input.title } : native.renameSession(input); },
    async deleteSession(input) {
      const c = find(input.ownerId, input.sessionId); if (!c) return native.deleteSession?.(input);
      await context.serial(() => context.mutate(input.ownerId, next => { delete next.phoneHistory[c.id]; }));
      return { deleted: true };
    },
  };
  // Runtime/model routes can be replaced after service construction. Delegate
  // every ordinary operation dynamically rather than freezing a backend copy.
  const backend=new Proxy(native,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  return { backend,
    read(ownerId, key) {
      for (const c of Object.values(rows(ownerId))) { const turn = c.turns.find(t => phoneTurnKey(t) === key); if (turn) return phoneConversation(turn, c.deviceName); }
      throw failure('IMPORT_SOURCE_UNAVAILABLE', 409);
    },
    async receive(ownerId, deviceName, turns) {
      await context.serial(() => context.mutate(ownerId, next => {
        next.phoneHistory ??= {};
        for (const turn of turns) {
          const existing=Object.values(next.phoneHistory).flatMap(c=>c.turns).find(t=>t.id===turn.id);
          if(existing && phoneTurnDigest(existing)!==phoneTurnDigest(turn))throw failure('REQUEST_CONFLICT',409);
          const id = turn.conversationId, sessionId = `phone-${hash(`${ownerId}:${id}`).slice(0, 48)}`;
          const c = next.phoneHistory[id] ??= { id, sessionId, deviceName,
            title: `来自手机 · ${turn.messages[0].text.slice(0, 48)}`, turns: [] };
          const prior = c.turns.find(t => t.id === turn.id);
          if (prior) continue;
          const sequence = (c.turns.at(-1)?.sequence ?? -2) + 2;
          c.turns.push({ ...turn, sequence });
          next.sessions[sessionId] ??= { ownerId, origin: 'local-attached', phoneHistory: true,
            title: c.title, attachedAt: new Date(turn.timestamp).toISOString(), unread: false };
        }
      }));
      return turns.map(turn => { const c = rows(ownerId)[turn.conversationId]; return { id: turn.id,
        sessionId: c.sessionId, chatId: context.accountState(ownerId).chatIdentity?.segments[
          context.accountState(ownerId).chatIdentity?.sessionSegments[c.sessionId]]?.chatId }; });
    },
    async remove(ownerId, conversationIds) {
      await context.serial(() => context.mutate(ownerId, next => {
        for (const id of conversationIds) { const c = next.phoneHistory?.[id]; if (!c) continue;
          delete next.sessions[c.sessionId]; delete next.phoneHistory[id]; }
      }));
    },
  };
}
