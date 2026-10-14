import { randomUUID } from 'node:crypto';
import { failure } from './common.mjs';
import { chatForSession } from './chat-identity.mjs';

export { WORK_SWITCH_REASON } from '../plugins/personal-work-mode.mjs';
export const isWorkSwitch = value => value?.intent === 'work-switch' || value?.reason?.startsWith('[weftmate:work-switch]');
export const conversationMode = session => session?.phoneHistory ? 'chat' : session?.mode ?? (session?.projectId || session?.workspaceKind === 'browser' ? 'work' : 'chat');
export const executionProject = command => command?.workContext ?? command?.payload ?? {};

export function modeProjection(session, account) {
  const mode = conversationMode(session), project = account.projects?.[session?.projectId];
  return { mode, ...(mode === 'work' ? { workHostId: session?.workHostId ?? account.hostId,
    workDirectory: project && !project.revoked ? { projectId: project.projectId, name: project.name, pathHint: project.pathHint ?? '' } : null } : {}) };
}

/** The original command, native events and memory provenance remain unchanged. */
export function bindConversationWork(account, sessionId, projectId, { at, commandId } = {}) {
  const session = account.sessions[sessionId], project = account.projects?.[projectId];
  if (!session || session.origin !== 'personal-remote' || session.phoneHistory) throw failure('SESSION_READ_ONLY', 409);
  if (!project || project.revoked) throw failure('PROJECT_NOT_SELECTED', 409);
  if (session.workHostId && session.workHostId !== account.hostId) throw failure('TARGET_UNAVAILABLE', 409);
  const chat = chatForSession(account, sessionId);
  if (chat?.kind === 'main') {
    chat.kind = 'side'; chat.wasMain = true; chat.revision++;
    const mainChatId = `chat-${randomUUID()}`;
    account.chatIdentity.mainChatId = mainChatId;
    account.chatIdentity.chats[mainChatId] = { chatId: mainChatId, kind: 'main', revision: 1, contentRevision: 1,
      createdAt: at, unread: false, activeSegmentId: null };
    for (const segment of Object.values(account.chatIdentity.segments)) if (segment.chatId === chat.chatId) {
      Object.assign(account.sessions[segment.sessionId], { mode: 'work', workHostId: account.hostId,
        projectId, projectRevision: project.revision, groupId: null });
    }
  }
  Object.assign(session, { mode: 'work', workHostId: account.hostId, projectId, projectRevision: project.revision, groupId: null,
    projectNotice: `在「${project.name}」里工作。之前的消息和文件仍保留。` });
  delete session.workspaceKind;
  if (commandId) {
    const command = account.commands[commandId];
    if (!command || command.sessionId !== sessionId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    command.workContext = { projectId, projectRevision: project.revision, hostId: account.hostId, at };
  }
  return modeProjection(session, account);
}
