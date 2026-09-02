/**
 * Keep the native startup dialog useful without reflecting a CLI error verbatim.
 * CLI output can contain paths, command lines, and environment-derived secrets;
 * the full diagnostic is retained only in the local crash log.
 */
export interface HarnessStartupErrorView {
  title: string;
  message: string;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error ?? '');
}

export function formatHarnessStartupError(error: unknown): HarnessStartupErrorView {
  const detail = errorText(error).toLowerCase();
  let reason = 'Harness 未能完成启动。';

  if (/err_module_not_found|cannot find module|enoent|missing|缺|不完整/.test(detail)) {
    reason = 'Harness 运行时文件缺失或不完整。';
  } else if (/timed? out|timeout|等待.*地址/.test(detail)) {
    reason = 'Harness 未在预期时间内提供本机访问地址。';
  } else if (/eaddrinuse|address already in use/.test(detail)) {
    reason = 'Harness 所需的本机端口当前不可用。';
  }

  return {
    title: 'WeftMate 无法启动 Harness',
    message: `${reason}\n\n请先退出并重新打开 WeftMate。若安装版持续失败，请重新安装当前候选；既有用户数据会按预览版策略保留。详细诊断已写入本机 WeftMate 崩溃日志。`,
  };
}
