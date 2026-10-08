/** EV-1: replay saved action-07 artifacts without contacting a model or host. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { checkOne, loadScenarios } from '../../scripts/eval.mjs';

const [output, ...roots] = process.argv.slice(2);
assert.ok(output && roots.length === 2, 'Usage: node personal-checks-offline.mjs <output.json> <saved-lan-root-1> <saved-lan-root-2>');
const scenario = (await loadScenarios('eval/scenarios/action-07-long-directory.yaml'))[0];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runs = [];
for (const [index, root] of roots.entries()) {
  const saved = JSON.parse(await readFile(join(root, 'eval/results.json'), 'utf8'));
  const result = saved.results.find(item => item.id === scenario.id);
  assert.ok(result);
  const files = [...new Set(scenario.checks.filter(check => check.type.startsWith('file_')).map(check => check.path))];
  const hashes = {};
  for (const path of files) hashes[path] = hash(await readFile(join(result.scratchDir, path)));
  const context = { scratchDir: result.scratchDir, turns: result.turns };
  const oldChecks = [], newChecks = [];
  for (const check of scenario.checks) {
    const { numeric, ...literal } = check;
    oldChecks.push(await checkOne(literal, context));
    newChecks.push(await checkOne(check, context));
  }
  for (const path of files) assert.equal(hash(await readFile(join(result.scratchDir, path))), hashes[path]);
  for (const file of scenario.setup.files) assert.equal(await readFile(join(result.scratchDir, file.path), 'utf8'), file.content);
  assert.deepEqual(oldChecks.map(check => check.status), result.checks.map(check => check.status), 'old replay must reproduce saved verdicts');
  const summary = checks => ({ status: checks.every(check => check.status === 'passed') ? 'passed' : 'failed',
    passed: checks.filter(check => check.status === 'passed').length, total: checks.length });
  const changed = newChecks.flatMap((check, i) => check.status === oldChecks[i].status ? [] :
    [{ path: check.path, text: check.text, numeric: check.numeric, old: oldChecks[i].status, new: check.status }]);
  runs.push({ label: `m1-4-lan-${index + 1}`, savedStatus: result.status, old: summary(oldChecks), new: summary(newChecks),
    changed, sourceFilesUnchanged: scenario.setup.files.length, artifactHashes: hashes, artifactsUnmodifiedByReplay: true });
}
await writeFile(output, JSON.stringify({ scenario: scenario.id, modelRequests: 0, numericFields: scenario.checks.filter(check => check.numeric).length, runs }, null, 2) + '\n');
console.log(JSON.stringify(runs.map(({ artifactHashes, ...run }) => run), null, 2));
