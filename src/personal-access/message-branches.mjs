import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { digest, exactKeys, failure } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';
import { chatForSession } from './chat-identity.mjs';

/** Branch metadata only. DSH owns the event seed, lineage and execution. */
export function createMessageBranches(context) {
  const owned = (ownerId, sessionId, write = true) => {
    const session = context.accountState(ownerId).sessions[sessionId];
    if (!session || session.deleting) throw failure('SESSION_UNAVAILABLE', 404);
    if (!['personal-remote', 'shared-chat'].includes(session.origin) || write && session.archived) throw failure('SESSION_READ_ONLY', 409);
    return session;
  };
  function versions(ownerId, sessionId) {
    owned(ownerId, sessionId, false);
    const account = context.accountState(ownerId), groups = new Map();
    for (const operation of Object.values(account.messageBranches ?? {}).sort((a,b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))) {
      const branch = operation.response;
      if (!account.sessions[branch.sessionId] || !account.sessions[branch.sourceSessionId]) continue;
      if (!groups.has(branch.groupId)) groups.set(branch.groupId, []);
      groups.get(branch.groupId).push(branch);
    }
    return { groups: [...groups.values()].filter(rows => rows.some(row =>
      row.sessionId === sessionId || row.sourceSessionId === sessionId)).map(rows => {
      const first = rows[0];
      return { groupId: first.groupId, action: first.action, sourceSessionId: first.sourceSessionId,
        sourceSeq: first.sourceSeq, versions: [{ sessionId: first.sourceSessionId, anchorSeq: first.sourceSeq },
          ...rows.map(row => ({ sessionId: row.sessionId, afterSeq: row.seedThroughSeq }))] };
    }) };
  }
  async function create(ownerId, sessionId, body) {
    exactKeys(body, ['requestId', 'seq', 'action', 'modelProfileId'], ['requestId', 'seq', 'action']);
    if (!REQUEST_ID.test(body.requestId ?? '') || !Number.isSafeInteger(body.seq) || body.seq < 0 ||
        !['edit', 'regenerate'].includes(body.action) || body.modelProfileId !== undefined &&
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.modelProfileId)) throw failure('INVALID_REQUEST');
    const fingerprint = digest(JSON.stringify([sessionId, body.requestId, body.seq, body.action, body.modelProfileId ?? null]));
    return context.serial(async () => {
      const account = context.accountState(ownerId), source = owned(ownerId, sessionId);
      const previous = account.messageBranches?.[body.requestId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409);
        owned(ownerId, previous.response.sessionId);
        return structuredClone(previous.response);
      }
      if (context.requestIdUsed(account, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
      if (chatForSession(account, sessionId)?.kind === 'main') throw failure('MAIN_CHAT_PROTECTED', 409);
      const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
      if (described.running || Object.values(account.commands).some(row => row.sessionId === sessionId &&
          ['pending', 'preflight', 'dispatching', 'uncertain'].includes(row.state))) throw failure('SESSION_BUSY', 409);
      const profile = body.modelProfileId ?? source.modelProfileId;
      if (!context.modelVisible(ownerId, profile)) throw failure('MODEL_UNAVAILABLE', 422);
      const events = []; let cursor = -1;
      do {
        const page = await context.callBackend(() => context.backend.readEvents({ ownerId, sessionId, afterSeq: cursor, limit: 200 }));
        events.push(...page.events.filter(event => event.seq <= body.seq));
        if (!page.hasMore || page.nextSeq >= body.seq) break;
        if (page.nextSeq <= cursor) throw failure('BACKEND_UNAVAILABLE', 503);
        cursor = page.nextSeq;
      } while (true);
      const anchor = events.find(event => event.seq === body.seq);
      if (anchor?.type !== (body.action === 'edit' ? 'user.message' : 'assistant.message') ||
          source.forgottenSeqs?.includes(body.seq) || anchor.data?.reminder) throw failure('SOURCE_UNAVAILABLE', 404);
      const user = body.action === 'edit' ? anchor : events.findLast(event => event.type === 'user.message');
      if (!user || source.forgottenSeqs?.includes(user.seq)) throw failure('SOURCE_UNAVAILABLE', 404);
      const command = Object.values(account.commands).find(row =>
        row.kind === 'session.message' && row.receiptId && row.receiptId === user.data?.receiptId);
      const priorEnd = events.findLast(event => event.type === 'turn.ended' && event.seq < user.seq)?.seq ?? -1;
      const start = events.find(event => event.type === 'turn.started' && event.seq > priorEnd && event.seq < user.seq);
      const earlierInput = start && events.some(event => event.type === 'user.message' && event.seq > start.seq && event.seq < user.seq);
      const beforeSeq = start && !earlierInput ? start.seq : user.seq, childId = `session-${randomUUID()}`;
      const inheritedGroup = versions(ownerId, sessionId).groups.find(group => group.action === body.action &&
        group.versions.some(version => version.sessionId === sessionId &&
          (version.anchorSeq === body.seq || version.afterSeq !== undefined &&
            events.find(event => event.seq > version.afterSeq && event.type === anchor.type)?.seq === body.seq)));
      const groupId = inheritedGroup?.groupId ?? `branch-${randomUUID()}`;
      const sendRequestId = `branch-send-${digest(body.requestId).slice(0, 40)}`;
      const attachments = [], originalAttachments = [], copiedIds = new Map(), attachmentMessageId = randomUUID();
      let fork;
      try {
        // Preserve the uploaded originals and the exact model input material. No
        // files are fetched from the user's working directory or reinterpreted.
        if (command?.payload.originalAttachments) for (const reference of command.payload.originalAttachments) {
          const store = context.attachmentStores.get(ownerId), found = await store.get(reference.attachmentId);
          const copy = await store.put({ ...reference, attachmentId: `attachment-${randomUUID()}`,
            conversationId: childId, messageId: attachmentMessageId, expectedSize: reference.size,
            stream: createReadStream(found.file, { start: found.offset }) });
          originalAttachments.push(copy.attachment);
          copiedIds.set(reference.attachmentId, copy.attachment.attachmentId);
        }
        if (command?.payload.attachments) {
          const store = context.sharedAttachmentStores.get(ownerId);
          let staged;
          try { staged = await store.resolve({ sessionId: command.payload.attachmentSessionId ?? command.sessionId,
            requestId: command.requestId, attachments: command.payload.attachments }); }
          catch (error) {
            if (error.code !== 'ATTACHMENT_NOT_FOUND') throw error;
            let imageIndex = 0;
            staged = [];
            for (const item of command.payload.attachments) {
              let bytes;
              if (item.contentType.startsWith('image/')) {
                const image = user.data?.images?.[imageIndex++];
                if (!image) throw failure('ATTACHMENT_NOT_FOUND', 404);
                bytes = (await context.callBackend(() => context.backend.readAttachment({ ownerId, sessionId,
                  attachmentId: image.attachmentId }))).bytes;
              } else {
                const found = await context.attachmentStores.get(ownerId).get(item.attachmentId);
                const handle = await open(found.file, 'r');
                try { bytes = Buffer.alloc(item.size); const read = await handle.read(bytes, 0, item.size, found.offset);
                  if (read.bytesRead !== item.size) throw failure('ATTACHMENT_NOT_FOUND', 404); }
                finally { await handle.close(); }
              }
              if (digest(bytes) !== item.sha256) throw failure('ATTACHMENT_NOT_FOUND', 404);
              staged.push({ ...item, bytes });
            }
          }
          for (const item of staged) attachments.push((await store.put({ ...item,
            attachmentId: copiedIds.get(item.attachmentId) ?? `attachment-${randomUUID()}`, sessionId: childId, requestId: sendRequestId })).attachment);
        }
        fork = await context.callBackend(() => context.backend.forkSession({ ownerId, sessionId,
          childId, modelProfileId: profile, title: source.title, beforeSeq }));
      } catch (error) {
        // These copies belong only to the newly allocated child, which was
        // never published. A failed native fork must not leave orphan inputs.
        try { await context.sharedAttachmentStores?.get(ownerId)?.removeSession(childId); } catch {}
        try { await context.attachmentStores?.get(ownerId)?.removeConversation(childId); } catch {}
        throw error;
      }
      const response = { sessionId: childId, title: fork.title, modelProfileId: profile, sendRequestId,
        text: command?.payload.text ?? user.data?.text ?? '', groupId, action: body.action,
        inputSourceSessionId: sessionId, userSeq: user.seq,
        sourceSessionId: inheritedGroup?.sourceSessionId ?? sessionId,
        sourceSeq: inheritedGroup?.sourceSeq ?? body.seq, seedThroughSeq: fork.latestSeq ?? beforeSeq - 1,
        ...(attachments.length ? { attachments } : {}),
        ...(originalAttachments.length ? { originalAttachments, attachmentMessageId } : {}) };
      await context.mutate(ownerId, next => {
        next.sessions[childId] = { ownerId, origin: source.origin, modelProfileId: profile,
          title: fork.title, parentSessionId: sessionId, pinned: false, unread: false,
          memoryMode: source.memoryMode ?? 'on', deepThinking: source.deepThinking ?? false,
          ...(source.approvalMode ? { approvalMode: source.approvalMode } : {}),
          ...(source.workspaceKind ? { workspaceKind: source.workspaceKind } : {}),
          ...(source.groupId ? { groupId: source.groupId } : {}),
          ...(source.projectId ? { projectId: source.projectId, projectRevision: source.projectRevision } : {}) };
        next.messageBranches ??= {};
        next.messageBranches[body.requestId] = { fingerprint, response,
          ordinal: Math.max(0, ...Object.values(next.messageBranches).map(row => row.ordinal ?? 0)) + 1 };
      });
      return response;
    });
  }
  return { create, versions };
}
