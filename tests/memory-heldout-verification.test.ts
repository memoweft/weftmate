import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMemoryHoldout, judgeMemorySemantics } from './integration/baseline-memory-verification.mjs';

const scenario = { turns: [{ user: '原话' }, { user: '新问题' }], checks: [{ type: 'llm_judge', prompt: '正确采用偏好' }] };
const result = { status: 'failed', turns: [{ sessionId: 'a', approvals: [] },
  { sessionId: 'b', approvals: [], reply: '语义正确', memoryUsed: [{ id: 'current', kind: 'relationship' }] }] };
const expectation = { kind: 'relationship', currentPattern: '同事', sourceTurn: 0 };

test('formal provenance is checked even when literal reply checks fail', async () => {
  const api = async (path: string) => ({ body: path.includes('/sources') ? { sources: [{ rawContent: '原话' }] }
    : { items: [{ id: 'current', text: '我的同事', currentState: 'current' }] } });
  const proof = await verifyMemoryHoldout({ result, scenario, expectation, api });
  assert.equal(proof.status, 'passed');
  assert.equal(proof.checks.exactSourceRetained, true);
  assert.equal(result.status, 'failed');
});

test('matching text in the wrong formal kind is insufficient', async () => {
  const api = async () => ({ body: { items: [{ id: 'current', text: '我的同事', currentState: 'current' }] } });
  const wrongKind = { ...result, turns: [result.turns[0], { ...result.turns[1], memoryUsed: [{ id: 'current', kind: 'cognition' }] }] };
  const proof = await verifyMemoryHoldout({ result: wrongKind, scenario, expectation, api });
  assert.equal(proof.status, 'failed');
  assert.equal(proof.checks.currentItemAdopted, undefined);
});

test('semantic pass is parallel evidence and cannot turn deterministic failure into success', async () => {
  const judgement = await judgeMemorySemantics({ result, scenario, key: 'synthetic', fetchImpl: async (_url: string, options: any) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"pass":true,"reason":"同义表达"}' } }], usage: { prompt_tokens: 10 } }));
  } });
  assert.equal(judgement.status, 'passed');
  assert.equal(judgement.reason, '同义表达');
  assert.equal(result.status, 'failed');
});

test('malformed semantic verdict retains usage and an explicit error', async () => {
  const judgement = await judgeMemorySemantics({ result, scenario, key: 'synthetic', fetchImpl: async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'bad JSON' } }], usage: { completion_tokens: 7 } })) });
  assert.equal(judgement.status, 'error');
  assert.equal(judgement.usage.completion_tokens, 7);
  assert.equal(judgement.rawVerdict, 'bad JSON');
});
