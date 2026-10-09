import { digest, exactKeys, failure, modelProfileId, validId } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';
import { readSourceEvents } from './source-history.mjs';
import { chatForSession } from './chat-identity.mjs';
import { randomUUID } from 'node:crypto';

const short = value => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, 160).join('');
const nativeId = (hostId, sessionId, seq) => `event-${digest(`${hostId}/${sessionId}/${seq}`)}`;
const states = { completed: 'completed', failed: 'failed', aborted: 'stopped' };

/** Side creation uses the existing durable session.create command internally.
 * Product result references never append messages to a native session. */
export function createSideChats(context) {
  const flights = new Map();
  function sourceSession(ownerId, chatId) {
    const account = context.accountState(ownerId), chat = context.chats.requireChat(ownerId, chatId);
    const segment = account.chatIdentity.segments[chat.activeSegmentId], session = account.sessions[segment?.sessionId];
    if (session?.memoryMode === 'off') throw failure('TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED', 409);
    if (session?.conversationId || session?.origin === 'shared-chat') throw failure('SHARED_CONTEXT_UNAVAILABLE', 409);
    if (session?.deleting) throw failure('SOURCE_UNAVAILABLE', 404);
    return { account, chat, segment, session };
  }
  async function source(ownerId, chatId, eventId) {
    sourceSession(ownerId, chatId);
    await context.chatTimeline.ready(ownerId, chatId);
    const page = await context.chatTimeline.query(ownerId, chatId, 'events', new URLSearchParams({ around: eventId, limit: '1' }));
    const event = page.items.find(item => item.eventId === eventId);
    if (!event || !['user.message','assistant.message'].includes(event.type) || event.sourceRef.kind !== 'native') throw failure('SOURCE_UNAVAILABLE', 404);
    const account = context.accountState(ownerId), session = account.sessions[event.sourceRef.sessionId];
    if (!session || session.deleting || session.memoryMode === 'off' || session.conversationId || session.origin === 'shared-chat') throw failure('SOURCE_UNAVAILABLE', 404);
    return event;
  }
  function validatePrepared(ownerId, prepared) {
    const account = context.accountState(ownerId);
    if (prepared.parent.kind === 'main') {
      if (prepared.parent.id !== account.chatIdentity.mainChatId) throw failure('CHAT_UNAVAILABLE', 404);
    } else {
      const project = account.projects?.[prepared.parent.id];
      if (!context.hostOwner(ownerId) || !project || project.revoked) throw failure('PROJECT_REVOKED', 409);
    }
    for (const ref of prepared.contextTransfer.sourceRefs) {
      const { chat } = sourceSession(ownerId, ref.chatId);
      if (chat.contentRevision !== ref.contentRevision) throw failure('SOURCE_UNAVAILABLE', 404);
      if (chatForSession(account, ref.sessionId)?.chatId !== ref.chatId) throw failure('SOURCE_UNAVAILABLE', 404);
    }
  }
  const responseFor = result => ({ result: structuredClone(Object.fromEntries([
    'resultId','sourceChatId','sourceEventId','sourceRef','taskId','state','summary','resultRevision','requiresResponse','artifactRefs','deleted',
  ].filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]]))),
  mainEventId: result.mainEventId, activityId: result.activityId });
  async function publish(ownerId, input, body, authorize = () => {}) {
    const orderAnchor = await context.chatTimeline.lastOrderKey(ownerId, context.accountState(ownerId).chatIdentity.mainChatId);
    return context.serial(async () => {
      authorize();
      const account = context.accountState(ownerId), { chat } = sourceSession(ownerId, input.sourceChatId);
      if (chat.kind !== 'side') throw failure('MAIN_CHAT_PROTECTED', 409);
      if (chat.contentRevision !== input.contentRevision) throw failure('SOURCE_UNAVAILABLE', 404);
      const fingerprint = body ? digest(JSON.stringify(body)) : null;
      const previousOperation = body && account.sideOperations?.[body.requestId];
      if (previousOperation) {
        if (previousOperation.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409);
        return responseFor(account.chatResults[previousOperation.resultId]);
      }
      if (body && context.requestIdUsed(account, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
      if (body && chat.revision !== body.expectedRevision) throw failure('REVISION_CHANGED', 409);
      const sameSource = Object.values(account.chatResults ?? {}).find(row => row.sourceChatId === input.sourceChatId &&
        (input.taskId ? row.taskId === input.taskId : row.sourceEventId === input.sourceEventId));
      const resultId = sameSource?.resultId ?? `result-${digest(`${input.sourceChatId}/${input.taskId ?? input.sourceEventId}`).slice(0,40)}`;
      const previous = account.chatResults?.[resultId];
      const contentHash = digest(JSON.stringify([input.sourceEventId,input.state,input.summary,input.artifactRefs,input.requiresResponse]));
      await context.mutate(ownerId, next => {
        next.chatResults ??= {}; next.sideOperations ??= {};
        const revision = previous ? previous.resultRevision + Number(previous.contentHash !== contentHash) : 1;
        const counter = previous ? null : (next.chatResultCounter = (next.chatResultCounter ?? 0) + 1);
        next.chatResults[resultId] = { resultId, sourceChatId: input.sourceChatId, sourceEventId: input.sourceEventId,
          sourceRef: { kind: 'result', resultId, sourceChatId: input.sourceChatId, sourceEventId: input.sourceEventId,
            native: input.nativeSource }, ...(input.taskId ? { taskId: input.taskId } : {}),
          state: input.state, summary: input.summary, resultRevision: revision, requiresResponse: input.requiresResponse === true,
          artifactRefs: input.artifactRefs ?? [], contentHash,
          mainEventId: previous?.mainEventId ?? `event-${resultId}`, activityId: previous?.activityId ?? `activity-${resultId}`,
          notificationRevision: revision, orderKey: previous?.orderKey ?? `${orderAnchor}~${String(counter).padStart(16,'0')}`,
          at: previous?.at ?? new Date(context.timestamp()).toISOString(),
          updatedAt: new Date(context.timestamp()).toISOString(), ...(input.observedCommandId ? { observedCommandId: input.observedCommandId } : {}) };
        if (body) next.sideOperations[body.requestId] = { fingerprint, resultId };
        if (!previous || previous.contentHash !== contentHash) {
          const main = next.chatIdentity.chats[next.chatIdentity.mainChatId]; main.unread = true; main.revision++;
        }
      });
      return responseFor(context.accountState(ownerId).chatResults[resultId]);
    });
  }
  async function terminal(ownerId, chatId, taskId, eventId, automatic) {
    const { account, chat } = sourceSession(ownerId, chatId), command = context.taskSource(account, taskId);
    if (chatForSession(account, command.sessionId)?.chatId !== chatId) throw failure('SOURCE_UNAVAILABLE', 404);
    const task = await context.taskDetail(account, taskId), evidence = task.replyEvidence;
    if (!states[evidence.status] || task.control?.backgroundJobs?.active || task.control?.backgroundJobs?.unconfirmed) throw failure('TASK_NOT_READY', 409);
    const accepted = [command, ...(context.taskChildren?.(account, taskId) ?? [])]
      .filter(row => row.kind === 'session.message' && row.state === 'accepted_by_dsh' && row.receiptId)
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (!accepted) throw failure('TASK_NOT_READY', 409);
    const page = await readSourceEvents(context, { ownerId, sessionId: command.sessionId, receiptId: accepted.receiptId, turn: evidence.turn }, fn => context.callBackend(fn));
    // The native source endpoint intentionally returns only binding boundaries,
    // not replies/tools. Hydrate the authorized turn from public history pages.
    const first = page.events.find(row => row.type === 'turn.started'), last = page.events.findLast(row => row.type === 'turn.ended');
    if (!first || !last || last.seq < first.seq) throw failure('TASK_NOT_READY', 409);
    const events = []; let afterSeq = first.seq - 1;
    while (afterSeq < last.seq) {
      const history = await context.callBackend(() => context.backend.readEvents({ ownerId, sessionId: command.sessionId, afterSeq, limit: 200 }));
      events.push(...history.events.filter(row => row.seq <= last.seq).map(event => context.publicHistoryEvent(ownerId, command.sessionId, event)));
      if (history.nextSeq <= afterSeq) throw failure('TASK_NOT_READY', 409);
      afterSeq = history.nextSeq;
      if (!history.hasMore) break;
    }
    const executed = task.executionSteps?.length || task.artifacts?.length || events.some(row => ['step.completed','artifact.created'].includes(row.type));
    if (automatic && !executed) return null; // Ordinary conversation does not create completion cards.
    const segment = account.chatIdentity.segments[account.chatIdentity.sessionSegments[command.sessionId]];
    const selected = eventId ? events.find(event => nativeId(segment.hostId, command.sessionId, event.seq) === eventId)
      : events.filter(row => row.type === 'assistant.message').at(-1) ?? events.findLast(row => row.type === 'turn.ended');
    if (!selected || eventId && !['assistant.message','turn.ended'].includes(selected.type)) throw failure('SOURCE_UNAVAILABLE', 404);
    const state = states[evidence.status];
    const label = state === 'stopped' ? '已停止' : state === 'failed' ? '执行失败' : '已完成';
    return { sourceChatId: chatId, sourceEventId: nativeId(segment.hostId, command.sessionId, selected.seq),
      contentRevision: chat.contentRevision, taskId, state,
      summary: short(selected.type === 'assistant.message' && selected.data?.text ? `${label}：${selected.data.text}` : label),
      requiresResponse: false, nativeSource: { kind: 'native', hostId: segment.hostId, sessionId: command.sessionId, seq: selected.seq },
      artifactRefs: (task.artifacts ?? []).map(row => ({ taskId, artifactId: row.artifactId })), observedCommandId: accepted.commandId };
  }
  return {
    validatePrepared,
    async prepare(ownerId, body) {
      exactKeys(body, ['requestId','kind','targetDeviceId','parent','modelProfileId','originChatId','originEventId','title','entry','confirmed'],
        ['requestId','kind','targetDeviceId','parent','modelProfileId']);
      if (!REQUEST_ID.test(body.requestId ?? '') || body.kind !== 'session.side.create') throw failure('INVALID_REQUEST');
      const account = context.accountState(ownerId);
      if (body.targetDeviceId !== account.hostId) throw failure('TARGET_UNAVAILABLE', 409);
      exactKeys(body.parent, ['kind','id'], ['kind','id']);
      if (!['main','project'].includes(body.parent.kind) || !validId(body.parent.id)) throw failure('INVALID_REQUEST');
      modelProfileId(body.modelProfileId);
      if ((body.originChatId === undefined) !== (body.originEventId === undefined) || body.originChatId !== undefined &&
          (!validId(body.originChatId) || !validId(body.originEventId)) ||
          body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 256) ||
          body.entry !== undefined && !['composer','message','suggestion'].includes(body.entry) ||
          body.confirmed !== undefined && body.confirmed !== true) throw failure('INVALID_REQUEST');
      if (body.entry === 'suggestion' && body.confirmed !== true) throw failure('SIDE_CHAT_CONFIRMATION_REQUIRED', 409);
      if (body.entry === 'message' && !body.originEventId) throw failure('INVALID_REQUEST');
      const canonical = { requestId: body.requestId, kind: body.kind, targetDeviceId: body.targetDeviceId,
        parent: { kind: body.parent.kind, id: body.parent.id }, modelProfileId: body.modelProfileId,
        ...(body.originChatId ? { originChatId: body.originChatId, originEventId: body.originEventId } : {}),
        ...(body.title ? { title: body.title.trim() } : {}), entry: body.entry ?? (body.originChatId ? 'message' : 'composer'),
        ...(body.confirmed ? { confirmed: true } : {}) };
      const requestHash = digest(JSON.stringify(canonical));
      const prior = Object.values(account.commands).find(row => row.requestId === body.requestId);
      if (prior) { if (prior.payload.sideChat?.requestHash !== requestHash) throw failure('REQUEST_CONFLICT', 409); return prior.payload; }
      const prepared = { chatId: `chat-${randomUUID()}`, requestHash,
        parent: canonical.parent, ...(canonical.title ? { title: canonical.title } : {}),
        contextTransfer: { state: 'references_only', sourceRefs: [], truncated: false } };
      if (body.originChatId) {
        const event = await source(ownerId, body.originChatId, body.originEventId);
        prepared.contextTransfer.sourceRefs = [{ chatId: body.originChatId, eventId: body.originEventId,
          ...event.sourceRef, contentRevision: context.chats.requireChat(ownerId, body.originChatId).contentRevision }];
      }
      validatePrepared(ownerId, prepared);
      const project = prepared.parent.kind === 'project' ? account.projects[prepared.parent.id] : null;
      return { requestId: body.requestId, kind: 'session.create', targetDeviceId: body.targetDeviceId, modelProfileId: body.modelProfileId,
        ...(project ? { projectId: prepared.parent.id, projectRevision: project.revision } : {}), sideChat: prepared };
    },
    async share(ownerId, chatId, raw, authorize) {
      exactKeys(raw, ['requestId','sourceEventId','taskId','expectedRevision'], ['requestId','sourceEventId','expectedRevision']);
      if (!REQUEST_ID.test(raw.requestId ?? '') || !validId(raw.sourceEventId) || raw.taskId !== undefined && !validId(raw.taskId) ||
          !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 1) throw failure('INVALID_REQUEST');
      const body = { requestId: raw.requestId, sourceChatId: chatId, sourceEventId: raw.sourceEventId,
        ...(raw.taskId ? { taskId: raw.taskId } : {}), expectedRevision: raw.expectedRevision };
      const account = context.accountState(ownerId), prior = account.sideOperations?.[raw.requestId];
      if (prior) { if (prior.fingerprint !== digest(JSON.stringify(body))) throw failure('REQUEST_CONFLICT', 409); authorize(); return responseFor(account.chatResults[prior.resultId]); }
      const { chat } = sourceSession(ownerId, chatId);
      if (chat.kind !== 'side') throw failure('MAIN_CHAT_PROTECTED', 409);
      let input;
      if (raw.taskId) input = await terminal(ownerId, chatId, raw.taskId, raw.sourceEventId, false);
      else {
        const event = await source(ownerId, chatId, raw.sourceEventId);
        if (event.type !== 'assistant.message') throw failure('SOURCE_UNAVAILABLE', 404);
        input = { sourceChatId: chatId, sourceEventId: raw.sourceEventId, state: 'completed', summary: short(event.data?.text),
          contentRevision: chat.contentRevision, requiresResponse: false, artifactRefs: [], nativeSource: event.sourceRef };
      }
      return publish(ownerId, input, body, authorize);
    },
    reconcile(ownerId) {
      if (flights.has(ownerId)) return flights.get(ownerId);
      const work = (async () => {
        const account = context.accountState(ownerId), cutoff = account.chatIdentity.chats[account.chatIdentity.mainChatId].createdAt;
        for (const command of Object.values(account.commands)) {
          if (context.closing || command.kind !== 'session.message' || command.rootTaskId || command.state !== 'accepted_by_dsh' || command.createdAt < cutoff) continue;
          if (account.sessions[command.sessionId]?.origin !== 'personal-remote') continue;
          const chat = chatForSession(context.accountState(ownerId), command.sessionId);
          if (chat?.kind !== 'side') continue;
          const latest = [command, ...(context.taskChildren?.(account, command.commandId) ?? [])].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
          const prior = Object.values(context.accountState(ownerId).chatResults ?? {}).find(row => row.taskId === command.commandId);
          if (prior?.observedCommandId === latest.commandId) continue;
          try { const input = await terminal(ownerId, chat.chatId, command.commandId, undefined, true); if (input) await publish(ownerId, input); }
          catch (error) { if (!['TASK_NOT_READY','SOURCE_UNAVAILABLE','TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED','SHARED_CONTEXT_UNAVAILABLE','CHAT_UNAVAILABLE',
            'BACKEND_UNAVAILABLE','BACKEND_TIMEOUT'].includes(error.code)) throw error; }
        }
      })().finally(() => flights.delete(ownerId));
      flights.set(ownerId, work); return work;
    },
    async close() { await Promise.allSettled([...flights.values()]); },
  };
}
