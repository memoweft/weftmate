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
type Scenario = 'three-rounds' | 'already-achieved' | 'pause';
const recordForRound = (round: number) => `Verified synthetic continuation round ${round}`;

function nativeEvents(file: string, sessionId: string): any[] {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      .filter(row => row.sessionId === sessionId).map(row => row.event);
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function responseFor(scenario: Scenario, events: any[], body: any) {
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
  const objective = scenario === 'three-rounds' ? 'Record three independent continuation rounds, then complete'
    : scenario === 'already-achieved' ? 'Create the synthetic goal and verify its exact active state in this human turn' : 'Create the synthetic goal, then pause it';
  if (!lastGoal) {
    assert.equal(source.kind, 'user', 'creation must originate in a real human turn');
    return call('create_goal', { objective, max_goal_rounds: 5 });
  }
  if (lastGoal.phase !== 'active') return { content: `Synthetic goal is ${lastGoal.phase}.` };
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

async function runScenario(scenario: Scenario) {
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
    runtime = await phoneRuntime(root, logs, { respond: (body: any) => {
      if (!capturedRequest && body.tools?.some((tool: any) => ['create_goal', 'get_goal', 'update_goal'].includes(tool.function.name))) {
        // Capture wiring only: responseFor never reads the guidance or this snapshot.
        capturedRequest = { system: body.system ?? null, messages: body.messages,
          tools: body.tools.map((tool: any) => tool.function.name) };
        if (evidence) writeFileSync(join(evidence, `h5-${scenario}-actual-request.json`), JSON.stringify(capturedRequest, null, 2));
      }
      return responseFor(scenario, nativeEvents(observed, sessionId), body);
    } });
    const home = join(root, 'dsh-home'), plugins = join(home, 'profiles', 'weftmate', 'plugins');
    await mkdir(plugins, { recursive: true });
    // Observe committed production session events. Never synthesize goal sources, turns or state changes.
    await writeFile(join(plugins, 'goal-driver-contract-observer.mjs'), `import { appendFileSync } from 'node:fs';
export const name = 'goal-driver-contract-observer';
export function apply(ctx) {
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
    const creation = (await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: 'synthetic' })).command;
    sessionId = await until(async () => {
      const row = (await api('/commands/' + creation.commandId)).command;
      return row.state === 'accepted_by_dsh' && row.sessionId;
    });
    await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId,
      sessionId, text: 'Synthetic native goal driver contract: ' + scenario, intent: 'queue' });
    const terminalPhase = scenario === 'pause' ? 'paused' : 'complete';
    await until(async () => {
      const events = nativeEvents(observed, sessionId);
      const failure = events.find(event => event.type === 'tool/result' && event.data.message.content.some((part: any) => part.isError));
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
    await runtime.close(); runtime = undefined;
    const events = nativeEvents(observed, sessionId);
    assert.ok(events.filter(event => event.type === 'turn/end').every(event => event.data.reason.kind === 'completed'),
      'each real driver turn finishes normally');
    assert.ok(events.filter(event => event.type === 'tool/result').every(event =>
      event.data.message.content.every((part: any) => part.type !== 'tool-result' || !part.isError)),
    'the scripted actions have successful native tool receipts');
    assert.ok(capturedRequest, 'an actual HTTP request with native goal tools was captured');
    return { events, projection, goalGuidanceSent: JSON.stringify(capturedRequest).includes(goalGuidance) };
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
