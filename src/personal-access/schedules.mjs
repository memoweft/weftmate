/** Calendar adaptation and client authorization; DSH owns all timers and dispatch. */
import { randomUUID } from 'node:crypto';
import { failure, digest } from './common.mjs';
import { canonicalCommand } from './command-policy.mjs';

export { scheduleContent, nextCalendarInput } from './schedules-calendar.mjs';

export function createScheduleOperations(context) {
  const session = (ownerId, sessionId) => {
    const row = context.accountState(ownerId).sessions[sessionId];
    if (!row || row.origin !== 'personal-remote') throw failure('SESSION_UNAVAILABLE', 404);
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
      if (!source) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      const payload = canonicalCommand({ requestId, kind: 'session.message', sessionId: input.sessionId,
        text: input.text, mode: 'queue', targetDeviceId: next.hostId }, next.hostId);
      const id = `cmd-${randomUUID()}`, at = new Date(context.timestamp()).toISOString();
      next.commands[id] = { commandId: id, ownerId, requestId, payloadHash: digest(JSON.stringify(payload)), payload,
        sourceDeviceId: source.sourceDeviceId, sourceAuthEpoch: next.devices?.[source.sourceDeviceId]?.authEpoch ?? source.sourceAuthEpoch,
        scheduleSourceId: source.commandId, targetDeviceId: next.hostId,
        kind: 'session.message', sessionId: input.sessionId, state: 'pending', createdAt: at, updatedAt: at };
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
    context.authenticate(request, write ? 'commands:write' : 'sessions:read');
    if (url.search || notifications && write) throw failure('INVALID_REQUEST');
    if (typeof context.backend.schedules !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
    if (!match?.[1]) {
      if (write) throw failure('INVALID_REQUEST');
      const rows = await Promise.all(Object.entries(context.accountState(ownerId).sessions).filter(([, row]) => row.origin === 'personal-remote')
        .map(async ([sessionId]) => {
          const value = await context.backend.schedules({ sessionId, ownerId, action: notifications ? 'notifications' : 'list' });
          return value.items.map(item => ({ ...item, sessionId }));
        }));
      context.json(response, 200, { items: rows.flat() }); return true;
    }
    const [, sessionId, id, action] = match;
    session(ownerId, sessionId);
    if (!(request.method === 'DELETE' && !action || request.method === 'POST' && action)) throw failure('INVALID_REQUEST');
    if (request.method === 'POST') {
      const body = await context.readJson(request);
      if (Object.keys(body).length) throw failure('INVALID_REQUEST');
    }
    const value = await context.backend.schedules({ sessionId, ownerId, id, action: action ?? 'delete' });
    context.json(response, 200, value); return true;
  }
  return { handleRuntime, handleHttp };
}
