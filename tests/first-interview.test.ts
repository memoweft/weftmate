import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_INTERVIEW_STEPS,
  FIRST_INTERVIEW_TOTAL_STEPS,
  advanceFirstInterview,
  ensureFirstInterviewRunId,
  newFirstInterviewState,
  normalizeFirstInterviewState,
  transitionFirstInterview,
} from '../src/first-interview.ts';

describe('首次认识纯状态机', () => {
  it('三轮可开始、暂停、继续并只在最后完成', () => {
    const fresh = newFirstInterviewState('t0');
    const started = transitionFirstInterview(fresh, 'start', { conversationId: 's-1', now: 't1' });
    assert.equal(started.status, 'in_progress');
    assert.equal(started.step, 0);
    assert.equal(started.conversationId, 's-1');
    assert.match(started.runId ?? '', /^[0-9a-f-]{36}$/i);
    assert.equal(started.updatedAt, 't1');

    const paused = transitionFirstInterview(started, 'pause', { now: 't2' });
    assert.equal(paused.status, 'paused');
    assert.equal(paused.runId, started.runId);
    const resumed = transitionFirstInterview(paused, 'resume', { now: 't3' });
    assert.equal(resumed.status, 'in_progress');
    assert.equal(resumed.conversationId, 's-1');
    assert.equal(resumed.runId, started.runId);

    const second = advanceFirstInterview(resumed, 't4');
    const third = advanceFirstInterview(second, 't5');
    const completed = advanceFirstInterview(third, 't6');
    assert.deepEqual([second.step, third.step, completed.step], [1, 2, 2]);
    assert.equal(completed.status, 'completed');
  });

  it('跳过整段或单题只改流程元数据，不产生答案字段', () => {
    const skipped = transitionFirstInterview(newFirstInterviewState('t0'), 'skip', { now: 't1' });
    assert.equal(skipped.status, 'skipped');
    assert.deepEqual(Object.keys(skipped).sort(), ['conversationId', 'runId', 'status', 'step', 'updatedAt']);

    const started = transitionFirstInterview(skipped, 'start', { conversationId: 's-2', now: 't2' });
    const next = transitionFirstInterview(started, 'skip_step', { now: 't3' });
    assert.equal(next.step, 1);
    assert.equal(next.status, 'in_progress');

    const stopped = transitionFirstInterview(started, 'skip', { now: 't4' });
    const restarted = transitionFirstInterview(stopped, 'start', { conversationId: 's-2', now: 't5' });
    assert.notEqual(restarted.runId, started.runId, '同一对话重新开始也必须是新一轮');
  });

  it('旧版进行中或暂停状态可补 runId，且不丢进度', () => {
    const legacy = normalizeFirstInterviewState({
      status: 'paused', step: 1, conversationId: 's-old', updatedAt: 'old',
    });
    assert.ok(legacy);
    assert.equal(legacy.runId, null);

    const upgraded = ensureFirstInterviewRunId(legacy, 'run-legacy');
    assert.deepEqual(upgraded, { ...legacy, runId: 'run-legacy' });
    const resumed = transitionFirstInterview(upgraded, 'resume', { now: 'new' });
    assert.equal(resumed.runId, 'run-legacy');
    assert.equal(resumed.step, 1);
  });

  it('状态损坏时拒绝读取，三轮文案明确 MBTI 只作参考', () => {
    assert.equal(normalizeFirstInterviewState({ status: 'unknown', step: 9 }), null);
    assert.equal(FIRST_INTERVIEW_TOTAL_STEPS, 3);
    assert.equal(FIRST_INTERVIEW_STEPS.length, 3);
    assert.match(FIRST_INTERVIEW_STEPS[2].question.zh, /MBTI.+只作参考.+不会定义你/);
    assert.match(FIRST_INTERVIEW_STEPS[2].question.en, /only a reference.+does not define you/i);
  });
});
