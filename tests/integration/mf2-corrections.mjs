/** Frozen MF-2 cases on real Electron/DSH/Core. Synthetic accounts only. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync, openSync, closeSync, utimesSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { runEvaluation } from '../../scripts/eval.mjs';
import { createLanBaselineBridge } from './baseline-lan-model.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { verify } from '../../src/personal-backup/archive.mjs';

const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const repository = resolve(import.meta.dirname, '../..'), run = promisify(execFile);
const pause = ms => new Promise(r => setTimeout(r, ms));
const model = arg('--model', 'mimo'), settledMode = process.argv.includes('--settled');
assert.ok(['mimo', 'lan'].includes(model));
const core = resolve(arg('--core-source', 'D:/AIProjects/MemoWeft/Worktrees/mf-2-elliptical-correction/py/src'));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const destination = resolve(arg('--out', `tests/evidence/mf-2/after-${model}-${settledMode ? 'settled' : 'default'}`));
mkdirSync(destination, { recursive: true });
const source = readFileSync(new URL('../fixtures/mf2-elliptical-corrections.json', import.meta.url), 'utf8');
const fixture = JSON.parse(source), cases = fixture.cases.filter(c => !arg('--only') || arg('--only').split(',').includes(c.id));
const environment = async (name, scope) => (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true })).stdout.trim();
const key = await environment(model === 'mimo' ? 'MIMO_API_KEY' : 'WEFTMATE_LAN_MODEL_KEY', model === 'mimo' ? 'Machine' : 'User');
const base = model === 'mimo' ? 'https://api.xiaomimimo.com/v1' : await environment('WEFTMATE_LAN_MODEL_BASE_URL', 'User');
assert.ok(key && base);
const secrets = [key, ...(model === 'lan' ? [base, new URL(base).host] : [])];
const safe = text => secrets.reduce((s, secret) => s.replaceAll(secret, '[private]'), String(text));
const save = (name, value) => writeFileSync(join(destination, name), safe(JSON.stringify(value, null, 2)) + '\n');
const lock = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock', lockToken = `MF-2 ${randomUUID()}`;
let bridge, timer, owned = false;
const reports = [], roots = [];
process.env.TEMP = process.env.TMP = 'C:/Temp';

async function one(testCase) {
  const root = mkdtempSync('C:/Temp/weftmate-mf2-'), profile = join(root, 'profile'), out = join(root, 'eval');
  roots.push(root); save('run-roots.json', roots);
  mkdirSync(profile); mkdirSync(out);
  writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const username = `eval-mf2-${randomUUID()}`, password = `synthetic-${randomUUID()}`;
  const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(k => [k, async () => ({})]));
  const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
  const prepared = await prep.start(), grant = await prep.issueSetupGrant();
  assert.equal((await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username, password, deviceName: 'MF-2 synthetic desktop' }) })).status, 201);
  await prep.close();
  const config = join(root, 'memory-config.json');
  writeFileSync(config, JSON.stringify({ python, pythonPath: core, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'mf2-pending' }));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(k) || ['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY', 'MODEL_SWITCH_UNIFIED_KEY'].includes(k)) delete env[k];
  env.WEFTMATE_BASELINE_TRACE = join(root, 'requests.jsonl');
  env.WEFTMATE_BASELINE_MEMORY_TRACE = join(root, 'memory-requests.jsonl');
  env.WEFTMATE_BASELINE_RECALL_TRACE = join(root, 'recall.jsonl');
  const report = { id: testCase.id, model, settledMode, root, startedAt: new Date().toISOString(), turns: [], settlements: [] };
  reports.push(report);
  let app, page, hostLog = '';
  const api = (path, body, method = body ? 'POST' : 'GET') => page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const r = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  }, { path, body, method });
  async function until(check, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(250); }
    throw new Error('MF2_WAIT_TIMEOUT');
  }
  try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [join(repository, 'tests/integration/m2-exit-bootstrap.mjs'), `--user-data-dir=${profile}`, '--personal-host', '--access-port=0', `--personal-memory-config=${config}`], cwd: repository, env, timeout: 90000 });
    for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', d => { hostLog += safe(d); });
    page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000);
    await page.waitForURL('**/personal/v1/ui'); await localUiSession(page, { username, password }, 'MF-2');
    await page.locator('#assistant-view').waitFor({ state: 'visible' });
    const requestId = randomUUID();
    assert.equal((await api('/account/models', { requestId, name: model, baseUrl: bridge?.url ?? base, modelId: model === 'mimo' ? 'mimo-v2.6-flash' : 'local-quality', apiKey: bridge?.token ?? key })).status, 202);
    assert.equal((await until(async () => { const op = (await api(`/account/models/by-request/${requestId}`)).body.operation; return op && !['pending', 'applying'].includes(op.status) && op; })).status, 'succeeded');
    const selected = (await api('/models')).body.models.find(m => m.name === model);
    assert.equal((await api('/settings/models', { backgroundModelProfileId: selected.id }, 'PATCH')).status, 200);
    const ownerId = (await api('/status')).body.ownerId;
    const db = join(profile, 'personal-access/accounts', ownerId, 'memory-home/memoweft/memoweft.sqlite3');
    async function storage() {
      const script = "import sqlite3,json,sys,pathlib\nc=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row\nr={}\nfor t in ['memory_world_job','cognition','cognition_transitions','relationship','entity']:\n r[t]=[dict(x) for x in c.execute('SELECT * FROM '+t)]\nprint(json.dumps(r,ensure_ascii=True));c.close()";
      return JSON.parse((await run(python, ['-c', script, db], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout);
    }
    async function settle() {
      let stable = 0, rows;
      await until(async () => { const status = (await api('/memory/status')).body; rows = await storage();
        stable = !rows.memory_world_job.some(j => ['pending', 'processing', 'retry'].includes(j.state)) && status.pendingBoundaryCount === 0 ? stable + 1 : 0;
        return stable >= 3;
      }, 330000);
      report.settlements.push(rows);
    }
    writeFileSync(join(out, 'credentials.json'), JSON.stringify({ host: new URL(page.url()).origin, username, password, deviceName: 'MF-2 evaluator', provisioned: true }));
    for (const [i, user] of testCase.turns.entries()) {
      const scenario = { id: `${testCase.id}-${i+1}`, category: 'memory', title: testCase.id, notes: fixture.protocol, setup: { files: [], memories: [], devices: [] }, turns: [{ user }], checks: [{ type: 'turn_status', status: 'completed' }], timeoutSec: 600 };
      await runEvaluation({ host: new URL(page.url()).origin, out, model, scenarioList: [scenario], onScenarioResult: result => { report.turns.push(...result.turns); report.turnResults ??= []; report.turnResults.push(result); save('results.json', reports); } });
      assert.equal(report.turnResults.at(-1).status, 'passed', report.turnResults.at(-1).reason);
      if (i < 2) { await pause(1000); if (settledMode) await settle(); }
    }
    const answer = report.turns.at(-1)?.reply ?? '';
    report.expectedValuePresent = new RegExp(testCase.current, 'u').test(answer);
    report.rejectedValueMentioned = new RegExp(testCase.rejected, 'u').test(answer);
    report.rubric = testCase.rubric;
    report.answer = answer;
    // A rejected value may be mentioned as obsolete; adjudicate those cases against
    // the frozen rubric instead of treating substring presence as current use.
    report.automaticPass = report.expectedValuePresent && !report.rejectedValueMentioned && report.turns.every(t => t.status === 'completed' && !t.approvals?.length);
    report.formalItems = (await api('/memory/items?kind=cognition')).body;
    await settle(); report.finalStorage = await storage();
    const sessionId = report.turns.at(-1).sessionId;
    await app.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.getAllWindows().find(w => /\/personal\/v1\/ui/.test(w.webContents.getURL()));
      window?.webContents.send('wm:desktop:conversation', id);
    }, sessionId);
    await pause(500); await page.screenshot({ path: join(destination, `${testCase.id}.png`) });
    if (process.argv.includes('--forget')) {
      report.forget = { deletions: [] };
      for (const turn of report.turns) {
        const preview = await api(`/sessions/${turn.sessionId}/forget-preview`);
        const result = await api(`/sessions/${turn.sessionId}`, { forgetMemories: true }, 'DELETE');
        report.forget.deletions.push({ sessionId: turn.sessionId, preview, result });
        assert.equal(result.status, 200);
      }
      const needles = [testCase.turns[0], testCase.turns[1], '300毫升', '150毫升'];
      for (const format of ['json', 'markdown']) {
        const exported = await api(`/memory/export?format=${format}`);
        assert.equal(exported.status, 200);
        assert.ok(needles.every(n => !exported.body.content.includes(n)));
      }
      const backup = await api('/backups', {});
      assert.equal(backup.status, 202); assert.equal(backup.body.state, 'succeeded');
      const extracted = join(root, 'forget-backup-check'); mkdirSync(extracted);
      const manifest = await verify(join(root, 'Backups', backup.body.backup.id), extracted);
      const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
      const encodings = needles.flatMap(n => [Buffer.from(n), Buffer.from(n, 'utf16le'), Buffer.from([...n].map(c => c.charCodeAt(0) > 127 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c).join(''))]);
      const contains = bytes => encodings.some(n => bytes.includes(n));
      const hits = walk(extracted).filter(file => {
        const bytes = readFileSync(file); if (contains(bytes)) return true;
        if (file.endsWith('.zstd')) for (let offset = 0; offset < bytes.length;) {
          const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true });
          assert.ok(decoded.engine.bytesWritten); offset += decoded.engine.bytesWritten;
          if (contains(decoded.buffer)) return true;
        }
        return false;
      }).map(file => relative(extracted, file));
      const scan = JSON.parse((await run(python, [join(repository, 'tests/integration/m2-backup-text-scan.py'), join(extracted, relative(profile, db)), ...needles], { windowsHide: true })).stdout);
      Object.assign(report.forget, { backupFiles: manifest.files.length, byteHits: hits, databaseScan: scan });
      assert.equal(hits.length, 0); assert.equal(scan.hitCount, 0);
      const followup = { id: 'mf2-after-forget', category: 'memory', title: 'Forgotten correction', notes: fixture.protocol, setup: { files: [], memories: [], devices: [] }, turns: [{ user: '此前我规定阳台盆栽每次浇多少？不知道就说不知道，不给一般建议。' }], checks: [{ type: 'turn_status', status: 'completed' }], timeoutSec: 600 };
      await runEvaluation({ host: new URL(page.url()).origin, out, model, scenarioList: [followup], onScenarioResult: result => { report.forget.followup = result; } });
      const latest = report.forget.followup.turns.at(-1);
      assert.equal(latest.status, 'completed'); assert.equal(latest.memoryUsed.length, 0);
      assert.doesNotMatch(latest.reply, /150|300/);
      const recalls = readFileSync(join(root, 'recall.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const recall = recalls.findLast(r => r.sessionId === latest.sessionId);
      assert.ok(recall); assert.doesNotMatch(recall.contextText, /150|300/);
      report.forget.contextAfterForget = recall.contextText; report.forget.passed = true;
    }
    console.log(`${testCase.id}: ${report.automaticPass ? 'PASS' : 'REVIEW/FAIL'} ${answer}`);
  } catch (error) { report.error = safe(String(error)); console.log(`${testCase.id}: ${report.error}`); }
  finally {
    if (app) { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); }
    rmSync(join(out, 'credentials.json'), { force: true });
    const dest = join(destination, testCase.id); mkdirSync(dest, { recursive: true });
    for (const name of ['requests.jsonl', 'memory-requests.jsonl', 'recall.jsonl']) if (existsSync(join(root, name))) {
      const text = readFileSync(join(root, name), 'utf8'); assert.equal(safe(text), text, 'public trace contains private data'); copyFileSync(join(root, name), join(dest, name));
    }
    writeFileSync(join(dest, 'host.log'), hostLog);
    report.endedAt = new Date().toISOString(); save('results.json', reports);
  }
}
try {
  save('protocol.json', { ...fixture, sha256: createHash('sha256').update(source).digest('hex'), model, settledMode, core });
  if (model === 'lan') {
    const fd = openSync(lock, 'wx'); try { writeFileSync(fd, `${lockToken} ${new Date().toISOString()}`); } finally { closeSync(fd); }
    owned = true; timer = setInterval(() => { if (readFileSync(lock, 'utf8').startsWith(lockToken)) utimesSync(lock, new Date(), new Date()); }, 60000);
    bridge = await createLanBaselineBridge({ baseUrl: base, key }); secrets.push(bridge.token);
    save('warmup.json', await bridge.warmup());
  }
  for (const c of cases) await one(c);
} finally {
  await bridge?.close(); if (bridge) save('lan-serial.json', bridge.metrics());
  clearInterval(timer); if (owned && readFileSync(lock, 'utf8').startsWith(lockToken)) rmSync(lock);
  save('results.json', reports);
}
