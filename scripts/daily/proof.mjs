// 用法：node scripts/daily/proof.mjs --builds <builds> --version 0.2.0-preview.N
// 在已安装日用版中用原有模型新建两段对话，验证「你好」和算术回复。
// 只清理本脚本创建且没有其他输入的对话，最后正常拉起日用版并保存报告。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parseOptions, json, until, dailyPaths, dailyEnv, processes, startDaily } from './common.mjs';

const { version, output } = parseOptions('proof');
const repo = join(output, 'source-final');
const { _electron } = createRequire(join(repo, 'package.json'))('playwright');
const { exe: installed, configFile } = dailyPaths();
const root = (await json(configFile)).dataDirectory;
const env = dailyEnv(), pids = () => processes(installed, env);
const store = () => json(join(root, 'personal-access/store.json'));
const host = () => json(join(root, 'dsh-home/weftmate-host-state.json'));
const wait = (check, label, ms = 90000) => until(check, 'Timeout: ' + label, ms, 250);
const report = { version, passed: false, receipts: [], cleanup: [] };
let app, page, owner, priorIds;
const save = () => writeFile(join(output, 'daily-proof.json'), JSON.stringify(report, null, 2));
const events = id => page.evaluate(async id =>
  (await proofCore.accessApi('/sessions/' + encodeURIComponent(id) + '/events?limit=180')).events, id);
const idsToClean = new Set();

async function verifiedCreatedIds() {
  const acc = (await store()).accounts[owner], calls = await page.evaluate(() => globalThis.proofCalls || []);
  const ours = new Set(calls.filter(x => x.kind === 'session.create').map(x => x.requestId));
  return Object.values(acc.commands).filter(c => c.kind === 'session.create' && c.state === 'accepted_by_dsh' &&
    ours.has(c.requestId) && !priorIds.has(c.sessionId)).map(c => c.sessionId);
}

async function send(text, { fresh = false, model = null } = {}) {
  if (fresh) {
    await page.waitForFunction(() => !proofCore.state.submitting && !proofCore.state.unresolvedSubmission, null, { timeout: 60000 });
    await page.locator('#new-session').click();
    await page.waitForFunction(() => proofCore.state.newConversation && proofCore.state.selectedSessionId === null, null, { timeout: 60000 });
  }
  if (model) assert.equal(await page.evaluate(id => proofCore.selectModelProfile(id), model), true);
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  await input.fill(text);
  await page.waitForFunction(text => !proofCore.sendBlocker(text), text, { timeout: 30000 });
  const start = Date.now(), offset = await page.evaluate(() => { globalThis.proofCapture = true; return proofCalls.length; });
  try {
    await input.press('Enter');
    const receipt = await wait(async () => {
      const calls = await page.evaluate(n => proofCalls.slice(n), offset);
      const requests = new Set(calls.filter(c => c.kind === 'session.message').map(c => c.requestId));
      return Object.values((await store()).accounts[owner].commands).find(c => requests.has(c.requestId) &&
        c.payload?.text === text && ['accepted_by_dsh', 'uncertain', 'rejected'].includes(c.state));
    }, 'normal composer receipt', 60000);
    assert.equal(receipt.state, 'accepted_by_dsh', receipt.errorCode);
    const id = receipt.sessionId;
    assert.ok((await verifiedCreatedIds()).includes(id));
    idsToClean.add(id);
    const row = { id, requestId: receipt.requestId, sendAt: start,
      acceptedMs: Date.parse(receipt.updatedAt) - start, modelId: receipt.payload?.modelProfileId };
    report.receipts.push(row); await save(); return row;
  } finally {
    await page.evaluate(() => { globalThis.proofCapture = false; });
  }
}

async function reply(receipt, n) {
  const xs = await wait(async () => {
    const rows = await events(receipt.id);
    return rows.filter(x => x.type === 'turn.ended').length >= n && rows;
  }, 'model reply', 195000);
  const startEvent = xs.filter(e => e.type === 'turn.started')[n - 1], ended = xs.filter(e => e.type === 'turn.ended')[n - 1];
  const turn = xs.filter(e => e.seq >= startEvent.seq && e.seq <= ended.seq);
  const start = Date.parse(startEvent.at), finish = Date.parse(ended.at);
  const messages = turn.filter(e => e.type === 'assistant.message' && e.data?.text?.trim());
  const log = (await readFile(join(root, 'logs', 'host-' + new Date(start).toISOString().slice(0, 10) + '.jsonl'), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  const request = log.find(e => e.event === 'model.start' && e.priority === 'foreground' && e.sessionId === receipt.id &&
    Date.parse(e.at) >= start && Date.parse(e.at) <= finish);
  const steps = turn.filter(e => e.type === 'step.completed').map(e => ({ tool: e.data?.toolName, state: e.data?.state }));
  return { reason: ended.data.reason, assistantMessages: messages.length, beforeModelMs: request ? Date.parse(request.at) - start : null,
    sendToEndMs: finish - receipt.sendAt, tools: steps,
    arithmetic13: messages.some(e => /^\s*13[。.！!]?\s*$/.test(e.data.text)),
    officialSource: messages.some(e => /https?:\/\/docs\.python\.org\//i.test(e.data.text)) };
}

async function clean() {
  const ours = await verifiedCreatedIds(), calls = new Set(report.receipts.map(c => c.requestId));
  for (const id of new Set([...idsToClean, ...ours])) {
    assert.ok(ours.includes(id) && !priorIds.has(id));
    const account = (await store()).accounts[owner];
    if (!account.sessions[id]) continue;
    const input = Object.values(account.commands).filter(c => c.kind === 'session.message' && c.sessionId === id);
    if (input.some(c => !calls.has(c.requestId))) throw Error('Another input appeared in the test conversation; preserved');
    const h = await host();
    await wait(async () => !(await (await fetch(h.runtime.origin + '/weftmate/api/v1/sessions')).json()).items
      .some(s => (s.id === id || s.sessionId === id) && s.running), 'wait before cleaning', 190000);
    const result = await page.evaluate(async id => {
      const preview = await proofCore.previewSessionForget(id);
      await proofCore.deleteSession(id, true, { worldRevision: preview.worldRevision });
      const dir = await proofCore.accessApi('/sessions?archived=all');
      return { id, deleted: !dir.sessions.some(s => s.sessionId === id) };
    }, id);
    assert.ok(result.deleted); report.cleanup.push(result); await save();
  }
}

try {
  report.sourceCommit = (await json(join(output, 'install-report.json'))).sourceCommit;
  const h = await wait(async () => {
    const state = await host();
    return state.app.version === version && state.runtime.state === 'listening' && state.personalAccess.state === 'listening' && state;
  }, 'normal services ready', 180000);
  assert.equal(h.app.version, version);
  await wait(async () => !(await (await fetch(h.runtime.origin + '/weftmate/api/v1/sessions')).json()).items
    .some(s => s.running), 'daily turns idle', 600000);
  const baseline = await store(); owner = baseline.desktopOwnerId;
  const acc = baseline.accounts[owner]; priorIds = new Set(Object.keys(acc.sessions));
  const cfg = await json(join(root, 'weftmate-settings.json'));
  const model = cfg.models.profiles.find(p => p.id === (acc.lastChatModelProfileId || acc.defaultModelProfileId));
  assert.ok(model); report.before = { sessions: priorIds.size, devices: Object.keys(acc.devices).length };
  const quit = spawnSync(installed, ['--quit', '--desktop-config=' + configFile], { env, windowsHide: true, timeout: 40000 });
  report.quitExitCode = quit.status;
  await wait(() => pids().length === 0, 'normal exit', 35000);
  app = await _electron.launch({ executablePath: installed, args: ['--desktop-config=' + configFile], env, cwd: repo, timeout: 120000 });
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.waitForURL('**/personal/v1/ui*', { timeout: 120000 });
  report.app = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }));
  assert.equal(report.app.version, version); assert.ok(report.app.packaged);
  await page.addInitScript(() => {
    let lib;
    Object.defineProperty(globalThis, 'WeftUiCore', { get: () => lib, set: value => {
      lib = value; const create = value.create;
      value.create = (...args) => {
        const core = create(...args); globalThis.proofCore ??= core; globalThis.proofUI ??= args[0].effects; return core;
      };
    } });
  });
  await page.reload();
  await page.waitForFunction(() => globalThis.proofCore?.state.ownerId, null, { timeout: 60000 });
  await page.evaluate(async () => { if (!proofCore.state.modelsKnown) await proofCore.refreshModels(); });
  await page.waitForFunction(() => proofCore.state.modelsKnown && !proofCore.state.refreshing && !proofCore.state.sessionSelecting,
    null, { timeout: 60000 });
  await page.evaluate(() => {
    globalThis.proofCalls = []; const submit = proofCore.submitCommand;
    proofCore.submitCommand = function (kind, fields, sessionId, requestId) {
      if (globalThis.proofCapture) proofCalls.push({ kind, requestId });
      return submit.call(this, kind, fields, sessionId, requestId);
    };
  });
  const first = await send('你好', { fresh: true, model: model.id });
  report.first = await reply(first, 1); await save();
  const second = await send('8 加 5 等于几？请只回复阿拉伯数字。', { fresh: true, model: model.id });
  assert.notEqual(first.id, second.id);
  report.second = await reply(second, 1); await save();
  for (const result of [report.first, report.second]) {
    assert.equal(result.reason, 'completed'); assert.ok(result.assistantMessages > 0);
  }
  assert.ok(report.second.arithmetic13, 'second real conversation answered 13');
  report.exercised = true;
} catch (error) {
  report.error = error.stack; process.exitCode = 1; console.error(error.message);
} finally {
  try {
    if (page && owner && await page.evaluate(() => Array.isArray(globalThis.proofCalls)).catch(() => false)) await clean();
  } catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
  try {
    const handle = app?.process(); await app?.close().catch(() => {});
    if (handle && handle.exitCode === null) await wait(() => handle.exitCode !== null, 'test window closed', 30000).catch(() => {});
    if (!pids().length) report.restarted = startDaily(installed, configFile, env);
  } catch (error) { report.restartError = error.stack; process.exitCode = 1; }
  report.passed = !!(report.exercised && report.cleanup.length === 2 && report.restarted &&
    !report.error && !report.cleanupError && !report.restartError);
  if (!report.passed) process.exitCode = 1;
  await save();
  console.log(JSON.stringify({ passed: report.passed, first: report.first, second: report.second,
    cleanup: report.cleanup.length, error: report.error?.split('\n')[0], cleanupError: report.cleanupError }));
}
