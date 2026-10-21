/** H5 P1: one unchanged real-model request, authorized file work and honest remaining rounds. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zstdDecompressSync } from 'node:zlib';
import { sourceModelDesktop } from '../helpers/source-model-desktop.mjs';

const request = '请创建一个长期目标，分3轮读取当前项目的 input.txt 并核对内容，每轮把本轮核对结果分别写入 round-1.txt、round-2.txt、round-3.txt。每轮须实际读取和保存，三轮都完成后再结束目标。';
const fixture = await sourceModelDesktop('R1021-CONTROL-H5-COMPUTER');
const { root, page, api, until, capture, send, report } = fixture;
report.request = request;
report.requestSha256 = createHash('sha256').update(request).digest('hex');
report.sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
report.goalPluginSha256 = createHash('sha256').update(await readFile('src/plugins/weftmate-personal-schedules.mjs')).digest('hex');
let failure, sessionId;
async function nativeEvents() {
  const base = join(root, 'dsh-home', 'sessions');
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!/^session\.jsonl(?:\.zstd)?$/.test(entry.name)) continue;
      let bytes = await readFile(path), text = '';
      if (entry.name.endsWith('.zstd')) while (bytes.length) {
        const value = zstdDecompressSync(bytes, { info: true });
        assert.ok(value.engine.bytesWritten > 0);
        text += value.buffer.toString(); bytes = bytes.subarray(value.engine.bytesWritten);
      }
      else text = bytes.toString();
      const events = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (events.some(event => event.type === 'user/message' && event.data.source?.kind === 'user' &&
        event.data.content.some(part => part.type === 'text' && part.text === request))) matches.push(events);
    }
  }
  // Project session public IDs need not equal native persistence IDs. Locate
  // this fixture's exact human request, rather than assuming their equivalence.
  await visit(base);
  assert.ok(matches.length <= 1, 'one isolated native session owns the exact synthetic request');
  return matches[0] ?? [];
}
try {
  const folder = join(root, 'goal-computer-project'); await mkdir(folder);
  await writeFile(join(folder, 'input.txt'), 'SYNTHETIC_GOAL_FILE_CONTENT\n');
  const project = (await api('/projects', { requestId: randomUUID(), name: '合成文件目标', rootPath: folder, permission: 'write' })).project;
  const created = (await api(`/projects/${project.projectId}/sessions`, { requestId: randomUUID(), modelProfileId: 'synthetic' })).command;
  sessionId = await until(async () => {
    const command = (await api('/commands/' + created.commandId)).command;
    return command.state === 'accepted_by_dsh' && command.sessionId;
  }, 'authorized work session');
  // Exercise the existing automatic permission mode in an isolated write project.
  // This does not give native goal sources a human receipt.
  await api(`/sessions/${sessionId}/approval-mode`, { mode: 'auto' }, 'PATCH');
  await page.evaluate(async id => { await scenarioCore.refreshSessions(); await scenarioCore.selectSession(id); }, sessionId);
  await page.locator(`#session-list .session-row[data-session-id="${sessionId}"] > button`).first().click();
  await send(request);
  report.observations = [];
  const settled = await until(async () => {
    const events = await nativeEvents().catch(() => []);
    const start = events.findLast(event => event.type === 'turn/start');
    const end = events.findLast(event => event.type === 'turn/end');
    const change = events.findLast(event => event.type === 'goal/change');
    const state = change && { phase: change.data.goal.phase, roundsStarted: change.data.roundsStarted };
    if (state && JSON.stringify(state) !== JSON.stringify(report.observations.at(-1))) report.observations.push(state);
    if (!start || start.data.turn !== end?.data.turn) return false;
    const sessions = (await api('/sessions')).sessions;
    if (sessions.find(row => row.sessionId === sessionId)?.running) return false;
    const source = events.findLast(event => event.type === 'user/message' && ['user', 'goal'].includes((event.data.source ?? event.data.message?.source)?.kind));
    if (source?.data.source?.kind === 'goal' || state && ['paused', 'blocked', 'complete'].includes(state.phase)) return { events, state };
    return false;
  }, 'goal either pauses honestly or reaches its first unsupported computer continuation', 180000);
  report.goal = (await api('/goals')).items.find(row => row.source.sessionId === sessionId);
  report.events = settled.events.filter(event => /^(?:goal\/|turn\/)/.test(event.type) ||
    ['tool/call', 'tool/result', 'tool/code-dispatch-start', 'tool/code-dispatch', 'assistant/message', 'user/message'].includes(event.type));
  report.prompts = settled.events.filter(event => event.type === 'request/header').map(event => ({ seq: event.seq,
    system: event.data.header.system, toolNames: event.data.header.tools?.map(tool => tool.name) }));
  report.files = {};
  for (const name of ['input.txt', 'round-1.txt', 'round-2.txt', 'round-3.txt']) report.files[name] = await readFile(join(folder, name), 'utf8').catch(() => null);
  report.body = await page.locator('body').innerText();
  await capture('computer-goal-result');
  const calls = [];
  let source;
  for (const event of settled.events) {
    if (event.type === 'turn/start') source = undefined;
    if (event.type === 'user/message' && ['user', 'goal'].includes((event.data.source ?? event.data.message?.source)?.kind)) source = event.data.source ?? event.data.message.source;
    if (event.type === 'tool/call' || event.type === 'tool/code-dispatch-start') calls.push({ ...event.data, source });
  }
  report.callsWithNativeSource = calls;
  assert.ok(calls.some(call => call.name === 'read' && call.source?.kind === 'user'), 'the requested file is actually read in the existing authorized human turn');
  assert.ok(report.files['round-1.txt'], 'the current authorized file result is actually saved before ending the human turn');
  assert.equal(calls.some(call => ['read', 'write', 'edit', 'pwsh', 'bash'].includes(call.name) && call.source?.kind === 'goal'), false,
    'unsupported computer work must not be promised to a goal continuation');
  assert.equal(report.goal.phase, 'paused', 'remaining independent computer rounds stay explicitly incomplete until authorized human continuation');
  assert.equal(report.goal.roundsStarted, 0, 'same-human-turn file work is not counted as independent native goal rounds');
  assert.equal(report.goal.phase === 'complete', false, 'never claim three independent computer rounds completed');
  report.passed = true;
  console.log('H5 computer goal PASS: current authorized file work saved; unsupported future rounds paused honestly.');
} catch (error) {
  failure = error; process.exitCode = 1;
  await capture('computer-goal-first-failure').catch(() => {});
  console.error(error.message);
} finally {
  if (sessionId && !report.events) report.events = await nativeEvents().catch(() => []);
  await fixture.close(failure);
}
