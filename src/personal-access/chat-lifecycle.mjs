import { createHmac, randomBytes } from 'node:crypto';
import { digest, exactKeys, failure } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';
import { conversationResources } from './resources.mjs';

export function createChatLifecycle(context) {
  const flights = new Map(), secret = randomBytes(32);
  const segments = (ownerId, chatId) => Object.values(context.accountState(ownerId).chatIdentity.segments)
    .filter(row => row.chatId === chatId).sort((a,b) => a.ordinal - b.ordinal);
  const cursor = data => { const raw = Buffer.from(JSON.stringify(data)).toString('base64url'); return `${raw}.${createHmac('sha256',secret).update(raw).digest('base64url')}`; };
  return {
    async preview(ownerId, chatId) {
      const revision = context.chats.requireChat(ownerId, chatId).contentRevision;
      const rows = segments(ownerId, chatId), items = new Map(), evidenceIds = new Set(); let worldRevision;
      for (const row of rows) {
        const preview = await context.sessionOperations.previewSessionForget(ownerId, row.sessionId);
        if (worldRevision !== undefined && worldRevision !== preview.worldRevision) throw failure('MEMORY_REVISION_CHANGED', 409);
        worldRevision = preview.worldRevision;
        for (const item of preview.items) items.set(`${item.kind}/${item.id}`, item);
        for (const id of preview.evidenceIds) evidenceIds.add(id);
      }
      if (worldRevision === undefined) worldRevision = (await context.memoryManager?.query(ownerId, 'query_world', { operation: 'revision' }))?.world_revision;
      if (!Number.isSafeInteger(worldRevision)) throw failure('MEMORY_UNAVAILABLE', 503);
      if (context.chats.requireChat(ownerId, chatId).contentRevision !== revision) throw failure('REVISION_CHANGED', 409);
      return { chatId, contentRevision: revision, sessionCount: rows.length, snippetCount: evidenceIds.size,
        worldRevision, itemCount: items.size, evidenceCount: evidenceIds.size, evidenceIds: [...evidenceIds], items: [...items.values()] };
    },
    async write(ownerId, chatId, action, body, authorize) {
      const extra = action === 'metadata' ? ['title','pinned','unread','groupId','projectId','memoryMode','recallEnabled','autoDeleteDays']
        : action === 'delete' ? ['forgetMemories','deleteConversationSnippets','memoryWorldRevision','expectedContentRevision'] : [];
      exactKeys(body, ['requestId','expectedRevision',...extra], ['requestId','expectedRevision']);
      if (!REQUEST_ID.test(body.requestId ?? '') || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 ||
          ['forgetMemories','deleteConversationSnippets'].some(key => body[key] !== undefined && typeof body[key] !== 'boolean') ||
          body.deleteConversationSnippets && !body.forgetMemories ||
          body.memoryWorldRevision !== undefined && (!body.forgetMemories || !Number.isSafeInteger(body.memoryWorldRevision) || body.memoryWorldRevision < 0) ||
          body.expectedContentRevision !== undefined && (!Number.isSafeInteger(body.expectedContentRevision) || body.expectedContentRevision < 1)) throw failure('INVALID_REQUEST');
      const fingerprint = digest(JSON.stringify({ chatId, action, ...Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b))) }));
      const key = `${ownerId}/${body.requestId}`, prior = context.accountState(ownerId).chatOperations?.[body.requestId];
      if (prior && prior.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409);
      if (flights.has(key)) return flights.get(key);
      const work = (async () => {
        const operation = await context.serial(async () => {
          authorize(); const account = context.accountState(ownerId), previous = account.chatOperations?.[body.requestId];
          if (previous) return previous;
          if (context.requestIdUsed(account, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
          const chat = context.chats.requireChat(ownerId, chatId);
          if (chat.kind === 'main') throw failure('MAIN_CHAT_PROTECTED', 409);
          if (chat.revision !== body.expectedRevision || body.expectedContentRevision !== undefined && body.expectedContentRevision !== chat.contentRevision) throw failure('REVISION_CHANGED', 409);
          const record = { chatId, action, phase: 'pending', fingerprint, sessionIds: segments(ownerId, chatId).map(row=>row.sessionId) };
          await context.mutate(ownerId, next => {
            next.chatIdentity.chats[chatId].revision++;
            next.chatOperations ??= {}; next.chatOperations[body.requestId] = record;
          });
          return record;
        });
        if (operation.response) {
          if (operation.response.deleted || !context.accountState(ownerId).chatIdentity.chats[chatId]) return { chatId, deleted: true };
          return { chat: await context.chats.view(ownerId, chatId) };
        }
        const { requestId, expectedRevision, expectedContentRevision, ...options } = body;
        for (const sessionId of operation.sessionIds) {
          authorize(); if (!context.accountState(ownerId).sessions[sessionId] && action === 'delete') continue;
          if (action === 'metadata') await context.sessionOperations.metadata(ownerId, sessionId, options);
          else if (action === 'delete') await context.sessionOperations.deleteSession(ownerId, sessionId, options);
          else await context.sessionOperations.archiveSession(ownerId, sessionId, action === 'archive');
        }
        // Retain the operation's identity, not a second title/source snapshot
        // that could outlive erasure. A replay projects current metadata.
        const response = action === 'delete' ? { chatId, deleted: true } : { chatId, completed: true };
        await context.serial(() => context.mutate(ownerId, next => { Object.assign(next.chatOperations[requestId], { phase: 'complete', response }); }));
        return action === 'delete' ? response : { chat: await context.chats.view(ownerId, chatId) };
      })().finally(() => flights.delete(key));
      flights.set(key, work); return work;
    },
    async resources(ownerId, chatId, params) {
      if ([...params.keys()].some(key => !['cursor','limit'].includes(key) || params.getAll(key).length !== 1)) throw failure('INVALID_REQUEST');
      const limit = Number(params.get('limit') ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw failure('INVALID_REQUEST');
      const revision = context.chats.requireChat(ownerId, chatId).contentRevision;
      if (context.accountState(ownerId).memoryCleanupPending) throw failure('SESSION_BUSY', 409);
      const rows = segments(ownerId, chatId); let position = 0, afterSeq = -1, offset = 0;
      if (params.has('cursor')) {
        try {
          const [raw, signature, extra] = params.get('cursor').split('.');
          if (extra || signature !== createHmac('sha256',secret).update(raw).digest('base64url')) throw 0;
          const [owner, id, rev, segment, after, skip] = JSON.parse(Buffer.from(raw,'base64url').toString());
          if (owner !== ownerId || id !== chatId || rev !== revision) throw 0;
          position = segment; afterSeq = after; offset = skip;
        } catch { throw failure('CURSOR_RESET_REQUIRED', 409); }
      }
      const items = []; let pagesRead = 0;
      while (position < rows.length && items.length < limit && pagesRead++ < 1) {
        const segment = rows[position], result = await conversationResources(context, context.accountState(ownerId), segment.sessionId, ownerId, afterSeq);
        const page = [...(afterSeq < 0 ? result.outputs : []).map(value => ({ type: 'output', value })), ...result.sources.map(value => ({ type: 'source', value }))];
        const selected = page.slice(offset, offset + limit - items.length);
        items.push(...selected.map(row => ({ ...row, value: { ...row.value, chatId, sessionId: segment.sessionId, segmentId: segment.segmentId } })));
        offset += selected.length;
        if (offset < page.length) break;
        offset = 0;
        if (result.hasMore) afterSeq = result.nextSeq;
        else { position++; afterSeq = -1; }
      }
      if (context.chats.requireChat(ownerId, chatId).contentRevision !== revision) throw failure('CURSOR_RESET_REQUIRED', 409);
      return { outputs: items.filter(row=>row.type==='output').map(row=>row.value), sources: items.filter(row=>row.type==='source').map(row=>row.value),
        hasMore: position < rows.length, nextCursor: position < rows.length ? cursor([ownerId,chatId,revision,position,afterSeq,offset]) : null, contentRevision: revision };
    },
  };
}
