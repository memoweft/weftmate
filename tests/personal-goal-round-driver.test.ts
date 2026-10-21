/** Native driver contracts with scripted inference; this does not test a real model's understanding of guidance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { phoneRuntime } from '../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from './helpers/personal-access-test-service.mjs';
import { stagePersonalPlugins } from './support/personal-plugins.ts';

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-goal-host';
type Scenario = 'three-rounds' | 'already-achieved' | 'pause' | 'computer-multi-round';
type FlowOptions = { computerPolicy?: 'transmitted' | 'retain-human-control'; stripComputerBoundary?: boolean; negateComputerRules?: boolean };
const recordForRound = (round: number) => `Verified synthetic continuation round ${round}`;
const messageText = (message: any) => typeof message.content === 'string' ? message.content
  : (message.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
const systemText = (body: any) => [typeof body.system === 'string' ? body.system : '',
  ...(body.messages ?? []).filter((message: any) => message.role === 'system').map(messageText)].join('\n');
function computerBoundaryParagraph(body: any) {
  return systemText(body).split(/\n\s*\n/).find(text => text.trim().startsWith('Computer-tool boundary:')) ?? '';
}
function boundaryKeywordsPresent(body: any) {
  const paragraph = computerBoundaryParagraph(body).toLowerCase();
  return ['computer tools', 'read/write', 'current authorized human turn', 'pause', 'human continuation']
    .every(meaning => paragraph.includes(meaning));
}
function hasComputerBoundary(body: any) {
  const paragraph = computerBoundaryParagraph(body);
  const retainWork = /(?:^|[,;]\s*)(?:first\s+)?continue\s+(?:the\s+)?current\s+authorized\s+human\s+turn\b[^.]*\b(?:perform|do|finish|carry out)\b/i.test(paragraph);
  const pauseForHuman = /(?:^|[,;]\s*|\bthen\s+)pause\s+(?:the\s+)?goal\b[^.]*\b(?:explain|tell|report)\b[^.]*\bhuman\s+continuation\b/i.test(paragraph);
  const negatedCore = /\b(?:do not|never|must not)\s+(?:continue|pause)\b/i.test(paragraph);
  return boundaryKeywordsPresent(body) && retainWork && pauseForHuman && !negatedCore;
}

function nativeEvents(file: string, sessionId: string): any[] {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      .filter(row => row.sessionId === sessionId).map(row => row.event);
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function responseFor(scenario: Scenario, events: any[], body: any, options: FlowOptions = {}) {
  if (!body.tools?.length) return { content: '合成目标对话' }; // Separate native title request.
  const start = events.findLastIndex(event => event.type === 'turn/start');
  assert.ok(start >= 0, 'inference belongs to an actual open native turn');
  const current = events.slice(start + 1);
  const source = current.find(event => event.type === 'user/message' && ['user', 'goal'].includes(event.data.source.kind))?.data.source;
  assert.ok(source, 'turn input has native human or admitted goal provenance');
  const turn = events[start].data.turn;
  const calls = current.filter(event => event.type === 'tool/call');
  const lastGoal = events.findLast(event => event.type === 'goal/change')?.data.goal;
  const call = (name: string, args: any): any => {
    if (!body.tools.some((tool: any) => tool.function.name === name)) return call('load_tools', { names: [name] });
    return { content: '', tool_calls: [{ id: `goal-contract-${turn}-${calls.length}-${name}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] };
  };
  const objective = scenario === 'computer-multi-round' ? 'Read input.txt, write and verify p1-result.txt; three independent computer rounds are required overall'
    : scenario === 'three-rounds' ? 'Record three independent continuation rounds, then complete'
    : scenario === 'already-achieved' ? 'Create the synthetic goal and verify its exact active state in this human turn' : 'Create the synthetic goal, then pause it';
  if (!lastGoal) {
    assert.equal(source.kind, 'user', 'creation must originate in a real human turn');
    return call('create_goal', { objective, max_goal_rounds: 5 });
  }
  if (lastGoal.phase !== 'active') return { content: scenario === 'computer-multi-round'
    ? '本次已读取文件、写入并核对结果；后续电脑轮需要你发起继续，目标已暂停。还没有完成三轮。'
    : `Synthetic goal is ${lastGoal.phase}.` };
  if (scenario === 'computer-multi-round') {
    // Explicit synthetic policy interpreter, not a claim about a real model.
    // It consumes transmitted SYSTEM policy and real native tool results only.
    const retained = options.computerPolicy === 'retain-human-control' || hasComputerBoundary(body);
    if (source.kind === 'user' && !retained) return { content: '已建立目标计划；结束人工回复，交给独立自动轮继续处理文件。' };
    const failed = current.findLast(event => event.type === 'tool/result' && event.data.message.content.some((part: any) => part.isError));
    if (failed) return { content: '本自动回合读取未完成，也未完成所要求的三轮；不能承诺后台文件操作。' };
    const completedCall = (name: string, path?: string) => calls.find(event => event.data.name === name &&
      (path === undefined || JSON.parse(event.data.arguments).file_path === path) && current.some(result =>
        result.type === 'tool/result' && result.data.message.source.callId === event.data.callId &&
        result.data.message.content.every((part: any) => !part.isError)));
    const input = completedCall('read', 'input.txt');
    if (!input) return call('read', { file_path: 'input.txt' });
    const receipt = body.messages.findLast((message: any) => message.role === 'tool' && message.tool_call_id === input.data.callId);
    const copied = messageText(receipt).match(/CI_R1_SYNTHETIC_FILE_CONTENT/)?.[0];
    assert.ok(copied, 'the write content must come from the actual successful read receipt');
    if (!completedCall('write', 'p1-result.txt')) return call('write', { file_path: 'p1-result.txt', content: copied + '\n' });
    if (!completedCall('read', 'p1-result.txt')) return call('read', { file_path: 'p1-result.txt' });
    const goalRead = completedCall('get_goal');
    if (!goalRead) return call('get_goal', {});
    const value = JSON.parse(body.messages.findLast((message: any) => message.role === 'tool' && message.tool_call_id === goalRead.data.callId).content);
    return call('update_goal', { goal_id: value.goal.id, revision: value.goal.revision, action: 'pause' });
  }
  if (source.kind === 'user' && scenario === 'three-rounds') return { content: 'Synthetic goal remains active; the native driver may admit continuation.' };
  const failed = current.findLast(event => event.type === 'tool/result' && event.data.message.content.some((part: any) => part.isError));
  if (failed) return { content: 'The synthetic action failed; its native error is retained by the local observer.' };
  if (source.kind === 'goal' && !current.some(event => event.type === 'todo/write')) {
    return call('todo_write', { todos: [{ content: recordForRound(source.round), status: 'completed' }] });
  }
  if (source.kind === 'goal' && source.round < 3) return { content: `Recorded continuation ${source.round}; verified work remains.` };
  const action = scenario === 'pause' ? 'pause' : 'complete';
  const read = calls.findLast(event => event.data.name === 'get_goal');
  if (!read) return call('get_goal', {});
  const toolMessage = body.messages.findLast((message: any) => message.role === 'tool' && message.tool_call_id === read.data.callId);
  assert.ok(toolMessage, 'update uses the actual get_goal tool receipt from this turn');
  const value = JSON.parse(toolMessage.content);
  assert.equal(value.goal.phase, 'active');
  return call('update_goal', { goal_id: value.goal.id, revision: value.goal.revision, action });
}

async function removeLinks(directory: string) {
  for (const row of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, row.name);
    if ((await lstat(file)).isSymbolicLink()) await unlink(file);
    else if (row.isDirectory()) await removeLinks(file);
  }
}

async function runScenario(scenario: Scenario, options: FlowOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-goal-driver-contract-'));
  const observed = join(root, 'native-events.jsonl'), outcomes = join(root, 'native-tool-outcomes.jsonl'), logs: string[] = [];
  let capturedRequest: any;
  let sessionId = '', runtime: any, host: any;
  const until = async (read: () => Promise<any>) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const value = await read(); if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    const events = nativeEvents(observed, sessionId);
    throw new Error('native goal driver did not settle: ' + JSON.stringify({ tail: events.slice(-8),
      firstCalls: events.filter(event => event.type === 'tool/call').slice(0, 8),
      lastResults: events.filter(event => event.type === 'tool/result').slice(-3) }) + '\n' + logs.slice(-12).join('\n'));
  };
  try {
    const staged = stagePersonalPlugins(join(root, 'staged'));
    const { presentPersonalGoalWorkflow } = await import(pathToFileURL(staged.stageFile(resolve('src/plugins/weftmate-personal-schedules.mjs'))).href);
    const base = 'SYNTHETIC_EXISTING_GOAL_POLICY';
    const goalGuidance = presentPersonalGoalWorkflow({ sections: [{ name: 'tool:goal', text: base }] }).sections[0].text.slice(base.length).trim();
    assert.ok(goalGuidance, 'the exported presenter supplies a goal guidance extension');
    const evidence = process.env.WEFTMATE_GOAL_CONTRACT_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence, { recursive: true });
    const label = scenario === 'computer-multi-round' ? `p1-${options.computerPolicy ?? 'transmitted'}${options.stripComputerBoundary ? '-without-boundary' : ''}${options.negateComputerRules ? '-negated-core' : ''}` : scenario;
    const artifactStem = `h5-${label}-${randomUUID()}`;
    const evidencePaths = evidence ? { request: join(evidence, `${artifactStem}-actual-request.json`),
      trajectory: join(evidence, `${artifactStem}-trajectory.json`) } : null;
    runtime = await phoneRuntime(root, logs, { respond: (body: any) => {
      if (!capturedRequest && body.tools?.some((tool: any) => ['create_goal', 'get_goal', 'update_goal'].includes(tool.function.name))) {
        // Ordinary driver cases do not interpret guidance. The explicitly
        // labelled computer policy case reads the actual transmitted system.
        capturedRequest = { system: body.system ?? null, messages: body.messages,
          tools: body.tools.map((tool: any) => tool.function.name) };
        if (evidencePaths) writeFileSync(evidencePaths.request, JSON.stringify(capturedRequest, null, 2));
      }
      return responseFor(scenario, nativeEvents(observed, sessionId), body, options);
    } });
    const home = join(root, 'dsh-home'), plugins = join(home, 'profiles', 'weftmate', 'plugins');
    await mkdir(plugins, { recursive: true });
    // Observe committed production session events. Never synthesize goal sources, turns or state changes.
    await writeFile(join(plugins, 'goal-driver-contract-observer.mjs'), `import { appendFileSync } from 'node:fs';
export const name = 'goal-driver-contract-observer';
export function apply(ctx) {
  if (${Boolean(options.stripComputerBoundary || options.negateComputerRules)}) ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return {...assembly, sections: assembly.sections.map(section => section.name === 'tool:goal'
      ? {...section, text: section.text.split(/\\n\\s*\\n/).map(paragraph => {
        if (!paragraph.trim().startsWith('Computer-tool boundary:')) return paragraph;
        if (${Boolean(options.stripComputerBoundary)}) return '';
        return paragraph.replace('continue the current authorized human turn', 'do not continue the current authorized human turn')
          .replace('then pause the goal', 'then do not pause the goal');
      }).filter(Boolean).join('\\n\\n')}
      : section)};
  }, {prepend: true, global: true});
  ctx.on('session/event', (session, event) => {
    appendFileSync(${JSON.stringify(observed)}, JSON.stringify({sessionId: session.id, event}) + '\\n');
  });
  ctx.on('tools/post-execute', (exec, result, next) => {
    appendFileSync(${JSON.stringify(outcomes)}, JSON.stringify({name: exec.name, arguments: exec.arguments,
      callId: exec.callId, error: result.error, isError: result.isError}) + '\\n');
    return next();
  });
  ctx.on('tools/execute', async (exec, next) => {
    try { return await next(); }
    catch (error) {
      const events = exec.agent?.session?.events ?? [];
      const start = events.findLastIndex(event => event.type === 'turn/start');
      appendFileSync(${JSON.stringify(outcomes)}, JSON.stringify({name: exec.name, arguments: exec.arguments,
        callId: exec.callId, turn: events[start]?.data.turn,
        nativeInputSources: events.slice(start + 1).filter(event => event.type === 'user/message' &&
          ['user', 'goal'].includes(event.data.source.kind)).map(event => event.data.source),
        thrown: {message: error.message, code: error.code, info: error.info, stack: error.stack}}) + '\\n');
      throw error;
    }
  }, {prepend: true});
}
`);
    const patch = join(home, 'model.yml');
    await writeFile(patch, await readFile(patch, 'utf8') + '\n- insert:\n    - id: goal-driver-contract-observer\n      name: ./plugins/goal-driver-contract-observer.mjs\n');
    host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend });
    runtime.setHost(host); await runtime.start();
    const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant,
        username: 'SyntheticGoal', password: 'Synthetic goal contract password', deviceName: 'synthetic-goal-device' }) });
    assert.equal(setup.status, 201);
    const auth: any = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const api = async (path: string, body?: any) => {
      const response = await fetch(origin + '/personal/v1' + path, { method: body ? 'POST' : 'GET',
        headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken },
        body: body ? JSON.stringify(body) : undefined });
      const value: any = await response.json(); assert.ok(response.ok, JSON.stringify({ path, error: value.error })); return value;
    };
    const project = scenario === 'computer-multi-round' ? (await api('/projects', { requestId: randomUUID(),
      name: 'Synthetic goal computer work', rootPath: runtime.project, permission: 'write' })).project : null;
    const creation = project ? (await api(`/projects/${project.projectId}/sessions`, { requestId: randomUUID(), modelProfileId: 'synthetic' })).command
      : (await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' })).command;
    sessionId = await until(async () => {
      const row = (await api('/commands/' + creation.commandId)).command;
      return row.state === 'accepted_by_dsh' && row.sessionId;
    });
    if (project) {
      const session = (await api('/sessions')).sessions.find((item: any) => item.sessionId === sessionId);
      assert.equal(session.mode, 'work'); assert.equal(session.projectId, project.projectId);
    }
    await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId,
      sessionId, text: scenario === 'computer-multi-round'
        ? '请创建一个分三轮检查文件的长期目标，每轮在选定目录读取 input.txt、写入 p1-result.txt 并核对结果。后续独立电脑轮若缺少授权，请暂停并说明需要我继续，不要把同一回合冒称成三轮。'
        : 'Synthetic native goal driver contract: ' + scenario, intent: 'queue' });
    const terminalPhase = ['pause', 'computer-multi-round'].includes(scenario) ? 'paused' : 'complete';
    await until(async () => {
      const events = nativeEvents(observed, sessionId);
      const failure = events.find(event => event.type === 'tool/result' && event.data.message.content.some((part: any) => part.isError));
      if (failure && scenario === 'computer-multi-round') return true;
      if (failure) throw new Error('native goal contract tool failure: ' + JSON.stringify(failure)
        + '\nUntranslated local outcomes:\n' + readFileSync(outcomes, 'utf8'));
      const change = events.findLast(event => event.type === 'goal/change');
      const lastStart = events.findLast(event => event.type === 'turn/start');
      const lastEnd = events.findLast(event => event.type === 'turn/end');
      if (change?.data.goal.phase !== terminalPhase || !lastEnd || lastEnd.data.turn !== lastStart?.data.turn) return false;
      const row = (await api('/sessions')).sessions.find((item: any) => item.sessionId === sessionId);
      return row && !row.running;
    });
    const projection = (await api('/goals')).items.find((item: any) => item.source.sessionId === sessionId);
    assert.ok(projection, 'production host exposes the native goal projection');
    const files = { input: await readFile(runtime.input, 'utf8'), output: await readFile(join(runtime.project, 'p1-result.txt'), 'utf8').catch(() => null) };
    const executionRecords = scenario === 'computer-multi-round' ? (await api('/execution-records?limit=100')).items : [];
    await runtime.close(); runtime = undefined;
    const events = nativeEvents(observed, sessionId);
    if (scenario !== 'computer-multi-round') assert.ok(events.filter(event => event.type === 'turn/end').every(event => event.data.reason.kind === 'completed'),
      'each real driver turn finishes normally');
    if (scenario !== 'computer-multi-round') assert.ok(events.filter(event => event.type === 'tool/result').every(event =>
      event.data.message.content.every((part: any) => part.type !== 'tool-result' || !part.isError)),
    'the scripted actions have successful native tool receipts');
    assert.ok(capturedRequest, 'an actual HTTP request with native goal tools was captured');
    const rawOutcomes = readFileSync(outcomes, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const result = { events, projection, files, executionRecords, rawOutcomes, evidencePaths,
      computerBoundarySent: hasComputerBoundary(capturedRequest), computerBoundaryKeywordsPresent: boundaryKeywordsPresent(capturedRequest),
      goalGuidanceSent: systemText(capturedRequest).includes(goalGuidance) };
    if (evidencePaths && scenario === 'computer-multi-round') writeFileSync(evidencePaths.trajectory, JSON.stringify({
      ...result, events: events.filter(event => /^(?:goal|turn)\//.test(event.type) ||
        ['user/message', 'assistant/message', 'tool/call', 'tool/result'].includes(event.type)) }, null, 2));
    return result;
  } finally {
    await runtime?.close(); await host?.close();
    const rel = relative(resolve(tmpdir()), resolve(root));
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'cleanup stays inside its owned temporary root');
    await removeLinks(root); await rm(root, { recursive: true, force: true });
  }
}

test('native goal driver admits three independent rounds and completes before its five-round cap', { timeout: 60000 }, async t => {
  const { events, projection, goalGuidanceSent } = await runScenario('three-rounds');
  const changes = events.filter(event => event.type === 'goal/change');
  assert.equal(changes[0].data.operation, 'create');
  assert.equal(changes[0].data.goal.phase, 'active'); assert.equal(changes[0].data.roundsStarted, 0);
  const goalInputs = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal');
  assert.deepEqual(goalInputs.map(event => event.data.source.round), [1, 2, 3]);
  assert.ok(goalInputs.every(event => event.data.source.goalId === changes[0].data.goal.id));
  assert.ok(goalInputs.every(event => event.data.source.revision === changes[0].data.goal.revision));
  const turns = events.filter(event => event.type === 'turn/start');
  assert.equal(turns.length, 4, 'one initial human turn plus three native continuation turns');
  const roundTurns = goalInputs.map(input => events.findLast(event => event.seq < input.seq && event.type === 'turn/start').data.turn);
  assert.equal(new Set(roundTurns).size, 3);
  for (const [index, input] of goalInputs.entries()) {
    const start = events.findLastIndex(event => event.seq < input.seq && event.type === 'turn/start');
    const end = events.findIndex((event, position) => position > start && event.type === 'turn/end');
    assert.ok(end > start, 'each admitted round actually ends');
    const round = events.slice(start, end + 1);
    assert.equal(round.filter(event => event.type === 'todo/write').length, 1);
    assert.deepEqual(round.find(event => event.type === 'todo/write').data.todos,
      [{ content: recordForRound(index + 1), status: 'completed' }]);
    assert.ok(round.some(event => event.type === 'assistant/message' && event.data.message.content.some((part: any) =>
      part.type === 'text' && part.text.trim())), 'each round also produces a real assistant reply');
    assert.equal(round.some(event => event.type === 'goal/change' && event.data.goal.phase === 'complete'), index === 2);
  }
  const final = changes.at(-1).data;
  assert.equal(final.operation, 'complete'); assert.equal(final.goal.phase, 'complete');
  assert.equal(final.roundsStarted, 3); assert.equal(final.goal.maxGoalRounds, 5);
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1);
  assert.equal(projection.phase, 'complete'); assert.equal(projection.roundsStarted, 3); assert.equal(projection.maxGoalRounds, 5);
  t.diagnostic(JSON.stringify({ nativeGoalSources: goalInputs.map(event => event.data.source), nativeRoundTurns: roundTurns,
    phase: projection.phase, roundsStarted: projection.roundsStarted, maxGoalRounds: projection.maxGoalRounds,
    goalGuidanceSent }));
});

for (const scenario of ['already-achieved', 'pause'] as const) {
  test(`native goal driver ${scenario === 'pause' ? 'leaves a paused goal paused' : 'allows completion in the initial human turn'} without extra rounds`, { timeout: 60000 }, async t => {
    const { events, projection, goalGuidanceSent } = await runScenario(scenario);
    const changes = events.filter(event => event.type === 'goal/change');
    const final = changes.at(-1).data, phase = scenario === 'pause' ? 'paused' : 'complete';
    assert.equal(changes[0].data.operation, 'create'); assert.equal(changes[0].data.goal.phase, 'active');
    assert.equal(final.goal.phase, phase); assert.equal(final.roundsStarted, 0);
    assert.equal(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal').length, 0);
    assert.equal(events.filter(event => event.type === 'turn/start').length, 1);
    assert.equal(events.filter(event => event.type === 'turn/end').length, 1);
    assert.equal(projection.phase, phase); assert.equal(projection.roundsStarted, 0);
    assert.equal(projection.maxGoalRounds, 5);
    t.diagnostic(JSON.stringify({ nativeGoalSources: [], phase: projection.phase,
      roundsStarted: projection.roundsStarted, nativeTurns: events.filter(event => event.type === 'turn/start').map(event => event.data.turn),
      goalGuidanceSent }));
  });
}

test('classifying native todo snapshots does not authorize computer reads or writes from nonhuman sources', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-goal-tool-boundary-'));
  try {
    const staged = stagePersonalPlugins(root);
    const { trackPersonalExecution } = await import(staged.plugin);
    const sources = [
      { label: 'current native goal round', source: { kind: 'goal', goalId: 'synthetic-goal', revision: 1, round: 1 } },
      { label: 'no input source', source: undefined },
      { label: 'unknown plugin source', source: { kind: 'plugin', plugin: 'untrusted-synthetic-producer' } },
      { label: 'unknown goal identity', source: { kind: 'goal', goalId: 'unrecognized-goal', revision: 99, round: 1 } },
      { label: 'incomplete goal source', source: { kind: 'goal' } },
    ];
    for (const name of ['read', 'write']) for (const { label, source } of sources) {
      let bridgeCalls = 0, bodyCalls = 0;
      const args = { file_path: 'synthetic.txt', ...(name === 'write' ? { content: 'synthetic content' } : {}) };
      const events = [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'goal/change', data: { kind: 'goal/change', version: 1, operation: 'create', roundsStarted: 0,
          createdAt: 1, updatedAt: 1, goal: { id: 'synthetic-goal', revision: 1, objective: 'Synthetic goal', phase: 'active', maxGoalRounds: 5 } } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'turn/start', data: { turn: 2 } },
        { type: 'user/message', data: { content: [{ type: 'text', text: 'Synthetic nonhuman input' }], ...(source ? { source } : {}) } },
        { type: 'tool/call', data: { turn: 2, step: 1, callId: 'computer-boundary-call', name, arguments: JSON.stringify(args) } },
      ];
      const exec = { name, callId: 'computer-boundary-call', arguments: args,
        agent: { session: { id: 'synthetic-boundary-session', header: { agentPreset: 'personal-remote' }, events } } };
      await assert.rejects(() => trackPersonalExecution({ request: async () => { bridgeCalls++; return { state: 'running', executionId: 'unused' }; } },
        exec, async () => { bodyCalls++; return { isError: false, value: {} }; }),
      { code: 'TOOL_SOURCE_UNAVAILABLE' }, `${name}: ${label}`);
      assert.equal(bridgeCalls, 0, `${name}: ${label} never reaches host authorization`);
      assert.equal(bodyCalls, 0, `${name}: ${label} never executes the computer tool`);
    }
  } finally {
    const rel = relative(resolve(tmpdir()), resolve(root)); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
    await removeLinks(root); await rm(root, { recursive: true, force: true });
  }
});

function computerTrace(result: Awaited<ReturnType<typeof runScenario>>) {
  return { computerBoundarySent: result.computerBoundarySent, phase: result.projection.phase,
    computerBoundaryKeywordsPresent: result.computerBoundaryKeywordsPresent,
    roundsStarted: result.projection.roundsStarted, files: result.files, evidencePaths: result.evidencePaths,
    sources: result.events.filter(event => event.type === 'user/message' && ['user', 'goal'].includes(event.data.source.kind)).map(event => event.data.source),
    calls: result.events.filter(event => event.type === 'tool/call').map(event => event.data),
    failures: result.rawOutcomes.filter(row => row.thrown), executionRecords: result.executionRecords };
}

function assertRetainedComputerWork(result: Awaited<ReturnType<typeof runScenario>>) {
  assert.equal(result.files.output, result.files.input, 'the current authorized human turn must actually read, write and verify the file');
  const computerCalls = result.events.filter(event => event.type === 'tool/call' && ['read', 'write'].includes(event.data.name));
  assert.deepEqual(computerCalls.map(event => [event.data.name, JSON.parse(event.data.arguments).file_path]),
    [['read', 'input.txt'], ['write', 'p1-result.txt'], ['read', 'p1-result.txt']]);
  assert.ok(computerCalls.every(event => event.data.turn === 1), 'computer work remains in the actually authorized human turn');
  const human = result.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user');
  assert.equal(typeof human.data.source.rpcId, 'string', 'the receipt comes from the real authenticated API command');
  assert.equal(result.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal').length, 0);
  assert.equal(result.projection.phase, 'paused'); assert.equal(result.projection.roundsStarted, 0);
  assert.equal(result.events.some(event => event.type === 'goal/change' && event.data.goal.phase === 'complete'), false);
  for (const type of ['read', 'write']) assert.ok(result.executionRecords.some((row: any) => row.types.includes(type) &&
    row.executionState === 'completed' && row.projectId), `the real project host records a completed authorized ${type}`);
  assert.equal(result.rawOutcomes.some(row => row.thrown), false);
  const replies = result.events.filter(event => event.type === 'assistant/message').map(event => messageText(event.data.message)).join('\n');
  assert.match(replies, /暂停/); assert.match(replies, /需要你.*继续/);
  assert.doesNotMatch(replies, /(?:已完成|完成了)\s*(?:3|三)\s*轮/);
}

test('synthetic transmitted goal policy retains authorized human computer work and pauses unsupported future rounds', { timeout: 60000 }, async t => {
  const result = await runScenario('computer-multi-round');
  t.diagnostic(JSON.stringify(computerTrace(result)));
  assertRetainedComputerWork(result);
  assert.equal(result.computerBoundarySent, true, 'the actual HTTP request carries the explicit computer-tool boundary');
});

test('real human-timing control can read and write the selected project before pausing the same computer goal', { timeout: 60000 }, async t => {
  const result = await runScenario('computer-multi-round', { computerPolicy: 'retain-human-control' });
  t.diagnostic(JSON.stringify(computerTrace(result)));
  assertRetainedComputerWork(result);
});

test('removing only the transmitted computer boundary replays premature end and actual goal-source file denial', { timeout: 60000 }, async t => {
  const result = await runScenario('computer-multi-round', { stripComputerBoundary: true });
  t.diagnostic(JSON.stringify(computerTrace(result)));
  assert.equal(result.computerBoundarySent, false);
  assert.ok(result.events.some(event => event.type === 'user/message' && event.data.source.kind === 'goal'),
    'the real driver admits a goal round after the human setup reply ends');
  const denial = result.rawOutcomes.find(row => row.name === 'read' && row.thrown?.code === 'TOOL_SOURCE_UNAVAILABLE');
  assert.ok(denial, 'the actual production identity boundary rejects the later file read');
  assert.ok(denial.nativeInputSources.some((source: any) => source.kind === 'goal'));
  assert.equal(denial.nativeInputSources.some((source: any) => source.kind === 'user'), false);
  assert.equal(result.files.output, null);
  assert.equal(result.executionRecords.some((row: any) => row.executionState === 'completed' &&
    row.types.some((type: string) => ['read', 'write'].includes(type))), false);
  assert.notEqual(result.projection.phase, 'complete');
});

test('negating the transmitted retain-and-pause rules while keeping all boundary keywords rejects the computer policy', { timeout: 60000 }, async t => {
  const result = await runScenario('computer-multi-round', { negateComputerRules: true });
  t.diagnostic(JSON.stringify(computerTrace(result)));
  assert.equal(result.computerBoundaryKeywordsPresent, true, 'the marker and all five keywords survive this local instruction mutation');
  assert.equal(result.computerBoundarySent, false, 'negated retain-and-pause instructions are not a supported computer policy');
  const denial = result.rawOutcomes.find(row => row.name === 'read' && row.thrown?.code === 'TOOL_SOURCE_UNAVAILABLE');
  assert.ok(denial, 'the negative policy really causes a later native file read to be denied');
  assert.ok(denial.nativeInputSources.some((source: any) => source.kind === 'goal'));
  assert.equal(denial.nativeInputSources.some((source: any) => source.kind === 'user'), false);
  assert.equal(result.files.output, null);
  assert.equal(result.executionRecords.some((row: any) => row.executionState === 'completed' &&
    row.types.some((type: string) => ['read', 'write'].includes(type))), false);
  assert.notEqual(result.projection.phase, 'complete');
});
