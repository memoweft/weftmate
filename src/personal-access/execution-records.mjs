import { failure } from './common.mjs';
import { chatForSession } from './chat-identity.mjs';
import { PERMISSION_TYPES, riskPermissionType, permissionCategories, permissionSummary } from '../plugins/personal-permission-rules.mjs';
function approvalSummary(approval, execution) {
  if (execution?.permission?.summary) return execution.permission.summary;
  const operation = /操作：([^\n]+)\n([\s\S]*)$/.exec(approval.reason);
  if (operation) { try { return permissionSummary(operation[1], JSON.parse(operation[2])); } catch { /* Older truncated reasons keep their first sentence. */ } }
  return approval.reason.replace(/^\[weftmate:[^\]]+\]\s*/, '').split('\n')[0].replace(/\s+/g,' ').slice(0,500);
}
export function executionRecords(account, params = new URLSearchParams()) {
  if ([...params.keys()].some(key => !['type','projectId','since','until','before','limit'].includes(key) || params.getAll(key).length !== 1)) throw failure('INVALID_REQUEST');
  const type = params.get('type'), projectId = params.get('projectId'), since = params.get('since'), until = params.get('until');
  const limit = Number(params.get('limit') ?? 100);
  if (type && !PERMISSION_TYPES.some(row => row.id === type) || !Number.isInteger(limit) || limit < 1 || limit > 200 ||
      [since,until].some(value => value && !Number.isFinite(Date.parse(value)))) throw failure('INVALID_REQUEST');
  const rows = [];
  for (const command of Object.values(account.commands)) {
    const session = account.sessions[command.sessionId];
    if (!session || session.deleting) continue;
    const chat = chatForSession(account, command.sessionId), project = account.projects?.[command.payload?.projectId];
    const base = { sessionId: command.sessionId, conversationId: chat?.chatId ?? null,
      conversationName: session.title ?? (chat?.kind === 'main' ? 'WeftMate' : command.payload?.text?.replace(/\s+/g,' ').slice(0,80)) ?? '对话', projectId: project?.projectId ?? null, projectName: project?.name ?? null };
    for (const approval of command.toolApprovals ?? []) {
      const outcome = approval.decisionOutcome ?? approval.outcome;
      const execution = command.toolExecutions?.find(row => row.callId === approval.callId);
      rows.push({ ...base, id: approval.approvalId, at: approval.answeredAt ?? approval.createdAt,
        types: approval.operationCategories ?? [...new Set((approval.riskCategories ?? []).map(riskPermissionType))],
        summary: approvalSummary(approval, execution),
        result: outcome === 'allowed-once' ? 'allowed' : outcome === 'rejected' ? 'rejected' : approval.status === 'pending' ? 'pending' : 'unavailable',
        executionState: execution?.state ?? null });
    }
    for (const execution of command.toolExecutions ?? []) {
      if (command.toolApprovals?.some(row => row.callId === execution.callId)) continue;
      const permission = execution.permission;
      rows.push({ ...base, id: execution.executionId, at: execution.startedAt, types: permission?.types ?? permissionCategories(execution.toolName),
        summary: permission?.summary ?? execution.toolName, result: permission?.decision === 'deny' ? 'blocked' : 'automatic',
        ruleSource: permission?.source ?? 'default', executionState: execution.state });
    }
  }
  const filtered = rows.filter(row => (!type || row.types.includes(type)) && (!projectId || (projectId === 'none' ? !row.projectId : row.projectId === projectId)) &&
    (!since || Date.parse(row.at) >= Date.parse(since)) && (!until || Date.parse(row.at) <= Date.parse(until)))
    .sort((a,b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const before = params.get('before'), offset = before ? filtered.findIndex(row => row.id === before) + 1 : 0;
  if (before && !offset) throw failure('INVALID_REQUEST');
  const items = filtered.slice(offset, offset + limit), hasMore = filtered.length > offset + limit;
  return { items, hasMore, nextBefore: hasMore ? items.at(-1).id : null,
    projects: Object.values(account.projects ?? {}).map(row => ({ projectId: row.projectId, name: row.name })) };
}
