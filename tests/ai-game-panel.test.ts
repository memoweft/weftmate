import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AiGamePanelError,
  collectDurableExecutionPointers,
  projectAiGameSessionPanel,
  sanitizeAiGameSnapshot,
  selectExecutionCandidate,
} from '../src/runtime/ai-game/panel.mjs'

function durable(executionId: string, status: string, seq: number, callId = `call-${executionId}`) {
  return [
    { type: 'tool/call', seq: seq - 1, time: seq - 1, data: { callId, name: 'phone_execution' } },
    {
      type: 'tool/result', seq, time: seq, data: {
        message: { source: { callId } },
        meta: {
          schemaVersion: 1,
          kind: 'ai-game-execution',
          toolName: 'phone_execution',
          executionId,
          status,
          eventCursor: seq,
          evidenceRefs: [{ read_path: 'must-never-leak' }],
        },
      },
    },
  ]
}

function snapshot(executionId: string, status: string) {
  return {
    execution_id: executionId,
    status,
    goal_summary: `Goal ${executionId}`,
    current_stage: 'Waiting for device',
    progress: { kind: 'unknown', completed: null, total: null, explanation: 'No numeric measure.' },
    current_action: null,
    pending_question: status === 'needs_user_input'
      ? { question_id: 'q-1', question: 'Choose an account', why_needed: 'Required by the app' }
      : null,
    result_summary: status === 'succeeded' ? 'Done' : null,
    evidence_refs: [{
      evidence_id: 'ev-1', content_type: 'image/png', size_bytes: 123,
      sha256: 'a'.repeat(64), read_path: `/api/execution/v1/executions/${executionId}/evidence/ev-1`,
    }],
    event_cursor: 9,
    timestamps: { created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:01:00Z', terminal_at: null },
    error: null,
    internal_pointer: { session_id: 'secret-session', goal_id: 'secret-goal', task_id: 'secret-task' },
  }
}

describe('Stage 4B durable execution recovery', () => {
  it('recovers only correlated phone_execution pointers and keeps the latest pointer per execution', () => {
    const events = [
      ...durable('exec-a', 'running', 2),
      ...durable('exec-a', 'cancelled', 4, 'call-a-2'),
      { type: 'tool/result', seq: 6, data: { message: { source: { callId: 'orphan' } }, meta: {
        schemaVersion: 1, kind: 'ai-game-execution', toolName: 'phone_execution', executionId: 'orphan',
        status: 'running', eventCursor: 1, evidenceRefs: [],
      } } },
      ...durable('wrong-tool', 'running', 8, 'call-wrong').map((event, index) => index === 0
        ? { ...event, data: { ...event.data, name: 'read' } }
        : event),
    ]
    assert.deepEqual(collectDurableExecutionPointers(events).map(item => [item.executionId, item.status]), [
      ['exec-a', 'cancelled'],
    ])
    assert.deepEqual(
      collectDurableExecutionPointers(structuredClone(events)),
      collectDurableExecutionPointers(events),
      'reload/restart reconstruction must not depend on object identity',
    )
  })

  it('selects needs-user-input, then active, otherwise the newest durable pointer', () => {
    const pointer = (executionId: string, status: string, seq: number) => ({ executionId, status, seq, time: seq })
    const selected = selectExecutionCandidate([
      { pointer: pointer('terminal-new', 'succeeded', 30), snapshot: snapshot('terminal-new', 'succeeded') },
      { pointer: pointer('active', 'running', 20), snapshot: snapshot('active', 'running') },
      { pointer: pointer('question', 'needs_user_input', 10), snapshot: snapshot('question', 'needs_user_input') },
    ])
    assert.equal(selected?.pointer.executionId, 'question')
    assert.equal(selectExecutionCandidate([
      { pointer: pointer('old', 'failed', 1), snapshot: snapshot('old', 'failed') },
      { pointer: pointer('new', 'succeeded', 2), snapshot: snapshot('new', 'succeeded') },
    ])?.pointer.executionId, 'new')
  })
})

describe('Stage 4B safe host projection', () => {
  it('returns authoritative state, cursor-deduped human events, and no private pointer/path/hash', async () => {
    const transport = {
      inspect: async (executionId: string) => snapshot(executionId, 'waiting_event'),
      events: async () => ({
        items: [
          { cursor: 5, type: 'runtime.event', created_at: 't1', payload: { private: 'x' } },
          { cursor: 5, type: 'runtime.event', created_at: 't1', payload: { private: 'x' } },
          { cursor: 6, type: 'unknown.private.event', created_at: 't2', payload: { private: 'x' } },
        ],
        count: 3,
        next_cursor: 6,
      }),
    }
    const panel = await projectAiGameSessionPanel({
      sessionId: 'session-a', events: durable('exec-a', 'running', 2), transport, after: 4,
    })
    assert.equal(panel.hasExecution, true)
    assert.equal(panel.selectedExecutionId, 'exec-a')
    assert.equal(panel.snapshot?.status, 'waiting_event')
    assert.deepEqual(panel.events, [{ cursor: 5, label: '设备执行阶段已更新', createdAt: 't1' }])
    const wire = JSON.stringify(panel)
    assert.doesNotMatch(wire, /read_path|sha256|secret-session|secret-goal|secret-task|private/)
    assert.equal(panel.snapshot?.progress.kind, 'unknown')
    assert.equal(Object.hasOwn(panel.snapshot?.progress ?? {}, 'completed'), false)
  })

  it('isolates unavailable AI-Game from a valid durable DSH session and permits bounded read retry', async () => {
    const failure = Object.assign(new Error('secret upstream detail'), { code: 'AI_GAME_UNAVAILABLE', retryable: true })
    const panel = await projectAiGameSessionPanel({
      sessionId: 'session-a',
      events: durable('exec-a', 'waiting_event', 2),
      transport: { inspect: async () => { throw failure }, events: async () => { throw failure } },
    })
    assert.equal(panel.availability, 'unavailable')
    assert.equal(panel.snapshot, null)
    assert.equal(panel.failure?.retryable, true)
    assert.doesNotMatch(JSON.stringify(panel), /secret upstream detail/)
  })

  it('never exposes another session execution through the requested-execution selector', async () => {
    await assert.rejects(
      projectAiGameSessionPanel({
        sessionId: 'session-a',
        events: durable('exec-a', 'running', 2),
        transport: { inspect: async () => snapshot('exec-a', 'running'), events: async () => ({ items: [], next_cursor: 0 }) },
        requestedExecutionId: 'exec-b',
      }),
      (error: unknown) => error instanceof AiGamePanelError && error.code === 'AI_GAME_PANEL_FORBIDDEN',
    )
  })

  it('shows no execution at all for an ordinary session', async () => {
    const panel = await projectAiGameSessionPanel({
      sessionId: 'ordinary',
      events: [{ type: 'tool/call', seq: 1, data: { callId: 'r1', name: 'read' } }],
      transport: { inspect: async () => { throw new Error('must not call') }, events: async () => { throw new Error('must not call') } },
    })
    assert.deepEqual(panel, {
      schemaVersion: 1, kind: 'ai-game-panel', sessionId: 'ordinary', hasExecution: false,
    })
  })

  it('derives action hints only from authoritative statuses', () => {
    assert.deepEqual(sanitizeAiGameSnapshot(snapshot('x', 'needs_user_input')).allowedIntents, {
      cancel: true, resume: false, answer: true,
    })
    assert.deepEqual(sanitizeAiGameSnapshot(snapshot('x', 'cancelled')).allowedIntents, {
      cancel: false, resume: true, answer: false,
    })
    assert.deepEqual(sanitizeAiGameSnapshot(snapshot('x', 'succeeded')).allowedIntents, {
      cancel: false, resume: false, answer: false,
    })
  })
})
