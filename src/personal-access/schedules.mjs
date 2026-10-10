/** Calendar adaptation and client authorization; DSH owns all timers and dispatch. */
import { randomUUID } from 'node:crypto';
import { failure, digest, exactKeys } from './common.mjs';
import { canonicalCommand } from './command-policy.mjs';
import { scheduleContent } from './schedules-calendar.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
import { REQUEST_ID } from './constants.mjs';
import { chatForSession } from './chat-identity.mjs';

export { scheduleContent, nextCalendarInput } from './schedules-calendar.mjs';

export function createScheduleOperations(context) {
  const session = (ownerId, sessionId) => {
    const row = context.accountState(ownerId).sessions[sessionId];
    if (!row || row.origin !== 'personal-remote' || row.deleting) throw failure('SESSION_UNAVAILABLE', 404);
    return row;
  };
  async function handleRuntime(input) {
    const ownerId = context.sessionOperations.ownerForSession(input.sessionId)?.ownerId;
    if (!ownerId || !context.hostOwner(ownerId)) throw failure('SESSION_UNAVAILABLE', 404);
    const row = session(ownerId, input.sessionId);
    if (input.action === 'context') return { timeZone: context.usage.settings(ownerId).timeZone,
      approvalMode: row.approvalMode ?? context.accountState(ownerId).defaultApprovalMode ?? 'auto' };
    if (input.action !== 'execute' || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 32000 ||
        typeof input.deliveryId !== 'string') throw failure('INVALID_REQUEST');
    const requestId = `scheduled-${digest(`${input.sessionId}|${input.deliveryId}`).slice(0, 48)}`;
    const commandId = await context.serial(() => context.mutate(ownerId, next => {
      const existing = Object.values(next.commands).find(c => c.requestId === requestId);
      if (existing) return existing.commandId;
      // The durable user authorization is the original conversation; revocation
      // and the current conversation approval mode still go through normal dispatch.
      const source = Object.values(next.commands).filter(c => c.kind === 'session.message' && c.sessionId === input.sessionId &&
        c.state === 'accepted_by_dsh' && c.receiptId === input.sourceReceiptId && !c.requestId.startsWith('scheduled-')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const authorization = next.scheduleAuthorizations?.[input.sourceReceiptId];
      const device = authorization && next.devices[authorization.sourceDeviceId];
      if (!source && (!authorization || authorization.sessionId !== input.sessionId || !device || device.revoked || device.authEpoch !== authorization.sourceAuthEpoch)) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      const origin = source ?? authorization;
      const chatId = source?.payload?.chatId ?? authorization?.chatId;
      const currentSession = next.sessions[input.sessionId], project = currentSession.projectId ? next.projects?.[currentSession.projectId] : null;
      if (currentSession.projectId && (!project || project.revoked)) throw failure('PROJECT_UNAVAILABLE',409);
      const payload = canonicalCommand({ requestId, ...(chatId ? { kind: 'chat.message', chatId }
        : { kind: 'session.message', sessionId: input.sessionId }),
        text: input.text, mode: 'queue', targetDeviceId: next.hostId,
        ...(!chatId && project ? {projectId:project.projectId,projectRevision:project.revision} : {}) }, next.hostId,true);
      const id = `cmd-${randomUUID()}`, at = new Date(context.timestamp()).toISOString();
      next.commands[id] = { commandId: id, ownerId, requestId, payloadHash: digest(JSON.stringify(payload)), payload,
        sourceDeviceId: origin.sourceDeviceId, sourceAuthEpoch: origin.sourceAuthEpoch,
        scheduleSourceId: source?.commandId ?? input.sourceReceiptId, targetDeviceId: next.hostId,
        kind: payload.kind, ...(!chatId ? { sessionId: input.sessionId } : {}), state: 'pending', createdAt: at, updatedAt: at };
      return id;
    }));
    context.schedule(ownerId, commandId);
    return { accepted: true, commandId };
  }
  async function handleHttp(request, response, url, ownerId) {
    const match = /^\/personal\/v1\/schedules(?:\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\/(pause|resume|run))?)?$/.exec(url.pathname);
    const notifications = url.pathname === '/personal/v1/notifications';
    if (!match && !notifications) return false;
    const write = request.method !== 'GET';
    const auth = context.authenticate(request, write ? 'commands:write' : 'sessions:read');
    if (url.search || notifications && write) throw failure('INVALID_REQUEST');
    if (typeof context.backend.schedules !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
    if (write && (!match?.[1] && request.method === 'POST' || match?.[1] && request.method === 'PATCH' && !match[3])) {
      if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
      const body = await context.readJson(request);
      exactKeys(body, ['requestId', 'sessionId', 'text', 'kind', 'at', 'repeat', 'expectedRevision'], ['requestId', 'text', 'kind']);
      if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 32000 || !['reminder','task'].includes(body.kind)) throw failure('INVALID_REQUEST');
      const sessionId = match?.[1] ?? body.sessionId; session(ownerId, sessionId);
      if (context.accountState(ownerId).memoryCleanupPending) throw failure('SESSION_BUSY', 409);
      let repeat;
      if (body.repeat) {
        const fields = { daily:['kind','time'], weekly:['kind','time','weekday'], monthly:['kind','time','day'], interval:['kind','seconds'] }[body.repeat.kind];
        if (!fields) throw failure('INVALID_REQUEST');
        exactKeys(body.repeat, fields, fields); repeat = Object.fromEntries(fields.map(key => [key,body.repeat[key]]));
      }
      if (body.at) { exactKeys(body.at, ['date','time'], ['date','time']); if (!/^\d{4}-\d{2}-\d{2}$/.test(body.at.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(body.at.time)) throw failure('INVALID_REQUEST'); }
      if (!body.at && !body.repeat || request.method === 'PATCH' && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)) throw failure('INVALID_REQUEST');
      const prompt = JSON.stringify({ weftmate: 1, kind: body.kind, text: body.text.trim(), ...(repeat ? { repeat } : {}) }); scheduleContent(prompt);
      const sourceReceiptId = `ui-schedule-${body.requestId}`;
      await context.serial(() => context.mutate(ownerId, next => {
        next.scheduleAuthorizations ??= {}; const prior = next.scheduleAuthorizations[sourceReceiptId];
        const fingerprint = digest(JSON.stringify({ sessionId, id: match?.[2], action: request.method, text: body.text.trim(),kind:body.kind,
          at:body.at ? {date:body.at.date,time:body.at.time} : null,repeat:repeat??null,expectedRevision:body.expectedRevision }));
        if (prior && prior.fingerprint !== fingerprint) throw failure('REQUEST_CONFLICT', 409);
        const chat = chatForSession(next,sessionId);
        next.scheduleAuthorizations[sourceReceiptId] ??= { sessionId, fingerprint, ...(chat?.kind==='main'?{chatId:chat.chatId}:{}), sourceDeviceId: auth.deviceId, sourceAuthEpoch: next.devices[auth.deviceId].authEpoch };
      }));
      const value = await context.backend.schedules({ ownerId, sessionId, action: request.method === 'POST' ? 'create' : 'edit', id: match?.[2], requestId: body.requestId,
        expectedRevision: body.expectedRevision, prompt, sourceReceiptId, ...(body.at ? { at: { ...body.at, time_zone: context.usage.settings(ownerId).timeZone } } : {}) });
      if (value.item && hasPrivateContent(context.accountState(ownerId).sessions[sessionId])) value.item = { ...value.item, text: '临时对话中的定时任务', temporary: true };
      context.json(response, request.method === 'POST' ? 201 : 200, value); return true;
    }
    if (!match?.[1]) {
      if (write) throw failure('INVALID_REQUEST');
      const generation = context.accountState(ownerId).activity?.generation ?? 0;
      const rows = await Promise.all(Object.entries(context.accountState(ownerId).sessions).filter(([, row]) => row.origin === 'personal-remote')
        .map(async ([sessionId]) => {
          const value = await context.backend.schedules({ sessionId, ownerId, action: notifications ? 'notifications' : 'list' });
          const live = context.accountState(ownerId); if (!live.sessions[sessionId] || live.sessions[sessionId].deleting || live.memoryCleanupPending) return [];
          return value.items.map(item => {
            const result = { ...item, sessionId };
            if (hasPrivateContent(live.sessions[sessionId])) { result.text = '临时对话中的定时任务'; result.temporary = true; }
            if (result.lastResult?.commandId) { const command = live.commands[result.lastResult.commandId], activity = Object.values(live.activity?.items ?? {}).find(row => row.source.taskId === result.lastResult.commandId && row.type.startsWith('task.')); result.lastResult = { ...result.lastResult, state: activity?.type.slice(5) ?? (command?.state === 'rejected' ? 'failed' : 'queued') }; }
            return result;
          });
        }));
      if ((context.accountState(ownerId).activity?.generation ?? 0) !== generation) throw failure('CURSOR_RESET_REQUIRED', 409);
      context.json(response, 200, { items: rows.flat() }); return true;
    }
    const [, sessionId, id, action] = match;
    session(ownerId, sessionId);
    if (!(request.method === 'DELETE' && !action || request.method === 'POST' && action)) throw failure('INVALID_REQUEST');
    let input = {};
    if (request.method === 'POST') {
      input = await context.readJson(request); exactKeys(input, ['requestId']);
      if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId))) throw failure('INVALID_REQUEST');
    }
    if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
    const value = await context.backend.schedules({ sessionId, ownerId, id, action: action ?? 'delete', ...input });
    context.json(response, 200, value); return true;
  }
  return { handleRuntime, handleHttp };
}
