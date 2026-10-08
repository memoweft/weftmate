import test from 'node:test';
import assert from 'node:assert/strict';
import { zstdCompressSync } from 'node:zlib';
import { formationChecks, correctionChecks, speedComparison, fourScenarioSummary, exportHasForgottenName } from './m2-exit-checks.mjs';
test('forgotten content in later compressed native-log frames is recoverable', () => {
  const bytes = Buffer.concat([zstdCompressSync(Buffer.from('{"type":"session"}\n')), zstdCompressSync(Buffer.from('王小明打游戏挺厉害\n'))]);
  assert.equal(exportHasForgottenName(bytes, 'session.jsonl.zstd'), true);
  assert.equal(exportHasForgottenName(zstdCompressSync(Buffer.from('unrelated')), 'session.jsonl.zstd'), false);
});
test('escaped JSON and UTF-16 export text are also recoverable', () => {
  assert.equal(exportHasForgottenName(Buffer.from(JSON.stringify({ model_result_json: '\\u738b\\u5c0f\\u660e' })), 'jobs.json'), true);
  assert.equal(exportHasForgottenName(Buffer.from('王小明', 'utf16le'), 'text.bin'), true);
});
test('reply-only and invalid memories cannot satisfy formal formation', () => {
  assert.deepEqual(formationChecks([{ kind: 'cognition', text: '王小明好兄弟游戏厉害组队找他', currentState: 'not_current' }]),
    { person: false, relationship: false, evaluation: false, decision: false });
});
test('empty previous relationship and empty replies cannot pass correction', () => {
  const result = correctionChecks([], [], [], {});
  assert.ok(Object.values(result).every(value => value === false));
});
test('latest wording without adoption and invalidation cannot satisfy correction', () => {
  const before = [{ id: 'old', kind: 'relationship', text: '王小明是我好兄弟', currentState: 'current' }];
  const now = [...before, { id: 'new', kind: 'relationship', text: '王小明是我表弟', currentState: 'current' }];
  const replies = Array(2).fill({ status: 'completed', reply: '王小明是你表弟，组队找他', memoryUsed: [{ id: 'old' }] });
  const result = correctionChecks(now, before, replies, {});
  assert.equal(result.bothRepliesLatest, true);
  assert.equal(result.oldInvalid, false);
  assert.equal(result.bothAdoptLatest, false);
  assert.equal(result.oldExcluded, false);
});
test('explicitly rejecting the old relationship is a valid corrected reply', () => {
  const replies = Array(2).fill({ status: 'completed', reply: '王小明是你的表弟，不是好兄弟。', memoryUsed: [] });
  assert.equal(correctionChecks([], [], replies, {}).bothRepliesLatest, true);
  replies[0] = { ...replies[0], reply: '王小明是你的好兄弟，也是表弟。' };
  assert.equal(correctionChecks([], [], replies, {}).bothRepliesLatest, false);
});
test('speed requires real successful output and script reuse', () => {
  const first = { durationMs: 100, steps: 3, status: 'completed', outputVerified: true };
  assert.equal(speedComparison(first, { ...first, durationMs: 10, steps: 1 }).passed, false);
  assert.equal(speedComparison(first, { ...first, durationMs: 80, reusedScript: true }).passed, true);
  assert.equal(speedComparison(first, { ...first, durationMs: 81, reusedScript: true }).passed, false);
  assert.equal(speedComparison(first, { ...first, steps: 2, reusedScript: true, outputVerified: false }).passed, false);
});
test('missing, skipped, unsupported or duplicate scenarios never inflate 3/4 gate', () => {
  const ids = ['memory-01-preference', 'memory-02-correction', 'memory-03-switch-model'];
  assert.equal(fourScenarioSummary(ids.map(id => ({ id, status: 'passed' }))).passedGate, true);
  assert.equal(fourScenarioSummary(Array(4).fill({ id: ids[0], status: 'passed' })).passedGate, false);
  assert.equal(fourScenarioSummary(ids.map(id => ({ id, status: 'unsupported' }))).passedGate, false);
});
