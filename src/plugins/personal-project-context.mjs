import { shellWriteTargets } from './personal-write-targets.mjs';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const contexts = new WeakMap();
export const executionDirectory = session => contexts.get(session)?.cwd ?? session?.header?.cwd;
export const sessionProject = session => contexts.get(session)?.project;
export function projectContextNotice(session) {
  const { project, cwd } = contexts.get(session) ?? {};
  return project ? `项目：${project.name}。本回合默认工作目录：${cwd}。权限：${project.permission === 'write' ? '可写（仅项目文件夹内）' : '只读（禁止修改文件）'}。历史回合的文件仍留在当时的目录。\n项目固定说明：\n${project.instructions}` : null;
}

export async function selectProjectContext(agent, policy) {
  const project = policy.project;
  const cwd = project?.rootPath ?? (policy.projectNotice ? policy.conversationWorkspace : agent.session.header.cwd);
  if (!project && cwd) await mkdir(cwd, { recursive: true });
  contexts.set(agent.session, { cwd, project });
  return projectContextNotice(agent.session) ?? policy.projectNotice;
}

export function inheritProjectContext(agent, parent) {
  const context = contexts.get(parent?.session);
  if (context) contexts.set(agent.session, context);
}

/** Resolve existing ancestors so a junction cannot widen the folder grant. */
export async function insideProject(root, file) {
  const canonicalRoot = await realpath(root);
  let existing = resolve(file), suffix = '';
  for (;;) {
    try { existing = resolve(await realpath(existing), suffix); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) return false;
      suffix = relative(parent, existing) + (suffix ? '/' + suffix : ''); existing = parent;
    }
  }
  const rel = relative(canonicalRoot, existing);
  return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../');
}

/** Route tool execution arguments without rewriting the native immutable history header. */
export function routeProjectTool(exec) {
  const context = contexts.get(exec.agent?.session);
  if (!context?.cwd || (!context.project && context.cwd === exec.agent.session.header.cwd)) return;
  const args = { ...exec.arguments };
  if (['pwsh', 'bash', 'shell'].includes(exec.name)) args.workdir = resolve(context.cwd, args.workdir ?? '.');
  if (['glob', 'grep'].includes(exec.name)) args.path = resolve(context.cwd, args.path ?? '.');
  for (const key of (['read', 'write', 'edit', 'glob', 'grep', 'subagent'].includes(exec.name) ? ['file_path', 'path', 'cwd'] : [])) if (typeof args[key] === 'string' && args[key]) args[key] = resolve(context.cwd, args[key]);
  exec.arguments = args;
}

/** DSH resolves one policy for files and shell, including delegated calls. */
export function installProjectSandbox(service) {
  if (!service) return () => {};
  const original = service.resolve;
  service.resolve = function(request = {}) {
    const policy = original.call(this, request), context = contexts.get(request.session);
    if (!context?.project) return context?.cwd ? { ...policy, workspaceRoot: context.cwd } : policy;
    return { ...policy, workspaceRoot: context.cwd,
      mode: context.project.permission === 'read-only' ? 'read-only' : request.mode ?? 'workspace-write' };
  };
  return () => { service.resolve = original; };
}

export async function projectToolDecision(exec) {
  const project = sessionProject(exec.agent?.session);
  if (!project) return null;
  if (['write', 'edit'].includes(exec.name)) {
    if (project.permission === 'read-only') return { kind: 'deny', reason: 'PROJECT_READ_ONLY: 此项目只读。请在项目设置改为可写后再修改文件。' };
    if (!exec.arguments?.sandbox_permissions && !await insideProject(project.rootPath, resolve(executionDirectory(exec.agent.session), exec.arguments.file_path ?? '')))
      return { kind: 'deny', reason: 'PROJECT_WRITE_OUTSIDE: 当前权限不能写入项目文件夹外。如用户确需该操作，使用原生 sandbox_permissions 与 justification 申请一次沙箱升级，等待明确批准；拒绝后停止。' };
  }
  if (['pwsh', 'bash', 'shell'].includes(exec.name)) {
    const cwd = resolve(executionDirectory(exec.agent.session), exec.arguments?.workdir ?? '.');
    for (const write of shellWriteTargets(exec.arguments?.command ?? '', cwd, exec.name !== 'bash')) {
      if (project.permission === 'read-only') return { kind: 'deny', reason: 'PROJECT_READ_ONLY: 此项目只读，不能通过命令修改文件。' };
      if (!exec.arguments?.sandbox_permissions && write.target && !await insideProject(project.rootPath, write.target)) return { kind: 'deny', reason: 'PROJECT_WRITE_OUTSIDE: 当前命令不能写入项目文件夹外。确需执行时用原生 sandbox_permissions 与 justification 申请一次升级，等待用户明确批准。' };
    }
  }
  if (project.permission === 'read-only' && exec.arguments?.sandbox_permissions)
    return { kind: 'deny', reason: 'PROJECT_READ_ONLY: 只读项目不能申请可写沙箱。请修改项目权限。' };
  return null;
}
