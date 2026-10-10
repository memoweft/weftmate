import '../ui-core/personalization.js';
import { failure } from './common.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
export const personalization = globalThis.WeftPersonalization;
export function accountPersonalization(account) { return personalization.settings(account.personalization); }
export async function handlePersonalization(context, request, response, url, ownerId) {
  const style = url.pathname === '/personal/v1/settings/personalization/style';
  if (url.search || !(style ? request.method === 'POST' : ['GET', 'PATCH'].includes(request.method))) throw failure('INVALID_REQUEST');
  context.authenticate(request, request.method === 'GET' ? 'sessions:read' : 'account:manage');
  let patch;
  if (style) {
    const body = await context.readJson(request); if (Object.keys(body).length) throw failure('INVALID_REQUEST');
    const messages = [];
    // History is read locally; no model, file contents, settings or memory input.
    for (const [sessionId, session] of Object.entries(context.accountState(ownerId).sessions).reverse()) {
      if (hasPrivateContent(session) || session.deleting || session.archived) continue;
      const page = await context.callBackend(() => context.backend.readEvents({ ownerId, sessionId, limit: 100, afterSeq: -1 }));
      const current = context.accountState(ownerId).sessions[sessionId];
      if (!current || hasPrivateContent(current) || current.deleting) continue;
      messages.push(...(page.events ?? []).filter(event => event.type === 'user.message' && !current.forgottenSeqs?.includes(event.seq)).map(event => event.data?.text));
    }
    patch = { useWritingStyle: true, writingStyle: personalization.extractStyle(messages) };
  } else if (request.method === 'PATCH') {
    try { patch = personalization.validate(await context.readJson(request)); } catch { throw failure('INVALID_REQUEST'); }
  }
  if (patch) await context.serial(() => context.mutate(ownerId, next => {
    context.authenticate(request, 'account:manage');
    next.personalization = { ...accountPersonalization(next), ...patch };
    next.personalizationUpdatedAt = new Date(context.timestamp()).toISOString();
  }));
  const account = context.accountState(ownerId);
  return context.json(response, 200, { settings: accountPersonalization(account), updatedAt: account.personalizationUpdatedAt ?? null, synced: true });
}
