import { randomUUID } from 'node:crypto';
import { failure } from './common.mjs';
import { currentChatProfile } from '../background-model-selection.mjs';

/** Reminders and offline tasks without a conversation land in one ordinary
 * 「提醒」 conversation per account (D92: there is no main chat). It is created
 * on demand and again after the owner deletes it. */
export function createReminderChat(context) {
  return {
    async prepare(ownerId, authorize = () => {}) {
      return context.serial(async () => {
        const auth = authorize(), account = context.accountState(ownerId);
        if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
        if (auth && !['password', 'cloud', 'desktop'].includes(account.devices[auth.deviceId]?.authKind)) throw failure('SESSION_READ_ONLY', 409);
        const existing = account.sessions[account.reminderSessionId];
        if (existing && !existing.deleting) return account.reminderSessionId;
        const profile = currentChatProfile(account, id => context.modelSelectable(ownerId, id)) ?? context.visibleModels(ownerId,
          await context.callBackend(() => context.backend.listModels({ ownerId }))).find(row => context.modelSelectable(ownerId, row.id))?.id;
        if (!profile) throw failure('MODEL_UNAVAILABLE', 422);
        const sessionId = `session-${randomUUID()}`;
        // Native session creation does not start a model turn or send a message.
        await context.callBackend(() => context.backend.createSession({ ownerId, sessionId, modelProfileId: profile, title: '提醒' }));
        await context.mutate(ownerId, next => {
          authorize();
          next.sessions[sessionId] = { ownerId, origin: 'personal-remote', attachedAt: new Date(context.timestamp()).toISOString(),
            modelProfileId: profile, approvalMode: next.defaultApprovalMode ?? 'auto' };
          next.reminderSessionId = sessionId;
        });
        return sessionId;
      });
    },
  };
}
