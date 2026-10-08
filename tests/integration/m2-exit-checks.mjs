// Pure acceptance predicates, shared by the real runner and focused regressions.
import { zstdDecompressSync } from 'node:zlib';
export const original = '王小明打游戏挺厉害，是我好兄弟。';
export const confirmation = '好，以后我想组队时，就提醒我找王小明。';
export const correction = '更正一下：王小明是我的表弟，不是好兄弟。以后组队还是找他。';
export const recallQuestion = '我们之前说组队可以找谁？';
export function exportHasForgottenName(bytes, path) {
  const containsName = buffer => buffer.includes(Buffer.from('王小明')) || buffer.includes(Buffer.from('王小明', 'utf16le')) ||
    /\\+u738b\\+u5c0f\\+u660e/i.test(buffer.toString('utf8'));
  if (containsName(bytes)) return true;
  if (!path.endsWith('.zstd')) return false;
  // Native DSH logs concatenate independent Zstandard frames. A single sync
  // decode sees only the first frame, so inspect every consumed frame.
  let offset = 0;
  while (offset < bytes.length) {
    const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true });
    if (!decoded.engine.bytesWritten) throw new Error('Export Zstandard frame did not advance');
    if (containsName(decoded.buffer)) return true;
    offset += decoded.engine.bytesWritten;
  }
  return false;
}
export function formationChecks(items) {
  const current = items.filter(item => item.currentState === 'current');
  return {
    person: current.some(item => item.kind === 'entity' && item.text === '王小明'),
    relationship: current.some(item => item.kind === 'relationship' && /王小明/.test(item.text) && /好兄弟|兄弟/.test(item.text)),
    evaluation: current.some(item => item.kind === 'cognition' && /王小明/.test(item.text) && /游戏/.test(item.text) && /厉害|擅长|很强|高手/.test(item.text)),
    decision: current.some(item => item.kind === 'cognition' && /王小明/.test(item.text) && /组队/.test(item.text) && /提醒|找|邀请/.test(item.text)),
  };
}
export function correctionChecks(items, previous, turns, sources) {
  const latest = items.filter(item => item.kind === 'relationship' && item.currentState === 'current' && /王小明/.test(item.text) && /表弟/.test(item.text));
  const old = previous.filter(item => item.kind === 'relationship' && /王小明/.test(item.text) && /好兄弟|兄弟/.test(item.text));
  return {
    latestStored: latest.length > 0,
    oldInvalid: old.length > 0 && old.every(item => items.some(now => now.id === item.id && now.currentState === 'not_current' && now.lifecycle?.invalidAt)),
    oldSourceExplainsChange: old.length > 0 && old.every(item => sources[item.id]?.some(source => source.rawContent === original && source.currentnessState === 'not_current')),
    correctedSource: latest.length > 0 && latest.every(item => sources[item.id]?.some(source => source.rawContent === correction)),
    bothRepliesLatest: turns.length === 2 && turns.every(turn => turn.status === 'completed' && /王小明/.test(turn.reply) && /表弟/.test(turn.reply) && !/(?<!不)是.{0,4}(?:我的|你的)?好兄弟/.test(turn.reply)),
    bothAdoptLatest: turns.length === 2 && latest.length > 0 && turns.every(turn => turn.memoryUsed?.some(memory => latest.some(item => item.id === memory.id))),
    oldExcluded: old.length > 0 && turns.every(turn => !turn.memoryUsed?.some(memory => old.some(item => item.id === memory.id))),
  };
}
export function speedComparison(first, second) {
  const ratio = second.durationMs / first.durationMs;
  return { first, second, durationRatio: ratio,
    // Fixed before baselining: at least one fewer tool step OR >=20% less wall time.
    threshold: 'at least one fewer tool step OR second duration <= 80% of first',
    passed: Boolean(first.status === 'completed' && second.status === 'completed' && first.outputVerified && second.outputVerified &&
      second.reusedScript && (second.steps < first.steps || ratio <= 0.8)) };
}
export function fourScenarioSummary(results) {
  const ids = ['memory-01-preference', 'memory-02-correction', 'memory-03-switch-model', 'memory-04-person'];
  const rows = ids.map(id => results.find(result => result.id === id) ?? { id, status: 'missing' });
  const passed = rows.filter(row => row.status === 'passed').length;
  return { total: 4, passed, threshold: 3, passedGate: passed >= 3, rows };
}
