/** Formal baseline on real Electron/DSH, fresh account/Core per model. Keys stay in memory. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { runEvaluation, loadScenarios, buildReport } from '../../../../scripts/eval.mjs';
import { createLanBaselineBridge } from '../../../../tests/integration/baseline-lan-model.mjs';
import { verifyMemoryHoldout, judgeMemorySemantics } from '../../../../tests/integration/baseline-memory-verification.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const repository = resolve(import.meta.dirname, '../../../..');
// Keep generated goals and evidence free of the Windows account's home path.
process.env.TEMP = process.env.TMP = 'C:/Temp';
const memoryUi = process.argv.includes('--memory-ui');
const memorySemanticJudge = process.argv.includes('--memory-semantic-judge');
const memoryTrace = process.argv.includes('--memory-trace');
const memoryLoop = process.argv.includes('--memory-loop');
const memoryAccuracy = process.argv.includes('--memory-accuracy');
const memoryFormation = process.argv.includes('--memory-formation');
const memoryCorrection = process.argv.includes('--memory-correction');
assert.ok(!memoryCorrection || memoryLoop, '--memory-correction requires --memory-loop');
assert.ok(!memoryAccuracy || memoryLoop, '--memory-accuracy requires --memory-loop');
const coreSourceIndex = process.argv.indexOf('--memory-core-source');
const coreSource = coreSourceIndex === -1 ? 'D:/AIProjects/MemoWeft/Core/py/src'
  : resolve(process.argv[coreSourceIndex + 1]);
const lan = process.argv.includes('--lan');
const alternateLan = process.argv.includes('--alternate-lan');
const usesLan = lan || alternateLan;
assert.ok(!alternateLan || process.argv.includes('--mimo'), '--alternate-lan requires --mimo');
assert.ok(!lan || !process.argv.includes('--mimo'), '--lan and --mimo are mutually exclusive');
const modelName = lan ? 'lan' : process.argv.includes('--mimo') ? 'mimo' : 'qwen';
const diagnostic = process.argv.includes('--diagnostic');
const comparison = process.argv.includes('--mimo-machine');
assert.ok(!comparison || modelName === 'mimo', '--mimo-machine requires --mimo');
const mimoKeyScope = lan || comparison || memoryLoop || memoryUi ? 'Machine' : 'User';
const run = promisify(execFile);
async function environmentKey(name, scope = 'User') {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true });
  return stdout.trim();
}
const keys = { qwen: await environmentKey('MODEL_SWITCH_UNIFIED_KEY'), mimo: await environmentKey('MIMO_API_KEY', mimoKeyScope) };
const lanBaseUrl = usesLan ? await environmentKey('WEFTMATE_LAN_MODEL_BASE_URL') : null;
if (usesLan) {
  keys.lan = await environmentKey('WEFTMATE_LAN_MODEL_KEY');
  assert.ok(lanBaseUrl, 'WEFTMATE_LAN_MODEL_BASE_URL absent');
}
if (comparison && !alternateLan && !memoryLoop) assert.ok(keys.qwen, 'Qwen key required for Qwen → MiMo memory-03');
if (modelName === 'mimo' && !keys.mimo && process.argv.includes('--wait-for-key')) {
  console.log(`${new Date().toISOString()} MIMO_API_KEY absent; checking ${mimoKeyScope} environment every 10 minutes, at most one hour.`);
  for (let check = 1; check <= 6 && !keys.mimo; check++) {
    await new Promise(r => setTimeout(r, 600000));
    keys.mimo = await environmentKey('MIMO_API_KEY', mimoKeyScope);
    console.log(`${new Date().toISOString()} MiMo key check ${check}/6: ${keys.mimo ? 'present' : 'absent'}`);
  }
}
assert.ok(!memorySemanticJudge || keys.mimo, 'MIMO_API_KEY required for --memory-semantic-judge');
if (!keys[modelName]) throw new Error(`${lan ? 'WEFTMATE_LAN_MODEL_KEY' : modelName === 'qwen' ? 'MODEL_SWITCH_UNIFIED_KEY' : 'MIMO_API_KEY'} absent`);
const scenarioFixes = process.argv.includes('--scenario-fixes');
const root = join('C:/Temp', `weftmate-${memoryTrace ? 'm2f' : memoryCorrection ? 'm2d' : memoryFormation ? 'm2c' : memoryAccuracy ? 'm2b' : memoryUi ? 'm2a-ui' : memoryLoop ? 'm2a' : scenarioFixes ? 'm1-1d' : comparison ? 'm0-7c' : 'm0-7b'}-${modelName}-${randomUUID()}`), profile = join(root, 'profile');
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
  pythonPath: coreSource, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'baseline-pending' }));
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || name === 'ELECTRON_RUN_AS_NODE' || name === 'MIMO_API_KEY' || name === 'MODEL_SWITCH_UNIFIED_KEY') delete env[name];
env.WEFTMATE_BASELINE_TRACE = join(root, 'requests.jsonl');
if (memoryTrace) env.WEFTMATE_BASELINE_MEMORY_TRACE = join(root, 'memory-requests.jsonl');
const formationWaitIndex = process.argv.indexOf('--formation-wait-ms');
if (formationWaitIndex !== -1) {
  const wait = Number(process.argv[formationWaitIndex + 1]);
  assert.ok(Number.isSafeInteger(wait) && wait >= 0, '--formation-wait-ms requires a nonnegative integer');
  env.WEFTMATE_BASELINE_FORMATION_WAIT_MS = String(wait);
}
let app, page, output = '';
let lanBridge;
const redact = value => {
  let text = String(value);
  if (usesLan) for (const secret of [lanBaseUrl, new URL(lanBaseUrl).host, keys.lan]) text = text.replaceAll(secret, '[private-lan]');
  return text;
};
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
  if (usesLan) {
    lanBridge = await createLanBaselineBridge({ baseUrl: lanBaseUrl, key: keys.lan });
    // A serial batch may reuse the model already warmed by its first invocation.
    if (!process.argv.includes('--lan-warmed')) {
      const warmup = await lanBridge.warmup();
      writeFileSync(join(root, 'lan-warmup.json'), JSON.stringify(warmup));
      console.log(`Warmup lan/local-quality: passed ${(warmup.durationMs / 1000).toFixed(2)}s`);
    }
  }
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [join(repository, 'tests/integration/personal-baseline-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0', `--personal-memory-config=${memoryConfig}`], cwd: repository, env, timeout: 90000 });
  const capture = data => { output += redact(data); writeFileSync(join(root, 'host.log'), output); };
  app.process().stdout?.on('data', capture);
  app.process().stderr?.on('data', capture);
  page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page, { username, password }, 'Baseline Electron');
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  for (const name of [modelName]) {
    if (!keys[name]) continue;
    const requestId = `baseline-model-${name}`;
    assert.equal((await api('/account/models', { requestId, name, baseUrl: name === 'lan' ? lanBridge.url : name === 'qwen' ? 'http://127.0.0.1:1/v1' : 'https://api.xiaomimimo.com/v1',
      modelId: name === 'lan' ? 'local-quality' : name === 'qwen' ? 'qwen3.8-27b-original' : 'mimo-v2.6-flash', apiKey: name === 'lan' ? lanBridge.token : keys[name] })).status, 202);
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
  if (memoryUi) scenarios = [{ id: 'memory-ui', category: 'memory', title: '单条表达偏好程序验收', setup: { files: [], memories: [], devices: ['隔离桌面程序'] }, turns: [{ user: '我希望你以后只用中文回答我的问题。请只回复收到，不调用工具。', after: { newSession: true, waitMs: 1000 } }, { user: '跟我问个好。只写一句话，不调用工具。' }], checks: [{ type: 'turn_status', turn: 1, status: 'completed' }, { type: 'turn_status', status: 'completed' }, { type: 'memory_used' }], timeoutSec: 600, notes: '独立合成账号，验证真实形成/新对话采用/单条来源标签。' }];
  if (memoryLoop) scenarios = scenarios.filter(s => s.category === 'memory');
  if (memoryAccuracy) scenarios = scenarios.filter(s => /^(memory-01|memory-03|memory-04)-/.test(s.id));
  if (scenarioFixes) scenarios = scenarios.filter(s => /^(action-04|action-06|memory-01|memory-02|memory-04)-/.test(s.id));
  if (diagnostic) scenarios = scenarios.filter(s => s.id === 'action-06-delete-approval').map(s => ({ ...s, timeoutSec: 600 }));
  const onlyIndex = process.argv.indexOf('--only');
  if (onlyIndex !== -1) scenarios = scenarios.filter(s => process.argv[onlyIndex + 1].split(',').includes(s.id));
  if (memoryCorrection) {
    scenarios = scenarios.filter(s => /^(memory-01|memory-02)-/.test(s.id));
    const original = scenarios.find(s => s.id === 'memory-02-correction');
    assert.ok(original);
    // Additional desktop acceptance; the original scenario stays unmodified.
    scenarios.push({ ...original, id: 'memory-correction-new-sessions',
      turns: [
        { user: '我最近只能周二晚上游泳，安排游泳时帮我记着。只回复收到，不调用工具。', after: { newSession: true, waitMs: 1000 } },
        { user: '刚才说错了，现在固定空出来的是周六晚上，周二已经没空了，以后游泳按周六来安排。只回复收到，不调用工具。', after: { newSession: true, waitMs: 1000 } },
        { user: '我哪天晚上能游泳？只写一句话，不调用工具。' },
      ], checks: original.checks.map(check => check.type === 'reply_contains' ? { ...check, text: '周六' }
        : check.type === 'llm_judge' ? { ...check, prompt: '按纠正后的周六晚上安排游泳。' } : check) });
    if (process.argv.includes('--desktop-only')) scenarios = scenarios.filter(s => s.id === 'memory-correction-new-sessions');
  }
  const repeatIndex = process.argv.indexOf('--repeat');
  const repetitions = repeatIndex === -1 ? 1 : Number(process.argv[repeatIndex + 1]);
  assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0, '--repeat requires a positive integer');
  // Repeat within this same isolated account, host and single prewarmed bridge.
  const batch = Array.from({ length: repetitions }, () => scenarios).flat();
  const results = [], startedAt = new Date().toISOString();
  for (const scenario of batch) {
    const firstModel = !memoryLoop && comparison && scenario.id === 'memory-03-switch-model' ? 'qwen' : modelName;
    if (comparison && !memoryLoop) assert.equal((await api('/settings/models', {
      backgroundModelProfileId: scenario.id === 'memory-03-switch-model' ? null : selected.id,
    }, 'PATCH')).status, 200);
    console.log(`Starting ${scenario.id}: ${lan ? 'lan/local-quality' : firstModel}${scenario.id === 'memory-03-switch-model' ? ' → ' + (alternateLan ? 'lan/local-quality' : lan || comparison && !memoryLoop ? 'mimo' : modelName === 'qwen' ? 'mimo' : 'qwen') : ''}`);
    await runEvaluation({ host: new URL(page.url()).origin, out, model: firstModel,
      switchModel: alternateLan ? 'lan' : lan || comparison && !memoryLoop ? 'mimo' : modelName === 'qwen' ? 'mimo' : 'qwen', scenarioList: [scenario],
      onScenarioResult: async result => { try { const id=result.turns.at(-1)?.sessionId;await page.locator(`[data-session-id="${id}"] > button`).first().click({timeout:5000});await page.screenshot({path:join(repository,'tests/evidence/qa-1/immediate-after-mf1',result.id+'.png')}); }catch{}
        const expectation = scenario.memoryExpectation ?? (result.id.startsWith('memory-1x-') ? {
          kind: result.id === 'memory-1x-person' ? 'relationship' : 'cognition',
          currentPattern: result.id === 'memory-1x-correction' ? '150毫升' : result.id === 'memory-1x-person' ? '闻舟' : '纯器乐',
          sourceTurn: result.id === 'memory-1x-correction' ? 1 : 0,
          ...(result.id === 'memory-1x-correction' ? { oldPattern: '300毫升' } : {}),
        } : null);
        if (expectation) {
          const proof = await verifyMemoryHoldout({ result, scenario, expectation, api });
          result.holdoutVerification = proof.checks;
          if (proof.status === 'failed') {
            result.status = 'failed'; result.reason = [result.reason, proof.reason].filter(Boolean).join('; ');
          }
        }
        if (memorySemanticJudge) result.semanticJudgement = await judgeMemorySemantics({ result, scenario, key: keys.mimo });
        results.push(result); writeFileSync(join(root, 'progress.json'), JSON.stringify(results, null, 2));
        console.log(`${result.id}: ${result.status} ${(result.durationMs / 1000).toFixed(2)}s ${result.reason ?? ''}`);
      } });
  }
  if (memoryLoop || memoryUi) {
    if (memoryCorrection && !process.argv.includes('--desktop-only')) {
      try {
        const correction = results.find(result => result.id === 'memory-02-correction');
        assert.equal(correction?.status, 'passed');
        const items = (await api('/memory/items?kind=cognition')).body.items;
        const adopted = correction.turns.at(-1).memoryUsed;
        assert.ok(items.some(item => item.text.includes('周五') && item.currentState === 'current' &&
          adopted.some(memory => memory.id === item.id)), 'original memory-02 must adopt its corrected item');
        assert.ok(items.filter(item => item.text.includes('只能周三')).every(item =>
          item.currentState === 'not_current' && !adopted.some(memory => memory.id === item.id)));
        assert.equal(correction.turns.flatMap(turn => turn.approvals).length, 0);
        if (lan) writeFileSync(join(root, 'original-correction-verification.json'), JSON.stringify({ status: 'passed' }));
      } catch (error) {
        if (!lan) throw error;
        // Preserve this failure, while still verifying the independent three-session case.
        writeFileSync(join(root, 'original-correction-verification.json'), JSON.stringify({ status: 'failed', reason: redact(error.message) }));
        process.exitCode = 1;
      }
    }
    const sample = results.find(result => result.id === (memoryCorrection ? 'memory-correction-new-sessions' : memoryUi ? 'memory-ui' : 'memory-01-preference'));
    if (sample?.status === 'passed') {
      if (memoryCorrection) {
        assert.equal(new Set(sample.turns.map(turn => turn.sessionId)).size, 3);
        assert.equal(sample.turns.flatMap(turn => turn.approvals).length, 0);
        const items = (await api('/memory/items?kind=cognition')).body.items;
        const used = sample.turns.at(-1).memoryUsed;
        const corrected = items.find(item => used.some(memory => memory.id === item.id) && item.text.includes('周六'));
        assert.ok(corrected, 'memoryUsed must identify the corrected understanding');
        assert.equal(corrected.currentState, 'current');
        const obsolete = items.filter(item => item.text.includes('只能周二'));
        assert.ok(obsolete.length);
        assert.ok(obsolete.every(item => item.currentState === 'not_current' && item.lifecycle.invalidAt));
        assert.ok(obsolete.every(item => !used.some(memory => memory.id === item.id)));
        const sources = (await api(`/memory/items/cognition/${corrected.id}/sources`)).body.sources;
        assert.ok(sources.some(source => source.rawContent === scenarios.find(s => s.id === sample.id).turns[1].user));
        for (const item of obsolete) {
          const previous = (await api(`/memory/items/cognition/${item.id}/sources`)).body.sources;
          assert.ok(previous.some(source => source.rawContent.includes('只能周二')));
        }
        writeFileSync(join(root, 'correction-verification.json'), JSON.stringify({ threeDistinctSessions: true,
          correctedMemoryUsed: true, obsoleteExcluded: true, sourcesRetained: true, undeclaredApprovals: 0 }));
      }
      const sessionId = sample.turns.at(-1).sessionId;
      await page.evaluate(async sessionId => {
        const status = await (await fetch('/personal/v1/status')).json();
        localStorage.setItem(`weftmate:last-session:v1:${status.ownerId}`, sessionId);
        localStorage.setItem('weftmate.desktop.appearance.v1', JSON.stringify({ theme: 'light' }));
      }, sessionId);
      await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
      // Select the acceptance conversation through the desktop's real notification
      // action. Background refresh may overwrite last-session storage at reload.
      const openAcceptanceConversation = () => app.evaluate(({ BrowserWindow }, id) => {
        const window = BrowserWindow.getAllWindows().find(window => /\/personal\/v1\/ui/.test(window.webContents.getURL()));
        if (!window) throw new Error('BASELINE_DESKTOP_WINDOW_MISSING');
        window.webContents.send('wm:desktop:conversation', id);
      }, sessionId);
      await openAcceptanceConversation();
      const label = page.locator('.reply-memory').last();
      await label.waitFor({ state: 'visible' });
      assert.match(await label.textContent(), /用到了 \d+ 条记忆/);
      if (memoryUi) assert.equal(await label.textContent(), '用到了 1 条记忆');
      await label.click();
      await page.getByRole('heading', { name: '这条回复的记忆来源' }).waitFor();
      await until(async () => await page.locator('.memory-source-text').count());
      if (memoryCorrection) assert.match(await page.locator('.memory-source-text').allTextContents().then(texts => texts.join('\n')), /周六/);
      await label.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(root, 'memory-source-light.png') });
      await page.evaluate(() => { localStorage.setItem('weftmate.desktop.appearance.v1', JSON.stringify({ theme: 'dark' })); });
      await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
      await openAcceptanceConversation(); await page.locator('.reply-memory').last().click();
      await until(async () => await page.locator('.memory-source-text').count());
      await page.locator('.reply-memory').last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(root, 'memory-source-dark.png') });
      writeFileSync(join(root, 'ui-verification.json'), JSON.stringify({ electron: true, label: await page.locator('.reply-memory').last().textContent(), sources: await page.locator('.memory-source-text').count(), themes: ['light', 'dark'] }));
    }
  }
  const count = status => results.filter(r => r.status === status).length;
  const summary = { passed: count('passed'), failed: count('failed'), manual: count('manual'), unsupported: count('unsupported'),
    skippedChecks: results.flatMap(r => r.checks).filter(c => c.status === 'skipped').length };
  summary.passRate = summary.passed + summary.failed ? summary.passed / (summary.passed + summary.failed) : null;
  summary.coverage = summary.passed / results.length;
  const report = { schemaVersion: 1, startedAt, host: new URL(page.url()).origin, model: lan ? 'lan/local-quality' : modelName, results, summary };
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, 'report.md'), buildReport(report));
  writeFileSync(join(root, 'memory-status.json'), JSON.stringify((await api('/memory/status')).body, null, 2));
  console.log(JSON.stringify(report.summary));
} catch (error) {
  if (lan) writeFileSync(join(root, 'lan-acceptance-error.json'), JSON.stringify({ name: error.name, reason: redact(error.message) }));
  throw error;
} finally {
  if (app) { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); }
  if (lanBridge) {
    await lanBridge.close();
    writeFileSync(join(root, 'lan-serial-requests.json'), JSON.stringify(lanBridge.metrics(), null, 2));
  }
  writeFileSync(join(root, 'host.log'), output);
  const sensitive = /credentials\.json$|(?:Cookies|Trust Tokens)(?:-journal)?$|setup-[^/]+\.json$|secure-snapshot.*\.yml$|security-credentials\.patch\.yml$/;
  function clean(dir) { for (const name of readdirSync(dir)) { const file = join(dir, name), info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) clean(file); else if (sensitive.test(name)) rmSync(file, { force: true }); } }
  clean(root);
  let scanned = 0, matches = 0, skippedLinks = 0;
  function scan(dir) { for (const name of readdirSync(dir)) { const file = join(dir, name), info = lstatSync(file);
    if (info.isSymbolicLink()) { skippedLinks++; continue; }
    if (info.isDirectory()) scan(file); else { const content = readFileSync(file); scanned++; if ([...Object.values(keys), lanBaseUrl, lanBaseUrl && new URL(lanBaseUrl).host].filter(Boolean).some(key => content.includes(Buffer.from(key)))) matches++; } } }
  scan(root); writeFileSync(join(root, 'credential-scan.json'), JSON.stringify({ scanned, matches, skippedLinks }));
  assert.equal(matches, 0, lan ? 'No model keys or private LAN destination may persist in isolated artifacts'
    : 'No model keys may persist in isolated artifacts');
}
