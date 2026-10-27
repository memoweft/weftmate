export { WORK_SWITCH_REASON } from '../plugins/personal-work-mode.mjs';
export const isWorkSwitch = value => value?.intent === 'work-switch' || value?.reason?.startsWith('[weftmate:work-switch]');
export const conversationMode = session => session?.phoneHistory ? 'chat' : session?.mode ?? (session?.projectId || session?.workspaceKind === 'browser' ? 'work' : 'chat');
export const executionProject = command => command?.workContext ?? command?.payload ?? {};

export function modeProjection(session, account) {
  const mode = conversationMode(session), project = account.projects?.[session?.projectId];
  return { mode, ...(mode === 'work' ? { workHostId: session?.workHostId ?? account.hostId,
    workDirectory: project && !project.revoked ? { projectId: project.projectId, name: project.name, pathHint: project.pathHint ?? '' } : null } : {}) };
}
