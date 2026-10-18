import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function timeline() {
  const context: any = { WeftUiCore: { factories: {} }, Intl, URL, Date };
  runInNewContext(readFileSync('src/ui-core/timeline-model.js', 'utf8'), context);
  return context.WeftUiCore;
}
function turn(turn: number, offset: number, user: string, reply: string) {
  const event = (seq: number, type: string, data: any) => ({ seq: offset + seq, type, sessionId: 'synthetic', data });
  return [event(0, 'turn.started', { turn }), event(1, 'user.message', { text: user }),
    event(2, 'step.started', { taskId: `turn-${turn}`, stepId: `load-${turn}`, toolName: 'load_tools', summary: '准备可用工具', state: 'running' }),
    event(3, 'step.completed', { taskId: `turn-${turn}`, stepId: `load-${turn}`, toolName: 'load_tools', state: 'completed' }),
    event(4, 'step.started', { taskId: `turn-${turn}`, stepId: `schedule-${turn}`, toolName: 'schedule_list', summary: '查看定时安排', state: 'running' }),
    event(5, 'step.completed', { taskId: `turn-${turn}`, stepId: `schedule-${turn}`, toolName: 'schedule_list', state: 'completed' }),
    event(6, 'assistant.message', { text: reply }), event(7, 'turn.ended', { turn, reason: 'completed' })];
}
const english = turn(1, 0, 'What reminder is already saved? Read the actual list. Reply in English.', 'Your reminder is saved for later tonight.');

test('English reminder conversation has an English progress title despite Chinese runtime metadata', () => {
  const core = timeline(), block = core.projectTimeline(english).groups[0];
  assert.equal(core.progressText(block.steps, core.turnOutcome(english, block.taskId)).text, 'Handled 1 scheduling action');
});
test('expanded English steps use English tool labels and preserve raw arguments', () => {
  const core = timeline(), block = core.projectTimeline(english).groups[0];
  const steps = block.steps.map((step: any) => core.stepPresentation(step, core.turnOutcome(english, block.taskId)));
  assert.equal(steps[0].summary, 'Prepare tools'); assert.equal(steps[1].summary, 'List schedules');
});
test('progress language belongs to its turn rather than the last conversation message', () => {
  const core = timeline(), events = [...english, ...turn(2, 10, '查一下已有提醒。', '今晚已有一条提醒。')];
  const groups = core.projectTimeline(events).groups;
  assert.equal(core.progressText(groups[0].steps, core.turnOutcome(events, groups[0].taskId)).text, 'Handled 1 scheduling action');
  assert.equal(core.progressText(groups[1].steps, core.turnOutcome(events, groups[1].taskId)).text, '处理了 1 次定时安排');
});
test('streaming and native projections share English labels without translating stored data', () => {
  const core = timeline(), streaming = english.filter(event => !['assistant.message','turn.ended'].includes(event.type));
  const block = core.projectTimeline(streaming).groups[0];
  assert.equal(core.progressText(block.steps, { terminal: false }).text, 'Handled 1 scheduling action');
  const row = core.nativeTimelineRows(english).find((event: any) => event.type === 'native.progress');
  assert.equal(row.data.summary, 'Handled 1 scheduling action');
  assert.equal(row.data.steps[1].summary, 'List schedules');
  const detail = JSON.stringify({ arguments: { query:'合成提醒' }, output:[{ type:'text', text:'合成提醒今晚九点' }] });
  assert.match(core.executionDetailText(detail, 'en'), /^Parameters\n/);
  assert.ok(core.executionDetailText(detail, 'en').includes('Output\n合成提醒今晚九点'));
  assert.equal(core.progressWaitingText('等待模型回复… 14 秒', 'en'), 'Waiting for the model… 14 s');
});
