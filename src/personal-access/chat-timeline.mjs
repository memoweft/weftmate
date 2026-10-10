import { createHmac, randomBytes } from 'node:crypto';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { digest, failure } from './common.mjs';

const pad = n => String(n).padStart(16, '0');
const formatters = new Map();
const day = (at, zone) => {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit' }));
  return formatters.get(zone).format(new Date(at));
};
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const searchable = type => ['user.message', 'assistant.message', 'side.result'].includes(type);

/** Rebuildable locator/search index. Bodies remain in native history. No timer,
 * polling worker, model call, or private native payload is stored here. */
export function createChatTimeline(context) {
  const secret = randomBytes(32), indexes = new Map(), jobs = new Set(), segmentGroups = new WeakMap();
  let closed = false;
  function token(index, kind, position, filter = '') {
    const body = Buffer.from(JSON.stringify([index.ownerId, index.chatId, index.generation, kind, position, filter])).toString('base64url');
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  }
  function decode(index, value, kind, filter = '') {
    try {
      const [body, signature, extra] = value.split('.');
      if (extra || signature !== createHmac('sha256', secret).update(body).digest('base64url')) throw 0;
      const [owner, chat, generation, type, position, filters] = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (owner !== index.ownerId || chat !== index.chatId || generation !== index.generation || type !== kind || filters !== filter) throw 0;
      return position;
    } catch { throw failure('CURSOR_RESET_REQUIRED', 409); }
  }
  function segments(ownerId, chatId) {
    const source = context.accountState(ownerId).chatIdentity.segments;
    let groups = segmentGroups.get(source);
    if (!groups) {
      groups = new Map();
      for (const segment of Object.values(source)) { if (!groups.has(segment.chatId)) groups.set(segment.chatId, []); groups.get(segment.chatId).push(segment); }
      for (const rows of groups.values()) rows.sort((a,b) => a.ordinal-b.ordinal || a.segmentId.localeCompare(b.segmentId));
      segmentGroups.set(source,groups);
    }
    return groups.get(chatId) ?? [];
  }
  function current(ownerId, chatId) {
    if (context.accountState(ownerId).memoryCleanupPending) throw failure('SESSION_BUSY', 409);
    const chat = context.chats.requireChat(ownerId, chatId), key = `${ownerId}/${chatId}`;
    let index = indexes.get(key);
    if (!index || index.contentRevision !== chat.contentRevision) {
      if (index) index.retired = true;
      index = { ownerId, chatId, contentRevision: chat.contentRevision, generation: randomBytes(16).toString('hex'),
        rows: new Map(), ordered: [], changes: [], removed: new Set(), revision: 0, segments: new Map(), queue: Promise.resolve(), job: null, error: null };
      indexes.set(key, index);
    }
    return index;
  }
  function serial(index, fn) {
    const pending = index.queue.then(fn); index.queue = pending.catch(() => {}); return pending;
  }
  function put(index, segment, raw) {
    if (context.accountState(index.ownerId).sessions[segment.sessionId]?.forgottenSeqs?.includes(raw.seq)) return;
    const event = context.publicHistoryEvent(index.ownerId, segment.sessionId, raw);
    const eventId = `event-${digest(`${segment.hostId}/${segment.sessionId}/${event.seq}`)}`;
    if (index.removed.has(eventId)) return;
    const old = index.rows.get(eventId), hash = digest(JSON.stringify(event));
    if (old?.hash === hash) return;
    const row = { eventId, orderKey: `${pad(segment.ordinal)}:${segment.segmentId}:${pad(event.seq)}`,
      sessionId: segment.sessionId, segmentId: segment.segmentId, hostId: segment.hostId, seq: event.seq,
      at: event.at ?? segment.startedAt, type: event.type, revision: (old?.revision ?? 0) + 1, hash,
      text: searchable(event.type) ? String(event.data?.text ?? event.data?.summary ?? '').slice(0, 16000) : '',
      hasArtifact: Boolean(event.data?.artifactId || event.data?.artifacts?.length || event.data?.originalAttachments?.length) };
    index.rows.set(eventId, row);
    if (!old) {
      let lo = 0, hi = index.ordered.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (index.ordered[mid].orderKey < row.orderKey) lo = mid + 1; else hi = mid; }
      index.ordered.splice(lo, 0, row);
    } else index.ordered[index.ordered.indexOf(old)] = row;
    index.changes.push({ revision: ++index.revision, eventId });
  }
  async function read(index, segment, options) {
    if (closed || context.accountState(index.ownerId).chatIdentity.segments[segment.segmentId]?.chatId !== index.chatId) return null;
    const page = await context.callBackend(() => context.backend.readEvents({ ownerId: index.ownerId, sessionId: segment.sessionId, ...options }));
    if (index.retired) throw failure('CURSOR_RESET_REQUIRED', 409);
    if (!Array.isArray(page?.events) || !Number.isSafeInteger(page.nextSeq)) throw failure('BACKEND_UNAVAILABLE', 503);
    for (const event of page.events) put(index, segment, event);
    return page;
  }
  async function seed(index) {
    // Newest segments first; first readable page never waits for backfill.
    for (const segment of segments(index.ownerId, index.chatId).reverse()) {
      if (index.segments.has(segment.segmentId)) continue;
      const page = await read(index, segment, { limit: 50 });
      if (!page) continue;
      index.segments.set(segment.segmentId, { high: page.nextSeq,
        before: page.nextBeforeSeq ?? page.events[0]?.seq, complete: !(page.hasOlder ?? page.hasMore) });
      if (index.ordered.length >= 50) break;
    }
  }
  async function refresh(index) {
    for (const segment of segments(index.ownerId, index.chatId)) {
      const state = index.segments.get(segment.segmentId);
      if (!state) continue;
      // One bounded increment per segment/request. hasMore keeps the sync loop live.
      const page = await read(index, segment, { afterSeq: state.high, limit: 200 });
      if (page) { state.high = page.nextSeq; state.more = page.hasMore; }
    }
  }
  function building(index) {
    return segments(index.ownerId, index.chatId).some(s => !index.segments.get(s.segmentId)?.complete);
  }
  function backfill(index) {
    if (closed || index.job || !building(index)) return;
    index.job = (async () => {
      while (!closed && !index.retired && building(index)) {
        await yieldLoop();
        await serial(index, async () => {
          if (index.retired || closed) return;
          const segment = segments(index.ownerId, index.chatId).reverse().find(s => !index.segments.get(s.segmentId)?.complete);
          if (!segment) return;
          let state = index.segments.get(segment.segmentId);
          const page = await read(index, segment, { limit: 200, ...(state ? { beforeSeq: state.before } : {}) });
          if (!page) return;
          if (!state) { state = { high: page.nextSeq }; index.segments.set(segment.segmentId, state); }
          const before = page.nextBeforeSeq ?? page.events[0]?.seq;
          const complete = !(page.hasOlder ?? page.hasMore);
          if (!complete && (!Number.isSafeInteger(before) || state.before !== undefined && before >= state.before)) throw failure('BACKEND_UNAVAILABLE', 503);
          state.before = before; state.complete = complete;
        });
      }
    })().catch(error => { index.error = error; }).finally(() => { jobs.delete(index.job); index.job = null; });
    jobs.add(index.job);
  }
  async function hydrate(index, rows) {
    const bodies = new Map();
    // Coalesce contiguous source ranges; never copy all history to hydrate a page.
    for (const sessionId of new Set(rows.filter(row => !row.product).map(row => row.sessionId))) {
      const selected = rows.filter(row => row.sessionId === sessionId).sort((a,b) => a.seq-b.seq);
      const wanted = new Set(selected.map(row => row.seq));
      let afterSeq = selected[0].seq - 1;
      while (wanted.size) {
        const page = await context.callBackend(() => context.backend.readEvents({ ownerId: index.ownerId, sessionId, afterSeq, limit: Math.min(200, wanted.size) }));
        for (const event of page.events) if (wanted.delete(event.seq)) bodies.set(`${sessionId}/${event.seq}`, context.publicHistoryEvent(index.ownerId, sessionId, event));
        if (!page.hasMore || page.nextSeq <= afterSeq || page.nextSeq >= selected.at(-1).seq) break;
        afterSeq = page.nextSeq;
      }
    }
    return rows.flatMap(row => {
      if (row.product) {
        const result = context.accountState(index.ownerId).chatResults?.[row.resultId];
        if (!result) return [];
        return [{ eventId: row.eventId, chatId: index.chatId, orderKey: row.orderKey, revision: row.revision,
          type: 'side.result', at: row.at, sourceRef: result.sourceRef,
          data: { resultId: result.resultId, sourceChatId: result.sourceChatId, sourceEventId: result.sourceEventId,
            ...(result.taskId ? { taskId: result.taskId } : {}), state: result.state, summary: result.summary,
            resultRevision: result.resultRevision, requiresResponse: result.requiresResponse, artifactRefs: result.artifactRefs,
            activityId: result.activityId, notificationRevision: result.notificationRevision, ...(result.deleted ? { deleted: true } : {}) } }];
      }
      const event = bodies.get(`${row.sessionId}/${row.seq}`);
      if (!event) return [];
      return [{ eventId: row.eventId, chatId: index.chatId, orderKey: row.orderKey, revision: row.revision,
        type: event.type, at: row.at, sourceRef: { kind: 'native', hostId: row.hostId, sessionId: row.sessionId, seq: row.seq },
        data: event.data }];
    });
  }
  function parse(params, keys) {
    if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1)) throw failure('INVALID_REQUEST');
    const limit = params.get('limit') ?? '50';
    if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200) throw failure('INVALID_REQUEST');
    return Number(limit);
  }
  function zone(index) { return context.usage?.settings(index.ownerId)?.timeZone ?? context.accountState(index.ownerId).chatIdentity.timeZone; }
  function info(index) {
    const chat = context.chats.requireChat(index.ownerId, index.chatId);
    return { contentRevision: index.contentRevision, chatRevision: chat.revision, unread: chat.unread === true,
      indexState: index.error ? 'failed' : building(index) ? 'building' : 'ready', timeZone: zone(index) };
  }
  function dateOf(row, timeZone) {
    if (row.dateZone !== timeZone) { row.dateZone = timeZone; row.date = day(row.at, timeZone); }
    return row.date;
  }
  function products(index) {
    const account = context.accountState(index.ownerId);
    if (index.chatId !== account.chatIdentity.mainChatId) return;
    for (const result of Object.values(account.chatResults ?? {})) {
      const old = index.rows.get(result.mainEventId);
      if (old?.revision === result.resultRevision) continue;
      const row = { product: true, resultId: result.resultId, eventId: result.mainEventId, orderKey: result.orderKey,
        revision: result.resultRevision, type: 'side.result', at: result.at, text: result.deleted ? '' : result.summary,
        hasArtifact: result.artifactRefs.length > 0, sourceRef: result.sourceRef };
      index.rows.set(row.eventId, row);
      if (old) index.ordered[index.ordered.indexOf(old)] = row;
      else { let lo = 0, hi = index.ordered.length; while (lo < hi) { const mid=(lo+hi)>>>1; if (index.ordered[mid].orderKey < row.orderKey) lo=mid+1; else hi=mid; } index.ordered.splice(lo,0,row); }
      index.changes.push({ revision: ++index.revision, eventId: row.eventId });
    }
  }
  return {
    // Account search uses the same rebuildable index and erasure generation as
    // in-conversation search. It never copies native history into another store.
    async searchAccount(ownerId, chatIds, q) {
      const revision = context.accountState(ownerId).activity?.generation ?? 0;
      const pages = await Promise.all(chatIds.map(async chatId => {
        const index = current(ownerId, chatId);
        const hits = await serial(index, async () => {
          await seed(index); await refresh(index); products(index);
          return index.ordered.filter(row => searchable(row.type) && !context.accountState(ownerId).sessions[row.sessionId]?.forgottenSeqs?.includes(row.seq) && row.text.toLowerCase().includes(q.toLowerCase())).map(row => {
            const offset = row.text.toLowerCase().indexOf(q.toLowerCase()), start = Math.max(0, offset - 60);
            return { chatId, eventId: row.eventId, sourceRef: row.sourceRef ?? { kind: 'native', hostId: row.hostId, sessionId: row.sessionId, seq: row.seq },
              at: row.at, snippet: row.text.slice(start, start + Math.max(200, q.length)), highlights: [{ start: offset - start, end: offset - start + q.length }] };
          });
        });
        if (index.retired) throw failure('CURSOR_RESET_REQUIRED', 409);
        backfill(index); return { hits, building: building(index) };
      }));
      if (revision !== (context.accountState(ownerId).activity?.generation ?? 0) || context.accountState(ownerId).memoryCleanupPending)
        throw failure('CURSOR_RESET_REQUIRED', 409);
      return { hits: pages.flatMap(page => page.hits), indexState: pages.some(page => page.building) ? 'building' : 'ready' };
    },
    async lastOrderKey(ownerId, chatId) {
      const index = current(ownerId, chatId);
      return serial(index, async () => { await seed(index); await refresh(index); return index.ordered.findLast(row => !row.product)?.orderKey ?? '!'; });
    },
    async query(ownerId, chatId, action, params) {
      const keys = { events: ['before','after','around','limit'], changes: ['cursor','limit'],
        dates: ['from','to'], locate: ['date'], search: ['q','from','to','role','hasArtifact','cursor','limit'] };
      const limit = parse(params, keys[action] ?? []), index = current(ownerId, chatId);
      const result = await serial(index, async () => {
        await seed(index); await refresh(index); products(index);
        const rows = index.ordered;
        if (action === 'events') {
          if (['before','after','around'].filter(key => params.has(key)).length > 1) throw failure('INVALID_REQUEST');
          let start = Math.max(0, rows.length - limit), deletedAnchor = false;
          if (params.has('before')) { const key = decode(index, params.get('before'), 'history'); start = Math.max(0, rows.findIndex(row => row.orderKey >= key) - limit); }
          if (params.has('after')) { const key = decode(index, params.get('after'), 'history'); const found = rows.findIndex(row => row.orderKey > key); start = found < 0 ? rows.length : found; }
          if (params.has('around')) { const found = rows.findIndex(row => row.eventId === params.get('around')); deletedAnchor = found < 0; start = found < 0 ? start : Math.max(0, found - Math.floor(limit / 2)); }
          let selected = rows.slice(start, start + limit);
          if (params.has('before')) { const key = decode(index, params.get('before'), 'history'); selected = selected.filter(row => row.orderKey < key); }
          return { items: await hydrate(index, selected), olderCursor: selected.length ? token(index, 'history', selected[0].orderKey) : null,
            newerCursor: selected.length ? token(index, 'history', selected.at(-1).orderKey) : null,
            hasOlder: start > 0 || building(index), hasNewer: start + selected.length < rows.length,
            syncCursor: token(index, 'sync', index.revision), deletedAnchor, ...info(index) };
        }
        if (action === 'changes') {
          if (!params.has('cursor')) throw failure('INVALID_REQUEST');
          const since = decode(index, params.get('cursor'), 'sync');
          const changes = index.changes.slice(since, since + limit);
          const ids = [...new Set(changes.map(row => row.eventId))];
          return { upserts: await hydrate(index, ids.map(id => index.rows.get(id)).filter(Boolean)),
            removals: changes.filter(row => row.reason).map(({ eventId, revision, reason }) => ({ eventId, revision, reason })),
            nextCursor: token(index, 'sync', changes.at(-1)?.revision ?? index.revision),
            hasMore: (changes.at(-1)?.revision ?? index.revision) < index.revision || [...index.segments.values()].some(s => s.more), ...info(index) };
        }
        if (action === 'dates' || action === 'locate') {
          const from = params.get(action === 'locate' ? 'date' : 'from'), to = action === 'locate' ? from : params.get('to');
          if (!dateValid(from) || !dateValid(to) || to < from || action === 'dates' && Date.parse(to) - Date.parse(from) > 31 * 86400000) throw failure('INVALID_REQUEST');
          const days = new Map(), timeZone = zone(index);
          for (const row of rows) { const date = dateOf(row, timeZone), old = days.get(date); days.set(date, { date, count: (old?.count ?? 0) + 1, firstEventId: old?.firstEventId ?? row.eventId, lastEventId: row.eventId }); }
          const ordered = [...days.keys()].sort();
          if (action === 'dates') return { days: ordered.filter(d => d >= from && d <= to).map(d => days.get(d)), ...info(index) };
          return { date: from, eventId: days.get(from)?.firstEventId ?? null, previousDate: ordered.filter(d => d < from).at(-1) ?? null,
            nextDate: ordered.find(d => d > from) ?? null, ...info(index) };
        }
        const q = params.get('q'), from = params.get('from'), to = params.get('to'), role = params.get('role'), artifact = params.get('hasArtifact');
        if (!q?.trim() || q.length > 256 || from && !dateValid(from) || to && !dateValid(to) || from && to && from > to ||
          role && !['user','assistant'].includes(role) || artifact !== null && !['true','false'].includes(artifact)) throw failure('INVALID_REQUEST');
        const timeZone = zone(index), filter = JSON.stringify([q,from,to,role,artifact,timeZone]), key = params.has('cursor') ? decode(index, params.get('cursor'), 'search', filter) : '';
        const matches = rows.filter(row => row.orderKey > key && searchable(row.type) && (!role || row.type === `${role}.message`) &&
          (artifact === null || row.hasArtifact === (artifact === 'true')) && (!from || dateOf(row, timeZone) >= from) &&
          (!to || dateOf(row, timeZone) <= to) && row.text.toLowerCase().includes(q.toLowerCase()));
        const selected = matches.slice(0, limit), hits = selected.map(row => {
          const offset = row.text.toLowerCase().indexOf(q.toLowerCase()), start = Math.max(0, offset - 60), snippet = row.text.slice(start, start + Math.max(200, q.length));
          return { eventId: row.eventId, sourceRef: row.sourceRef ?? { kind: 'native', hostId: row.hostId, sessionId: row.sessionId, seq: row.seq }, at: row.at,
            snippet, highlights: [{ start: offset - start, end: offset - start + q.length }] };
        });
        return { hits, nextCursor: matches.length > limit ? token(index, 'search', selected.at(-1).orderKey, filter) : null, hasMore: matches.length > limit, ...info(index) };
      });
      if (index.retired) throw failure('CURSOR_RESET_REQUIRED', 409);
      backfill(index); return result;
    },
    async ready(ownerId, chatId) { const index = current(ownerId, chatId); await serial(index, () => seed(index)); backfill(index); await index.job; if (index.error) throw index.error; },
    // IA-2b erasure calls this only after durable source deletion. A content
    // generation bump instead forces CURSOR_RESET_REQUIRED across restarts.
    removeEvents(ownerId, chatId, eventIds, reason = 'deleted') {
      if (!['deleted','forgotten'].includes(reason)) throw failure('INVALID_REQUEST');
      const index = current(ownerId, chatId);
      for (const eventId of eventIds) {
        if (index.removed.has(eventId)) continue;
        index.removed.add(eventId); index.rows.delete(eventId);
        index.changes.push({ eventId, revision: ++index.revision, reason });
      }
      index.ordered = index.ordered.filter(row => !index.removed.has(row.eventId));
    },
    invalidate(ownerId, chatId) { context.chats.invalidateSearch?.(ownerId); segmentGroups.delete(context.accountState(ownerId).chatIdentity.segments); const key = `${ownerId}/${chatId}`; const index = indexes.get(key); if (index) index.retired = true; indexes.delete(key); },
    async close() { closed = true; await Promise.all([...jobs, ...[...indexes.values()].map(index => index.queue)]); indexes.clear(); },
  };
}
