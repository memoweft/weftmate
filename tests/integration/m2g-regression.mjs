/** Original seven + unchanged A/C, one LAN and MiMo round, under the LAN lease. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openSync, closeSync, writeFileSync, readFileSync, statSync, rmSync, mkdirSync, utimesSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const out = resolve(option('--out', 'tests/evidence/m2g/regression'));
const core = resolve(option('--memory-core-source', 'D:/AIProjects/MemoWeft/Worktrees/m2g-person-loop/py/src'));
const repository = resolve(import.meta.dirname, '../..');
const lock = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock', token = `M2g regression ${randomUUID()}`;
const pause = ms => new Promise(r => setTimeout(r, ms)), exec = promisify(execFile);
mkdirSync(out, { recursive: true });
const privateValues = [];
for (const [name, scope] of [['MIMO_API_KEY', 'Machine'], ['WEFTMATE_LAN_MODEL_KEY', 'User'], ['WEFTMATE_LAN_MODEL_BASE_URL', 'User']]) {
  const value = (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true })).stdout.trim();
  assert.ok(value, `${name} absent`); privateValues.push(value);
}
privateValues.push(new URL(privateValues[2]).host, new URL(privateValues[2]).hostname);
const redact = value => privateValues.reduce((text, value) => text.replaceAll(value, '[private]'), String(value));
const save = (file, data) => writeFileSync(file, redact(JSON.stringify(data, null, 2)) + '\n');
while (true) {
  try { const fd = openSync(lock, 'wx'); try { writeFileSync(fd, token + '\n'); } finally { closeSync(fd); } break; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = statSync(lock, { throwIfNoEntry: false });
    if (!info) continue;
    if (Date.now() - info.mtimeMs > 10800000) { rmSync(lock); continue; }
    console.log('LAN occupied; retry in five minutes.'); await pause(300000);
  }
}
const timer = setInterval(() => {
  if (readFileSync(lock, 'utf8').startsWith(token)) utimesSync(lock, new Date(), new Date());
}, 60000);
const runs = [];
const usage = { requests: 0, returnedUsage: 0, missingUsage: 0, input: 0, cached: 0, output: 0 };
function walk(dir) { return readdirSync(dir).flatMap(name => { const file = join(dir, name), info = lstatSync(file);
  return info.isSymbolicLink() ? [] : info.isDirectory() ? walk(file) : [file]; }); }
try {
  for (const model of ['lan', 'mimo']) for (const suite of ['matrix', 'correction']) {
    const args = ['tests/integration/personal-scenario-baseline.mjs', '--memory-loop', '--memory-trace', '--memory-semantic-judge', '--memory-core-source', core];
    args.push(...(model === 'lan' ? ['--lan'] : ['--mimo', '--mimo-machine', '--alternate-lan']));
    if (suite === 'correction') args.push('--memory-correction');
    else args.push('--only', 'memory-01-preference,memory-02-correction,memory-03-switch-model,memory-04-person,memory-1x-preference,memory-1x-correction,memory-1x-person,memory-3x-preference,memory-3x-correction,memory-3x-person');
    let output = '';
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += String(chunk); process.stdout.write(redact(chunk)); });
      child.on('error', reject); child.on('close', resolve);
    });
    const root = /Isolated \w+ root: ([^\r\n]+)/.exec(output)?.[1];
    assert.ok(root, 'Runner must identify its isolated root');
    const report = JSON.parse(readFileSync(join(root, 'eval/results.json')));
    const row = { model, suite, root, exitCode: code, report, privateScan: JSON.parse(readFileSync(join(root, 'credential-scan.json'))) };
    runs.push(row); save(join(out, `${model}-${suite}.json`), row);
    const trace = readFileSync(join(root, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s));
    const starts = trace.filter(r => r.phase === 'start' && r.requestedModel === 'mimo-v2.6-flash' && r.origin === 'https://api.xiaomimimo.com');
    const uses = trace.filter(r => r.phase === 'end' && r.usage && starts.some(s => s.id === r.id));
    usage.requests += starts.length; usage.returnedUsage += uses.length; usage.missingUsage += starts.length - uses.length;
    for (const r of uses) { usage.input += r.usage.prompt_tokens ?? 0; usage.cached += r.usage.prompt_tokens_details?.cached_tokens ?? 0; usage.output += r.usage.completion_tokens ?? 0; }
    // Semantic verdict calls bypass the proxy trace; count them separately.
    for (const result of report.results) if (result.semanticJudgement?.usage) {
      const u = result.semanticJudgement.usage; usage.requests++; usage.returnedUsage++;
      usage.input += u.prompt_tokens ?? 0; usage.cached += u.prompt_tokens_details?.cached_tokens ?? 0; usage.output += u.completion_tokens ?? 0;
    }
    usage.knownCnyLowerBound = (usage.input - usage.cached + usage.cached * 0.02 + usage.output * 2) / 1000000;
    save(join(out, 'usage.json'), usage);
    save(join(out, `${model}-${suite}-formation.json`), walk(root).filter(file => /memory-requests\.jsonl$/.test(file)).flatMap(file =>
      readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s))));
  }
  save(join(out, 'summary.json'), runs.map(({ model, suite, report, exitCode, privateScan }) => ({ model, suite, exitCode, summary: report.summary, privateScan })));
} finally {
  clearInterval(timer);
  if (readFileSync(lock, 'utf8').startsWith(token)) rmSync(lock);
  const files = walk(out), matches = files.filter(file => privateValues.some(value => readFileSync(file).includes(Buffer.from(value)))).length;
  save(join(out, 'credential-scan.json'), { scanned: files.length, matches }); assert.equal(matches, 0);
}
