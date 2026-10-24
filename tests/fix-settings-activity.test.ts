import assert from 'node:assert/strict';
import test from 'node:test';
import { putActivity, reconcileActivity, activityCounts } from '../src/personal-access/activity-store.mjs';

test('#642 resolved approvals and answers are read; only pending decisions and task results need attention', () => {
  const account: any = { sessions: { s: {} }, commands: { t: { sessionId: 's', commandId: 't',
    toolApprovals: [{ approvalId: 'auto', status: 'resolved', decisionOutcome: 'allowed-once' }, { approvalId: 'ask', status: 'pending' }],
    userQuestions: [{ questionRpcId: 'q', status: 'pending' }] } } };
  reconcileActivity(account);
  const rows = () => Object.values(account.activity.items) as any[];
  assert.equal(rows().find(row => row.summary === '已处理').read, true);
  assert.equal(activityCounts(account).unreadCount, 2);
  account.commands.t.toolApprovals[1].status = 'resolved';
  account.commands.t.userQuestions[0].status = 'resolved';
  reconcileActivity(account);
  assert.equal(activityCounts(account).unreadCount, 0);
  for (const type of ['task.started', 'task.stopped', 'memory.submission.completed', 'system.reconnected']) {
    assert.equal(putActivity(account, type, { type, title: type }).read, true);
  }
  for (const type of ['task.completed', 'task.failed']) assert.equal(putActivity(account, type, { type, title: type }).read, false);
  assert.equal(activityCounts(account).unreadCount, 2);
});

test('#642 existing handled approval unread counts are corrected on reconciliation and remain stable', () => {
  const account: any = { sessions: { s: {} }, commands: { t: { sessionId: 's', toolApprovals: [{ approvalId: 'old', status: 'resolved' }] } } };
  reconcileActivity(account);
  const row: any = Object.values(account.activity.items)[0]; row.read = false;
  reconcileActivity(account);
  assert.equal(activityCounts(account).unreadCount, 0);
  const sequence = account.activity.sequence;
  reconcileActivity(account); assert.equal(account.activity.sequence, sequence);
});
