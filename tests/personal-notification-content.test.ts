import assert from 'node:assert/strict';
import test from 'node:test';
import { putActivity, reconcileActivity } from '../src/personal-access/activity-store.mjs';
import { observeActivityEvents } from '../src/personal-access/activity.mjs';
import { finalizeNotifications } from '../src/personal-access/notification-settings.mjs';
import { nativeEventNotification } from '../src/personal-access/notification-content.mjs';

const at = '2026-10-10T02:00:00Z';
function fixture() {
  return { sessions: { a: { origin: 'personal-remote', title: '整理项目资料' } }, commands: { task: { commandId: 'task', sessionId: 'a', kind: 'session.message', state: 'accepted_by_dsh', dshTurn: 1, payload: { text: '整理项目资料并生成摘要' } } } } as any;
}

test('host completion uses task name and concise copy while preserving activity details', () => {
  const account = fixture();
  observeActivityEvents(account, 'a', [{ seq: 0, at, type: 'turn.started', data: { turn: 1 } }, { seq: 1, type: 'step.completed' }, { seq: 2, type: 'assistant.message', data: { text: '已整理三份资料。' } }, { seq: 3, at, type: 'turn.ended', data: { reason: 'completed' } }], 3);
  const row = Object.values(account.activity.items)[0] as any;
  assert.equal(row.notification.title, '整理项目资料');
  assert.equal(row.notification.body, '已完成 · 点开查看结果');
  assert.equal(row.summary, '已整理三份资料。');
  account.chatResults = { result: { taskId: 'task', state: 'completed', at, sourceRef: { native: { sessionId: 'a' } }, summary: '已完成' } };
  reconcileActivity(account);
  assert.equal(Object.keys(account.activity.items).length, 1);
  assert.equal(account.activity.items[row.id].notification.body, '已完成 · 点开查看结果');
});

test('failed native turn reports its actual failure and does not replace it with earlier assistant text', () => {
  const account = fixture();
  observeActivityEvents(account, 'a', [{ seq: 0, at, type: 'turn.started', data: { turn: 1 } }, { seq: 1, type: 'assistant.message', data: { text: '我会读取资料。' } }, { seq: 2, at, type: 'turn.ended', data: { reason: 'failed', error: { message: '文件已被移动，无法读取。' } } }], 2);
  const row = Object.values(account.activity.items)[0] as any;
  assert.equal(row.notification.body, '文件已被移动，无法读取。');
  account.chatResults = { result: { taskId: 'task', state: 'failed', at, sourceRef: { native: { sessionId: 'a' } }, summary: '执行失败' } };
  reconcileActivity(account);
  assert.equal(account.activity.items[row.id].notification.body, '文件已被移动，无法读取。');
});

test('approval identifies the operation; reminder carries its actual content', () => {
  const account = fixture();
  account.commands.task.toolApprovals = [{ approvalId: 'a', taskId: 'task', toolName: '写入项目摘要', createdAt: at, status: 'pending' }];
  reconcileActivity(account);
  const approval = Object.values(account.activity.items)[0] as any;
  assert.equal(approval.notification.body, '需要你批准：写入项目摘要');
  const reminder = putActivity(account, 'reminder', { at, type: 'reminder.triggered', title: '提醒', summary: '下午三点查看资料', source: { sessionId: 'a' } });
  assert.equal(reminder.notification.body, '下午三点查看资料');
});

test('DSH projected error and max-token terminal reasons create failed activity with native cause', () => {
  const account = fixture();
  observeActivityEvents(account, 'a', [{ seq: 0, at, type: 'turn.started', data: { turn: 1 } }, { seq: 1, at, type: 'turn.ended', data: { reason: 'error', endReasonKind: 'max-tokens' } }], 1);
  const row = Object.values(account.activity.items)[0] as any;
  assert.equal(row.type, 'task.failed');
  assert.equal(row.notification.body, '回复达到长度上限，任务未能完成。');
});

test('temporary task and approval notification fields never persist private text', () => {
  const account = fixture();
  account.sessions.a.temporary = true;
  account.sessions.a.title = 'TEMP-PRIVATE-TITLE';
  const result = putActivity(account, 'result', { at, type: 'task.completed', title: 'SECRET', summary: 'SECRET', source: { sessionId: 'a', taskId: 'task' } });
  assert.equal(result.notification.title, '临时对话中的任务');
  assert.equal(result.notification.body, '已完成 · 点开查看结果');
  putActivity(account, 'failed', { at, type: 'task.failed', title: 'SECRET', summary: 'SECRET', failureReason: 'SECRET', source: { sessionId: 'a' } });
  putActivity(account, 'approval', { at, type: 'approval.pending', state: 'pending', title: 'SECRET', summary: 'SECRET', approvalOperation: 'SECRET', source: { sessionId: 'a' } });
  assert.ok(!JSON.stringify(account.activity).includes('SECRET'));
  assert.ok(!JSON.stringify(account.activity).includes('TEMP-PRIVATE-TITLE'));
});

test('old persisted activity gains host notification copy without changing its notification decision', () => {
  const account = fixture();
  const row = putActivity(account, 'result', { at, type: 'task.completed', title: '任务完成', summary: '已完成', source: { sessionId: 'a' } });
  delete row.notification.title; delete row.notification.body;
  row.notification.notify = false; row.notification.reason = 'dnd';
  finalizeNotifications(account, Date.parse(at), 'UTC');
  assert.equal(row.notification.title, '整理项目资料');
  assert.equal(row.notification.body, '已完成 · 点开查看结果');
  assert.equal(row.notification.notify, false);
  assert.equal(row.notification.reason, 'dnd');
});

test('legacy desktop uses the same task, approval and reminder copy', () => {
  assert.deepEqual(nativeEventNotification({ type: 'turn.ended', data: { reason: 'completed' } }, '整理项目资料'), { title: '整理项目资料', body: '已完成 · 点开查看结果' });
  assert.equal(nativeEventNotification({ type: 'approval.requested', data: { toolName: '写入项目摘要' } }).body, '需要你批准：写入项目摘要');
  assert.equal(nativeEventNotification({ type: 'assistant.message', data: { reminder: true, text: '下午三点查看资料' } }).body, '下午三点查看资料');
});
