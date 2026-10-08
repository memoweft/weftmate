/** Formal baseline on real Electron/DSH, fresh account/Core per model. Keys stay in memory. */
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
import { runEvaluation, loadScenarios, buildReport } from '../../scripts/eval.mjs';
const repository = resolve(import.meta.dirname, '../..');
// Keep generated goals and evidence free of the Windows account's home path.
process.env.TEMP = process.env.TMP = 'C:/Temp';
const modelName = process.argv.includes('--mimo') ? 'mimo' : 'qwen';
const diagnostic = process.argv.includes('--diagnostic');
const comparison = process.argv.includes('--mimo-machine');
assert.ok(!comparison || modelName === 'mimo', '--mimo-machine requires --mimo');
const mimoKeyScope = comparison ? 'Machine' : 'User';
const run = promisify(execFile);
async function environmentKey(name, scope = 'User') {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true });
  return stdout.trim();
}
const keys = { qwen: await environmentKey('MODEL_SWITCH_UNIFIED_KEY'), mimo: await environmentKey('MIMO_API_KEY', mimoKeyScope) };
if (comparison) assert.ok(keys.qwen, 'Qwen key required for Qwen → MiMo memory-03');
if (modelName === 'mimo' && !keys.mimo && process.argv.includes('--wait-for-key')) {
  console.log(`${new Date().toISOString()} MIMO_API_KEY absent; checking ${mimoKeyScope} environment every 10 minutes, at most one hour.`);
  for (let check = 1; check <= 6 && !keys.mimo; check++) {
    await new Promise(r => setTimeout(r, 600000));
    keys.mimo = await environmentKey('MIMO_API_KEY', mimoKeyScope);
    console.log(`${new Date().toISOString()} MiMo key check ${check}/6: ${keys.mimo ? 'present' : 'absent'}`);
  }
}
if (!keys[modelName]) throw new Error(`${modelName === 'qwen' ? 'MODEL_SWITCH_UNIFIED_KEY' : 'MIMO_API_KEY'} absent`);
const root = join('C:/Temp', `weftmate-${comparison ? 'm0-7c' : 'm0-7b'}-${modelName}-${randomUUID()}`), profile = join(root, 'profile');
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const password = `test-${randomUUID()}-password`, username = `eval-${randomUUID()}`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(key => [key, async () => ({})]));
const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await prep.start(), setup = await prep.issueSetupGrant();
assert.equal((await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'Baseline preparation' }) })).status, 201);
await prep.close();
const memoryConfig = join(root, 'memory-config.json');
writeFileSync(memoryConfig, JSON.stringify({ python: 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',
  pythonPath: 'D:/AIProjects/MemoWeft/Core/py/src', baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', authRef: 'baseline-pending' }));
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || name === 'ELECTRON_RUN_AS_NODE' || name === 'MIMO_API_KEY' || name === 'MODEL_SWITCH_UNIFIED_KEY') delete env[name];
env.WEFTMATE_BASELINE_TRACE = join(root, 'requests.jsonl');
let app, page, output = '';
const out = join(root, diagnostic ? 'diagnostic' : 'eval'); mkdirSync(out);
async function api(path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function until(check) { const deadline = Date.now() + 90000; while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 250)); } throw new Error('Baseline setup timed out'); }
console.log(`Isolated ${modelName} root: ${root}`);
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [join(repository, 'tests/integration/personal-baseline-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0', `--personal-memory-config=${memoryConfig}`], cwd: repository, env, timeout: 90000 });
  const capture = data => { output += String(data); writeFileSync(join(root, 'host.log'), output); };
  app.process().stdout?.on('data', capture);
  app.process().stderr?.on('data', capture);
  page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
  await page.waitForURL('**/personal/v1/ui');
  await page.fill('#login-name', username); await page.fill('#login-password', password); await page.fill('#login-device', 'Baseline Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  for (const name of [modelName, modelName === 'qwen' ? 'mimo' : 'qwen']) {
    if (!keys[name]) continue;
    const requestId = `baseline-model-${name}`;
    assert.equal((await api('/account/models', { requestId, name, baseUrl: name === 'qwen' ? 'http://127.0.0.1:8081/v1' : 'https://api.xiaomimimo.com/v1',
      modelId: name === 'qwen' ? 'qwen3.8-27b-original' : 'mimo-v2.6-flash', apiKey: keys[name] })).status, 202);
    const operation = await until(async () => { const value = await api(`/account/models/by-request/${requestId}`); return !['pending', 'applying'].includes(value.body.operation?.status) && value.body.operation; });
    assert.equal(operation.status, 'succeeded');
    console.log(`Configured ${name}`);
  }
  const selected = (await api('/models')).body.models.find(model => model.name === modelName);
  assert.ok(selected?.configured);
  assert.equal((await api('/settings/models', { backgroundModelProfileId: selected.id }, 'PATCH')).status, 200);
  const memory = (await api('/memory/status')).body;
  console.log(`Memory state: ${memory.state} ${memory.reasonCode ?? ''}`);
  writeFileSync(join(root, 'memory-status-initial.json'), JSON.stringify(memory, null, 2));
  assert.equal(comparison ? memory.capabilities?.list : memory.capabilities?.inject, true,
    'The isolated Core must be configured before recording memory results');
  writeFileSync(join(out, 'credentials.json'), JSON.stringify({ host: new URL(page.url()).origin, username, password, deviceName: 'Baseline runner', provisioned: true }), { mode: 0o600 });
  let scenarios = await loadScenarios('eval/scenarios/*.yaml');
  if (diagnostic) scenarios = scenarios.filter(s => s.id === 'action-06-delete-approval').map(s => ({ ...s, timeoutSec: 600 }));
  const onlyIndex = process.argv.indexOf('--only');
  if (onlyIndex !== -1) scenarios = scenarios.filter(s => s.id === process.argv[onlyIndex + 1]);
  // Each scenario runs once. Only memory-03 starts on Qwen and switches to MiMo.
  const results = [], startedAt = new Date().toISOString();
  for (const scenario of scenarios) {
    const firstModel = comparison && scenario.id === 'memory-03-switch-model' ? 'qwen' : modelName;
    if (comparison) assert.equal((await api('/settings/models', {
      backgroundModelProfileId: scenario.id === 'memory-03-switch-model' ? null : selected.id,
    }, 'PATCH')).status, 200);
    console.log(`Starting ${scenario.id}: ${firstModel}${scenario.id === 'memory-03-switch-model' ? ' → ' + (comparison ? 'mimo' : modelName === 'qwen' ? 'mimo' : 'qwen') : ''}`);
    await runEvaluation({ host: new URL(page.url()).origin, out, model: firstModel,
      switchModel: comparison ? 'mimo' : modelName === 'qwen' ? 'mimo' : 'qwen', scenarioList: [scenario],
      onScenarioResult: async result => { results.push(result); writeFileSync(join(root, 'progress.json'), JSON.stringify(results, null, 2)); console.log(`${result.id}: ${result.status} ${(result.durationMs / 1000).toFixed(2)}s ${result.reason ?? ''}`); } });
  }
  const count = status => results.filter(r => r.status === status).length;
  const summary = { passed: count('passed'), failed: count('failed'), manual: count('manual'), unsupported: count('unsupported'),
    skippedChecks: results.flatMap(r => r.checks).filter(c => c.status === 'skipped').length };
  summary.passRate = summary.passed + summary.failed ? summary.passed / (summary.passed + summary.failed) : null;
  summary.coverage = summary.passed / results.length;
  const report = { schemaVersion: 1, startedAt, host: new URL(page.url()).origin, model: modelName, results, summary };
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, 'report.md'), buildReport(report));
  writeFileSync(join(root, 'memory-status.json'), JSON.stringify((await api('/memory/status')).body, null, 2));
  console.log(JSON.stringify(report.summary));
} finally {
  if (app) { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); }
  writeFileSync(join(root, 'host.log'), output);
  const sensitive = /credentials\.json$|(?:Cookies|Trust Tokens)(?:-journal)?$|setup-[^/]+\.json$|secure-snapshot.*\.yml$|security-credentials\.patch\.yml$/;
  function clean(dir) { for (const name of readdirSync(dir)) { const file = join(dir, name), info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) clean(file); else if (sensitive.test(name)) rmSync(file, { force: true }); } }
  clean(root);
  let scanned = 0, matches = 0, skippedLinks = 0;
  function scan(dir) { for (const name of readdirSync(dir)) { const file = join(dir, name), info = lstatSync(file);
    if (info.isSymbolicLink()) { skippedLinks++; continue; }
    if (info.isDirectory()) scan(file); else { const content = readFileSync(file); scanned++; if (Object.values(keys).filter(Boolean).some(key => content.includes(Buffer.from(key)))) matches++; } } }
  scan(root); writeFileSync(join(root, 'credential-scan.json'), JSON.stringify({ scanned, matches, skippedLinks }));
  assert.equal(matches, 0, 'No model keys may persist in isolated artifacts');
}
