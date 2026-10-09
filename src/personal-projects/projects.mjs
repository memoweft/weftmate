import { failure, publicProject, validProjectName } from '../personal-access/common.mjs';

export function redactProjectPath(text, rootPath) {
  if (typeof text !== 'string' || !rootPath) return text;
  const variants = new Set([rootPath, rootPath.replaceAll('\\', '/')]);
  for (const value of [...variants]) variants.add(JSON.stringify(value).slice(1, -1));
  for (const value of [...variants].sort((a,b) => b.length - a.length))
    text = text.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[项目文件夹]');
  return text;
}

export function migrateProjects(account) {
  let changed = false;
  for (const project of Object.values(account.projects ?? {})) {
    if (project.permission === undefined) {
      project.permission = 'read-only'; project.instructions = ''; changed = true;
    }
  }
  for (const command of Object.values(account.commands ?? {})) {
    const project = account.projects?.[command.payload?.projectId];
    for (const approval of command.toolApprovals ?? []) {
      const reason = redactProjectPath(approval.reason, project?.rootPath);
      if (reason !== approval.reason) { approval.reason = reason; changed = true; }
    }
  }
  return changed;
}

export function projectSettings(body) {
  if (body.name !== undefined && !validProjectName(body.name) ||
      body.instructions !== undefined && (typeof body.instructions !== 'string' || body.instructions.length > 16000) ||
      body.permission !== undefined && !['read-only', 'write'].includes(body.permission)) throw failure('INVALID_REQUEST');
  return { ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
    ...(body.permission !== undefined ? { permission: body.permission } : {}) };
}

export function createProjectOperations(context) {
  return async (ownerId, projectId, method, body, assertCurrent = () => {}) => context.serial(async () => {
    const account = context.accountState(ownerId), project = account.projects?.[projectId];
    if (!project || project.removed) throw failure('NOT_FOUND', 404);
    const keys = method === 'DELETE' ? ['expectedRevision'] : ['name', 'instructions', 'permission', 'expectedRevision'];
    if (!body || Object.keys(body).some(key => !keys.includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision)) throw failure('INVALID_REQUEST');
    if (body.expectedRevision !== project.revision) throw failure('PROJECT_REVISION_CHANGED', 409);
    const patch = method === 'DELETE' ? {} : projectSettings(body);
    if (method !== 'DELETE' && !Object.keys(patch).length) throw failure('INVALID_REQUEST');
    if (Object.values(account.sessions).some(session => session.projectId === projectId && session.deleting)) throw failure('SESSION_BUSY', 409);
    // Do not change a running turn's policy or invalidate its approval receipt.
    for (const [sessionId, session] of Object.entries(account.sessions)) {
      if (session.projectId !== projectId) continue;
      const live = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
      if (live?.running || Object.values(account.commands).some(command => command.sessionId === sessionId &&
          ['pending', 'dispatching', 'uncertain'].includes(command.state))) throw failure('SESSION_BUSY', 409);
    }
    assertCurrent();
    return context.mutate(ownerId, next => {
      const found = next.projects[projectId];
      Object.assign(found, patch, { revision: found.revision + 1, updatedAt: new Date(context.timestamp()).toISOString() });
      for (const session of Object.values(next.sessions)) if (session.projectId === projectId) {
        if (method === 'DELETE') { delete session.projectId; delete session.projectRevision; session.projectNotice = '项目已移除登记，文件夹里的文件仍保留。下个回合使用本对话的独立工作目录。'; }
        else session.projectRevision = found.revision;
      }
      // Keep the tombstone for old source snapshots, commands and idempotent requests.
      if (method === 'DELETE') { found.removed = true; found.revoked = true; found.revokedAt = found.updatedAt; }
      return method === 'DELETE' ? { deleted: true, projectId } : { project: publicProject(found) };
    });
  });
}
