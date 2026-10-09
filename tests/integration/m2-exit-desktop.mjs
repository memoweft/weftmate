/** EX-2 repeatable M2 exit. Real Electron/DSH/Core, synthetic account per baseline.
 * Default: MiMo 8 steps + LAN 8 steps + original LAN memory-01..04 + speed each.
 * --model mimo|lan runs one baseline; --four runs original four (LAN by default).
 * --judge-model same|mimo enables the existing optional semantic evaluator.
 * --reminders runs the two unchanged scheduling requests three times each.
 * --recall-trace retains synthetic Core snapshots and the exact injected context.
 * No product fixes, seeded memories, daily vault, private LAN address or key files.
 */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, lstatSync, rmSync, openSync, closeSync, statSync, utimesSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { PersonalClient, checkOne, loadScenarios, runEvaluation } from '../../scripts/eval.mjs';
import { createLanBaselineBridge } from './baseline-lan-model.mjs';
import { judgeMemorySemantics } from './baseline-memory-verification.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { verify } from '../../src/personal-backup/archive.mjs';
import { original, confirmation, correction, recallQuestion, proposalCheck, formationChecks, correctionChecks, speedComparison, fourScenarioSummary, exportHasForgottenName } from './m2-exit-checks.mjs';

const repository = resolve(import.meta.dirname, '../..');
const run = promisify(execFile), pause = ms => new Promise(r => setTimeout(r, ms));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const fgOnly = process.argv.includes('--fg-1');
const outageOnly = process.argv.includes('--fg-1-outage');
const settingsOnly = process.argv.includes('--fg-1-settings');
const provider = option('--model', fgOnly ? 'mimo' : null), judgeModel = option('--judge-model', undefined);
const remindersOnly = process.argv.includes('--reminders');
const eightOnly = process.argv.includes('--eight-only');
assert.ok(provider === null || ['mimo', 'lan'].includes(provider), '--model mimo|lan');
const coreSource = resolve(option('--memory-core-source', 'D:/AIProjects/MemoWeft/Core/py/src'));
const python = option('--python', 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe');
const evidence = resolve(option('--out', join(repository, 'tests/evidence/m2-exit')));
const lockPath = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock';
const lockToken = `${option('--lock-owner', 'EX-2')} ${randomUUID()}`;
let bridge, lockTimer, ownsLock = false;
const roots = [], reports = [];
process.env.TEMP = process.env.TMP = 'C:/Temp';
mkdirSync(evidence, { recursive: true });
async function environmentValue(name, scope) {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true });
  return stdout.trim();
}
const key = await environmentValue('MIMO_API_KEY', 'Machine');
const lanKey = fgOnly ? '' : await environmentValue('WEFTMATE_LAN_MODEL_KEY', 'User');
const lanUrl = fgOnly ? '' : await environmentValue('WEFTMATE_LAN_MODEL_BASE_URL', 'User');
assert.ok(key && (fgOnly || lanKey && lanUrl), 'Required model environment variables absent');
const secrets = [key, lanKey, lanUrl, lanUrl && new URL(lanUrl).host].filter(Boolean);
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[private]'), String(value));
const save = (file, value) => writeFileSync(file, redact(JSON.stringify(value, null, 2)) + '\n');
async function acquireLan() {
  if (bridge) return;
  while (!ownsLock) {
    try {
      const fd = openSync(lockPath, 'wx');
      try { writeFileSync(fd, `${lockToken} ${new Date().toISOString()}\n`); } finally { closeSync(fd); }
      ownsLock = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const occupied = statSync(lockPath, { throwIfNoEntry: false });
      if (!occupied) continue; // The other batch may have released between calls.
      if (Date.now() - occupied.mtimeMs > 3 * 60 * 60 * 1000) {
        rmSync(lockPath); continue;
      }
      console.log(`${new Date().toISOString()} LAN occupied; next atomic attempt in five minutes.`);
      await pause(300000);
    }
  }
  lockTimer = setInterval(() => {
    if (readFileSync(lockPath, 'utf8').startsWith(lockToken)) utimesSync(lockPath, new Date(), new Date());
  }, 60000);
  bridge = await createLanBaselineBridge({ baseUrl: lanUrl, key: lanKey });
  secrets.push(bridge.token);
  await bridge.warmup();
  console.log('LAN lock acquired; local-quality warmed.');
}
async function until(check, timeoutMs = 90000, label = 'setup') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(500); }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}
const git = async directory => (await run('git', ['-C', directory, 'rev-parse', 'HEAD'])).stdout.trim();
const revisions = async () => ({ weftmate: await git(repository), core: await git(resolve(coreSource, '../..')) });

async function baseline(modelName, fourOnly = false) {
  // Short, atomically unique roots also keep Windows SQLite backup destinations
  // below the native path limit after the archive's staging directory is added.
  const root = mkdtempSync(join('C:/Temp', `weftmate-m2-exit-${modelName}-`));
  roots.push(root);
  const profile = join(root, 'profile'), out = join(root, 'eval');
  mkdirSync(profile, { recursive: true }); mkdirSync(out);
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), model: modelName, revision: await revisions(), electron: true, steps: [], turns: [] };
  const reportFile = join(evidence, `${remindersOnly ? 'reminders' : fourOnly ? 'four' : 'baseline'}-${modelName}.json`);
  const persist = () => { save(join(root, 'progress.json'), report); save(reportFile, report); };
  reports.push(report);
  console.log(`Isolated ${modelName} root: ${root}`);
  const username = `eval-${randomUUID()}`, password = `test-${randomUUID()}-password`;
  writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => ({})]));
  const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
  const started = await prep.start(), setup = await prep.issueSetupGrant();
  try {
    assert.equal((await fetch(`${started.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'EX-2 synthetic desktop' }) })).status, 201);
  } finally { await prep.close(); }
  const config = join(root, 'memory-config.json');
  save(config, { python, pythonPath: coreSource, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'ex-2' });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:WEFTMATE_|MEMOWEFT_)/.test(name) || ['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY', 'MODEL_SWITCH_UNIFIED_KEY'].includes(name)) delete env[name];
  env.WEFTMATE_BASELINE_TRACE = join(root, 'requests.jsonl');
  if (process.argv.includes('--recall-trace')) env.WEFTMATE_BASELINE_RECALL_TRACE = join(root, 'recall.jsonl');
  if (process.argv.includes('--memory-trace')) env.WEFTMATE_BASELINE_MEMORY_TRACE = join(root, 'memory-requests.jsonl');
  let app, page, ownerId, models = [], client, log = '', A, previous = [], corrected = [];
  const capturedSessions = new Set();
  async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    return page.evaluate(async ({ path, body, method }) => {
      const me = await (await fetch('/personal/v1/auth/me')).json();
      const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      return { status: response.status, body: await response.json() };
    }, { path, body, method });
  }
  async function configure(name) {
    if (models.some(model => model.name === name && model.configured)) return;
    if (name === 'lan') await acquireLan();
    const requestId = randomUUID();
    const result = await api('/account/models', { requestId, name,
      baseUrl: name === 'mimo' ? 'https://api.xiaomimimo.com/v1' : bridge.url,
      modelId: name === 'mimo' ? 'mimo-v2.6-flash' : 'local-quality', apiKey: name === 'mimo' ? key : bridge.token });
    assert.equal(result.status, 202, JSON.stringify(result.body));
    const operation = await until(async () => { const value = (await api(`/account/models/by-request/${requestId}`)).body.operation; return value && !['pending', 'applying'].includes(value.status) && value; });
    assert.equal(operation.status, 'succeeded');
    models = (await api('/models')).body.models;
  }
  async function launch(restart = false) {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [join(import.meta.dirname, 'm2-exit-bootstrap.mjs'),
      `--user-data-dir=${profile}`, '--personal-host', '--access-port=0', `--personal-memory-config=${config}`], cwd: repository, env, timeout: 90000 });
    const capture = part => { log += redact(part); writeFileSync(join(root, 'host.log'), log); };
    app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
    page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(20000);
    await page.waitForURL('**/personal/v1/ui', { timeout: 90000 });
    if (restart) await app.evaluate((_, input) => globalThis.m2ExitSeedCredentials(input), { mimo: key, lan: bridge?.token });
    await localUiSession(page, { username, password }, 'EX-2 desktop');
    await page.locator('#assistant-view').waitFor();
    ownerId = (await api('/status')).body.ownerId;
    client = new PersonalClient(new URL(page.url()).origin);
    await client.call('/auth/login', { username, password, deviceName: 'EX-2 optional evaluator' });
    assert.equal((await api('/backups/settings', { enabled: false, directory: join(root, 'Backups') }, 'PATCH')).status, 200);
  }
  async function close() {
    if (!app) return;
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await app.close().catch(() => {}); app = null;
  }
  async function openSession(id) {
    await app.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.getAllWindows().find(window => /\/personal\/v1\/ui/.test(window.webContents.getURL()));
      window.webContents.send('wm:desktop:conversation', id);
    }, id);
    await page.locator('#message-text').waitFor();
    await until(async () => (await api('/sessions')).body.sessions?.some(s => s.sessionId === id && s.sendAvailable));
    await page.waitForFunction(({ ownerId, id }) => localStorage.getItem(`weftmate:last-session:v1:${ownerId}`) === id, { ownerId, id });
  }
  async function openMemoryPage() {
    await page.getByRole('button', { name: '账户菜单', exact: true }).click();
    await page.getByRole('button', { name: '记忆', exact: true }).click();
    await page.locator('#memory-view').waitFor();
  }
  async function selectMemoryKind(kind) {
    const picker = page.getByRole('combobox', { name: '类型', exact: true });
    if (await picker.evaluate(element => element.tagName === 'SELECT')) await picker.selectOption(kind);
    else {
      await picker.click();
      const label = { cognition: '理解', entity: '人物与事物', relationship: '关系', event: '经历' }[kind];
      await page.getByRole('listbox', { name: '类型', exact: true }).getByRole('option', { name: label, exact: true }).click();
    }
  }
  async function leaveMemoryPage() {
    const detailClose = page.getByRole('button', { name: '关闭记忆详情', exact: true });
    if (await detailClose.isVisible()) await detailClose.click();
    const settingsClose = page.getByRole('button', { name: '关闭设置', exact: true });
    if (await settingsClose.isVisible()) await settingsClose.click();
    else await page.getByRole('button', { name: /返回对话/ }).click();
  }
  async function session(name = modelName, capture = true) {
    // Use the visible model picker and new-conversation action in the real app.
    await page.reload(); await page.locator('#assistant-view').waitFor();
    await page.locator('#model-trigger').click();
    await page.getByRole('option', { name, exact: true }).click();
    await until(async () => await page.locator('#new-session').isEnabled(), 30000, 'new conversation available');
    await page.locator('#new-session').click();
    // UI-P4 keeps a new conversation as a draft until its first send. The
    // original fixture needs an id before that send; create it through the
    // same authorized command, then send all original text in the real app.
    const status = (await api('/status')).body;
    const created = await api('/commands', { requestId: randomUUID(), kind: 'session.create',
      targetDeviceId: status.hostId, modelProfileId: models.find(model => model.name === name).id });
    assert.equal(created.status, 202);
    const body = created.body;
    const cmd = await until(async () => { const cmd = (await api(`/commands/${body.command.commandId}`)).body.command;
      if (['rejected', 'uncertain'].includes(cmd.state)) throw new Error(`session.create ${cmd.state}`);
      return cmd.state === 'accepted_by_dsh' && cmd; });
    if (capture) capturedSessions.add(cmd.sessionId);
    await openSession(cmd.sessionId);
    return cmd.sessionId;
  }
  async function events(id) {
    let cursor = -1, rows = [], more;
    do { const response = await api(`/sessions/${id}/events?afterSeq=${cursor}&limit=200`); assert.equal(response.status, 200);
      rows.push(...response.body.events); cursor = response.body.nextSeq; more = response.body.hasMore; } while (more);
    return rows;
  }
  async function message(id, text, name = modelName, timeoutMs = 600000) {
    await openSession(id);
    const prior = (await events(id)).at(-1)?.seq ?? -1, start = Date.now();
    const turn = { sessionId: id, model: name, modelProfileId: models.find(m => m.name === name).id, user: text, reply: '', status: 'running', memoryUsed: [] };
    report.turns.push(turn); persist();
    await page.locator('#message-text').fill(text);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/personal/v1/commands' && r.request().postDataJSON()?.kind === 'session.message');
    response.catch(() => {});
    await page.locator('#send-message').click();
    const sent = await response; assert.equal(sent.status(), 202, await sent.text());
    let savedEventCount = -1;
    try {
      await until(async () => {
        const rows = (await events(id)).filter(row => row.seq > prior);
        turn.events = rows;
        turn.reply = rows.filter(row => row.type === 'assistant.message').map(row => row.data.text ?? '').join('\n');
        turn.memoryUsed = rows.flatMap(row => row.data.memoryUsed ?? []);
        if (rows.length !== savedEventCount) { savedEventCount = rows.length; persist(); }
        const pending = (await api(`/sessions/${id}/approvals?limit=100`)).body.approvals?.filter(row => row.status === 'pending');
        if (pending?.length) { turn.unexpectedApprovals = pending; throw new Error('Undeclared approval; left pending, turn cancelled'); }
        const questions = (await api(`/sessions/${id}/questions?limit=100`)).body.questions?.filter(row => row.status === 'pending');
        if (questions?.length) { turn.unexpectedQuestions = questions; throw new Error('Unexpected clarification; no answer declared by the eight-step scenario, turn cancelled'); }
        const end = rows.find(row => row.type === 'turn.ended');
        if (end) { turn.status = end.data.reason === 'error' ? 'failed' : end.data.reason; return true; }
        return false;
      }, timeoutMs, 'model turn');
    } catch (error) {
      turn.status = 'failed'; turn.reason = redact(error.message);
      await api('/commands', { requestId: randomUUID(), kind: 'session.cancel', targetDeviceId: (await api('/status')).body.hostId, sessionId: id }).catch(() => {});
    }
    turn.durationMs = Date.now() - start;
    turn.steps = (turn.events ?? []).filter(row => row.type === 'step.started').length;
    persist(); return turn;
  }
  const dbPath = () => join(profile, 'personal-access/accounts', ownerId, 'memory-home/memoweft/memoweft.sqlite3');
  async function storage(file = dbPath()) {
    const script = `import sqlite3,json,sys,pathlib\nc=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)\nc.row_factory=sqlite3.Row\ntables=['entity','relationship','cognition','cognition_transitions','relationship_transitions','interaction_commitment','memory_world_job']\nr={}\nfor t in tables:\n try: r[t]=[dict(x) for x in c.execute('SELECT * FROM '+t)]\n except sqlite3.OperationalError: r[t]=[]\nprint(json.dumps(r,ensure_ascii=True))\nc.close()`;
    const { stdout } = await run(python, ['-c', script, file], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  async function settled() {
    let stable = 0;
    await until(async () => {
      const status = (await api('/memory/status')).body;
      const rows = await storage();
      const pending = rows.memory_world_job.some(row => ['pending', 'processing', 'retry'].includes(row.state));
      stable = !pending && status.pendingBoundaryCount === 0 ? stable + 1 : 0;
      return stable >= 3;
    }, 330000, 'Core formation');
  }
  async function items() {
    const rows = [];
    for (const kind of ['entity', 'relationship', 'cognition', 'event']) {
      let after = '';
      do { const result = await api(`/memory/items?kind=${kind}&limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`);
        assert.equal(result.status, 200, JSON.stringify(result.body)); rows.push(...result.body.items);
        after = result.body.hasMore ? result.body.nextCursor : ''; } while (after);
    }
    return rows;
  }
  async function sources(rows) {
    const result = {};
    for (const item of rows) {
      const response = await api(`/memory/items/${item.kind}/${encodeURIComponent(item.id)}/sources`);
      result[item.id] = response.body.sources ?? [];
    }
    return result;
  }
  async function semantic(turn, criterion) {
    if (judgeModel === 'mimo') {
      const verdict = await judgeMemorySemantics({ result: { turns: [turn] },
        scenario: { turns: [{ user: turn.user }], checks: [{ type: 'llm_judge', prompt: criterion }] }, key });
      (report.directJudgements ??= []).push(verdict);
      return { type: 'llm_judge', prompt: criterion, turn: report.turns.indexOf(turn) + 1, ...verdict };
    }
    return checkOne({ type: 'llm_judge', prompt: criterion, turn: report.turns.indexOf(turn) + 1 }, { judgeModel, models, client, turns: report.turns,
      scenario: { turns: report.turns.map(t => ({ user: t.user })) }, scratchDir: root, deadline: Date.now() + 180000 });
  }
  async function step(id, title, action) {
    if (fgOnly && !(settingsOnly ? ['settings-export'] : outageOnly ? ['08'] : ['06', '07', '08']).includes(id)) return;
    const result = { id, title, status: 'running', checks: {}, startedAt: new Date().toISOString() };
    report.steps.push(result); persist();
    try {
      await action(result);
      const verdicts = result.semantic ? Array.isArray(result.semantic) ? result.semantic : [result.semantic] : [];
      if (judgeModel && verdicts.length) result.checks.semanticAccepted = verdicts.every(verdict => verdict.status === 'passed');
      result.status = Object.values(result.checks).every(value => value === true) && Object.keys(result.checks).length ? 'passed' : 'failed';
    }
    catch (error) { result.status = 'failed'; result.reason = redact(error.message); }
    result.finishedAt = new Date().toISOString();
    persist(); console.log(`${modelName} ${id}: ${result.status} ${result.reason ?? JSON.stringify(result.checks)}`);
  }
  try {
    await launch(); await configure(modelName);
    await api('/settings/models', { backgroundModelProfileId: models.find(m => m.name === modelName).id }, 'PATCH');
    report.initialMemory = (await api('/memory/status')).body; persist();
    if (!fourOnly && ['mimo', 'lan'].includes(judgeModel) && judgeModel !== modelName) await configure(judgeModel);
    if (remindersOnly) {
      for (const kind of ['reminder', 'task']) for (let repetition = 1; repetition <= 3; repetition++) {
        await step(`${kind}-${repetition}`, kind === 'reminder' ? '明天早上 8 点提醒我交报告' : '每周一 8 点生成周报', async result => {
          const id = await session();
          const before = Date.now();
          const turn = await message(id, result.title);
          const rows = (await api('/schedules')).body.items.filter(row => row.sessionId === id);
          result.schedules = rows;
          const schedule = rows[0];
          const local = schedule?.nextRunAt && new Date(schedule.nextRunAt);
          const parts = value => new Intl.DateTimeFormat('en-CA', {timeZone: schedule?.timeZone ?? 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(value)).reduce((out,part)=>({...out,[part.type]:part.value}),{});
          const actual = local && parts(local);
          const tomorrow = parts(before + 86400000);
          result.checks = { completed: turn.status === 'completed', exactlyOne: rows.length === 1,
            kind: schedule?.kind === kind, content: (schedule?.text ?? '').includes(kind === 'reminder' ? '交报告' : '周报'),
            hour: actual?.hour === '08' && actual?.minute === '00' && actual?.second === '00',
            calendar: kind === 'reminder' ? actual?.year === tomorrow.year && actual?.month === tomorrow.month && actual?.day === tomorrow.day && !schedule?.repeat
              : schedule?.repeat?.kind === 'weekly' && schedule.repeat.weekday === 1 && schedule.repeat.time === '08:00:00' && actual?.weekday === 'Mon',
            nativeTool: turn.events?.some(row => row.type === 'step.started' && row.data.toolName === 'schedule_create') === true,
            noSourceOrTimers: !(turn.events ?? []).some(row => row.type === 'step.started' && ['read','grep','glob','pwsh','bash','write','edit'].includes(row.data.toolName)),
            confirmation: /8|八|08/.test(turn.reply) && /报告|周报/.test(turn.reply),
          };
        });
      }
      return;
    }
    if (fourOnly) {
      const alternate = modelName === 'mimo' ? 'lan' : 'mimo';
      await configure(alternate);
      writeFileSync(join(out, 'credentials.json'), JSON.stringify({ host: new URL(page.url()).origin, username, password, deviceName: 'EX-2 four', provisioned: true }));
      const scenarioList = (await loadScenarios('eval/scenarios/memory-*.yaml')).filter(s => /^memory-0[1-4]-/.test(s.id));
      report.fourProgress = [];
      const result = await runEvaluation({ host: new URL(page.url()).origin, out, model: modelName, switchModel: alternate,
        judgeModel: judgeModel === 'mimo' ? undefined : judgeModel, scenarioList,
        onScenarioResult: async result => {
          if (judgeModel === 'mimo') {
            result.semanticJudgement = await judgeMemorySemantics({ result, scenario: scenarioList.find(s => s.id === result.id), key });
            (report.directJudgements ??= []).push(result.semanticJudgement);
            if (!['passed', 'skipped'].includes(result.semanticJudgement.status)) {
              result.status = 'failed';
              result.reason = [result.reason, result.semanticJudgement.reason].filter(Boolean).join('; ');
            }
          }
          report.fourProgress.push(result); persist(); console.log(`${result.id}: ${result.status} ${result.durationMs}ms`);
        } });
      report.four = fourScenarioSummary(result.results); persist(); return;
    }
    if (settingsOnly) {
      await step('settings-export', '真实桌面设置里的记忆导出与下载', async result => {
        await app.evaluate(({BrowserWindow}, directory) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.session.setDownloadPath(directory); }, join(root,'downloads'));
        await page.getByRole('button', {name:'账户菜单',exact:true}).click();
        await page.getByRole('button', {name:'设置',exact:true}).click();
        await page.locator('.settings-nav-item').filter({hasText:'记忆'}).click();
        for (const [format,label] of [['json','JSON'],['markdown','Markdown']]) {
          await page.getByRole('button',{name:label,exact:true}).click();
          const file=join(root,'downloads',format==='json'?'weftmate-memory.json':'weftmate-memory.md');
          await until(async()=>statSync(file,{throwIfNoEntry:false})?.size>0,20000,'native memory export');
          const text=readFileSync(file,'utf8');
          result.checks[format] = format==='json'?JSON.parse(text).schemaVersion===1:text.startsWith('# 我的记忆');
        }
        await page.screenshot({path:join(evidence,'settings-export.png')});
        await page.getByRole('button',{name:'管理记忆',exact:true}).click();
        await page.locator('#memory-view').waitFor();
        await page.screenshot({path:join(evidence,'memory-export.png')});
        const browser=await chromium.launch({headless:true});
        try {
          const mobile=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
          await mobile.goto(page.url());await localUiSession(mobile,{username,password},'FG-1 synthetic mobile browser');
          await mobile.locator('#assistant-view').waitFor();
          await mobile.locator('#rail-open').click();
          await mobile.getByRole('button',{name:'账户菜单',exact:true}).click();
          await mobile.getByRole('button',{name:'记忆',exact:true}).click();
          await mobile.locator('#memory-view').waitFor();
          const downloaded=mobile.waitForEvent('download');
          await mobile.getByRole('button',{name:'导出我的记忆 · Markdown',exact:true}).click();
          const file=await downloaded;const target=join(root,'browser-weftmate-memory.md');await file.saveAs(target);
          result.checks.mobileBrowserDownload=readFileSync(target,'utf8').startsWith('# 我的记忆');
          await mobile.screenshot({path:join(evidence,'mobile-browser-memory-export.png')});
        } finally {await browser.close();}

      });
      return;
    }
    if (fgOnly) { A = await session(); await message(A, outageOnly ? '你好，请用一句中文打个招呼。' : original); if (!outageOnly) await message(A, correction); await settled(); }
    await step('01', '原话进入真实桌面对话', async result => {
      A = await session(); const turn = await message(A, original);
      result.checks = { completed: turn.status === 'completed', exactUserEvent: turn.events?.some(row => row.type === 'user.message' && row.data.text === original) === true,
        nonemptyReply: turn.reply.trim().length > 0 };
    });
    await step('02', '模型提议、用户确认组队提醒', async result => {
      const first = report.turns[0];
      result.checks.proposal = proposalCheck(first.reply);
      result.semantic = await semantic(first, '应主动提议以后用户想组队时提醒找王小明，邀请用户确认。');
      const turn = await message(A, confirmation);
      result.checks.confirmationCompleted = turn.status === 'completed';
      result.checks.confirmationSource = turn.events?.some(row => row.type === 'user.message' && row.data.text === confirmation) === true;
    });
    if (process.argv.includes('--proposal-only')) return;
    await step('03', '人物、关系、评价、决定和原话来源', async result => {
      await settled(); previous = await items(); const provenance = await sources(previous);
      result.items = previous; result.sources = provenance; result.storage = await storage();
      result.checks = formationChecks(previous);
      for (const [name, kinds, words, raw] of [
        ['personSource', ['entity'], /王小明/, original], ['relationshipSource', ['relationship'], /王小明.*(?:好兄弟|兄弟)/, original],
        ['evaluationSource', ['cognition'], /王小明.*(?:厉害|擅长|很强|高手)/, original], ['decisionSource', ['cognition'], /组队/, confirmation]]) {
        result.checks[name] = previous.some(item => kinds.includes(item.kind) && words.test(item.text) && provenance[item.id]?.some(source => source.rawContent === raw && source.contentAvailable));
      }
    });
    // MiMo can finish formation while another package owns the LAN lock.
    if (!fgOnly) await configure(modelName === 'mimo' ? 'lan' : 'mimo');
    const alternate = modelName === 'mimo' ? 'lan' : 'mimo';
    await step('04', '新会话、换模型、改写问题仍召回', async result => {
      const id = await session(alternate), turn = await message(id, recallQuestion, alternate);
      result.checks = { newSession: id !== A, changedModel: alternate !== modelName, completed: turn.status === 'completed', replyName: /王小明/.test(turn.reply),
        formalMemoryAdopted: turn.memoryUsed.some(memory => previous.some(item => item.id === memory.id && /王小明/.test(item.text))) };
      result.semantic = await semantic(turn, '新会话应根据此前确认的组队决定回答找王小明，不能只询问或编造别人。');
    });
    await step('05', '自然纠正、两个模型的当前理解和失效解释', async result => {
      const id = await session(modelName); const turn = await message(id, correction);
      await settled(); corrected = await items(); const provenance = await sources(corrected);
      const turns = [];
      for (const name of [modelName, alternate]) turns.push(await message(await session(name), '王小明跟我是什么关系？我们组队该找谁？', name));
      result.items = corrected; result.sources = provenance; result.storage = await storage();
      result.checks = { correctionCompleted: turn.status === 'completed', ...correctionChecks(corrected, previous, turns, provenance),
        replacementReason: result.storage.relationship_transitions.some(row => row.reason && previous.some(item => item.id === row.prior_relationship_id) && corrected.some(item => item.id === row.replacement_relationship_id && /表弟/.test(item.text))) };
      result.semantic = await Promise.all(turns.map(turn => semantic(turn, '当前关系是表弟，已纠正好兄弟的旧说法；组队仍找王小明。')));
      result.explanations = [];
      for (const name of [modelName, alternate]) {
        const explanation = await message(await session(name), '为什么之前说王小明是好兄弟，现在那个说法不算了？', name);
        result.explanations.push(explanation);
      }
      result.checks.bothExplainReplacement = result.explanations.every(turn => turn.status === 'completed' &&
        /纠正|更正|改口|修正|更改/.test(turn.reply) && /表弟/.test(turn.reply));
    });
    await step('06', '重启宿主、持久化后仍采用最新理解', async result => {
      const oldPid = app.process().pid; await settled(); await close(); await launch(true);
      const rows = await items(), turn = await message(await session(modelName), '王小明跟我是什么关系？我们组队该找谁？');
      result.items = rows;
      result.checks = { restarted: app.process().pid !== oldPid, persistedLatest: rows.some(item => item.kind === 'relationship' && item.currentState === 'current' && /表弟/.test(item.text)),
        latestReply: turn.status === 'completed' && /王小明/.test(turn.reply) && /表弟/.test(turn.reply),
        latestAdopted: turn.memoryUsed.some(memory => rows.some(item => item.id === memory.id && item.currentState === 'current' && /表弟/.test(item.text))) };
      result.semantic = await semantic(turn, '重启后当前关系仍是表弟；组队找王小明。');
    });
    await step('07', '界面看来源、真正遗忘、导出不可恢复', async result => {
      const rows = await items(); const target = rows.find(item => item.kind === 'relationship' && /王小明/.test(item.text)) ?? rows.find(item => /王小明/.test(item.text));
      result.checks.uiSource = false;
      if (target) {
        await openMemoryPage();
        await selectMemoryKind(target.kind);
        await page.getByLabel('搜索当前类型').fill('王小明');
        await page.getByRole('button', { name: '搜索', exact: true }).click();
        await page.getByRole('button', { name: new RegExp(target.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
        await until(async () => (await page.locator('.memory-source-raw').allTextContents()).some(text => text.includes(original) || text.includes(correction)));
        result.checks.uiSource = true;
        // The restarted isolated desktop can be occluded by another test window.
        // Restore its own compositor before capturing; keep semantic checks and
        // screenshot errors unchanged instead of skipping the forget operation.
        await app.evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
        });
        await page.bringToFront();
        await page.screenshot({ path: join(evidence, `${modelName}-sources.png`), animations: 'disabled' });
        if (fgOnly) {
          const before = await api('/memory/export?format=json');
          result.checks.exportBeforeForget = before.status === 200 && before.body.content.includes('王小明');
          await page.getByRole('button', { name: '忘掉', exact: true }).click();
          const response = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname.includes('/memory/items/'));
          await page.getByRole('button', { name: '确认忘掉', exact: true }).click();
          const removed = await response; result.memoryPageForget = { status: removed.status(), body: await removed.json() };
          if (removed.ok() && result.memoryPageForget.body.receipt.storageCleanup?.state === 'pending') {
            const requestId = result.memoryPageForget.body.receipt.requestId;
            result.cleanupRetry = await api(`/memory/commands/by-request/${requestId}/retry-cleanup`, {});
          }
          result.checks.memoryPageForget = removed.ok() && (result.cleanupRetry?.body.receipt ?? result.memoryPageForget.body.receipt).storageCleanup?.state !== 'pending';
          result.checks.originalChatRetained = (await events(A)).some(event => event.type === 'user.message' && event.data.text === original);
          if (result.checks.memoryPageForget) { await leaveMemoryPage(); await openMemoryPage(); }
          else if (await page.getByRole('button', { name: '关闭记忆详情', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭记忆详情', exact: true }).click();
        } else await page.getByRole('button', { name: '关闭记忆详情', exact: true }).click();
        await leaveMemoryPage();
      }
      result.deletions = [];
      // Remove every synthetic conversation that observed these facts, including recall
      // replies, so retained chat cannot masquerade as a memory-export failure.
      for (const id of capturedSessions) {
        await openSession(id);
        const list = (await api('/sessions?archived=all')).body.sessions;
        const row = list.find(s => s.sessionId === id); if (!row) continue;
        await page.locator('.session-row').filter({ has: page.locator('button.is-current') }).getByRole('button', { name: /^更多操作 / }).click();
        await page.getByRole('menuitem', { name: /^删除(?:\s*D)?$/ }).click();
        await page.getByRole('checkbox', { name: '同时忘掉从这段对话形成的记忆' }).check();
        (result.forgetPreviews ??= []).push({ sessionId: id,
          ...await api(`/sessions/${id}/forget-preview`) });
        if (result.deletions.length === 0) await page.screenshot({ path: join(evidence, `${modelName}-forget.png`) });
        const response = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname === `/personal/v1/sessions/${id}`);
        await page.getByRole('button', { name: '永久删除', exact: true }).click();
        const deleted = await response; result.deletions.push({ sessionId: id, status: deleted.status(), body: await deleted.json() });
        if (deleted.ok()) await page.getByRole('dialog', { name: '删除对话', exact: true }).waitFor({ state: 'hidden' });
        else {
          // A failed true-forget is a product failure, not a hidden-dialog timeout.
          // Leave the failed conversation intact and continue collecting export evidence.
          await page.getByRole('dialog', { name: '删除对话', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
        }
      }
      const remaining = await items(); result.remaining = remaining;
      result.checks.forgotSourceEvidence = result.deletions.some(row => row.status === 200 && row.body.forgottenEvidenceCount > 0);
      result.checks.allConversationsDeleted = result.deletions.length === capturedSessions.size && result.deletions.every(row => row.status === 200);
      result.checks.noFormalFact = !remaining.some(item => /王小明|好兄弟|表弟/.test(item.text));
      if (fgOnly) {
        result.memoryExports = [];
        for (const format of ['json', 'markdown']) {
          const exported = await api(`/memory/export?format=${format}`); result.memoryExports.push(exported);
        }
        result.checks.memoryExportsExcludeForgotten = result.memoryExports.every(value => value.status === 200 && !/王小明|好兄弟|表弟/.test(value.body.content));
      }
      // BK-1 additionally checks fresh archives after the source chats are deleted.
      const exported = await api('/backups', {}); result.export = { kind: 'BK-1 local backup', status: exported.status, dedicatedMemoryExport: fgOnly };
      result.checks.exportSucceeded = exported.status === 202 && exported.body.state === 'succeeded';
      if (result.checks.exportSucceeded) {
        const archive = join(root, 'Backups', exported.body.backup.id), extracted = join(root, 'export-check');
        mkdirSync(extracted);
        const manifest = await verify(archive, extracted);
        const affected = walk(extracted).filter(file => exportHasForgottenName(readFileSync(file), file)).map(file => relative(extracted, file).replaceAll('\\', '/'));
        result.export.filesWithForgottenName = affected;
        result.export.files = manifest.files.length;
        result.checks.exportNoRecoverableBytes = affected.length === 0;
        const { stdout } = await run(python, [join(repository, 'tests/integration/m2-backup-text-scan.py'),
          join(extracted, relative(profile, dbPath())), '王小明', '好兄弟', '表弟', original, correction]);
        result.export.databaseTextScan = JSON.parse(stdout);
        result.checks.exportNoRecoverableDatabase = result.export.databaseTextScan.hitCount === 0;
      }
      const turn = await message(await session(modelName, false), recallQuestion);
      result.checks.noRecallAfterForget = turn.status === 'completed' && !turn.memoryUsed.length && !/王小明/.test(turn.reply);
      result.semantic = await semantic(turn, '遗忘后不知道此前组队对象，不应重新说出王小明。');
    });
    await step('08', 'Core 真进程停止且无法重启、普通聊天和提示', async result => {
      const outageSession = fgOnly ? (outageOnly ? A : report.turns.at(-1).sessionId) : null;
      if (outageSession) await openSession(outageSession);
      const killed = await app.evaluate(() => globalThis.m2ExitBreakCore()); result.killedCoreProcesses = killed.length;
      await pause(1000); result.memory = (await api('/memory/status')).body;
      const turn = await message(outageSession ?? await session(modelName, false), '你好，请用一句中文打个招呼。');
      result.checks = { actualCoreStopped: killed.length > 0, unavailable: result.memory.state === 'unavailable', chatCompleted: turn.status === 'completed' && turn.reply.trim().length > 0,
        noMemoryInjected: turn.memoryUsed.length === 0 };
      result.chatNotice = await page.locator('body').innerText();
      result.checks.chatNotice = /记忆.{0,20}(?:不可用|中断|离线|故障|无法)/.test(result.chatNotice);
      await page.screenshot({ path: join(evidence, `${modelName}-core-unavailable-chat.png`) });
      await openMemoryPage();
      await until(async () => /不可用|无法/.test(await page.locator('#memory-status').innerText()));
      result.memoryNotice = await page.locator('#memory-status').innerText();
      result.checks.memoryPageNotice = /不可用|无法/.test(result.memoryNotice);
      await page.screenshot({ path: join(evidence, `${modelName}-core-unavailable-memory.png`) });
      await leaveMemoryPage();
      if (fgOnly) {
        await page.setViewportSize({width:390,height:844});
        await until(async () => await page.locator('#chat-memory-notice').isVisible());
        result.checks.mobileWebNotice = (await page.locator('#chat-memory-notice').innerText()).includes('不会用到或记住新内容');
        await page.screenshot({path:join(evidence,`${modelName}-core-unavailable-mobile-web.png`)});
        await app.evaluate(() => globalThis.m2ExitRestoreCore());
        await until(async () => ['ready','degraded'].includes((await api('/memory/status')).body.state) && (await api('/memory/status')).body.capabilities?.list === true, 60000, 'Core recovery');
        await until(async () => !(await page.locator('#chat-memory-notice').isVisible()), 30000, 'notice recovery');
        result.checks.recoveryClearsNotice = true;
        await page.screenshot({path:join(evidence,`${modelName}-core-recovered-mobile-web.png`)});
        await page.setViewportSize({width:1200,height:800});
        await page.screenshot({path:join(evidence,`${modelName}-core-recovered-chat.png`)});
      }
      result.semantic = await semantic(turn, '记忆服务故障时普通问候仍可用。');
    });
    if (!eightOnly) await step('speed', '同一对话重复任务的步骤与耗时', async result => {
      // Restore only the isolated Core process seam before this independent task.
      await close(); await launch(true);
      const id = await session(modelName, false);
      const first = await message(id, '请在本对话默认工作目录创建 triangle.py：用 Python 打印 1 到 n 的三角数，n 从命令行参数读取。运行 n=8，检查输出 36。写经验.md 简短记录脚本路径与使用命令。只在默认工作目录写文件。');
      const scripts = walk(join(profile, 'conversations')).filter(file => file.endsWith('triangle.py'));
      const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
      const beforeHash = scripts.length === 1 ? hash(scripts[0]) : null;
      const beforeMtimeMs = scripts.length === 1 ? statSync(scripts[0]).mtimeMs : null;
      const second = await message(id, '用这段对话已有的方法计算 n=12 的三角数。');
      const details = [];
      for (const event of second.events ?? []) if (event.type === 'step.started') details.push((await api(`/sessions/${id}/events/${event.seq}/detail`)).body.text ?? '');
      const text = details.join('\n');
      first.outputVerified = /(?:^|\D)36(?:\D|$)/.test(first.reply);
      second.outputVerified = /(?:^|\D)78(?:\D|$)/.test(second.reply);
      second.reusedScript = beforeHash !== null && hash(scripts[0]) === beforeHash && statSync(scripts[0]).mtimeMs === beforeMtimeMs && /(?:python|py)\b[^\n]*triangle\.py/.test(text);
      result.measurement = speedComparison(first, second);
      result.checks = { sameConversation: first.sessionId === second.sessionId, verifiedReuseAndImprovement: result.measurement.passed === true };
      result.toolDetails = details;
    });
  } catch (error) { report.fatal = redact(error.message); persist(); console.log(`${modelName} setup/fatal: ${report.fatal}`); }
  finally {
    await close();
    report.finishedAt = new Date().toISOString();
    report.summary = { passed: report.steps.filter(step => step.status === 'passed').length, failed: report.steps.filter(step => step.status !== 'passed').length,
      eightStepGate: report.steps.filter(step => /^0[1-8]$/.test(step.id)).length === 8 && report.steps.filter(step => /^0[1-8]$/.test(step.id)).every(step => step.status === 'passed') };
    const trace = readFileSync(join(root, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    // Count actual upstream requests only, excluding the local scheduler proxy.
    const starts = trace.filter(row => row.phase === 'start' && row.requestedModel === 'mimo-v2.6-flash' && row.origin === 'https://api.xiaomimimo.com');
    const uses = trace.filter(row => row.phase === 'end' && row.usage && starts.some(start => start.id === row.id));
    const sum = field => uses.reduce((total, row) => total + (field(row.usage) ?? 0), 0);
    report.mimoUsage = { requests: starts.length, returnedUsage: uses.length, missingUsage: starts.length - uses.length,
      input: sum(u => u.prompt_tokens), cached: sum(u => u.prompt_tokens_details?.cached_tokens), output: sum(u => u.completion_tokens) };
    for (const verdict of report.directJudgements ?? []) {
      report.mimoUsage.requests++;
      if (!verdict.usage) { report.mimoUsage.missingUsage++; continue; }
      report.mimoUsage.returnedUsage++;
      report.mimoUsage.input += verdict.usage.prompt_tokens ?? 0;
      report.mimoUsage.cached += verdict.usage.prompt_tokens_details?.cached_tokens ?? 0;
      report.mimoUsage.output += verdict.usage.completion_tokens ?? 0;
    }
    report.mimoUsage.knownCnyLowerBound = (report.mimoUsage.input - report.mimoUsage.cached + report.mimoUsage.cached * 0.02 + report.mimoUsage.output * 2) / 1000000;
    // No synthetic passwords, setup grants, API keys, private endpoints in artifacts.
    const sensitive = /credentials\.json$|(?:Cookies|Trust Tokens)(?:-journal)?$|setup-[^/]+\.json$|secure-snapshot.*\.yml$|security-credentials\.patch\.yml$/;
    for (const file of walk(root)) if (sensitive.test(file.replaceAll('\\', '/'))) rmSync(file, { force: true });
    report.credentialScan = scan(root); assert.equal(report.credentialScan.matches, 0);
    persist();
  }
}
function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const file = join(directory, name), info = lstatSync(file);
    return info.isSymbolicLink() ? [] : info.isDirectory() ? walk(file) : [file];
  });
}
function scan(directory) {
  const files = walk(directory), matches = files.filter(file => secrets.some(secret => readFileSync(file).includes(Buffer.from(secret))));
  return { scanned: files.length, matches: matches.length };
}
try {
  if (process.argv.includes('--four')) { await acquireLan(); await baseline(provider ?? 'lan', true); }
  else {
    if (!provider || provider === 'mimo') await baseline('mimo');
    if (!provider || provider === 'lan') { await acquireLan(); await baseline('lan'); }
    if (!provider && !eightOnly && !remindersOnly) await baseline('lan', true);
  }
} finally {
  if (bridge) { await bridge.close(); save(join(evidence, 'lan-serial.json'), bridge.metrics()); }
  clearInterval(lockTimer);
  if (ownsLock && readFileSync(lockPath, 'utf8').startsWith(lockToken)) rmSync(lockPath);
  const usage = reports.reduce((total, report) => {
    for (const name of ['requests', 'returnedUsage', 'missingUsage', 'input', 'cached', 'output', 'knownCnyLowerBound']) total[name] = (total[name] ?? 0) + (report.mimoUsage?.[name] ?? 0);
    return total;
  }, {});
  save(join(evidence, 'usage.json'), usage);
  save(join(evidence, 'run-roots.json'), roots);
  const publicScan = scan(evidence); save(join(evidence, 'credential-scan.json'), publicScan); assert.equal(publicScan.matches, 0);
  // Optional assertion mode lets CI consume the same evidence without treating
  // a successfully completed baseline collection as a passing product exit.
  if (process.argv.includes('--require-pass') && reports.some(report => report.fatal ||
    (report.four ? !report.four.passedGate : remindersOnly ? report.steps.length !== 6 || report.steps.some(step => step.status !== 'passed') : fgOnly ? !report.steps.length || report.steps.some(step => step.status !== 'passed') : !report.summary?.eightStepGate || (!eightOnly && report.steps.find(step => step.id === 'speed')?.status !== 'passed')))) process.exitCode = 1;
  console.log(JSON.stringify({ roots, usage, credentialScan: publicScan }));
}
