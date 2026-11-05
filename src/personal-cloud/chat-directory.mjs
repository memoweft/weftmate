import { randomUUID } from 'node:crypto';
import { failure } from '../personal-access/common.mjs';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import { directoryPage, validCursor } from './directory-wire.mjs';

function candidates(account, hostId) {
  const identity = account.chatIdentity;
  if (identity?.version !== 2) throw failure('CHAT_INITIALIZING',503);
  const privateChats = new Set();
  for (const segment of Object.values(identity.segments)) {
    const session = account.sessions[segment.sessionId];
    if (hasPrivateContent(session) || session?.phoneHistory) privateChats.add(segment.chatId);
  }
  const candidates = [];
  for (const chat of Object.values(identity.chats)) {
    if (chat.kind !== 'side' || privateChats.has(chat.chatId)) continue;
    const segment = identity.segments[chat.activeSegmentId], session = account.sessions[segment?.sessionId];
    if (!session || !segment) throw failure('CHAT_INITIALIZING',503);
    if (segment.hostId === hostId) candidates.push({chat,session,id:segment.sessionId});
  }
  return candidates;
}

export function reconcileDirectory(feed, candidates, descriptions, activityTime) {
  const rows = new Map(feed.rows.map(r => [r.id,r])), present = new Set();
  let seq = feed.seq, partial = false;
  for (const {chat,session,id} of candidates) {
    present.add(chat.chatId);
    const prior = rows.get(chat.chatId);
    if (prior?.deleted || session.deleting) continue;
    const info = descriptions.get(id);
    const nativeTitle = info?.unavailable ? null : info?.title;
    if (session.title == null && typeof nativeTitle !== 'string') partial = true;
    const title = (session.title ?? nativeTitle ?? prior?.title ?? '').slice(0,256);
    const times = [chat.createdAt,activityTime(id), info?.updatedAt, prior?.updatedAt].map(t => Date.parse(t)).filter(Number.isFinite);
    const updatedAt = new Date(Math.max(...times)).toISOString();
    const contentRevision=chat.contentRevision??1;
    if (!prior || title !== prior.title || updatedAt !== prior.updatedAt || contentRevision!==prior.contentRevision)
      rows.set(chat.chatId,{id:chat.chatId,title,updatedAt,contentRevision,seq:++seq});
  }
  for (const row of rows.values()) {
    if (!row.deleted && !present.has(row.id)) rows.set(row.id,{id:row.id,seq:++seq,deleted:true});
  }
  return {feed:{epoch:feed.epoch,seq,rows:[...rows.values()]},partial};
}

export function createDirectoryPull(context, hostId, authorize, withCodec, persist, label) {
  // Order native metadata reads as well as journal commits for each source account.
  const pending = new Map();
  return async function pull(request, box) {
    const identity = authorize(request);
    const {issuer,sub,deviceId,ownerId} = identity;
    const scope = JSON.stringify([issuer,sub]);
    return withCodec(issuer,sub,hostId, async codec => {
      let query;
      try { query = await codec.open('pull',box); } catch { throw failure('DIRECTORY_INVALID',403); }
      if (query?.deviceId !== deviceId || typeof query.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(query.requestId) ||
          !validCursor(query.cursor)) throw failure('DIRECTORY_INVALID',403);
      const work = (pending.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const check = () => {
          const now = authorize(request);
          if (now.deviceId !== deviceId || now.ownerId !== ownerId || now.sub !== sub || now.keyId !== identity.keyId)
            throw failure('UNAUTHORIZED',401);
          return now.binding;
        };
        check();
        const initial = candidates(context.accountState(ownerId),hostId);
        let described;
        try { described = await context.sessionOperations.describe(ownerId,initial.filter(c => !c.session.deleting).map(c => c.id)); }
        catch { described = new Map(); }
        return context.serial(async () => {
          const binding = check();
          const old = binding.directoryBox ? await codec.open('source',binding.directoryBox) : {epoch:randomUUID(),seq:0,rows:[]};
          if (query.epoch !== null && query.epoch !== old.epoch) throw failure('DIRECTORY_RESET',409);
          const current = candidates(context.accountState(ownerId),hostId);
          const {feed,partial} = reconcileDirectory(old,current,described,id => context.sessionOperations.activityTime(ownerId,id));
          const page = directoryPage(feed,query.cursor);
          if (!binding.directoryBox || feed.seq !== old.seq) await persist(scope,await codec.seal('source',feed));
          return {box:await codec.seal('page',{...page,requestId:query.requestId,label:label(ownerId),partial})};
        });
      });
      pending.set(scope,work);
      try { return await work; } finally { if (pending.get(scope) === work) pending.delete(scope); }
    });
  };
}
