import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { aggregateReports, requireLatestShardJobs } from '../.github/scripts/ci-test-summary.mjs';
import { parseFailures } from '../.github/scripts/ci-failure-survey.mjs';
import { declaredTests, parseTap, recoveredSummary, runFileGate, selectShard, selectRequiredShard, validateTimingTests } from '../.github/scripts/ci-test-policy.mjs';

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

test('the recurring host-close failure cannot be recovered by a second file attempt', async () => {
  const file = 'tests/bl-29-rework.test.ts';
  const closeFailure = 'BL-29b M5 host close revokes empty account waits before closing sockets';
  const entries = JSON.parse(readFileSync('.github/timing-sensitive-tests.json', 'utf8')).tests;
  const calls: number[] = [];
  const result = await runFileGate([file], {entries, policy, execute: async (_file: string, attempt: number) => {
    calls.push(attempt);
    return attempt === 1 ? {...fail, failures: [closeFailure]} : pass;
  }});
  assert.deepEqual(calls, [1]);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.recovered, []);
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
test('manifest failure counts match every retained historical attempt and functional-only cases remain strict', () => {
  const manifest=JSON.parse(readFileSync('.github/timing-sensitive-tests.json','utf8'));
  const evidence=JSON.parse(readFileSync(manifest.evidence,'utf8'));
  for(const entry of manifest.tests) {
    const source=entry.evidence?JSON.parse(readFileSync(entry.evidence,'utf8')):evidence;
    const allRows=source.table??source.observations.flatMap((item:any)=>item.rows);
    const rows=allRows.filter((row:any)=>row.file===(entry.evidenceFile??entry.file)&&row.name===entry.name);
    assert.equal(entry.failureCount,rows.reduce((n:number,row:any)=>n+(row.count??1),0),entry.name);
  }
  assert.ok(!manifest.tests.some((entry:any)=>/22000|unrelated account|public model projection|M1 real Electron|credential commit phase/.test(entry.name)));
});
test('stable filename shards partition all files once and new files do not move existing files', () => {
  const files=Array.from({length:300},(_,i)=>`tests/file-${i}.test.ts`);
  const parts=[1,2,3].map(i=>selectShard(files,`${i}/3`));
  assert.deepEqual(parts.flat().sort(),[...files].sort()); assert.equal(new Set(parts.flat()).size,300);
  parts.forEach((part,i)=>assert.deepEqual(selectShard([...files,'tests/new.test.ts'],`${i+1}/3`).filter((f:string)=>f!=='tests/new.test.ts'),part));
  assert.throws(()=>selectShard(files,'0/3')); assert.throws(()=>selectShard(files,'4/3'));
});

test('Windows five shards cover the current required files once with their audited stable seed', () => {
  const exceptions=JSON.parse(readFileSync('.github/ci-test-exceptions.json','utf8'));
  const vendor=JSON.parse(readFileSync('.github/vendor-test-suite.json','utf8'));
  const unavailable=new Set(exceptions.unavailableFiles.map((row:any)=>row.file));
  const files=readdirSync('tests').filter(file=>file.endsWith('.test.ts')).map(file=>`tests/${file}`)
    .filter(file=>!unavailable.has(file)&&!vendor.files.includes(file)).sort();
  const seed='required-windows-v10760';
  const parts=[1,2,3,4,5].map(i=>selectShard(files,`${i}/5`,seed));
  parts.forEach((part,i)=>assert.deepEqual(selectRequiredShard(files,`${i+1}/5`,'win32'),part));
  assert.deepEqual(parts.flat().sort(),files);
  assert.equal(new Set(parts.flat()).size,files.length);
  for(const [file,shard] of [['tests/bl-29-rework.test.ts',2],['tests/ci-test-policy.test.ts',5],['tests/personal-access-core.test.ts',4]] as const)
    assert.ok(parts[shard-1].includes(file),file);
  parts.forEach((part,i)=>assert.deepEqual(selectShard([...files,'tests/new.test.ts'],`${i+1}/5`,seed).filter((f:string)=>f!=='tests/new.test.ts'),part));
  for(const [file,shard] of [['tests/bl-29-rework.test.ts',2],['tests/ci-test-policy.test.ts',3],['tests/personal-access-core.test.ts',1]] as const)
    assert.ok(selectShard(files,`${shard}/3`).includes(file),'unchanged Linux '+file);
  for(const platform of ['linux','darwin'])for(const shard of [1,2,3])
    assert.deepEqual(selectRequiredShard(files,`${shard}/3`,platform),selectShard(files,`${shard}/3`));
  assert.deepEqual(selectShard(files,'1/1'),files);
});

test('workflow matrix contains exactly five Windows and three Linux shards', () => {
  const workflow=createRequire(import.meta.url)('js-yaml').load(readFileSync('.github/workflows/ci.yml','utf8'));
  const matrix=workflow.jobs.test.strategy.matrix;
  for(const [os,count] of [['ubuntu-latest',3],['windows-latest',5]] as const){
    const actual=matrix.shard.filter((shard:number)=>!matrix.exclude.some((row:any)=>row.os===os&&row.shard===shard));
    assert.deepEqual(actual,Array.from({length:count},(_,i)=>i+1),os);
  }
  assert.equal(workflow.jobs.test['timeout-minutes'],25);
});
test('TAP leaf failures are counted once and final totals exclude diagnostic lookalikes', () => {
  const output = `    not ok 1 - leaf\n      ---\n      type: 'test'\n      failureType: 'testCodeFailure'\n      ...\nnot ok 1 - parent\n  ---\n  type: 'suite'\n  failureType: 'subtestsFailed'\n  ...\n# pass 3\n# fail 1\n# skipped 2\n# cancelled 0\n`;
  assert.deepEqual(parseTap(output),{passed:3,failed:1,skipped:2,cancelled:0,failures:['leaf']});
});
test('all-shard totals reject missing or duplicate reports and preserve red status', () => {
  const reports=['ubuntu-latest','windows-latest'].flatMap(os=>Array.from({length:os==='windows-latest'?5:3},(_,i)=>({os,shard:`${i+1}/${os==='windows-latest'?5:3}`,exitCode:0,passed:10,failed:0,skipped:2})));
  assert.equal(aggregateReports(reports).passed,80); assert.equal(aggregateReports(reports).skipped,16);
  assert.throws(()=>aggregateReports(reports.slice(1)),/Missing/);
  for(const shard of ['4/5','5/5'])assert.throws(()=>aggregateReports(reports.filter(row=>row.os!=='windows-latest'||row.shard!==shard)),/Missing/);
  assert.throws(()=>aggregateReports(reports.map(row=>row.os==='windows-latest'?{...row,shard:row.shard.replace('/5','/3')}:row)),/unexpected/);
  assert.throws(()=>aggregateReports([...reports,reports[0]]),/duplicate/);
  assert.equal(aggregateReports([{...reports[0],exitCode:1},...reports.slice(1)]).exitCode,1);
  const linux=reports.filter(row=>row.os==='ubuntu-latest');
  assert.equal(aggregateReports(linux,{oses:['ubuntu-latest']}).passed,30);
  assert.throws(()=>aggregateReports(linux),/Missing/);
});

test('summary accepts a recovered shard and untouched successful shards from earlier attempts', () => {
  const jobs=['ubuntu-latest','windows-latest'].flatMap(os=>Array.from({length:os==='windows-latest'?5:3},(_,i)=>({name:`test (${os}, shard ${i+1}/${os==='windows-latest'?5:3})`,id:i,run_attempt:1,status:'completed',conclusion:'success'})));
  const failed={...jobs.at(-1),conclusion:'failure'};
  assert.throws(()=>requireLatestShardJobs([...jobs.slice(0,-1),failed]),/Latest shard/);
  const recovered={...jobs.at(-1),id:100,run_attempt:2};
  assert.equal(requireLatestShardJobs([recovered,...jobs.slice(0,-1),failed]).length,8);
  for(const change of [{conclusion:'failure'},{conclusion:'cancelled'},{conclusion:'skipped'},{status:'in_progress',conclusion:null}])
    assert.throws(()=>requireLatestShardJobs([...jobs,{...recovered,...change}]),/Latest shard/);
  assert.throws(()=>requireLatestShardJobs(jobs.slice(1)),/missing/);
  for(const shard of [4,5])assert.throws(()=>requireLatestShardJobs(jobs.filter(row=>row.name!==`test (windows-latest, shard ${shard}/5)`)),/missing/);
  assert.equal(requireLatestShardJobs(jobs.filter(row=>row.name.includes('ubuntu')),{oses:['ubuntu-latest']}).length,3);
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
