/** Review regressions against owned Electron, native DSH, real Core and real MiMo. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { harness, until } from './ia-2b-harness.mjs';
import { redactEvidenceText } from '../helpers/process-evidence.mjs';
import { managedTempRoot, managedMkdtempSync, disposeManagedTemp } from '../helpers/managed-temp.mjs';

const out = process.env.WEFTMATE_FIX50_EVIDENCE;
assert.ok(out && resolve(out).endsWith(`${sep}evidence${sep}FIX-50`));
const report = { realElectron: true, realDsh: true, realCore: true, model: 'mimo-v2.6-flash', steps: [] };
let h, lease, scope;
const clean = value => redactEvidenceText(value, h ? [h.base] : []).replace(/https?:\/\/[^\s"'<>\\]+/g, '[URL]');
const save = () => writeFile(join(out, 'review-mimo-report.json'), clean(JSON.stringify(report, null, 2)) + '\n');
async function removeLinks(directory) {
  for (const row of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, row.name);
    if ((await lstat(file)).isSymbolicLink()) await unlink(file);
    else if (row.isDirectory()) await removeLinks(file);
  }
}
try {
  await mkdir(out, { recursive: true });
  scope = managedMkdtempSync('weftmate-fix50-review-scope-', { prune: false });
  process.env.WEFTMATE_TEST_TEMP_SCOPE = scope;
  while (!lease) {
    for (const id of [1, 2, 3]) {
      const file = `D:/AIProjects/WeftMate/Runtime/Orchestrator/locks/heavy-${id}.lock`;
      try { const handle = await open(file, 'wx'); await handle.writeFile(`FIX-50 fix-1 ${new Date().toISOString()} isolated Electron MiMo/Core`); await handle.close(); lease = file; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!lease) { console.log('FIX-50 waiting for a heavy slot'); await new Promise(resolve => setTimeout(resolve, 30000)); }
  }
  h = await harness('fix50-review', { memory: true, mainChat: true, modelTrace: true });
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFocusable(false));
  await h.app.evaluate(() => {
    globalThis.fix50Decisions = [];
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      let name; try { name = JSON.parse(args[1]?.body).tools?.[0]?.function?.name; } catch {}
      if (name?.startsWith('classify_forget_')) void response.clone().json().then(value =>
        fix50Decisions.push({ judge: name, choices: value.choices })).catch(() => {});
      return response;
    };
    const manager = ia2b.context.memoryManager;
    const forget = manager.forgetFromMessage.bind(manager);
    manager.forgetFromMessage = async (...args) => {
      try { const result = await forget(...args); fix50Decisions.push({ input: args[1].source.text, result }); return result; }
      catch (error) { fix50Decisions.push({ input: args[1].source.text, failure: error.code ?? error.name }); throw error; }
    };
    const plan = manager.planForget.bind(manager);
    manager.planForget = async (...args) => {
      const result = await plan(...args); fix50Decisions.push({ plan: result }); return result;
    };
  });
  const inputs = [
    '记住：我喜欢喝乌龙茶。',
    '不对，纠正我喝茶的偏好：我现在喜欢红茶，不是乌龙茶。请更新这条记忆。',
    '忘掉我喝茶的偏好，如果会删除来源原文就先别执行。',
    '忘掉我喝茶的偏好，会删除哪些数据？',
    '请把下面这句话翻译成英文：\n忘掉我喝茶的偏好。',
    '忘掉我喝茶的偏好，另外请计算12×13。',
    '记住：我的生日是五月一日。',
    '记住：妈妈的生日是六月一日。',
    '记住：同事小王的生日是七月一日。',
    '忘掉我的生日。',
    '记住：我的生日是五月一日。',
    '忘掉妈妈的生日。',
  ];
  const sourceRoutes = async items => {
    const result = [];
    for (const item of items.filter(item => item.kind === 'cognition')) result.push({ id: item.id, text: item.text,
      ...await h.api(`/memory/items/cognition/${item.id}/sources`) });
    return result;
  };
  for (let i = 0; i < inputs.length; i++) {
    const before = (await h.api('/memory/items?kind=all')).body.items ?? [];
    const create = await h.command({ requestId: randomUUID(), kind: 'session.create', targetDeviceId: h.hostId, modelProfileId: h.modelProfileId });
    const sessionId = create.sessionId;
    const command = await h.command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: h.hostId, sessionId, text: inputs[i] });
    const step = { input: inputs[i], sessionId, before }; report.steps.push(step); await save();
    const task = await h.complete(command);
    step.status = task.replyEvidence?.status; step.executionSteps = task.executionSteps;
    const events = (await h.api(`/sessions/${sessionId}/events`)).body.events ?? [];
    step.reply = events.filter(event => event.type === 'assistant.message').map(event => event.data?.text ?? '').join('\n');
    step.memoryStatus = await until(async () => {
      const status = (await h.api('/memory/status')).body;
      return !status.pendingFormationCount && !status.pendingBoundaryCount && status;
    }, 240000);
    step.items = (await h.api('/memory/items?kind=all')).body.items ?? [];
    step.oldSources = await sourceRoutes(before);
    step.sources = await sourceRoutes(step.items);
    step.decisions = await h.app.evaluate(() => { const rows = fix50Decisions; globalThis.fix50Decisions = []; return rows; });
    await save(); console.log(JSON.stringify({ step: i + 1, input: inputs[i], reply: step.reply,
      count: step.items.length, decisions: step.decisions.filter(row => row.result).map(row => row.result) }));
    if ([2, 3, 4].includes(i)) {
      assert.ok(step.oldSources.length >= 1);
      assert.ok(step.oldSources.every(row => row.status === 200 && row.body.sources.some(source => source.contentAvailable)), 'conditional/question/translation keeps old sources readable');
      assert.ok(step.decisions.some(row => row.result?.state === 'no_action'));
      assert.ok(step.decisions.every(row => !row.result || row.result.state !== 'applied'));
    }
    if (i === 5) {
      assert.match(step.reply, /156/); assert.match(step.reply, /已删除/);
      assert.ok(step.oldSources.every(row => row.status === 404), 'plain forgetting deletes every old tea source route');
    }
    if (i === 8) {
      for (const value of ['五月一日', '六月一日', '七月一日']) assert.ok(step.items.some(item => item.text.includes(value)), 'all three birthdays were actually remembered');
    }
    if (i === 9 || i === 11) {
      const removed = i === 9 ? '五月一日' : '六月一日', kept = i === 9 ? '六月一日' : '五月一日';
      assert.equal(step.items.some(item => item.text.includes(removed)), false);
      assert.ok(step.items.some(item => item.text.includes(kept)));
      assert.ok(step.items.some(item => item.text.includes('七月一日')));
      assert.ok(step.oldSources.filter(row => row.text.includes(removed)).every(row => row.status === 404));
      assert.ok(step.oldSources.filter(row => row.text.includes(kept) || row.text.includes('七月一日')).every(row => row.status === 200));
      assert.match(step.reply, /关于别人的没动/);
    }
  }
  report.passed = true;
} catch (error) { report.failure = clean(error.stack ?? String(error)); throw error; }
finally {
  if (h) {
    await h.close();
    for (const name of ['host.log', 'model-messages.jsonl', 'requests.jsonl']) await writeFile(join(out, 'review-mimo-' + name), clean(await readFile(join(h.base, name), 'utf8').catch(() => '')));
    await save();
    assert.ok(resolve(h.base).startsWith(resolve(managedTempRoot()) + sep));
    await removeLinks(h.base); await rm(h.base, { recursive: true, force: true });
  }
  if (lease) await unlink(lease);
  if (scope) disposeManagedTemp(scope);
  await save();
}
