/** H5/#594: unchanged three-round user request, real MiMo, native goal driver and UI. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zstdDecompressSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { sourceModelDesktop } from '../helpers/source-model-desktop.mjs';

const request = '请创建一个长期目标，名称为B2-R3算术验收：分3轮检查2加2的结果，每轮记录结果，完成3轮就结束。不要写文件，也不要定时提醒。';
const fixture = await sourceModelDesktop('R1021-CONTROL-H5');
const { root, page, api, until, capture, send, report } = fixture;
report.request = request;
report.sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
report.sourceHashes = {};
for (const name of ['src/plugins/weftmate-personal-schedules.mjs', 'src/plugins/weftmate-personal-desktop.mjs', 'src/plugins/personal-goal-guidance.mjs']) {
  const bytes = await readFile(name).catch(() => null);
  report.sourceHashes[name] = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
}
let failure, sessionId;
async function nativeEvents() {
  const base = join(root, 'dsh-home', 'sessions');
  const folder = (await readdir(base)).find(name => name.includes(sessionId));
  if (!folder) return [];
  const directory = join(base, folder, sessionId);
  const file = (await readdir(directory)).find(name => name === 'session.jsonl.zstd' || name === 'session.jsonl');
  if (!file) return [];
  let bytes = await readFile(join(directory, file)), text = '';
  if (file.endsWith('.zstd')) while (bytes.length) {
    const value = zstdDecompressSync(bytes, { info: true });
    assert.ok(value.engine.bytesWritten > 0);
    text += value.buffer.toString(); bytes = bytes.subarray(value.engine.bytesWritten);
  }
  else text = bytes.toString();
  return text.trim().split('\n').map(line => JSON.parse(line));
}
function roundEvidence(rows, goalId) {
  let turn;
  const rounds = [];
  for (const event of rows) {
    if (event.type === 'turn/start') turn = event.data.turn;
    const message = event.data?.message ?? event.data;
    const source = event.data?.source ?? message?.source;
    if (event.type === 'user/message' && source?.kind === 'goal' && source.goalId === goalId) {
      rounds.push({ round: source.round, turn, seq: event.seq, source, records: [] });
    }
    const current = rounds.find(row => row.turn === turn);
    if (!current) continue;
    if (event.type === 'assistant/message') current.records.push(...message.content.filter(part => part.type === 'text').map(part => part.text));
    if (event.type === 'tool/call' && event.data.name === 'todo_write') current.records.push(event.data.arguments);
  }
  return rounds;
}
try {
  const created = (await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: fixture.hostId, modelProfileId: 'synthetic' })).command;
  sessionId = await until(async () => {
    const value = (await api('/commands/' + created.commandId)).command;
    return value.state === 'accepted_by_dsh' && value.sessionId;
  }, 'new goal conversation');
  await page.evaluate(async id => { await scenarioCore.refreshSessions(); await scenarioCore.selectSession(id); }, sessionId);
  await page.locator(`#session-list .session-row[data-session-id="${sessionId}"] > button`).first().click();
  await send(request);
  report.observations = [];
  const goal = await until(async () => {
    const value = (await api('/goals')).items.find(row => row.source.sessionId === sessionId);
    if (!value) return;
    const state = { id: value.id, phase: value.phase, roundsStarted: value.roundsStarted, revision: value.revision, blockedReason: value.blockedReason };
    if (JSON.stringify(state) !== JSON.stringify(report.observations.at(-1))) report.observations.push(state);
    return ['complete', 'blocked', 'paused'].includes(value.phase) && value;
  }, 'three-round goal reaches a terminal state', 180000);
  report.goal = goal;
  const rows = await until(async () => {
    const value = await nativeEvents().catch(() => []);
    const change = value.findLast(row => row.type === 'goal/change');
    const start = value.findLast(row => row.type === 'turn/start');
    const end = value.findLast(row => row.type === 'turn/end');
    return change?.data.goal?.phase === goal.phase && start?.data.turn === end?.data.turn && value;
  }, 'native goal state is durable');
  report.rounds = roundEvidence(rows, goal.id);
  // Capture the native request header's system content, never its config or credentials.
  report.goalPromptSnapshots = rows.filter(row => row.type === 'request/header').map(row => ({
    seq: row.seq, system: row.data.header.system, toolNames: row.data.header.tools?.map(tool => tool.name),
  }));
  report.events = rows.filter(row => /^(?:goal\/|turn\/)/.test(row.type) || row.type === 'tool/call' ||
    row.type === 'assistant/message' || row.type === 'user/message' && (row.data.source ?? row.data.message?.source)?.kind === 'goal');
  await capture('conversation-result');
  await page.getByRole('button', { name: '目标', exact: true }).click();
  await page.evaluate(() => scenarioCore.readGoals());
  await until(async () => (await page.locator('body').innerText()).includes('B2-R3算术验收'), 'goal is visible in the real page');
  report.goalPage = await page.locator('body').innerText();
  await page.getByText(`已执行 ${goal.roundsStarted} 轮`, { exact: false }).first().scrollIntoViewIfNeeded();
  await capture('goal-page');
  assert.equal(goal.phase, 'complete', 'three rounds must complete rather than merely exhaust the continuation budget');
  assert.equal(goal.roundsStarted, 3, 'the first human reply is not an admitted automatic goal round');
  assert.deepEqual(report.rounds.map(row => row.round), [1, 2, 3], 'three real native goal-source messages must be admitted');
  assert.equal(new Set(report.rounds.map(row => row.turn)).size, 3);
  for (const round of report.rounds) assert.match(round.records.join('\n'),
    /2\s*(?:\+|＋|加)\s*2[\s\S]{0,60}(?:4|四)|(?:结果|等于|答案)[\s\S]{0,30}(?:4|四)/,
    `round ${round.round} must actually record its result`);
  const completed = rows.find(row => row.type === 'goal/change' && row.data.goal?.id === goal.id && row.data.goal.phase === 'complete');
  assert.ok(completed.seq > report.rounds[2].seq, 'completion follows admission of round 3');
  assert.equal(rows.some(row => row.type === 'tool/call' && ['schedule_create', 'write', 'edit', 'pwsh', 'bash'].includes(row.data.name)), false,
    'the arithmetic goal must not write files or create timed reminders');
  assert.match(report.goalPage, /已执行\s*3\s*轮/);
  report.passed = true;
  console.log('H5 PASS: three native goal rounds recorded results before completion; real goal page shows 3');
} catch (error) {
  failure = error; process.exitCode = 1;
  await capture('first-failure').catch(() => {});
  console.error(error.message);
} finally {
  await fixture.close(failure);
}
