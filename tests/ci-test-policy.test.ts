import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateReports } from '../.github/scripts/ci-test-summary.mjs';
import { parseFailures } from '../.github/scripts/ci-failure-survey.mjs';
import { declaredTests, parseTap, recoveredSummary, runFileGate, selectShard, validateTimingTests } from '../.github/scripts/ci-test-policy.mjs';

const name = 'synthetic clock budget';
const entry = { file: 'tests/synthetic.test.ts', name, reason: 'wall-clock assertion', failureCount: 1 };
const policy = { ci: 'true', mode: 'required', event: 'pull_request' };
const pass = { status: 0, passed: 2, failed: 0, cancelled: 0, skipped: 1, failures: [] };
const fail = { ...pass, status: 1, passed: 1, failed: 1, failures: [name] };
async function gate(sequence: any[], overrides: any = {}) {
  const calls: any[] = [];
  const result = await runFileGate([entry.file], { entries: [entry], policy,
    execute: async (file: string, attempt: number) => { calls.push({file, attempt}); return sequence[attempt - 1]; }, ...overrides });
  return { calls, ...result };
}
test('unlisted and mixed functional failures never retry, even alongside a timing failure', async () => {
  for (const failures of [['functional assertion'], [name, 'functional assertion']]) {
    const result = await gate([{ ...fail, failed: failures.length, failures }]);
    assert.equal(result.calls.length, 1); assert.equal(result.exitCode, 1); assert.deepEqual(result.recovered, []);
  }
});
test('listed timing failure retries exactly its whole file once and summary names the recovery', async () => {
  const result = await gate([fail, pass]);
  assert.deepEqual(result.calls, [{file: entry.file, attempt: 1}, {file: entry.file, attempt: 2}]);
  assert.equal(result.exitCode, 0); assert.equal(result.passed, 2); assert.equal(result.failed, 0); assert.equal(result.skipped, 1);
  assert.match(recoveredSummary(result.recovered), /本次重跑才通过的用例/);
  assert.ok(recoveredSummary(result.recovered).includes(name)); assert.ok(recoveredSummary(result.recovered).includes(entry.file));
  assert.equal(result.results[0].attempts.length, 2);
});
test('a second timing failure stays red; a new functional failure on retry also stays red', async () => {
  for (const second of [fail, {...fail, failures:['functional assertion']}]) {
    const result = await gate([fail, second]);
    assert.equal(result.calls.length, 2); assert.equal(result.exitCode, 1); assert.equal(result.failed, 1); assert.deepEqual(result.recovered, []);
  }
});
test('local, schedule, nightly strict and vendor gates retain a single strict attempt', async () => {
  for (const change of [{ci:undefined}, {ci:'false'}, {event:'schedule'}, {strict:'true'}, {mode:'vendor'}]) {
    const result = await gate([fail], {policy:{...policy,...change}});
    assert.equal(result.calls.length, 1); assert.equal(result.exitCode, 1);
  }
});
test('file deadline, runner crash, cancellation, output error and unidentified failures cannot retry', async () => {
  for (const change of [{timedOut:true}, {signal:'SIGABRT'}, {cancelled:1}, {error:'output overflow'}, {failed:2}]) {
    const result = await gate([{...fail,...change}]);
    assert.equal(result.calls.length, 1); assert.equal(result.exitCode, 1);
  }
});
test('a failed file does not prevent execution of later files', async () => {
  const calls: string[] = [];
  const result = await runFileGate(['first.ts', 'last.ts'], {entries:[],policy,execute:async (file:string)=>{
    calls.push(file); return file==='first.ts'? {...fail, timedOut:true}:pass;
  }});
  assert.deepEqual(calls,['first.ts','last.ts']); assert.equal(result.exitCode,1); assert.equal(result.passed,3);
});
test('manifest refuses nonexistent, commented, duplicate and zero-evidence test names', () => {
  const source = `// test('not real',()=>{});\ntest('${name}',()=>{});`;
  assert.deepEqual([...declaredTests(source)], [name]);
  validateTimingTests([entry], () => source);
  assert.throws(()=>validateTimingTests([{...entry,name:'not real'}],()=>source),/does not exist/);
  assert.throws(()=>validateTimingTests([entry,entry],()=>source),/Invalid timing entry/);
  assert.throws(()=>validateTimingTests([{...entry,failureCount:0}],()=>source),/Invalid timing entry/);
  validateTimingTests(JSON.parse(readFileSync('.github/timing-sensitive-tests.json','utf8')).tests);
});
test('stable filename shards partition all files once and new files do not move existing files', () => {
  const files=Array.from({length:300},(_,i)=>`tests/file-${i}.test.ts`);
  const parts=[1,2,3].map(i=>selectShard(files,`${i}/3`));
  assert.deepEqual(parts.flat().sort(),[...files].sort()); assert.equal(new Set(parts.flat()).size,300);
  parts.forEach((part,i)=>assert.deepEqual(selectShard([...files,'tests/new.test.ts'],`${i+1}/3`).filter((f:string)=>f!=='tests/new.test.ts'),part));
  assert.throws(()=>selectShard(files,'0/3')); assert.throws(()=>selectShard(files,'4/3'));
});
test('TAP leaf failures are counted once and final totals exclude diagnostic lookalikes', () => {
  const output = `    not ok 1 - leaf\n      ---\n      type: 'test'\n      failureType: 'testCodeFailure'\n      ...\nnot ok 1 - parent\n  ---\n  type: 'suite'\n  failureType: 'subtestsFailed'\n  ...\n# pass 3\n# fail 1\n# skipped 2\n# cancelled 0\n`;
  assert.deepEqual(parseTap(output),{passed:3,failed:1,skipped:2,cancelled:0,failures:['leaf']});
});
test('all-shard totals reject missing or duplicate reports and preserve red status', () => {
  const reports=['ubuntu-latest','windows-latest'].flatMap(os=>[1,2,3].map(i=>({os,shard:`${i}/3`,exitCode:0,passed:10,failed:0,skipped:2})));
  assert.equal(aggregateReports(reports).passed,60); assert.equal(aggregateReports(reports).skipped,12);
  assert.throws(()=>aggregateReports(reports.slice(1)),/Missing/);
  assert.throws(()=>aggregateReports([...reports,reports[0]]),/duplicate/);
  assert.equal(aggregateReports([{...reports[0],exitCode:1},...reports.slice(1)]).exitCode,1);
});
test('survey distinguishes assertion, timeout and process exit, and normalizes escaped Windows paths', () => {
  const block=(name:string,error:string)=>`test (windows-latest)\tstep\t2026-10-12T00:00:00Z not ok 1 - ${name}\n`+
    `test (windows-latest)\tstep\t2026-10-12T00:00:00Z   ---\n`+
    `test (windows-latest)\tstep\t2026-10-12T00:00:00Z   type: 'test'\n`+
    `test (windows-latest)\tstep\t2026-10-12T00:00:00Z   location: 'D:\\\\a\\\\tests\\\\synthetic.test.ts:1:1'\n`+
    `test (windows-latest)\tstep\t2026-10-12T00:00:00Z   failureType: 'testCodeFailure'\n`+
    `test (windows-latest)\tstep\t2026-10-12T00:00:00Z   error: '${error}'\n`+
    `test (windows-latest)\tstep\t2026-10-12T00:00:00Z   ...\n`;
  const failures=parseFailures(block('assertion','7 !== 6')+block('timeout','ETIMEDOUT')+block('crash','exitCode: 3221226505'));
  assert.deepEqual(failures.map((f:any)=>f.type),['assertion','timeout','process-exit']);
  assert.ok(failures.every((f:any)=>f.file==='tests/synthetic.test.ts'));
});
