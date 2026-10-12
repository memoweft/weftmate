import { exactKeys, failure } from '../personal-access/common.mjs';
import { connectorPermission } from './policy.mjs';
import { createHash } from 'node:crypto';
export async function connectorSettings(context, request, auth, operation) {
  if (!context.connectors) return { connectors: [], builtinConnectors: [], canManageConnectors: false };
  const { ownerId, device } = auth, desktop = device.authKind === 'desktop';
  if (operation) {
    exactKeys(operation, ['action','id','name','transport','command','args','url','credentials','builtinId','fields','enabled'], ['action']);
    if (operation.action !== 'toggle' && !desktop) throw failure('FORBIDDEN', 403);
    context.authenticate(request, 'commands:write');
    if (operation.action === 'test') return { connectionTest: await context.connectors.test(ownerId, operation) };
    if (operation.action === 'add') await context.connectors.add(ownerId, operation);
    else if (operation.action === 'toggle') await context.connectors.enable(ownerId, operation.id, operation.enabled);
    else if (operation.action === 'rotate') await context.connectors.rotate(ownerId, operation.id, operation.credentials);
    else if (operation.action === 'remove') {
      const names = await context.connectors.remove(ownerId, operation.id);
      await context.serial(() => context.mutate(ownerId, account => { for (const name of Object.keys(account.permissionRules ?? {})) if (names.includes(name) || name.startsWith(`mcp__${operation.id}__`)) delete account.permissionRules[name]; }));
    } else throw failure('INVALID_REQUEST');
  }
  const account = context.accountState(ownerId);
  const policy = { mode: account.defaultApprovalMode ?? 'auto', permissionRules: account.permissionRules ?? {} };
  const connectors = context.connectors.list(ownerId).map(connector => ({ ...connector,
    tools: connector.tools.map(tool => {
      const defaults = { ...policy.permissionRules }; delete defaults[tool.name];
      return { ...tool, rule: connectorPermission(policy, tool).decision,
        defaultRule: connectorPermission({ ...policy, permissionRules: defaults }, tool).decision };
    }) }));
  return { connectors, builtinConnectors: context.connectors.builtins(), canManageConnectors: desktop };
}
export async function connectorExecution(context, input) {
  const ownerId = context.sessionOperations.executionOwnerForSession(input.sessionId), account = context.accountState(ownerId);
  const { source } = context.personalExecutionSource(account, input, true);
  const execution = source.toolExecutions?.find(row => row.callId === input.callId && row.rootCallId === input.rootCallId && row.state === 'running');
  const hash = createHash('sha256').update(JSON.stringify(input.arguments)).digest('hex');
  if (!execution || execution.toolName !== input.toolName || execution.argumentsHash !== hash || execution.runtimeId !== input.runtimeId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
  const tool = context.connectors?.catalog(ownerId).find(tool => tool.name === input.toolName && tool.connectorId === input.connectorId);
  if (!tool) throw failure('CAPABILITY_UNAVAILABLE', 503);
  const project = account.projects?.[source.payload.projectId];
  const decision = connectorPermission({ mode: account.sessions[input.sessionId]?.approvalMode ?? account.defaultApprovalMode ?? 'auto',
    permissionRules: account.permissionRules, projectPermissionRules: project?.permissionRules }, tool);
  if (decision.decision === 'deny' || decision.decision === 'ask' && !source.toolApprovals?.some(row =>
      row.callId === input.callId && row.argumentsHash === hash && row.runtimeId === input.runtimeId && row.status === 'resolved' && row.outcome === 'allowed-once')) throw failure('FORBIDDEN', 403);
  return context.connectors.call(ownerId, input.connectorId, input.toolName, input.arguments);
}
