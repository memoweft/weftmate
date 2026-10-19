import { scheduleSourceReceipt } from '../personal-access/schedules-native.mjs';

/** Adapt the native per-agent definition in place; a second registration conflicts. */
export function installAccountScheduleQuery(tools, agent, request) {
  const tool = tools.get('schedule_list', agent);
  Object.assign(tool, {
    description: 'List all reminders and scheduled tasks for this account across every conversation, including paused entries. This is the same list as the goals page.',
    // This is an existing normalized definition, so use JSON Schema, not defineTool's spec shorthand.
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => request({ action: 'schedule_list', sessionId: exec.agent.id, sourceReceiptId: scheduleSourceReceipt(exec) }),
    presentCall: () => ({ card: 'generic', title: '查看提醒与定时任务', kind: 'other' }),
  });
}
