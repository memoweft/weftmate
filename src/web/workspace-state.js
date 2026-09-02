/** Renderer state that is safe to execute without a DOM. */
export function deriveWorkspaceState({ profile, runtimeReady, running }) {
  const hasKey = profile?.hasKey === true;
  const configured = !!profile && hasKey && runtimeReady;
  const kind = !profile ? 'no-profile' : !hasKey ? 'credential-unavailable' : !runtimeReady ? 'runtime-unavailable' : 'ready';
  const connection = !profile ? '离线工作台' : !hasKey ? '凭据不可用' : !runtimeReady ? '运行时未就绪' : running ? '正在生成' : '已连接';
  return { configured, kind, connection, preserveHistory: kind === 'runtime-unavailable' };
}
