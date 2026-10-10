const text = (value, limit = 160) => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');

/** Notification copy belongs to the host; native clients only display these fields. */
export function activityNotificationContent(account, row) {
  const session = account.sessions?.[row.source?.sessionId];
  const task = account.commands?.[row.source?.taskId];
  const taskTitle = row.temporary ? '临时对话中的任务' : text(session?.title || task?.payload?.text || row.title, 80);
  if (row.type === 'task.completed') return { title: taskTitle, body: '已完成 · 点开查看结果' };
  if (row.type === 'task.failed') {
    const summary = text(row.summary?.replace(/^执行失败[：:]\s*/, ''));
    const reason = row.failureReason || (!['', '任务失败', '执行失败', '打开对话查看结果。'].includes(summary) ? summary : '宿主未提供失败原因 · 点开查看详情');
    return { title: taskTitle, body: row.temporary ? '任务未能完成 · 点开查看原因' : text(reason) };
  }
  if (row.type === 'task.stopped') return { title: taskTitle, body: '已停止 · 点开查看详情' };
  if (row.type === 'approval.pending' && row.state === 'pending') return { title: row.title, body: row.temporary ? '需要你批准：临时对话中的操作' : `需要你批准：${text(row.approvalOperation || row.summary).replace(/^需要你批准[：:]\s*/, '')}` };
  return { title: row.title, body: row.summary };
}

export function nativeFailureReason(data) {
  return text(typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message || data?.reasonText || (data?.endReasonKind === 'max-tokens' ? '回复达到长度上限，任务未能完成。' : data?.reason === 'blocked' ? '任务被阻止，无法继续执行。' : ''));
}

/** Compatibility for hosts that expose native history but no activity API yet. */
export function nativeEventNotification(event, taskTitle = '对话任务') {
  const data = event.data ?? {};
  if (event.type === 'assistant.message' && data.reminder) return { title: '提醒', body: text(data.text) };
  if (event.type === 'approval.requested') return { title: '需要审批', body: `需要你批准：${text(data.reason || data.toolName || '这项操作')}` };
  if (event.type === 'question.asked') return { title: '需要回答', body: text(data.questions?.[0]?.question || '打开对话补充信息。') };
  if (event.type === 'turn.ended' && data.reason === 'completed') return { title: text(taskTitle, 80), body: '已完成 · 点开查看结果' };
  if (event.type === 'turn.ended' && ['failed','error','blocked'].includes(data.reason)) return { title: text(taskTitle, 80), body: nativeFailureReason(data) || '宿主未提供失败原因 · 点开查看详情' };
  return null;
}
