/** Small reducer so an IPC rejection cannot dismiss the still-actionable card. */
export function receiveApproval(previous, request) {
  return { request, error: '', submitting: false, changed: previous?.request?.approvalId !== request.approvalId };
}

export function beginApproval(previous) {
  return previous?.request ? { ...previous, error: '', submitting: true } : previous;
}

export function settleApproval(previous, result) {
  if (!previous?.request) return previous;
  if (result?.ok && result.accepted === true) return { request: null, error: '', submitting: false, changed: false };
  return { ...previous, error: result?.error || '许可请求未被 Harness 接受。请重试或重新发起这项操作。', submitting: false, changed: false };
}
