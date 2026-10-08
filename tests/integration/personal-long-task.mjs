/** M1-3: real Electron + personal/v1 + native DSH, keys only in memory. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { PROFILE_PATCH_TEMPLATE } from '../../src/dsh-web-runtime.ts';
import { runEvaluation, loadScenarios, buildReport } from '../../scripts/eval.mjs';

const repository = resolve(import.meta.dirname, '../..');
process.env.TEMP = process.env.TMP = 'C:/Temp';
const modelName = process.argv.includes('--mimo') ? 'mimo' : 'qwen';
const regression = process.argv.includes('--regression');
const run = promisify(execFile);
const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${modelName === 'qwen' ? 'MODEL_SWITCH_UNIFIED_KEY' : 'MIMO_API_KEY'}','${modelName === 'qwen' ? 'User' : 'Machine'}'))`], { windowsHide: true });
const key = stdout.trim(); assert.ok(key, 'Required model key absent');
const root = join('C:/Temp', `weftmate-m1-3-${modelName}-${randomUUID()}`), profile = join(root, 'profile'), out = join(root, 'eval');
mkdirSync(profile, { recursive: true }); mkdirSync(out);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const username = `eval-${randomUUID()}`, password = `test-${randomUUID()}-password`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => ({})]));
const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await prep.start(), setup = await prep.issueSetupGrant();
assert.equal((await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'Long task fixture' }) })).status, 201);
await prep.close();
const plugins = join(profile, 'dsh-home', 'profiles', 'weftmate', 'plugins'); mkdirSync(plugins, { recursive: true });
writeFileSync(join(plugins, 'long-task-observer.mjs'), `import { appendFileSync } from 'node:fs';
export const name = 'long-task-observer';
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    let data;
    if (['request/context', 'goal/change', 'todo/write', 'compaction/start', 'compaction/summary', 'compaction/end', 'turn/end'].includes(event.type)) data = event.data;
    if (event.type === 'assistant/message') data = { usage: event.data.usage, tools: event.data.message.content.filter(part => part.type === 'tool-call').map(part => part.name) };
    if (data) appendFileSync(${JSON.stringify(join(root, 'native-events.jsonl'))}, JSON.stringify({ sessionId: session.id, seq: event.seq, type: event.type, data }) + '\\n');
  });
}
`);
writeFileSync(join(profile, 'dsh-home', 'profiles', 'weftmate', 'cordis.patch.yml'), PROFILE_PATCH_TEMPLATE + '\n- insert:\n    - id: long-task-observer\n      name: ./plugins/long-task-observer.mjs\n');
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || ['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY', 'MODEL_SWITCH_UNIFIED_KEY'].includes(name)) delete env[name];
env.WEFTMATE_BASELINE_TRACE = join(root, 'requests.jsonl');
let app, page, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function until(check) { const deadline = Date.now() + 90000; while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(250); } throw new Error('Isolated host setup timed out'); }
console.log(`Isolated ${modelName} root: ${root}`);
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [join(repository, 'tests/integration/personal-baseline-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], cwd: repository, env, timeout: 90000 });
  const capture = part => { output += String(part); writeFileSync(join(root, 'host.log'), output); };
  app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
  page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
  await page.waitForURL('**/personal/v1/ui');
  await page.fill('#login-name', username); await page.fill('#login-password', password); await page.fill('#login-device', 'Long task Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  const requestId = `long-task-model-${modelName}`;
  assert.equal((await api('/account/models', { requestId, name: modelName,
    baseUrl: modelName === 'qwen' ? 'http://127.0.0.1:8081/v1' : 'https://api.xiaomimimo.com/v1',
    modelId: modelName === 'qwen' ? 'qwen3.8-27b-original' : 'mimo-v2.6-flash', apiKey: key })).status, 202);
  const operation = await until(async () => { const value = await api(`/account/models/by-request/${requestId}`); return !['pending', 'applying'].includes(value.body.operation?.status) && value.body.operation; });
  assert.equal(operation.status, 'succeeded');
  const selected = (await api('/models')).body.models.find(model => model.name === modelName); assert.ok(selected?.configured);
  assert.equal((await api('/settings/models', { backgroundModelProfileId: selected.id }, 'PATCH')).status, 200);
  writeFileSync(join(out, 'credentials.json'), JSON.stringify({ host: new URL(page.url()).origin, username, password, deviceName: 'Long task runner', provisioned: true }), { mode: 0o600 });
  let scenarios = await loadScenarios('eval/scenarios/*.yaml');
  scenarios = scenarios.filter(scenario => regression ? /^action-0[1-6]-/.test(scenario.id) : scenario.id === 'action-07-long-directory');
  const results = [], startedAt = new Date().toISOString();
  for (const scenario of scenarios) {
    console.log(`Starting ${scenario.id}: ${modelName}`);
    await runEvaluation({ host: new URL(page.url()).origin, out, model: modelName, scenarioList: [scenario],
      onScenarioResult: async result => { results.push(result); writeFileSync(join(root, 'progress.json'), JSON.stringify(results, null, 2)); console.log(`${result.id}: ${result.status} ${(result.durationMs / 1000).toFixed(2)}s ${result.reason ?? ''}`); } });
  }
  const native = readFileSync(join(root, 'native-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const count = status => results.filter(result => result.status === status).length;
  const summary = { passed: count('passed'), failed: count('failed'), manual: count('manual'), unsupported: count('unsupported') };
  const report = { schemaVersion: 1, startedAt, host: new URL(page.url()).origin, model: modelName, results, summary };
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2)); writeFileSync(join(out, 'report.md'), buildReport(report));
  const sessionIds = results.flatMap(result => result.turns.map(turn => turn.sessionId));
  const events = native.filter(event => sessionIds.includes(event.sessionId));
  const stats = { contextWindows: [...new Set(events.filter(event => event.type === 'request/context').map(event => event.data.contextWindow))],
    compactions: events.filter(event => event.type === 'compaction/summary').length,
    compactionEnds: events.filter(event => event.type === 'compaction/end').map(event => event.data),
    nativeGoalChanges: events.filter(event => event.type === 'goal/change').length,
    nativeTodoWrites: events.filter(event => event.type === 'todo/write').length,
    toolCalls: events.filter(event => event.type === 'assistant/message').flatMap(event => event.data.tools ?? []).length,
    goalAndTodosInCheckpoint: events.filter(event => event.type === 'compaction/summary').every(event => JSON.stringify(event.data.summary).includes('Native continuation state') && JSON.stringify(event.data.summary).includes('todos')) };
  for (const scenario of scenarios) {
    const result = results.find(result => result.id === scenario.id);
    if (result?.scratchDir) for (const file of scenario.setup.files) assert.equal(readFileSync(join(result.scratchDir, file.path), 'utf8'), file.content, 'Source remains unchanged');
  }
  writeFileSync(join(root, 'long-task-verification.json'), JSON.stringify(stats, null, 2)); console.log(JSON.stringify({ summary, stats }));
  if (!regression) {
    assert.equal(summary.passed, 1, 'Deliverable checks must all pass'); assert.ok(stats.toolCalls > 15);
    assert.ok(stats.nativeGoalChanges >= 2 && stats.nativeTodoWrites >= 2);
    if (modelName === 'qwen') { assert.deepEqual(stats.contextWindows, [98304]); assert.ok(stats.compactions >= 1); assert.ok(stats.goalAndTodosInCheckpoint); }
  }
} finally {
  if (app) { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); }
  writeFileSync(join(root, 'host.log'), output);
  const sensitive = /credentials\.json$|(?:Cookies|Trust Tokens)(?:-journal)?$|setup-[^/]+\.json$|secure-snapshot.*\.yml$|security-credentials\.patch\.yml$/;
  let scanned = 0, matches = 0;
  function cleanAndScan(dir) { for (const name of readdirSync(dir)) { const file = join(dir, name), info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) cleanAndScan(file); else if (sensitive.test(name)) rmSync(file, { force: true });
    else { scanned++; if (readFileSync(file).includes(Buffer.from(key))) matches++; } } }
  cleanAndScan(root); writeFileSync(join(root, 'credential-scan.json'), JSON.stringify({ scanned, matches }));
  assert.equal(matches, 0, 'No model key may persist in test artifacts');
}
